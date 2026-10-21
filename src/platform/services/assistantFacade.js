import { ACTIONS } from '../contracts/capabilities.js';
import { browserClock } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';
import { calculateSnapshotChecksum } from '../validation/snapshotValidator.js';

export const ASSISTANT_FACADE_SCHEMA_VERSION = 1;
export const ASSISTANT_RESPONSE_MAXIMUM_AGE_MS = 10 * 60 * 1000;
export const ASSISTANT_NOTE_MAXIMUM_LENGTH = 240;

export const ASSISTANT_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  UNSUPPORTED_SCRIPT_TOPIC: 'UNSUPPORTED_SCRIPT_TOPIC',
  RESPONSE_NOT_FOUND: 'RESPONSE_NOT_FOUND',
  RESPONSE_EXPIRED: 'RESPONSE_EXPIRED',
  RESPONSE_SESSION_MISMATCH: 'RESPONSE_SESSION_MISMATCH',
  INQUIRY_NOT_FOUND: 'INQUIRY_NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  RESPONSE_FAILED: 'RESPONSE_FAILED',
  ATTACHMENT_FAILED: 'ATTACHMENT_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  LOCAL_STORAGE_QUOTA: 'LOCAL_STORAGE_QUOTA',
  READ_ONLY_RECOVERY: 'READ_ONLY_RECOVERY',
});

export const ASSISTANT_AUDIT_ACTIONS = Object.freeze({
  RESPONSE_ATTACHED: 'ASSISTANT_RESPONSE_ATTACHED',
});

const RESPONSE_ID_PREFIX = 'asr_';
const ATTACHMENT_ID_PREFIX = 'att_';
const SCRIPT_DISCLOSURE = 'Scripted demo — no model call';
const ALLOWED_RESPONSE_FIELDS = new Set(['topic', 'context']);
const ALLOWED_ATTACHMENT_FIELDS = new Set([
  'responseId',
  'note',
  'expectedInquiryRevision',
  'expectedRootRevision',
]);

function deepFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreeze(item)));
  }

  if (isPlainObject(value)) {
    const clone = {};

    Object.entries(value).forEach(([key, item]) => {
      clone[key] = deepFreeze(item);
    });

    return Object.freeze(clone);
  }

  return value;
}

function requireAssistantRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.getAssistantScript !== 'function' &&
      typeof value.findAssistantScript !== 'function')
  ) {
    throw new AssistantFacadeError(
      ASSISTANT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Assistant facade requires a repository with getAssistantScript() or findAssistantScript().',
    );
  }

  return value;
}

function requireInquiryRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.attachAssistantResponse !== 'function' &&
      typeof value.attachResponse !== 'function')
  ) {
    throw new AssistantFacadeError(
      ASSISTANT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Assistant facade requires an inquiry repository with attachAssistantResponse() or attachResponse().',
    );
  }

  return value;
}

function requirePermissionService(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new AssistantFacadeError(
      ASSISTANT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Assistant facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function requireAuditService(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.append !== 'function'
  ) {
    throw new AssistantFacadeError(
      ASSISTANT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Assistant facade requires an audit service with append().',
    );
  }

  return value;
}

function requireSessionProvider(value) {
  if (
    typeof value === 'function' ||
    (value !== null &&
      typeof value === 'object' &&
      (typeof value.getSession === 'function' ||
        typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function'))
  ) {
    return value;
  }

  throw new AssistantFacadeError(
    ASSISTANT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
    'Assistant facade requires a session provider.',
  );
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.insightsRepository !== undefined ||
      repositoryOrOptions.assistantRepository !== undefined)
  ) {
    const repository =
      repositoryOrOptions.repository ??
      repositoryOrOptions.insightsRepository ??
      repositoryOrOptions.assistantRepository;

    return {
      repository,
      inquiryRepository:
        repositoryOrOptions.inquiryRepository ??
        repositoryOrOptions.inquiries ??
        repository,
      options: repositoryOrOptions,
    };
  }

  const normalizedOptions = isPlainObject(options) ? options : {};

  return {
    repository: repositoryOrOptions,
    inquiryRepository:
      normalizedOptions.inquiryRepository ??
      normalizedOptions.inquiries ??
      repositoryOrOptions,
    options: normalizedOptions,
  };
}

function readSession(provider) {
  if (typeof provider === 'function') {
    return provider();
  }

  if (typeof provider.getSession === 'function') {
    return provider.getSession();
  }

  const snapshot =
    typeof provider.getSnapshot === 'function'
      ? provider.getSnapshot()
      : provider.getState();

  return snapshot?.session ?? snapshot?.actor ?? null;
}

function normalizeSession(value) {
  if (
    !isPlainObject(value) ||
    typeof value.userId !== 'string' ||
    value.userId.trim().length === 0 ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    typeof value.role !== 'string' ||
    value.role.trim().length === 0
  ) {
    return null;
  }

  return deepFreeze({
    sessionId:
      typeof value.sessionId === 'string' &&
      value.sessionId.trim().length > 0
        ? value.sessionId.normalize('NFC').trim()
        : null,
    userId: value.userId.normalize('NFC').trim(),
    displayName: value.displayName.normalize('NFC').trim(),
    role: value.role.trim().toUpperCase(),
  });
}

function getCurrentDate(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Assistant facade clock must provide now() or nowIso().',
    );
  }

  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Assistant facade clock must provide a valid timestamp.',
    );
  }

  return date;
}

function createIdentifier(idGenerator, prefix) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Assistant facade ID generator must return a non-empty string.',
    );
  }

  const normalized = value.normalize('NFC').trim();

  return normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;
}

function createSuccess(
  status,
  data,
  correlationId,
  warnings = [],
) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      schemaVersion: ASSISTANT_FACADE_SCHEMA_VERSION,
      warnings,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      correlationId,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
    },
  });
}

function createFieldError(field, code, message) {
  return {
    field,
    code,
    message,
  };
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function createAuthorizationFailure(
  decision,
  correlationId,
  message,
) {
  const unauthenticated =
    decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
    decision?.reasonCode === 'SESSION_EXPIRED';

  return createFailure(
    unauthenticated ? 401 : 403,
    unauthenticated
      ? ASSISTANT_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : ASSISTANT_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : message,
    correlationId,
    {
      details: {
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function normalizeTopic(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 100
  ) {
    return null;
  }

  return value
    .normalize('NFC')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

function normalizeResponseRequest(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Assistant response request must be a safe object.',
        ),
      ],
    };
  }

  const errors = Object.keys(value)
    .filter((field) => !ALLOWED_RESPONSE_FIELDS.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Assistant response field ${field} is not supported.`,
      ),
    );
  const topic = normalizeTopic(value.topic);

  if (topic === null) {
    errors.push(
      createFieldError(
        'topic',
        'REQUIRED',
        'A supported assistant topic is required.',
      ),
    );
  }

  if (
    value.context !== undefined &&
    (!isPlainObject(value.context) ||
      !isJsonCompatible(value.context))
  ) {
    errors.push(
      createFieldError(
        'context',
        'INVALID_CONTEXT',
        'Assistant context must be a safe object.',
      ),
    );
  }

  return {
    value: {
      topic,
    },
    errors,
  };
}

function escapeText(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function normalizeAttachmentRequest(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Assistant attachment request must be a safe object.',
        ),
      ],
    };
  }

  const errors = Object.keys(value)
    .filter((field) => !ALLOWED_ATTACHMENT_FIELDS.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Assistant attachment field ${field} is not supported.`,
      ),
    );
  let responseId = null;

  if (
    typeof value.responseId !== 'string' ||
    value.responseId.trim().length === 0 ||
    value.responseId.trim().length > 200
  ) {
    errors.push(
      createFieldError(
        'responseId',
        'REQUIRED',
        'Assistant response ID is required.',
      ),
    );
  } else {
    responseId = value.responseId.normalize('NFC').trim();
  }

  let note = null;

  if (
    value.note !== undefined &&
    value.note !== null &&
    value.note !== ''
  ) {
    if (
      typeof value.note !== 'string' ||
      value.note.trim().length >
        ASSISTANT_NOTE_MAXIMUM_LENGTH
    ) {
      errors.push(
        createFieldError(
          'note',
          'INVALID_LENGTH',
          `Assistant attachment note must not exceed ${ASSISTANT_NOTE_MAXIMUM_LENGTH} characters.`,
        ),
      );
    } else {
      note = escapeText(value.note.normalize('NFC').trim());
    }
  }

  if (
    !Number.isSafeInteger(value.expectedInquiryRevision) ||
    value.expectedInquiryRevision < 0
  ) {
    errors.push(
      createFieldError(
        'expectedInquiryRevision',
        'INVALID_REVISION',
        'Expected inquiry revision must be a non-negative safe integer.',
      ),
    );
  }

  if (
    value.expectedRootRevision !== undefined &&
    (!Number.isSafeInteger(value.expectedRootRevision) ||
      value.expectedRootRevision < 0)
  ) {
    errors.push(
      createFieldError(
        'expectedRootRevision',
        'INVALID_REVISION',
        'Expected root revision must be a non-negative safe integer.',
      ),
    );
  }

  return {
    value: {
      responseId,
      note,
      expectedInquiryRevision: value.expectedInquiryRevision,
      expectedRootRevision: value.expectedRootRevision,
    },
    errors,
  };
}

function requireInquiryId(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    return null;
  }

  return value.normalize('NFC').trim();
}

function normalizeScript(value, expectedTopic) {
  if (
    !isPlainObject(value) ||
    !isJsonCompatible(value) ||
    normalizeTopic(value.topic) !== expectedTopic ||
    typeof value.answer !== 'string' ||
    value.answer.trim().length === 0 ||
    typeof value.scriptVersion !== 'string' ||
    value.scriptVersion.trim().length === 0 ||
    value.disclosure !== SCRIPT_DISCLOSURE
  ) {
    throw new AssistantFacadeError(
      ASSISTANT_FACADE_ERROR_CODES.RESPONSE_FAILED,
      'Assistant script does not satisfy the deterministic response contract.',
    );
  }

  return deepFreeze({
    topic: expectedTopic,
    title:
      typeof value.title === 'string'
        ? value.title.normalize('NFC').trim()
        : null,
    answer: value.answer.normalize('NFC').trim(),
    scriptVersion: value.scriptVersion.normalize('NFC').trim(),
    disclosure: SCRIPT_DISCLOSURE,
  });
}

function createScriptHash(script) {
  return calculateSnapshotChecksum(
    {
      topic: script.topic,
      answer: script.answer,
      scriptVersion: script.scriptVersion,
      disclosure: script.disclosure,
    },
    'SHA-256',
  );
}

function getSessionKey(session) {
  return session.sessionId ?? `user:${session.userId}`;
}

function readAssistantScript(repository, topic) {
  return typeof repository.getAssistantScript === 'function'
    ? repository.getAssistantScript(topic)
    : repository.findAssistantScript(topic);
}

function resolveStateRevision(repository) {
  if (typeof repository.getStateRevision === 'function') {
    return repository.getStateRevision();
  }

  if (typeof repository.getSnapshot === 'function') {
    const snapshot = repository.getSnapshot();

    if (Number.isSafeInteger(snapshot?.stateRevision)) {
      return snapshot.stateRevision;
    }

    if (Number.isSafeInteger(snapshot?.revision)) {
      return snapshot.revision;
    }
  }

  return null;
}

async function saveAssistantResponse(
  repository,
  response,
  session,
) {
  if (typeof repository.saveAssistantResponse !== 'function') {
    return response;
  }

  const expectedRevision = resolveStateRevision(repository);

  if (!Number.isSafeInteger(expectedRevision)) {
    throw new AssistantFacadeError(
      ASSISTANT_FACADE_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      'Assistant response repository revision is unavailable.',
    );
  }

  return repository.saveAssistantResponse(response, {
    expectedRevision,
    updatedBy: session.userId,
  });
}

async function attachToInquiry(
  repository,
  inquiryId,
  attachment,
  request,
  session,
) {
  const options = {
    expectedInquiryRevision: request.expectedInquiryRevision,
    updatedBy: session.userId,
  };
  const stateRevision = resolveStateRevision(repository);

  if (Number.isSafeInteger(stateRevision)) {
    options.expectedRevision = stateRevision;
  }

  if (Number.isSafeInteger(request.expectedRootRevision)) {
    options.expectedRootRevision = request.expectedRootRevision;
  }

  if (typeof repository.attachAssistantResponse === 'function') {
    return repository.attachAssistantResponse(
      inquiryId,
      attachment,
      options,
    );
  }

  return repository.attachResponse(
    inquiryId,
    attachment,
    options,
  );
}

function normalizeAttachmentResult(value, attachment, expectedRevision) {
  if (isPlainObject(value?.attachment)) {
    return deepFreeze({
      attachment: value.attachment,
      inquiryRevision:
        Number.isSafeInteger(value.inquiryRevision)
          ? value.inquiryRevision
          : expectedRevision + 1,
    });
  }

  if (isPlainObject(value)) {
    return deepFreeze({
      attachment: value,
      inquiryRevision: expectedRevision + 1,
    });
  }

  throw new AssistantFacadeError(
    ASSISTANT_FACADE_ERROR_CODES.ATTACHMENT_FAILED,
    'Inquiry repository returned an invalid attachment result.',
  );
}

function normalizeOperationFailure(
  error,
  fallbackCode,
  fallbackMessage,
  correlationId,
) {
  const code = getErrorCode(error);

  switch (code) {
    case 'UNSUPPORTED_TOPIC':
    case 'UNSUPPORTED_SCRIPT_TOPIC':
      return createFailure(
        422,
        ASSISTANT_FACADE_ERROR_CODES.UNSUPPORTED_SCRIPT_TOPIC,
        'Assistant topic is not supported by the scripted demo.',
        correlationId,
      );
    case 'INQUIRY_NOT_FOUND':
    case 'NOT_FOUND':
      return createFailure(
        404,
        ASSISTANT_FACADE_ERROR_CODES.INQUIRY_NOT_FOUND,
        'The requested local inquiry was not found.',
        correlationId,
      );
    case 'RESPONSE_NOT_FOUND':
      return createFailure(
        404,
        ASSISTANT_FACADE_ERROR_CODES.RESPONSE_NOT_FOUND,
        'The scripted assistant response was not found.',
        correlationId,
      );
    case 'REVISION_CONFLICT':
      return createFailure(
        409,
        ASSISTANT_FACADE_ERROR_CODES.REVISION_CONFLICT,
        'Local inquiry data changed before the assistant response was attached.',
        correlationId,
        { retryable: true },
      );
    case 'STORAGE_QUOTA_EXCEEDED':
    case 'LOCAL_STORAGE_QUOTA':
      return createFailure(
        507,
        ASSISTANT_FACADE_ERROR_CODES.LOCAL_STORAGE_QUOTA,
        'Browser-local storage quota was exceeded.',
        correlationId,
        { recoveryAction: 'EXPORT_SNAPSHOT' },
      );
    case 'READ_ONLY_RECOVERY':
      return createFailure(
        409,
        ASSISTANT_FACADE_ERROR_CODES.READ_ONLY_RECOVERY,
        'Local demonstration data is in read-only recovery mode.',
        correlationId,
      );
    case 'DEPENDENCY_UNAVAILABLE':
      return createFailure(
        503,
        ASSISTANT_FACADE_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        'A local assistant dependency is unavailable.',
        correlationId,
      );
    default:
      return createFailure(
        500,
        fallbackCode,
        fallbackMessage,
        correlationId,
        {
          details: {
            dependencyCode: code,
          },
        },
      );
  }
}

/**
 * Error raised when assistant facade configuration or data is invalid.
 */
export class AssistantFacadeError extends Error {
  /**
   * @param {string} code Stable assistant facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AssistantFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Capability-checked deterministic assistant facade.
 *
 * Responses are selected exclusively from bundled scripts. No prompt, model,
 * or network operation is performed.
 */
export class AssistantFacade {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Assistant
   * repository or facade options containing repository dependencies.
   * @param {{
   *   inquiryRepository?: object,
   *   permissionService?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   responseMaximumAgeMs?: number
   * }} [options] Facade options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );

    this.repository = requireAssistantRepository(
      resolved.repository,
    );
    this.inquiryRepository = requireInquiryRepository(
      resolved.inquiryRepository,
    );
    this.permissionService = requirePermissionService(
      resolved.options.permissionService,
    );
    this.auditService = requireAuditService(
      resolved.options.auditService,
    );
    this.sessionProvider = requireSessionProvider(
      resolved.options.sessionProvider ??
        resolved.options.authFacade ??
        this.permissionService.sessionProvider,
    );
    this.clock = resolved.options.clock ?? browserClock;
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;
    this.responseMaximumAgeMs =
      Number.isFinite(resolved.options.responseMaximumAgeMs) &&
      resolved.options.responseMaximumAgeMs > 0
        ? resolved.options.responseMaximumAgeMs
        : ASSISTANT_RESPONSE_MAXIMUM_AGE_MS;
    this.responseCache = new Map();

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Assistant facade ID generator must be a function.',
      );
    }
  }

  getSession() {
    try {
      return normalizeSession(readSession(this.sessionProvider));
    } catch {
      return null;
    }
  }

  pruneResponses(nowMs = getCurrentDate(this.clock).getTime()) {
    this.responseCache.forEach((record, responseId) => {
      if (
        nowMs - record.createdAtMs >
        this.responseMaximumAgeMs
      ) {
        this.responseCache.delete(responseId);
      }
    });
  }

  async authorize(action, resource, correlationId) {
    const session = this.getSession();
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action,
          resource,
          session,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          ASSISTANT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Assistant permission evaluation could not be completed.',
          correlationId,
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        ),
      };
    }

    if (decision?.allowed === true && session !== null) {
      return {
        allowed: true,
        decision,
        session,
      };
    }

    return {
      allowed: false,
      failure: createAuthorizationFailure(
        decision,
        correlationId,
        action === ACTIONS.ASSISTANT_ATTACH_RESPONSE
          ? 'Only authorized CSR demo roles can attach scripted responses.'
          : 'Only authorized CSR demo roles can use the scripted assistant.',
      ),
    };
  }

  async appendAttachmentAudit({
    correlationId,
    session,
    inquiryId,
    attachmentId,
    response,
  }) {
    await this.auditService.append(
      {
        correlationId,
        actor: {
          userId: session.userId,
          displayName: session.displayName,
          role: session.role,
        },
        action: ASSISTANT_AUDIT_ACTIONS.RESPONSE_ATTACHED,
        entity: {
          type: 'INQUIRY',
          id: inquiryId,
        },
      },
      {
        action: ASSISTANT_AUDIT_ACTIONS.RESPONSE_ATTACHED,
        entity: {
          type: 'INQUIRY',
          id: inquiryId,
        },
        before: null,
        after: {
          attachmentId,
          responseId: response.responseId,
          topic: response.topic,
          scriptVersion: response.scriptVersion,
          status: 'ATTACHED',
        },
        outcome: 'SUCCESS',
      },
    );
  }

  /**
   * Returns one deterministic scripted response.
   *
   * @param {{topic: string, context?: Record<string, unknown>}} request
   * Assistant response request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async respond(request) {
    const correlationId = createIdentifier(
      this.idGenerator,
      'corr_',
    );
    const authorization = await this.authorize(
      ACTIONS.ASSISTANT_RESPOND,
      {
        type: 'SCRIPTED_ASSISTANT',
        id: 'local',
      },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeResponseRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ASSISTANT_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Assistant response request validation failed.',
        correlationId,
        {
          fieldErrors: normalized.errors,
        },
      );
    }

    try {
      const scriptValue = await readAssistantScript(
        this.repository,
        normalized.value.topic,
      );
      const script = normalizeScript(
        scriptValue,
        normalized.value.topic,
      );
      const now = getCurrentDate(this.clock);
      const response = deepFreeze({
        responseId: createIdentifier(
          this.idGenerator,
          RESPONSE_ID_PREFIX,
        ),
        topic: script.topic,
        answer: script.answer,
        scriptVersion: script.scriptVersion,
        scriptHash: createScriptHash(script),
        disclosure: SCRIPT_DISCLOSURE,
        createdAt: now.toISOString(),
      });
      const stored = await saveAssistantResponse(
        this.repository,
        response,
        authorization.session,
      );
      const normalizedStored =
        isPlainObject(stored) &&
        stored.responseId === response.responseId
          ? deepFreeze(stored)
          : response;

      this.pruneResponses(now.getTime());
      this.responseCache.set(response.responseId, {
        response: normalizedStored,
        sessionKey: getSessionKey(authorization.session),
        createdAtMs: now.getTime(),
      });

      return createSuccess(
        200,
        normalizedStored,
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ASSISTANT_FACADE_ERROR_CODES.RESPONSE_FAILED,
        'The scripted assistant response could not be created.',
        correlationId,
      );
    }
  }

  /**
   * Attaches a recent scripted response to a local inquiry.
   *
   * @param {string} inquiryId Inquiry identifier.
   * @param {{
   *   responseId: string,
   *   note?: string,
   *   expectedInquiryRevision: number,
   *   expectedRootRevision?: number
   * }} request Attachment request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async attachResponse(inquiryId, request) {
    const correlationId = createIdentifier(
      this.idGenerator,
      'corr_',
    );
    const normalizedInquiryId = requireInquiryId(inquiryId);

    if (normalizedInquiryId === null) {
      return createFailure(
        422,
        ASSISTANT_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Assistant attachment request validation failed.',
        correlationId,
        {
          fieldErrors: [
            createFieldError(
              'inquiryId',
              'INVALID_IDENTIFIER',
              'Inquiry ID must be a non-empty string of at most 200 characters.',
            ),
          ],
        },
      );
    }

    const authorization = await this.authorize(
      ACTIONS.ASSISTANT_ATTACH_RESPONSE,
      {
        type: 'INQUIRY',
        id: normalizedInquiryId,
      },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeAttachmentRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ASSISTANT_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Assistant attachment request validation failed.',
        correlationId,
        {
          fieldErrors: normalized.errors,
        },
      );
    }

    const now = getCurrentDate(this.clock);
    const cached = this.responseCache.get(
      normalized.value.responseId,
    );

    if (cached === undefined) {
      this.pruneResponses(now.getTime());

      return createFailure(
        404,
        ASSISTANT_FACADE_ERROR_CODES.RESPONSE_NOT_FOUND,
        'The scripted assistant response is unavailable in the current session.',
        correlationId,
      );
    }

    if (
      now.getTime() - cached.createdAtMs >
      this.responseMaximumAgeMs
    ) {
      this.responseCache.delete(normalized.value.responseId);

      return createFailure(
        409,
        ASSISTANT_FACADE_ERROR_CODES.RESPONSE_EXPIRED,
        'The scripted assistant response has expired. Create a new response before attaching it.',
        correlationId,
      );
    }

    if (
      cached.sessionKey !==
      getSessionKey(authorization.session)
    ) {
      return createFailure(
        403,
        ASSISTANT_FACADE_ERROR_CODES.RESPONSE_SESSION_MISMATCH,
        'The scripted assistant response belongs to another local session.',
        correlationId,
      );
    }

    let currentScript;

    try {
      currentScript = normalizeScript(
        await readAssistantScript(
          this.repository,
          cached.response.topic,
        ),
        cached.response.topic,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ASSISTANT_FACADE_ERROR_CODES.ATTACHMENT_FAILED,
        'The scripted assistant response could not be verified.',
        correlationId,
      );
    }

    if (
      createScriptHash(currentScript) !==
      cached.response.scriptHash
    ) {
      this.responseCache.delete(normalized.value.responseId);

      return createFailure(
        409,
        ASSISTANT_FACADE_ERROR_CODES.RESPONSE_EXPIRED,
        'The scripted assistant response no longer matches the current fixture.',
        correlationId,
      );
    }

    const attachment = deepFreeze({
      attachmentId: createIdentifier(
        this.idGenerator,
        ATTACHMENT_ID_PREFIX,
      ),
      inquiryId: normalizedInquiryId,
      responseId: cached.response.responseId,
      topic: cached.response.topic,
      answerSnapshot: cached.response.answer,
      scriptVersion: cached.response.scriptVersion,
      scriptHash: cached.response.scriptHash,
      note: normalized.value.note,
      attachedBy: authorization.session.userId,
      attachedAt: now.toISOString(),
      disclosure: SCRIPT_DISCLOSURE,
    });

    let result;

    try {
      const stored = await attachToInquiry(
        this.inquiryRepository,
        normalizedInquiryId,
        attachment,
        normalized.value,
        authorization.session,
      );

      result = normalizeAttachmentResult(
        stored,
        attachment,
        normalized.value.expectedInquiryRevision,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ASSISTANT_FACADE_ERROR_CODES.ATTACHMENT_FAILED,
        'The scripted assistant response could not be attached to the inquiry.',
        correlationId,
      );
    }

    try {
      await this.appendAttachmentAudit({
        correlationId,
        session: authorization.session,
        inquiryId: normalizedInquiryId,
        attachmentId:
          result.attachment.attachmentId ??
          attachment.attachmentId,
        response: cached.response,
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ASSISTANT_FACADE_ERROR_CODES.AUDIT_FAILED,
        'The scripted response was attached, but its local audit event could not be stored.',
        correlationId,
      );
    }

    return createSuccess(201, result, correlationId);
  }

  respondToTopic(request) {
    return this.respond(request);
  }

  attachAssistantResponse(inquiryId, request) {
    return this.attachResponse(inquiryId, request);
  }

  attach(inquiryId, request) {
    return this.attachResponse(inquiryId, request);
  }

  clearResponseCache() {
    const count = this.responseCache.size;

    this.responseCache.clear();
    return count;
  }
}

/**
 * Creates a deterministic scripted assistant facade.
 *
 * @param {ConstructorParameters<typeof AssistantFacade>[0]}
 * repositoryOrOptions Repository or facade options.
 * @param {ConstructorParameters<typeof AssistantFacade>[1]} [options]
 * Facade options.
 * @returns {AssistantFacade} Assistant facade.
 */
export function createAssistantFacade(
  repositoryOrOptions,
  options = {},
) {
  return new AssistantFacade(repositoryOrOptions, options);
}

export const LocalAssistantFacade = AssistantFacade;
export const ScriptedAssistantFacade = AssistantFacade;
export const createLocalAssistantFacade = createAssistantFacade;
export const createScriptedAssistantFacade =
  createAssistantFacade;

export default AssistantFacade;