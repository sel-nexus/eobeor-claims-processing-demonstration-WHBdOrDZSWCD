import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  DOCUMENT_STATUSES,
  OUTBOUND_KINDS,
  OUTBOUND_STATUSES,
} from '../domain/operationsSchemas.js';
import { isOperationsUuid } from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';

export const OUTBOUND_SERVICE_SCHEMA_VERSION = 1;

export const OUTBOUND_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  INVALID_DOCUMENT_STATUS: 'INVALID_DOCUMENT_STATUS',
  OUTBOUND_NOT_FOUND: 'OUTBOUND_NOT_FOUND',
  INVALID_OUTBOUND_KIND: 'INVALID_OUTBOUND_KIND',
  INVALID_OUTBOUND_STATUS: 'INVALID_OUTBOUND_STATUS',
  FAX_ALREADY_EXISTS: 'FAX_ALREADY_EXISTS',
  FAX_NOT_READY: 'FAX_NOT_READY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const OUTBOUND_AUDIT_ACTIONS = Object.freeze({
  RECORDS_CREATED: 'OUTBOUND_RECORDS_CREATED',
  FAX_OUTBOX_CREATED: 'FAX_OUTBOX_CREATED',
  FAX_SIMULATED: 'FAX_SIMULATED',
});

export const OUTBOUND_DISCLOSURES = Object.freeze({
  IXIT:
    'Mock IXIT record created locally; no report was transmitted.',
  REPORTING:
    'Reporting reference created locally; no reporting service was contacted.',
  REPRINT_REFERENCE:
    'Reprint reference created locally for demonstration.',
  EMAIL:
    'Email delivery was not requested and no email service is connected.',
  CRM:
    'CRM activity reference created locally; no CRM is connected.',
  FAX_READY:
    'Fax outbox marked ready for demonstration; no external transmission occurred.',
  FAX_SENT:
    'Fax marked sent for demonstration; no external transmission occurred.',
});

export const DEFAULT_OUTBOUND_KINDS = Object.freeze([
  OUTBOUND_KINDS.IXIT,
  OUTBOUND_KINDS.REPORTING,
  OUTBOUND_KINDS.REPRINT_REFERENCE,
  OUTBOUND_KINDS.EMAIL,
  OUTBOUND_KINDS.CRM,
]);

const OUTBOUND_KIND_VALUES = new Set(Object.values(OUTBOUND_KINDS));
const MASKED_DESTINATION_PATTERN =
  /(?:\*{2,}|\[REDACTED(?::[A-Z]+)?\]|\([*Xx]{3}\)|[Xx]{3})/;
const MAXIMUM_IDENTIFIER_LENGTH = 100;
const MAXIMUM_CORRELATION_ID_LENGTH = 200;

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
    typeof value.transact !== 'function'
  ) {
    throw new OutboundServiceError(
      OUTBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Outbound service requires an operations repository with getSnapshot() and transact().',
    );
  }

  return value;
}

function normalizePermissionGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.evaluate !== 'function') {
    throw new OutboundServiceError(
      OUTBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Outbound service permission gateway must provide evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.append !== 'function') {
    throw new OutboundServiceError(
      OUTBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Outbound service audit gateway must provide append().',
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

  throw new OutboundServiceError(
    OUTBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Outbound service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
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
      'Outbound service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Outbound service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedId(idGenerator, prefix) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Outbound service ID generator must return a non-empty string.',
    );
  }

  const normalized = value.normalize('NFC').trim();
  const identifier = normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;

  if (identifier.length > MAXIMUM_IDENTIFIER_LENGTH) {
    throw new TypeError(
      'Outbound service generated an identifier longer than 100 characters.',
    );
  }

  return identifier;
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <=
      MAXIMUM_CORRELATION_ID_LENGTH
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return createGeneratedId(idGenerator, 'corr-');
}

function createSuccess(
  status,
  data,
  correlationId,
  revision,
  warnings = [],
) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      revision,
      schemaVersion: OUTBOUND_SERVICE_SCHEMA_VERSION,
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
      schemaVersion: OUTBOUND_SERVICE_SCHEMA_VERSION,
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

  return deepFreeze({
    actorId: actorId.normalize('NFC').trim(),
    userId: actorId.normalize('NFC').trim(),
    displayName:
      typeof source.displayName === 'string' &&
      source.displayName.trim().length > 0
        ? source.displayName.normalize('NFC').trim()
        : actorId.normalize('NFC').trim(),
    role,
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
        : null,
    correlationId:
      typeof source.correlationId === 'string'
        ? source.correlationId
        : null,
  });
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function normalizeIdentifier(value, field, errors) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > MAXIMUM_IDENTIFIER_LENGTH
  ) {
    errors.push(
      createFieldError(
        field,
        'INVALID_IDENTIFIER',
        `${field} must be a non-empty string of at most ${MAXIMUM_IDENTIFIER_LENGTH} characters.`,
      ),
    );
    return null;
  }

  return value.normalize('NFC').trim();
}

function normalizeIdempotencyKey(value, required, errors) {
  if (
    (value === undefined || value === null || value === '') &&
    required !== true
  ) {
    return null;
  }

  if (!isOperationsUuid(value)) {
    errors.push(
      createFieldError(
        'idempotencyKey',
        'INVALID_UUID',
        'Idempotency key must be an RFC 4122 UUID.',
      ),
    );
    return null;
  }

  return value.toLowerCase();
}

function normalizeKinds(value, includeFax, errors) {
  const source =
    value === undefined || value === null
      ? [...DEFAULT_OUTBOUND_KINDS]
      : Array.isArray(value)
        ? value
        : [value];
  const kinds = source.map((kind) =>
    typeof kind === 'string' ? kind.trim().toUpperCase() : kind,
  );

  if (
    kinds.length === 0 ||
    kinds.some((kind) => !OUTBOUND_KIND_VALUES.has(kind)) ||
    new Set(kinds).size !== kinds.length
  ) {
    errors.push(
      createFieldError(
        'kinds',
        'INVALID_OUTBOUND_KIND',
        'Outbound kinds must contain unique supported values.',
      ),
    );
  }

  if (includeFax === true && !kinds.includes(OUTBOUND_KINDS.FAX)) {
    kinds.push(OUTBOUND_KINDS.FAX);
  }

  return kinds;
}

function normalizeDocumentIds(value, errors) {
  const source = Array.isArray(value) ? value : [value];
  const documentIds = source
    .map((documentId, index) =>
      normalizeIdentifier(
        documentId,
        source.length === 1
          ? 'documentId'
          : `documentIds[${index}]`,
        errors,
      ),
    )
    .filter(Boolean);

  if (source.length === 0) {
    errors.push(
      createFieldError(
        'documentIds',
        'REQUIRED',
        'At least one document ID is required.',
      ),
    );
  }

  if (new Set(documentIds).size !== documentIds.length) {
    errors.push(
      createFieldError(
        'documentIds',
        'DUPLICATE_IDENTIFIER',
        'Document IDs must be unique.',
      ),
    );
  }

  return documentIds;
}

function normalizeMaskedDestination(value, required, errors) {
  if (
    (value === undefined || value === null || value === '') &&
    required !== true
  ) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length < 4 ||
    value.trim().length > 100 ||
    !MASKED_DESTINATION_PATTERN.test(value.trim())
  ) {
    errors.push(
      createFieldError(
        'destinationMasked',
        'INVALID_MASKED_DESTINATION',
        'Fax destination must be a masked value of 4–100 characters.',
      ),
    );
    return null;
  }

  return value.normalize('NFC').trim();
}

function normalizeCreateRecordsCommand(value) {
  const command =
    typeof value === 'string'
      ? { documentId: value }
      : Array.isArray(value)
        ? { documentIds: value }
        : value;

  if (!isPlainObject(command) || !isJsonCompatible(command)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Outbound creation request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const documentIds = normalizeDocumentIds(
    command.documentIds ?? command.documentId,
    errors,
  );
  const includeFax =
    command.includeFax === true ||
    (Array.isArray(command.kinds) &&
      command.kinds.some(
        (kind) =>
          typeof kind === 'string' &&
          kind.trim().toUpperCase() === OUTBOUND_KINDS.FAX,
      ));
  const kinds = normalizeKinds(command.kinds, includeFax, errors);
  const destinationMasked = normalizeMaskedDestination(
    command.destinationMasked,
    kinds.includes(OUTBOUND_KINDS.FAX),
    errors,
  );
  const idempotencyKey = normalizeIdempotencyKey(
    command.idempotencyKey,
    false,
    errors,
  );

  if (
    command.includeFax !== undefined &&
    typeof command.includeFax !== 'boolean'
  ) {
    errors.push(
      createFieldError(
        'includeFax',
        'INVALID_BOOLEAN',
        'includeFax must be a boolean.',
      ),
    );
  }

  return {
    value: {
      documentIds,
      kinds,
      destinationMasked,
      idempotencyKey,
    },
    errors,
  };
}

function normalizeFaxCommand(value, operation) {
  const command =
    typeof value === 'string'
      ? operation === 'CREATE'
        ? { documentId: value }
        : { outboundId: value }
      : value;

  if (!isPlainObject(command) || !isJsonCompatible(command)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Fax outbox request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const documentId =
    command.documentId === undefined
      ? null
      : normalizeIdentifier(
          command.documentId,
          'documentId',
          errors,
        );
  const outboundId =
    command.outboundId === undefined
      ? null
      : normalizeIdentifier(
          command.outboundId,
          'outboundId',
          errors,
        );

  if (
    operation === 'CREATE' &&
    documentId === null &&
    command.documentId === undefined
  ) {
    errors.push(
      createFieldError(
        'documentId',
        'REQUIRED',
        'Document ID is required.',
      ),
    );
  }

  if (
    operation === 'SEND' &&
    outboundId === null &&
    documentId === null
  ) {
    errors.push(
      createFieldError(
        'outboundId',
        'REQUIRED',
        'Outbound ID or document ID is required.',
      ),
    );
  }

  return {
    value: {
      documentId,
      outboundId,
      destinationMasked:
        operation === 'CREATE'
          ? normalizeMaskedDestination(
              command.destinationMasked,
              true,
              errors,
            )
          : null,
      idempotencyKey: normalizeIdempotencyKey(
        command.idempotencyKey,
        true,
        errors,
      ),
    },
    errors,
  };
}

function hashCommand(commandName, values) {
  const source = [commandName, ...values].join('|');
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function findOutboundRecord(records, documentId, kind) {
  return (
    Object.values(records).find(
      (record) =>
        record.documentId === documentId &&
        record.kind === kind,
    ) ?? null
  );
}

function createUniqueOutboundId(draft, idGenerator, kind) {
  let identifier;

  do {
    identifier = createGeneratedId(
      idGenerator,
      `OUT-${kind}-`,
    );
  } while (draft.outboundRecords[identifier] !== undefined);

  return identifier;
}

function getDisclosure(kind, status) {
  if (kind === OUTBOUND_KINDS.FAX) {
    return status === OUTBOUND_STATUSES.SENT
      ? OUTBOUND_DISCLOSURES.FAX_SENT
      : OUTBOUND_DISCLOSURES.FAX_READY;
  }

  return OUTBOUND_DISCLOSURES[kind];
}

function createPayload(kind, document, destinationMasked) {
  const base = {
    transmitted: false,
    simulated: true,
    disclosure: getDisclosure(
      kind,
      kind === OUTBOUND_KINDS.EMAIL
        ? OUTBOUND_STATUSES.NOT_REQUESTED
        : kind === OUTBOUND_KINDS.FAX
          ? OUTBOUND_STATUSES.READY
          : OUTBOUND_STATUSES.COMPLETE,
    ),
  };

  switch (kind) {
    case OUTBOUND_KINDS.IXIT:
      return {
        ...base,
        reportId: `IXIT-${document.documentId}`,
        destination: 'MOCK_IXIT',
      };
    case OUTBOUND_KINDS.REPORTING:
      return {
        ...base,
        reportReference: `REPORT-${document.documentId}`,
      };
    case OUTBOUND_KINDS.REPRINT_REFERENCE:
      return {
        ...base,
        requestId: document.requestId,
        documentVersion: document.version,
      };
    case OUTBOUND_KINDS.EMAIL:
      return {
        ...base,
        destination: null,
      };
    case OUTBOUND_KINDS.CRM:
      return {
        ...base,
        activityReference: `CRM-${document.documentId}`,
      };
    case OUTBOUND_KINDS.FAX:
      return {
        ...base,
        destinationMasked,
      };
    default:
      throw new OutboundServiceError(
        OUTBOUND_SERVICE_ERROR_CODES.INVALID_OUTBOUND_KIND,
        'Outbound kind is not supported.',
        { kind },
      );
  }
}

function getInitialStatus(kind) {
  if (kind === OUTBOUND_KINDS.EMAIL) {
    return OUTBOUND_STATUSES.NOT_REQUESTED;
  }

  if (kind === OUTBOUND_KINDS.FAX) {
    return OUTBOUND_STATUSES.READY;
  }

  return OUTBOUND_STATUSES.COMPLETE;
}

function validateDocument(document) {
  if (document === undefined || document === null) {
    throw new OutboundServiceError(
      OUTBOUND_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND,
      'The representative document does not exist.',
    );
  }

  if (document.status !== DOCUMENT_STATUSES.COMPLETE) {
    throw new OutboundServiceError(
      OUTBOUND_SERVICE_ERROR_CODES.INVALID_DOCUMENT_STATUS,
      'Only complete representative documents may create outbound records.',
      {
        documentId: document.documentId,
        status: document.status,
      },
    );
  }
}

function updateRequestFaxStatus(draft, document, status) {
  const request = draft.requests[document.requestId];

  if (request === undefined) {
    return;
  }

  request.faxStatus = status;
  request.version += 1;
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
      OUTBOUND_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before the outbound operation completed.',
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
      OUTBOUND_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof OutboundServiceError) {
    const status =
      error.code === OUTBOUND_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND ||
      error.code === OUTBOUND_SERVICE_ERROR_CODES.OUTBOUND_NOT_FOUND
        ? 404
        : error.code ===
              OUTBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT ||
            error.code ===
              OUTBOUND_SERVICE_ERROR_CODES.FAX_ALREADY_EXISTS ||
            error.code === OUTBOUND_SERVICE_ERROR_CODES.FAX_NOT_READY ||
            error.code ===
              OUTBOUND_SERVICE_ERROR_CODES.INVALID_DOCUMENT_STATUS
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
    OUTBOUND_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The local outbound operation could not be stored.',
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
 * Error raised when outbound service input or dependencies are invalid.
 */
export class OutboundServiceError extends Error {
  /**
   * @param {string} code Stable outbound service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OutboundServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Creates browser-local outbound metadata without contacting external systems.
 */
export class OutboundService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options containing injected dependencies.
   * @param {{
   *   permissionGateway?: object,
   *   permissionService?: object,
   *   auditGateway?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.repository = requireRepository(resolved.repository);
    this.permissionGateway = normalizePermissionGateway(
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
        this.permissionGateway?.sessionProvider,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Outbound service ID generator must be a function.',
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

  async authorize(action, document, actor, correlationId) {
    if (this.permissionGateway === null) {
      return {
        allowed: true,
        decision: null,
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action,
          resource: {
            type: 'DOCUMENT',
            id: document.documentId,
            documentId: document.documentId,
            claimNumber: document.claimNumber,
            memberId: document.memberId,
            ownerMemberId: document.memberId,
            owned:
              actor?.role !== 'MEMBER' ||
              actor.memberId === document.memberId,
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          OUTBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Outbound permission evaluation could not be completed.',
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
      decision?.reasonCode === 'SESSION_EXPIRED' ||
      actor === null;

    return {
      allowed: false,
      failure: createFailure(
        unauthenticated ? 401 : 403,
        unauthenticated
          ? OUTBOUND_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : OUTBOUND_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'This demo role cannot create or update the outbound record.',
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
    document,
    records,
  }) {
    if (this.auditGateway === null || actor === null) {
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
            type: 'DOCUMENT',
            id: document.documentId,
          },
        },
        {
          action,
          entity: {
            type: 'DOCUMENT',
            id: document.documentId,
          },
          before: null,
          after: {
            documentId: document.documentId,
            outboundRecords: records.map((record) => ({
              outboundId: record.outboundId,
              kind: record.kind,
              status: record.status,
              transmitted: false,
            })),
          },
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: OUTBOUND_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The outbound operation completed, but its local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Creates the mock IXIT, reporting, reprint, email, CRM, and optional fax
   * records for one or more complete representative documents.
   *
   * @param {string|string[]|Record<string, unknown>} command Creation command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async createOutboundRecords(command, context = undefined) {
    const normalized = normalizeCreateRecordsCommand(command);
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        OUTBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Outbound creation request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const documents = [];

    for (const documentId of input.documentIds) {
      const document = snapshot.documents[documentId];

      if (document === undefined) {
        return createFailure(
          404,
          OUTBOUND_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND,
          'The representative document does not exist.',
          correlationId,
          snapshot.revision,
          { details: { documentId } },
        );
      }

      if (document.status !== DOCUMENT_STATUSES.COMPLETE) {
        return createFailure(
          409,
          OUTBOUND_SERVICE_ERROR_CODES.INVALID_DOCUMENT_STATUS,
          'Only complete representative documents may create outbound records.',
          correlationId,
          snapshot.revision,
          {
            details: {
              documentId,
              status: document.status,
            },
          },
        );
      }

      const authorization = await this.authorize(
        ACTIONS.DOCUMENT_VIEW,
        document,
        actor,
        correlationId,
      );

      if (!authorization.allowed) {
        return authorization.failure;
      }

      documents.push(document);
    }

    const requestHash = hashCommand(
      'createOutboundRecords',
      [
        ...input.documentIds,
        ...input.kinds,
        input.destinationMasked ?? '',
      ],
    );
    const existingIdempotency =
      input.idempotencyKey === null
        ? undefined
        : snapshot.idempotencyResults[input.idempotencyKey];

    if (existingIdempotency !== undefined) {
      if (
        existingIdempotency.commandName !==
          'createOutboundRecords' ||
        existingIdempotency.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          OUTBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another outbound operation.',
          correlationId,
          snapshot.revision,
        );
      }

      const records = existingIdempotency.result.outboundIds
        .map(
          (outboundId) =>
            snapshot.outboundRecords[outboundId],
        )
        .filter(Boolean);

      return createSuccess(
        200,
        {
          replayed: true,
          transmitted: false,
          outboundIds: records.map(
            (record) => record.outboundId,
          ),
          records,
        },
        correlationId,
        snapshot.revision,
      );
    }

    const createdAt = getCurrentTimestamp(this.clock);
    let createdIds = [];
    let replayed = false;
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          if (input.idempotencyKey !== null) {
            const committed =
              draft.idempotencyResults[
                input.idempotencyKey
              ];

            if (committed !== undefined) {
              if (
                committed.commandName !==
                  'createOutboundRecords' ||
                committed.requestHash !== requestHash
              ) {
                throw new OutboundServiceError(
                  OUTBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                  'The idempotency key was already used for another outbound operation.',
                );
              }

              replayed = true;
              createdIds = committed.result.outboundIds;
              return;
            }
          }

          documents.forEach((documentReference) => {
            const document =
              draft.documents[documentReference.documentId];

            validateDocument(document);

            input.kinds.forEach((kind) => {
              const existing = findOutboundRecord(
                draft.outboundRecords,
                document.documentId,
                kind,
              );

              if (existing !== null) {
                createdIds.push(existing.outboundId);
                return;
              }

              const outboundId = createUniqueOutboundId(
                draft,
                this.idGenerator,
                kind,
              );
              const status = getInitialStatus(kind);
              const record = {
                outboundId,
                kind,
                documentId: document.documentId,
                status,
                payloadMasked: createPayload(
                  kind,
                  document,
                  input.destinationMasked,
                ),
                createdAt,
              };

              draft.outboundRecords[outboundId] = record;
              createdIds.push(outboundId);

              if (kind === OUTBOUND_KINDS.FAX) {
                updateRequestFaxStatus(
                  draft,
                  document,
                  OUTBOUND_STATUSES.READY,
                );
              }
            });
          });

          createdIds = [...new Set(createdIds)];

          if (input.idempotencyKey !== null) {
            draft.idempotencyResults[input.idempotencyKey] = {
              idempotencyKey: input.idempotencyKey,
              commandName: 'createOutboundRecords',
              requestHash,
              result: {
                outboundIds: createdIds,
                transmitted: false,
              },
              createdAt,
            };
          }
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

    const records = createdIds
      .map(
        (outboundId) =>
          storedEnvelope.outboundRecords[outboundId],
      )
      .filter(Boolean);
    const warnings = [];

    if (!replayed) {
      for (const document of documents) {
        const documentRecords = records.filter(
          (record) =>
            record.documentId === document.documentId,
        );
        const warning = await this.appendAudit({
          correlationId,
          actor,
          action: OUTBOUND_AUDIT_ACTIONS.RECORDS_CREATED,
          document,
          records: documentRecords,
        });

        if (warning !== null) {
          warnings.push(warning);
        }
      }
    }

    return createSuccess(
      replayed ? 200 : 201,
      {
        replayed,
        transmitted: false,
        outboundIds: records.map(
          (record) => record.outboundId,
        ),
        records,
      },
      correlationId,
      storedEnvelope.revision,
      warnings,
    );
  }

  /**
   * Creates one local fax outbox row in READY status.
   *
   * @param {string|Record<string, unknown>} command Fax command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async createFaxOutbox(command, context = undefined) {
    const normalized = normalizeFaxCommand(command, 'CREATE');

    if (normalized.errors.length > 0) {
      const actor = this.resolveContext(context);
      const correlationId = createCorrelationId(
        this.idGenerator,
        actor ?? context,
      );

      return createFailure(
        422,
        OUTBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Fax outbox request validation failed.',
        correlationId,
        this.getRevision(),
        { fieldErrors: normalized.errors },
      );
    }

    const result = await this.createOutboundRecords(
      {
        documentId: normalized.value.documentId,
        kinds: [OUTBOUND_KINDS.FAX],
        destinationMasked:
          normalized.value.destinationMasked,
        idempotencyKey: normalized.value.idempotencyKey,
      },
      context,
    );

    if (!result.ok) {
      return result;
    }

    const record = result.data.records.find(
      (candidate) => candidate.kind === OUTBOUND_KINDS.FAX,
    );

    return createSuccess(
      result.status,
      {
        replayed: result.data.replayed,
        transmitted: false,
        outboundId: record.outboundId,
        record,
        disclosure: OUTBOUND_DISCLOSURES.FAX_READY,
      },
      result.meta.correlationId,
      result.meta.revision,
      result.meta.warnings,
    );
  }

  /**
   * Marks a READY fax row as SENT for demonstration without transmission.
   *
   * @param {string|Record<string, unknown>} command Fax command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async markFaxSent(command, context = undefined) {
    const normalized = normalizeFaxCommand(command, 'SEND');
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        OUTBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Fax simulation request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const initialRecord =
      input.outboundId !== null
        ? snapshot.outboundRecords[input.outboundId]
        : Object.values(snapshot.outboundRecords).find(
            (record) =>
              record.kind === OUTBOUND_KINDS.FAX &&
              record.documentId === input.documentId,
          );

    if (
      initialRecord === undefined ||
      initialRecord.kind !== OUTBOUND_KINDS.FAX
    ) {
      return createFailure(
        404,
        OUTBOUND_SERVICE_ERROR_CODES.OUTBOUND_NOT_FOUND,
        'The local fax outbox record does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const document =
      snapshot.documents[initialRecord.documentId];

    if (document === undefined) {
      return createFailure(
        404,
        OUTBOUND_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND,
        'The representative document does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const authorization = await this.authorize(
      ACTIONS.DOCUMENT_DOWNLOAD,
      document,
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const requestHash = hashCommand('markFaxSent', [
      initialRecord.outboundId,
    ]);
    const existingIdempotency =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existingIdempotency !== undefined) {
      if (
        existingIdempotency.commandName !== 'markFaxSent' ||
        existingIdempotency.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          OUTBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another fax operation.',
          correlationId,
          snapshot.revision,
        );
      }

      const record =
        snapshot.outboundRecords[
          existingIdempotency.result.outboundId
        ];

      if (record === undefined) {
        return createFailure(
          500,
          OUTBOUND_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
          'The stored fax result references a missing outbound record.',
          correlationId,
          snapshot.revision,
        );
      }

      return createSuccess(
        200,
        {
          replayed: true,
          transmitted: false,
          outboundId: record.outboundId,
          record,
          disclosure: OUTBOUND_DISCLOSURES.FAX_SENT,
        },
        correlationId,
        snapshot.revision,
      );
    }

    const sentAt = getCurrentTimestamp(this.clock);
    let replayed = false;
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const committed =
            draft.idempotencyResults[input.idempotencyKey];

          if (committed !== undefined) {
            if (
              committed.commandName !== 'markFaxSent' ||
              committed.requestHash !== requestHash
            ) {
              throw new OutboundServiceError(
                OUTBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another fax operation.',
              );
            }

            replayed = true;
            return;
          }

          const record =
            draft.outboundRecords[initialRecord.outboundId];

          if (
            record === undefined ||
            record.kind !== OUTBOUND_KINDS.FAX
          ) {
            throw new OutboundServiceError(
              OUTBOUND_SERVICE_ERROR_CODES.OUTBOUND_NOT_FOUND,
              'The local fax outbox record does not exist.',
            );
          }

          if (
            record.status !== OUTBOUND_STATUSES.READY &&
            record.status !== OUTBOUND_STATUSES.SENT
          ) {
            throw new OutboundServiceError(
              OUTBOUND_SERVICE_ERROR_CODES.FAX_NOT_READY,
              'Only a ready fax outbox record may be marked sent.',
              {
                outboundId: record.outboundId,
                status: record.status,
              },
            );
          }

          if (record.status === OUTBOUND_STATUSES.SENT) {
            replayed = true;
          } else {
            record.status = OUTBOUND_STATUSES.SENT;
            record.payloadMasked = {
              ...record.payloadMasked,
              transmitted: false,
              simulated: true,
              simulatedSentAt: sentAt,
              disclosure: OUTBOUND_DISCLOSURES.FAX_SENT,
            };

            const storedDocument =
              draft.documents[record.documentId];

            if (storedDocument !== undefined) {
              updateRequestFaxStatus(
                draft,
                storedDocument,
                OUTBOUND_STATUSES.SENT,
              );
            }
          }

          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'markFaxSent',
            requestHash,
            result: {
              outboundId: record.outboundId,
              status: OUTBOUND_STATUSES.SENT,
              transmitted: false,
            },
            createdAt: sentAt,
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

    const record =
      storedEnvelope.outboundRecords[initialRecord.outboundId];
    const warnings = [];

    if (!replayed) {
      const warning = await this.appendAudit({
        correlationId,
        actor,
        action: OUTBOUND_AUDIT_ACTIONS.FAX_SIMULATED,
        document,
        records: [record],
      });

      if (warning !== null) {
        warnings.push(warning);
      }
    }

    return createSuccess(
      200,
      {
        replayed,
        transmitted: false,
        outboundId: record.outboundId,
        record,
        disclosure: OUTBOUND_DISCLOSURES.FAX_SENT,
      },
      correlationId,
      storedEnvelope.revision,
      warnings,
    );
  }

  getOutboundRecordById(outboundId) {
    if (
      typeof outboundId !== 'string' ||
      outboundId.trim().length === 0 ||
      outboundId.trim().length > MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new OutboundServiceError(
        OUTBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Outbound ID must be a non-empty string of at most 100 characters.',
      );
    }

    return (
      this.repository.getSnapshot().outboundRecords[
        outboundId.normalize('NFC').trim()
      ] ?? null
    );
  }

  getOutboundRecordsByDocumentId(documentId) {
    if (
      typeof documentId !== 'string' ||
      documentId.trim().length === 0 ||
      documentId.trim().length > MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new OutboundServiceError(
        OUTBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Document ID must be a non-empty string of at most 100 characters.',
      );
    }

    const identifier = documentId.normalize('NFC').trim();

    return deepFreeze(
      Object.values(
        this.repository.getSnapshot().outboundRecords,
      )
        .filter(
          (record) => record.documentId === identifier,
        )
        .sort((left, right) => {
          const timestampDifference =
            Date.parse(left.createdAt) -
            Date.parse(right.createdAt);

          return timestampDifference !== 0
            ? timestampDifference
            : left.outboundId.localeCompare(
                right.outboundId,
                'en-US',
              );
        }),
    );
  }

  createRecords(command, context = undefined) {
    return this.createOutboundRecords(command, context);
  }

  createForDocuments(command, context = undefined) {
    return this.createOutboundRecords(command, context);
  }

  createFax(command, context = undefined) {
    return this.createFaxOutbox(command, context);
  }

  markFaxAsSent(command, context = undefined) {
    return this.markFaxSent(command, context);
  }

  findOutboundRecordById(outboundId) {
    return this.getOutboundRecordById(outboundId);
  }

  listByDocumentId(documentId) {
    return this.getOutboundRecordsByDocumentId(documentId);
  }
}

/**
 * Creates a browser-local outbound service.
 *
 * @param {ConstructorParameters<typeof OutboundService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof OutboundService>[1]} [options]
 * Service options.
 * @returns {OutboundService} Outbound service.
 */
export function createOutboundService(
  repositoryOrOptions,
  options = {},
) {
  return new OutboundService(repositoryOrOptions, options);
}

export const LocalOutboundService = OutboundService;
export const OperationsOutboundService = OutboundService;
export const createLocalOutboundService =
  createOutboundService;
export const createOperationsOutboundService =
  createOutboundService;

export default OutboundService;