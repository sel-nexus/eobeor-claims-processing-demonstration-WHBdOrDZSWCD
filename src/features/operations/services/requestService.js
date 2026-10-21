import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  OPEN_REQUEST_STATUSES,
  PRIORITY_VALUES,
  REQUEST_TYPE_VALUES,
  SOURCE_TYPE_VALUES,
} from '../domain/domainConstants.js';
import { isOperationsUuid } from '../domain/operationsSchemas.js';
import {
  OPERATIONS_COLLECTIONS,
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';

export const REQUEST_SERVICE_SCHEMA_VERSION = 1;

export const REQUEST_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  MEMBER_CLAIM_MISMATCH: 'MEMBER_CLAIM_MISMATCH',
  CLAIM_NOT_ELIGIBLE: 'CLAIM_NOT_ELIGIBLE',
  REQUEST_TYPE_NOT_AVAILABLE: 'REQUEST_TYPE_NOT_AVAILABLE',
  DUPLICATE_OPEN_REQUEST: 'DUPLICATE_OPEN_REQUEST',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  DISPLAY_ID_EXHAUSTED: 'DISPLAY_ID_EXHAUSTED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const REQUEST_AUDIT_ACTIONS = Object.freeze({
  CREATED: 'REQUEST_CREATED',
  VIEWED: 'REQUEST_VIEWED',
  LISTED: 'REQUESTS_LISTED',
});

export const REQUEST_SERVICE_DEFAULTS = Object.freeze({
  page: 1,
  limit: 50,
  maximumLimit: 200,
  sortBy: 'QUEUE',
  sortDirection: 'ASC',
});

const REQUEST_TYPE_SET = new Set(REQUEST_TYPE_VALUES);
const PRIORITY_SET = new Set(PRIORITY_VALUES);
const SOURCE_TYPE_SET = new Set(SOURCE_TYPE_VALUES);
const OPEN_STATUS_SET = new Set(OPEN_REQUEST_STATUSES);
const INTERNAL_ROLES = new Set(['CSR', 'BOS', 'ITS', 'ADMIN']);
const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const DISPLAY_ID_PATTERN = /^REQ-(\d{6})$/;
const MAXIMUM_DISPLAY_SEQUENCE = 999999;
const MAXIMUM_SOURCE_DETAIL_LENGTH = 200;
const ALLOWED_CREATE_FIELDS = new Set([
  'claimNumber',
  'memberId',
  'requestType',
  'priority',
  'sourceType',
  'sourceDetail',
  'processNow',
  'idempotencyKey',
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

function requireRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getSnapshot !== 'function' ||
    typeof value.transact !== 'function' ||
    typeof value.listRequests !== 'function'
  ) {
    throw new RequestServiceError(
      REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Request service requires an operations repository with getSnapshot(), transact(), and listRequests().',
    );
  }

  return value;
}

function requireFixtureGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.getClaimByNumber !== 'function' &&
      typeof value.findClaimByNumber !== 'function' &&
      typeof value.getSnapshot !== 'function') ||
    (typeof value.getMemberById !== 'function' &&
      typeof value.findMemberById !== 'function' &&
      typeof value.getSnapshot !== 'function')
  ) {
    throw new RequestServiceError(
      REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Request service requires a fixture gateway with claim and member lookup operations.',
    );
  }

  return value;
}

function requirePermissionGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new RequestServiceError(
      REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Request service requires a permission gateway with evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.append !== 'function') {
    throw new RequestServiceError(
      REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Request service audit gateway must provide append().',
    );
  }

  return value;
}

function normalizeSessionProvider(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === 'function' ||
    (typeof value === 'object' &&
      (typeof value.getSession === 'function' ||
        typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function'))
  ) {
    return value;
  }

  throw new RequestServiceError(
    REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Request service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.operationsRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.operationsRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function getCurrentTimestamp(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Request service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Request service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedId(idGenerator, name) {
  const value = idGenerator();

  if (!isOperationsUuid(value)) {
    throw new TypeError(
      `${name} generator must return an RFC 4122 UUID.`,
    );
  }

  return value.toLowerCase();
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return `corr-${createGeneratedId(idGenerator, 'Request service ID')}`;
}

function createSuccess(status, data, correlationId, revision, warnings = []) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      revision,
      schemaVersion: REQUEST_SERVICE_SCHEMA_VERSION,
      warnings,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  revision,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
    },
    meta: {
      correlationId,
      revision,
      schemaVersion: REQUEST_SERVICE_SCHEMA_VERSION,
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

function readSession(provider) {
  if (provider === null) {
    return null;
  }

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

function normalizeContext(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? {
        ...value.session,
        correlationId:
          value.correlationId ?? value.session.correlationId,
      }
    : isPlainObject(value.actor)
      ? {
          ...value.actor,
          correlationId:
            value.correlationId ?? value.actor.correlationId,
        }
      : value;
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;
  const actorId =
    source.actorId ?? source.userId ?? source.requestedBy;

  if (
    typeof actorId !== 'string' ||
    actorId.trim().length === 0 ||
    actorId.trim().length > 80 ||
    !isPlatformRole(role)
  ) {
    return null;
  }

  const memberId =
    source.memberId === undefined || source.memberId === null
      ? null
      : normalizeIdentifier(source.memberId);

  if (
    source.memberId !== undefined &&
    source.memberId !== null &&
    memberId === null
  ) {
    return null;
  }

  return deepFreeze({
    actorId: actorId.normalize('NFC').trim(),
    userId: actorId.normalize('NFC').trim(),
    displayName:
      typeof source.displayName === 'string' &&
      source.displayName.trim().length > 0
        ? source.displayName.normalize('NFC').trim()
        : actorId.normalize('NFC').trim(),
    role,
    memberId,
    sessionId:
      typeof source.sessionId === 'string' &&
      source.sessionId.trim().length > 0
        ? source.sessionId.normalize('NFC').trim()
        : null,
    correlationId:
      typeof source.correlationId === 'string'
        ? source.correlationId
        : null,
  });
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.normalize('NFC').trim().toUpperCase();

  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCreateRequest(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Reprint request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = Object.keys(value)
    .filter((field) => !ALLOWED_CREATE_FIELDS.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Request field ${field} is not supported.`,
      ),
    );
  const claimNumber = normalizeIdentifier(value.claimNumber);
  const memberId = normalizeIdentifier(value.memberId);
  const requestType =
    typeof value.requestType === 'string'
      ? value.requestType.trim().toUpperCase()
      : value.requestType;
  const priority =
    typeof value.priority === 'string'
      ? value.priority.trim().toUpperCase()
      : value.priority;
  const sourceType =
    typeof value.sourceType === 'string'
      ? value.sourceType.trim().toUpperCase()
      : value.sourceType;
  const sourceDetail =
    value.sourceDetail === undefined || value.sourceDetail === null
      ? ''
      : typeof value.sourceDetail === 'string'
        ? value.sourceDetail.normalize('NFC').trim()
        : null;
  const idempotencyKey =
    typeof value.idempotencyKey === 'string'
      ? value.idempotencyKey.trim().toLowerCase()
      : value.idempotencyKey;

  if (claimNumber === null) {
    errors.push(
      createFieldError(
        'claimNumber',
        'INVALID_IDENTIFIER',
        'Claim number must contain 1–40 letters, numbers, underscores, or hyphens.',
      ),
    );
  }

  if (memberId === null) {
    errors.push(
      createFieldError(
        'memberId',
        'INVALID_IDENTIFIER',
        'Member ID must contain 1–40 letters, numbers, underscores, or hyphens.',
      ),
    );
  }

  if (!REQUEST_TYPE_SET.has(requestType)) {
    errors.push(
      createFieldError(
        'requestType',
        'INVALID_REQUEST_TYPE',
        'Request type must be EOB, EOR, or BOTH.',
      ),
    );
  }

  if (!PRIORITY_SET.has(priority)) {
    errors.push(
      createFieldError(
        'priority',
        'INVALID_PRIORITY',
        'Priority must be URGENT, HIGH, or NORMAL.',
      ),
    );
  }

  if (!SOURCE_TYPE_SET.has(sourceType)) {
    errors.push(
      createFieldError(
        'sourceType',
        'INVALID_SOURCE_TYPE',
        'Request source type is not supported.',
      ),
    );
  }

  if (
    sourceDetail === null ||
    sourceDetail.length > MAXIMUM_SOURCE_DETAIL_LENGTH
  ) {
    errors.push(
      createFieldError(
        'sourceDetail',
        'INVALID_LENGTH',
        `Source detail must not exceed ${MAXIMUM_SOURCE_DETAIL_LENGTH} characters.`,
      ),
    );
  }

  if (!isOperationsUuid(idempotencyKey)) {
    errors.push(
      createFieldError(
        'idempotencyKey',
        'INVALID_UUID',
        'Idempotency key must be an RFC 4122 UUID.',
      ),
    );
  }

  if (
    value.processNow !== undefined &&
    typeof value.processNow !== 'boolean'
  ) {
    errors.push(
      createFieldError(
        'processNow',
        'INVALID_BOOLEAN',
        'Process-now must be a boolean.',
      ),
    );
  }

  return {
    value: {
      claimNumber,
      memberId,
      requestType,
      priority,
      sourceType,
      sourceDetail: sourceDetail ?? '',
      processNow: value.processNow === true,
      idempotencyKey,
    },
    errors,
  };
}

function normalizeListQuery(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new RequestServiceError(
      REQUEST_SERVICE_ERROR_CODES.INVALID_REQUEST,
      'Request list query must be a safe JSON-compatible object.',
    );
  }

  return {
    ...value,
    sortBy: value.sortBy ?? REQUEST_SERVICE_DEFAULTS.sortBy,
    sortDirection:
      value.sortDirection ??
      value.direction ??
      REQUEST_SERVICE_DEFAULTS.sortDirection,
    page: value.page ?? REQUEST_SERVICE_DEFAULTS.page,
    limit: value.limit ?? REQUEST_SERVICE_DEFAULTS.limit,
  };
}

function createRequestHash(command) {
  const source = [
    command.claimNumber,
    command.memberId,
    command.requestType,
    command.priority,
    command.sourceType,
    command.sourceDetail,
    command.processNow ? '1' : '0',
  ].join('|');
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function createNextDisplayId(requests) {
  let maximum = 0;

  Object.values(requests).forEach((request) => {
    const match = DISPLAY_ID_PATTERN.exec(request.displayId);

    if (match !== null) {
      maximum = Math.max(maximum, Number(match[1]));
    }
  });

  if (maximum >= MAXIMUM_DISPLAY_SEQUENCE) {
    throw new RequestServiceError(
      REQUEST_SERVICE_ERROR_CODES.DISPLAY_ID_EXHAUSTED,
      'The local request display sequence is exhausted.',
    );
  }

  return `REQ-${String(maximum + 1).padStart(6, '0')}`;
}

function findDuplicateRequest(requests, command) {
  return (
    Object.values(requests).find(
      (request) =>
        request.claimNumber === command.claimNumber &&
        request.memberId === command.memberId &&
        request.requestType === command.requestType &&
        OPEN_STATUS_SET.has(request.status),
    ) ?? null
  );
}

function readClaim(gateway, claimNumber, context) {
  if (typeof gateway.getClaimByNumber === 'function') {
    return gateway.getClaimByNumber(
      claimNumber,
      context,
      ACTIONS.REPRINT_REQUEST,
    );
  }

  if (typeof gateway.findClaimByNumber === 'function') {
    return gateway.findClaimByNumber(claimNumber, context);
  }

  const snapshot = gateway.getSnapshot();

  return (
    snapshot?.claimsByNumber?.[claimNumber] ??
    snapshot?.claims?.find(
      (claim) => claim.claimNumber === claimNumber,
    ) ??
    null
  );
}

function readMember(gateway, memberId, context) {
  if (typeof gateway.getMemberById === 'function') {
    return gateway.getMemberById(memberId, context);
  }

  if (typeof gateway.findMemberById === 'function') {
    return gateway.findMemberById(memberId, context);
  }

  const snapshot = gateway.getSnapshot();

  return (
    snapshot?.membersById?.[memberId] ??
    snapshot?.members?.find(
      (member) => member.memberId === memberId,
    ) ??
    null
  );
}

function requestTypeIsAvailable(claim, requestType) {
  if (!Array.isArray(claim.documentTypes)) {
    return true;
  }

  if (requestType === 'BOTH') {
    return (
      claim.documentTypes.includes('EOB') &&
      claim.documentTypes.includes('EOR')
    );
  }

  return claim.documentTypes.includes(requestType);
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizeRepositoryFailure(
  error,
  correlationId,
  revision,
) {
  const code = getErrorCode(error);

  if (
    code === OPERATIONS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT ||
    code === 'REVISION_CONFLICT'
  ) {
    return createFailure(
      409,
      REQUEST_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before the request could be stored.',
      correlationId,
      revision,
      { retryable: true },
    );
  }

  if (
    code === 'STORAGE_QUOTA_EXCEEDED' ||
    code === 'LOCAL_STORAGE_QUOTA'
  ) {
    return createFailure(
      507,
      REQUEST_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof RequestServiceError) {
    const status =
      error.code ===
      REQUEST_SERVICE_ERROR_CODES.DUPLICATE_OPEN_REQUEST
        ? 409
        : error.code ===
            REQUEST_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT
          ? 409
          : error.code ===
              REQUEST_SERVICE_ERROR_CODES.DISPLAY_ID_EXHAUSTED
            ? 409
            : 422;

    return createFailure(
      status,
      error.code,
      error.message,
      correlationId,
      revision,
      { details: error.details },
    );
  }

  return createFailure(
    500,
    REQUEST_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The reprint request could not be stored.',
    correlationId,
    revision,
    {
      details: {
        dependencyCode: code,
      },
    },
  );
}

/**
 * Error raised when request service configuration or input is invalid.
 */
export class RequestServiceError extends Error {
  /**
   * @param {string} code Stable request-service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RequestServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Capability-checked service for creating and reading local reprint requests.
 */
export class RequestService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options containing injected dependencies.
   * @param {{
   *   fixtureGateway?: object,
   *   fixtureRepository?: object,
   *   permissionGateway?: object,
   *   permissionService?: object,
   *   auditGateway?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   correlationIdGenerator?: () => string,
   *   processRequest?: Function,
   *   scheduler?: Function
   * }} [options] Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.repository = requireRepository(resolved.repository);
    this.fixtureGateway = requireFixtureGateway(
      normalizedOptions.fixtureGateway ??
        normalizedOptions.fixtureRepository ??
        normalizedOptions.fixtures,
    );
    this.permissionGateway = requirePermissionGateway(
      normalizedOptions.permissionGateway ??
        normalizedOptions.permissionService,
    );
    this.auditGateway = normalizeAuditGateway(
      normalizedOptions.auditGateway ??
        normalizedOptions.auditService,
    );
    this.sessionProvider = normalizeSessionProvider(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade ??
        this.permissionGateway.sessionProvider,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ??
      normalizedOptions.uuid ??
      generateUuid;
    this.correlationIdGenerator =
      normalizedOptions.correlationIdGenerator ??
      this.idGenerator;
    this.requestProcessor =
      normalizedOptions.processRequest ??
      normalizedOptions.requestProcessor ??
      null;
    this.scheduler = normalizedOptions.scheduler ?? null;

    if (
      typeof this.idGenerator !== 'function' ||
      typeof this.correlationIdGenerator !== 'function'
    ) {
      throw new TypeError(
        'Request service ID generators must be functions.',
      );
    }

    if (
      this.requestProcessor !== null &&
      typeof this.requestProcessor !== 'function'
    ) {
      throw new TypeError(
        'Request service processor must be a function.',
      );
    }

    if (
      this.scheduler !== null &&
      typeof this.scheduler !== 'function'
    ) {
      throw new TypeError(
        'Request service scheduler must be a function.',
      );
    }
  }

  getRevision() {
    return this.repository.getSnapshot().revision;
  }

  resolveContext(context) {
    const supplied = normalizeContext(context);

    if (supplied !== null) {
      return supplied;
    }

    try {
      return normalizeContext(readSession(this.sessionProvider));
    } catch {
      return null;
    }
  }

  async authorize(action, resource, actor, correlationId) {
    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          REQUEST_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
          'An active demo session is required.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action,
          resource,
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Request permission evaluation could not be completed.',
          correlationId,
          this.getRevision(),
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        ),
      };
    }

    if (decision?.allowed === true) {
      return {
        allowed: true,
        decision,
      };
    }

    const unauthenticated =
      decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
      decision?.reasonCode === 'SESSION_EXPIRED';

    return {
      allowed: false,
      failure: createFailure(
        unauthenticated ? 401 : 403,
        unauthenticated
          ? REQUEST_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : REQUEST_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'This demo role cannot perform the request operation.',
        correlationId,
        this.getRevision(),
        {
          details: {
            reasonCode: decision?.reasonCode ?? null,
          },
        },
      ),
    };
  }

  async appendAudit({
    correlationId,
    actor,
    action,
    request,
  }) {
    if (this.auditGateway === null) {
      return null;
    }

    try {
      await this.auditGateway.append(
        {
          correlationId,
          actor: {
            userId: actor.actorId,
            displayName: actor.displayName,
            role: actor.role,
          },
          action,
          entity: {
            type: 'REPRINT_REQUEST',
            id: request.requestId,
          },
        },
        {
          action,
          entity: {
            type: 'REPRINT_REQUEST',
            id: request.requestId,
          },
          before: null,
          after: {
            requestId: request.requestId,
            displayId: request.displayId,
            claimNumber: request.claimNumber,
            memberId: request.memberId,
            requestType: request.requestType,
            priority: request.priority,
            sourceType: request.sourceType,
            status: request.status,
          },
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: REQUEST_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The request was stored, but its local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  scheduleProcessing(request, command, actor) {
    if (
      command.processNow !== true ||
      this.requestProcessor === null
    ) {
      return null;
    }

    const callback = () =>
      Promise.resolve(
        this.requestProcessor(
          {
            requestId: request.requestId,
            idempotencyKey: createGeneratedId(
              this.idGenerator,
              'Request processing ID',
            ),
          },
          actor,
        ),
      ).catch(() => null);

    try {
      if (this.scheduler !== null) {
        this.scheduler(callback);
      } else if (typeof globalThis.queueMicrotask === 'function') {
        globalThis.queueMicrotask(callback);
      } else {
        globalThis.setTimeout(callback, 0);
      }

      return null;
    } catch (error) {
      return {
        code: 'PROCESSING_NOT_SCHEDULED',
        message:
          'The request was created but automatic processing could not be scheduled.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Creates one pending, browser-local reprint request.
   *
   * @param {Record<string, unknown>} command Request command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async createRequest(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.correlationIdGenerator,
      actor ?? context,
    );
    const normalized = normalizeCreateRequest(command);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        REQUEST_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Reprint request validation failed.',
        correlationId,
        this.getRevision(),
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const authorization = await this.authorize(
      ACTIONS.REPRINT_REQUEST,
      {
        type: 'CLAIM',
        id: input.claimNumber,
        memberId: input.memberId,
        ownerMemberId: input.memberId,
        owned:
          actor?.role !== 'MEMBER' ||
          actor.memberId === input.memberId,
      },
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    if (
      actor.role === 'MEMBER' &&
      actor.memberId !== input.memberId
    ) {
      return createFailure(
        403,
        REQUEST_SERVICE_ERROR_CODES.FORBIDDEN,
        'A member may request documents only for their own claims.',
        correlationId,
        this.getRevision(),
      );
    }

    let claim;
    let member;

    try {
      claim = await readClaim(
        this.fixtureGateway,
        input.claimNumber,
        actor,
      );
      member = await readMember(
        this.fixtureGateway,
        input.memberId,
        actor,
      );
    } catch (error) {
      return createFailure(
        500,
        REQUEST_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Local claim and member fixtures could not be read.',
        correlationId,
        this.getRevision(),
        {
          details: {
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    if (claim === null || claim === undefined) {
      return createFailure(
        404,
        REQUEST_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
        'The fictional claim was not found or is not accessible.',
        correlationId,
        this.getRevision(),
      );
    }

    if (member === null || member === undefined) {
      return createFailure(
        404,
        REQUEST_SERVICE_ERROR_CODES.MEMBER_NOT_FOUND,
        'The fictional member was not found or is not accessible.',
        correlationId,
        this.getRevision(),
      );
    }

    if (
      claim.memberId !== input.memberId ||
      member.memberId !== input.memberId
    ) {
      return createFailure(
        422,
        REQUEST_SERVICE_ERROR_CODES.MEMBER_CLAIM_MISMATCH,
        'The fictional claim does not belong to the supplied member.',
        correlationId,
        this.getRevision(),
      );
    }

    if (claim.eligibleForReprint !== true) {
      return createFailure(
        422,
        REQUEST_SERVICE_ERROR_CODES.CLAIM_NOT_ELIGIBLE,
        'The fictional claim is not eligible for reprint.',
        correlationId,
        this.getRevision(),
      );
    }

    if (!requestTypeIsAvailable(claim, input.requestType)) {
      return createFailure(
        422,
        REQUEST_SERVICE_ERROR_CODES.REQUEST_TYPE_NOT_AVAILABLE,
        'The requested document type is not available for this fictional claim.',
        correlationId,
        this.getRevision(),
      );
    }

    const requestHash = createRequestHash(input);
    const snapshot = this.repository.getSnapshot();
    const existingIdempotency =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existingIdempotency !== undefined) {
      if (
        existingIdempotency.commandName !== 'createRequest' ||
        existingIdempotency.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          REQUEST_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another request.',
          correlationId,
          snapshot.revision,
        );
      }

      const existingRequest =
        snapshot.requests[
          existingIdempotency.result.requestId
        ] ?? null;

      if (existingRequest === null) {
        return createFailure(
          500,
          REQUEST_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
          'The stored idempotency result references a missing request.',
          correlationId,
          snapshot.revision,
        );
      }

      return createSuccess(
        200,
        existingRequest,
        correlationId,
        snapshot.revision,
      );
    }

    const requestId = createGeneratedId(
      this.idGenerator,
      'Request ID',
    );
    const createdAt = getCurrentTimestamp(this.clock);
    let storedEnvelope;
    let replayed = false;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const committedIdempotency =
            draft.idempotencyResults[input.idempotencyKey];

          if (committedIdempotency !== undefined) {
            if (
              committedIdempotency.commandName !==
                'createRequest' ||
              committedIdempotency.requestHash !== requestHash
            ) {
              throw new RequestServiceError(
                REQUEST_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another request.',
              );
            }

            replayed = true;
            return;
          }

          const duplicate = findDuplicateRequest(
            draft.requests,
            input,
          );

          if (duplicate !== null) {
            throw new RequestServiceError(
              REQUEST_SERVICE_ERROR_CODES.DUPLICATE_OPEN_REQUEST,
              'An open request already exists for this claim, member, and request type.',
              {
                requestId: duplicate.requestId,
                displayId: duplicate.displayId,
              },
            );
          }

          const displayId = createNextDisplayId(
            draft.requests,
          );
          const request = {
            requestId,
            displayId,
            claimNumber: input.claimNumber,
            memberId: input.memberId,
            requestType: input.requestType,
            priority: input.priority,
            sourceType: input.sourceType,
            sourceDetail: input.sourceDetail,
            status: 'PENDING',
            createdAt,
            startedAt: null,
            completedAt: null,
            processingTimeMs: null,
            result: null,
            documentReferences: [],
            errorReportId: null,
            currentStep: 'REQUEST',
            faxStatus: 'NOT_REQUESTED',
            requestedBy: actor.actorId,
            version: 1,
          };

          draft.requests[requestId] = request;
          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'createRequest',
            requestHash,
            result: {
              requestId,
              displayId,
              status: 'PENDING',
            },
            createdAt,
          };
        },
        {
          expectedRevision: snapshot.revision,
        },
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    const idempotency =
      storedEnvelope.idempotencyResults[input.idempotencyKey];
    const storedRequest =
      storedEnvelope.requests[idempotency.result.requestId];

    if (replayed) {
      return createSuccess(
        200,
        storedRequest,
        correlationId,
        storedEnvelope.revision,
      );
    }

    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: REQUEST_AUDIT_ACTIONS.CREATED,
      request: storedRequest,
    });
    const schedulingWarning = this.scheduleProcessing(
      storedRequest,
      input,
      actor,
    );
    const warnings = [
      auditWarning,
      schedulingWarning,
    ].filter(Boolean);

    return createSuccess(
      201,
      storedRequest,
      correlationId,
      storedEnvelope.revision,
      warnings,
    );
  }

  /**
   * Returns requests visible to the current actor.
   *
   * Member actors are always restricted to their own member identifier.
   *
   * @param {Record<string, unknown>} [query] Request filters.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async listRequests(query = {}, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.correlationIdGenerator,
      actor ?? context,
    );

    if (actor === null) {
      return createFailure(
        401,
        REQUEST_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
        'An active demo session is required.',
        correlationId,
        this.getRevision(),
      );
    }

    const action = INTERNAL_ROLES.has(actor.role)
      ? ACTIONS.OPERATIONAL_SUMMARY_VIEW
      : ACTIONS.CLAIM_VIEW;
    const authorization = await this.authorize(
      action,
      actor.role === 'MEMBER'
        ? {
            type: 'CLAIM_COLLECTION',
            id: actor.memberId,
            memberId: actor.memberId,
            owned: true,
          }
        : {
            type: 'REPRINT_REQUEST_COLLECTION',
            id: 'requests',
          },
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let normalizedQuery;

    try {
      normalizedQuery = normalizeListQuery(query);
    } catch (error) {
      return createFailure(
        422,
        REQUEST_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        error.message,
        correlationId,
        this.getRevision(),
      );
    }

    if (
      actor.role === 'MEMBER' &&
      actor.memberId === null
    ) {
      return createFailure(
        403,
        REQUEST_SERVICE_ERROR_CODES.FORBIDDEN,
        'Member request access requires a member identifier.',
        correlationId,
        this.getRevision(),
      );
    }

    if (
      actor.role === 'MEMBER' &&
      normalizedQuery.memberId !== undefined &&
      normalizedQuery.memberId !== null &&
      normalizeIdentifier(normalizedQuery.memberId) !==
        actor.memberId
    ) {
      return createFailure(
        403,
        REQUEST_SERVICE_ERROR_CODES.FORBIDDEN,
        'A member may list only their own requests.',
        correlationId,
        this.getRevision(),
      );
    }

    const contextualQuery =
      actor.role === 'MEMBER'
        ? {
            ...normalizedQuery,
            memberId: actor.memberId,
          }
        : normalizedQuery;

    try {
      const result = this.repository.listRequests(
        contextualQuery,
      );

      return createSuccess(
        200,
        result,
        correlationId,
        result.revision,
      );
    } catch (error) {
      if (
        getErrorCode(error) ===
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY
      ) {
        return createFailure(
          422,
          REQUEST_SERVICE_ERROR_CODES.VALIDATION_ERROR,
          'Request list filters are invalid.',
          correlationId,
          this.getRevision(),
          {
            details: {
              dependencyDetails: error.details ?? null,
            },
          },
        );
      }

      return normalizeRepositoryFailure(
        error,
        correlationId,
        this.getRevision(),
      );
    }
  }

  /**
   * Returns one request after contextual ownership authorization.
   *
   * @param {string} requestId Request identifier.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async getRequestById(requestId, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.correlationIdGenerator,
      actor ?? context,
    );

    if (!isOperationsUuid(requestId)) {
      return createFailure(
        422,
        REQUEST_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Request ID must be an RFC 4122 UUID.',
        correlationId,
        this.getRevision(),
        {
          fieldErrors: [
            createFieldError(
              'requestId',
              'INVALID_UUID',
              'Request ID must be an RFC 4122 UUID.',
            ),
          ],
        },
      );
    }

    const normalizedRequestId = requestId.toLowerCase();
    const request =
      typeof this.repository.getRequestById === 'function'
        ? this.repository.getRequestById(normalizedRequestId)
        : this.repository.getEntity(
            OPERATIONS_COLLECTIONS.REQUESTS,
            normalizedRequestId,
          );

    if (request === null) {
      return createFailure(
        404,
        REQUEST_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND,
        'The reprint request does not exist.',
        correlationId,
        this.getRevision(),
      );
    }

    const authorization = await this.authorize(
      ACTIONS.CLAIM_VIEW,
      {
        type: 'CLAIM',
        id: request.claimNumber,
        memberId: request.memberId,
        ownerMemberId: request.memberId,
        owned:
          actor?.role !== 'MEMBER' ||
          actor.memberId === request.memberId,
      },
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    if (
      actor.role === 'MEMBER' &&
      actor.memberId !== request.memberId
    ) {
      return createFailure(
        403,
        REQUEST_SERVICE_ERROR_CODES.FORBIDDEN,
        'A member may view only their own requests.',
        correlationId,
        this.getRevision(),
      );
    }

    return createSuccess(
      200,
      request,
      correlationId,
      this.getRevision(),
    );
  }

  create(command, context = undefined) {
    return this.createRequest(command, context);
  }

  list(query = {}, context = undefined) {
    return this.listRequests(query, context);
  }

  get(requestId, context = undefined) {
    return this.getRequestById(requestId, context);
  }

  findRequestById(requestId, context = undefined) {
    return this.getRequestById(requestId, context);
  }

  getOwnedRequest(requestId, context = undefined) {
    return this.getRequestById(requestId, context);
  }

  listOwnedRequests(query = {}, context = undefined) {
    return this.listRequests(query, context);
  }
}

/**
 * Creates a capability-checked local request service.
 *
 * @param {ConstructorParameters<typeof RequestService>[0]}
 * repositoryOrOptions Operations repository or service options.
 * @param {ConstructorParameters<typeof RequestService>[1]} [options]
 * Service options.
 * @returns {RequestService} Request service.
 */
export function createRequestService(
  repositoryOrOptions,
  options = {},
) {
  return new RequestService(repositoryOrOptions, options);
}

export const ReprintRequestService = RequestService;
export const LocalRequestService = RequestService;
export const createReprintRequestService =
  createRequestService;
export const createLocalRequestService = createRequestService;

export default RequestService;