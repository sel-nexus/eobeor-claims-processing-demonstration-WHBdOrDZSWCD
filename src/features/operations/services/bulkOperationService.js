import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import {
  formatCsv,
  sanitizeFilename,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  PROCESSING_SCENARIOS,
  REQUEST_STATUSES,
} from '../domain/domainConstants.js';
import { isOperationsUuid } from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';

export const BULK_OPERATION_SERVICE_SCHEMA_VERSION = 1;

export const BULK_OPERATION_ACTIONS = Object.freeze({
  PROCESS: 'PROCESS',
});

export const BULK_OPERATION_AUDIT_ACTIONS = Object.freeze({
  ROW_PROCESSED: 'BULK_ROW_PROCESSED',
  EXPORTED: 'OPERATIONS_QUEUE_EXPORTED',
});

export const BULK_OPERATION_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_ACTION: 'INVALID_ACTION',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  INVALID_STATE: 'INVALID_STATE',
  RUN_ALREADY_ACTIVE: 'RUN_ALREADY_ACTIVE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const BULK_OPERATION_LIMITS = Object.freeze({
  MAXIMUM_REQUESTS: 200,
  MAXIMUM_EXPORT_ROWS: 5000,
  EXPORT_PAGE_SIZE: 200,
  MAXIMUM_FILENAME_LENGTH: 255,
});

export const BULK_OPERATION_EXPORT_NOTICE =
  'Fictional demo data';

const BULK_ACTION_VALUES = new Set(
  Object.values(BULK_OPERATION_ACTIONS),
);
const PROCESSING_SCENARIO_VALUES = new Set(
  Object.values(PROCESSING_SCENARIOS),
);
const AUTHORIZED_ROLES = new Set(['BOS', 'ADMIN']);
const PROCESSABLE_STATUSES = new Set([
  REQUEST_STATUSES.PENDING,
  REQUEST_STATUSES.FAILED,
]);
const CSV_HEADERS = Object.freeze([
  'display_id',
  'claim_number',
  'request_type',
  'priority',
  'status',
  'created_at',
]);
const CSV_MEDIA_TYPE = 'text/csv;charset=utf-8';

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

function cloneMutable(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneMutable(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneMutable(item),
      ]),
    );
  }

  return value;
}

function requireRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getSnapshot !== 'function' ||
    typeof value.listRequests !== 'function' ||
    typeof value.transact !== 'function'
  ) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Bulk operation service requires an operations repository with getSnapshot(), listRequests(), and transact().',
    );
  }

  return value;
}

function normalizeProcessor(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value !== 'object' ||
    (typeof value.processRequest !== 'function' &&
      typeof value.process !== 'function' &&
      typeof value.run !== 'function')
  ) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Bulk operation service requires a pipeline processor with processRequest(), process(), or run().',
    );
  }

  return value;
}

function normalizePermissionGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Bulk operation service permission gateway must provide evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.append !== 'function'
  ) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Bulk operation service audit gateway must provide append().',
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

  throw new BulkOperationServiceError(
    BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Bulk operation service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
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
      'Bulk operation service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Bulk operation service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedValue(
  idGenerator,
  prefix,
  maximumLength = 200,
) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Bulk operation service ID generator must return a non-empty string.',
    );
  }

  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-');
  const identifier = normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;

  if (identifier.length > maximumLength) {
    throw new TypeError(
      `Bulk operation service generated an identifier longer than ${maximumLength} characters.`,
    );
  }

  return identifier;
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return createGeneratedValue(idGenerator, 'corr-', 200);
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
      schemaVersion: BULK_OPERATION_SERVICE_SCHEMA_VERSION,
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
      schemaVersion: BULK_OPERATION_SERVICE_SCHEMA_VERSION,
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
  const actorId =
    source.actorId ?? source.userId ?? source.requestedBy;
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;

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
      typeof source.correlationId === 'string' &&
      source.correlationId.trim().length > 0
        ? source.correlationId.normalize('NFC').trim()
        : null,
  });
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function normalizeListQuery(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Bulk request query must be a safe JSON-compatible object.',
    );
  }

  return cloneMutable(value);
}

function normalizeBulkCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Bulk processing request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    'requestIds',
    'action',
    'scenario',
    'mode',
    'idempotencyKey',
  ]);
  const errors = Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Bulk processing field ${field} is not supported.`,
      ),
    );
  const action =
    value.action === undefined
      ? BULK_OPERATION_ACTIONS.PROCESS
      : typeof value.action === 'string'
        ? value.action.trim().toUpperCase()
        : value.action;
  const scenario =
    value.scenario === undefined
      ? PROCESSING_SCENARIOS.SUCCESS
      : typeof value.scenario === 'string'
        ? value.scenario.trim().toUpperCase()
        : value.scenario;
  const mode =
    value.mode === undefined
      ? 'IMMEDIATE'
      : typeof value.mode === 'string'
        ? value.mode.trim().toUpperCase()
        : value.mode;
  const idempotencyKey =
    typeof value.idempotencyKey === 'string'
      ? value.idempotencyKey.trim().toLowerCase()
      : value.idempotencyKey;

  if (
    !Array.isArray(value.requestIds) ||
    value.requestIds.length === 0 ||
    value.requestIds.length >
      BULK_OPERATION_LIMITS.MAXIMUM_REQUESTS
  ) {
    errors.push(
      createFieldError(
        'requestIds',
        'INVALID_REQUEST_IDS',
        `Bulk request IDs must contain between 1 and ${BULK_OPERATION_LIMITS.MAXIMUM_REQUESTS} entries.`,
      ),
    );
  }

  const requestIds = Array.isArray(value.requestIds)
    ? value.requestIds.map((requestId, index) => {
        if (!isOperationsUuid(requestId)) {
          errors.push(
            createFieldError(
              `requestIds[${index}]`,
              'INVALID_UUID',
              'Bulk request ID must be an RFC 4122 UUID.',
            ),
          );
          return null;
        }

        return requestId.toLowerCase();
      }).filter(Boolean)
    : [];

  if (new Set(requestIds).size !== requestIds.length) {
    errors.push(
      createFieldError(
        'requestIds',
        'DUPLICATE_IDENTIFIER',
        'Bulk request IDs must be unique.',
      ),
    );
  }

  if (!BULK_ACTION_VALUES.has(action)) {
    errors.push(
      createFieldError(
        'action',
        'INVALID_ACTION',
        'Bulk action must be PROCESS.',
      ),
    );
  }

  if (!PROCESSING_SCENARIO_VALUES.has(scenario)) {
    errors.push(
      createFieldError(
        'scenario',
        'INVALID_SCENARIO',
        'Bulk processing scenario is not supported.',
      ),
    );
  }

  if (mode !== 'IMMEDIATE' && mode !== 'COMPRESSED') {
    errors.push(
      createFieldError(
        'mode',
        'INVALID_MODE',
        'Bulk processing mode must be IMMEDIATE or COMPRESSED.',
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

  return {
    value: {
      requestIds,
      action,
      scenario,
      mode,
      idempotencyKey,
    },
    errors,
  };
}

function normalizeExportInput(value) {
  if (value === undefined || value === null) {
    return {
      query: {},
      filename: null,
    };
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Queue export request must be a safe JSON-compatible object.',
    );
  }

  if (
    isPlainObject(value.filters) ||
    isPlainObject(value.query)
  ) {
    const query = value.filters ?? value.query;
    const filename = value.filename;

    if (
      filename !== undefined &&
      (typeof filename !== 'string' ||
        filename.trim().length === 0 ||
        filename.trim().length >
          BULK_OPERATION_LIMITS.MAXIMUM_FILENAME_LENGTH)
    ) {
      throw new BulkOperationServiceError(
        BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Queue export filename must be a non-empty string of at most 255 characters.',
      );
    }

    return {
      query: normalizeListQuery(query),
      filename:
        typeof filename === 'string'
          ? filename.normalize('NFC').trim()
          : null,
    };
  }

  const {
    filename,
    filters: ignoredFilters,
    ...query
  } = value;

  void ignoredFilters;

  if (
    filename !== undefined &&
    (typeof filename !== 'string' ||
      filename.trim().length === 0 ||
      filename.trim().length >
        BULK_OPERATION_LIMITS.MAXIMUM_FILENAME_LENGTH)
  ) {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Queue export filename must be a non-empty string of at most 255 characters.',
    );
  }

  return {
    query,
    filename:
      typeof filename === 'string'
        ? filename.normalize('NFC').trim()
        : null,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(value[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashCommand(commandName, value) {
  const source = `${commandName}|${canonicalize(value)}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function hashHex(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deriveRowIdempotencyKey(parentKey, requestId, index) {
  const source = `${parentKey}|${requestId}|${index}`;
  const compact = [
    hashHex(`${source}|0`),
    hashHex(`${source}|1`),
    hashHex(`${source}|2`),
    hashHex(`${source}|3`),
  ].join('');
  const characters = compact.split('');

  characters[12] = '4';
  characters[16] = '8';

  return [
    characters.slice(0, 8).join(''),
    characters.slice(8, 12).join(''),
    characters.slice(12, 16).join(''),
    characters.slice(16, 20).join(''),
    characters.slice(20, 32).join(''),
  ].join('-');
}

function getProcessingMethod(processor) {
  if (typeof processor.processRequest === 'function') {
    return processor.processRequest.bind(processor);
  }

  if (typeof processor.process === 'function') {
    return processor.process.bind(processor);
  }

  return processor.run.bind(processor);
}

function createEligibilitySnapshot(snapshot, requestIds) {
  return requestIds.map((requestId) => {
    const request = snapshot.requests[requestId];

    if (request === undefined) {
      return deepFreeze({
        requestId,
        exists: false,
        eligible: false,
        status: null,
        version: null,
        errorCode:
          BULK_OPERATION_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND,
      });
    }

    const eligible = PROCESSABLE_STATUSES.has(request.status);

    return deepFreeze({
      requestId,
      exists: true,
      eligible,
      status: request.status,
      version: request.version,
      errorCode: eligible
        ? null
        : BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_STATE,
    });
  });
}

function createIneligibleResult(eligibility) {
  return {
    requestId: eligibility.requestId,
    status: REQUEST_STATUSES.FAILED,
    errorCode: eligibility.errorCode,
    sourceStatus: eligibility.status,
  };
}

function normalizeProcessingResult(requestId, value) {
  if (!isPlainObject(value)) {
    return {
      requestId,
      status: REQUEST_STATUSES.FAILED,
      errorCode:
        BULK_OPERATION_SERVICE_ERROR_CODES.PROCESSING_FAILED,
    };
  }

  if (value.ok !== true) {
    return {
      requestId,
      status: REQUEST_STATUSES.FAILED,
      errorCode:
        value.error?.code ??
        BULK_OPERATION_SERVICE_ERROR_CODES.PROCESSING_FAILED,
    };
  }

  const status =
    typeof value.data?.status === 'string'
      ? value.data.status
      : REQUEST_STATUSES.COMPLETE;

  return {
    requestId,
    status,
    errorCode:
      status === REQUEST_STATUSES.FAILED
        ? value.data?.errorCode ??
          BULK_OPERATION_SERVICE_ERROR_CODES.PROCESSING_FAILED
        : null,
    ...(Array.isArray(value.data?.documentIds)
      ? { documentIds: value.data.documentIds }
      : {}),
    ...(typeof value.data?.errorReportId === 'string'
      ? { errorReportId: value.data.errorReportId }
      : {}),
  };
}

function normalizeRejectedResult(requestId, error) {
  return {
    requestId,
    status: REQUEST_STATUSES.FAILED,
    errorCode:
      getErrorCode(error) ??
      BULK_OPERATION_SERVICE_ERROR_CODES.PROCESSING_FAILED,
  };
}

function createExportFilename(timestamp) {
  return `operations-queue-demo-${timestamp.slice(0, 10).replace(/-/g, '')}.csv`;
}

function createExportBlob(content) {
  const BlobConstructor = globalThis.Blob;

  if (typeof BlobConstructor !== 'function') {
    throw new BulkOperationServiceError(
      BULK_OPERATION_SERVICE_ERROR_CODES.EXPORT_FAILED,
      'Browser Blob APIs are unavailable.',
    );
  }

  return new BlobConstructor([content], {
    type: CSV_MEDIA_TYPE,
  });
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
      BULK_OPERATION_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before the bulk operation completed.',
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
      BULK_OPERATION_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof BulkOperationServiceError) {
    const status =
      error.code ===
        BULK_OPERATION_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND
        ? 404
        : error.code ===
              BULK_OPERATION_SERVICE_ERROR_CODES.RUN_ALREADY_ACTIVE ||
            error.code ===
              BULK_OPERATION_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT ||
            error.code ===
              BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_STATE
          ? 409
          : 422;

    return createFailure(
      status,
      error.code,
      error.message,
      correlationId,
      revision,
      {
        details: error.details,
        retryable:
          error.code ===
          BULK_OPERATION_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      },
    );
  }

  return createFailure(
    500,
    BULK_OPERATION_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The local bulk operation could not be completed.',
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
 * Error raised when bulk-operation input, dependencies, or state are invalid.
 */
export class BulkOperationServiceError extends Error {
  /**
   * @param {string} code Stable bulk-operation error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BulkOperationServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Provides permission-checked queue listing, independent bulk processing, and
 * fictional browser-local CSV export.
 */
export class BulkOperationService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options.
   * @param {{
   *   pipelineOrchestrator?: object,
   *   pipelineService?: object,
   *   requestProcessor?: object,
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
    this.processor = normalizeProcessor(
      normalizedOptions.pipelineOrchestrator ??
        normalizedOptions.pipelineService ??
        normalizedOptions.requestProcessor,
    );
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
    this.activeIdempotencyKeys = new Set();

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Bulk operation service ID generator must be a function.',
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

  async authorize(actor, correlationId) {
    if (actor !== null && !AUTHORIZED_ROLES.has(actor.role)) {
      return {
        allowed: false,
        failure: createFailure(
          403,
          BULK_OPERATION_SERVICE_ERROR_CODES.FORBIDDEN,
          'Bulk queue operations are available only to BOS and Admin demo roles.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    if (this.permissionGateway === null) {
      if (actor === null) {
        return {
          allowed: true,
          actor: null,
        };
      }

      return {
        allowed: true,
        actor,
      };
    }

    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          BULK_OPERATION_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
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
          action: ACTIONS.OPERATIONAL_SUMMARY_VIEW,
          resource: {
            type: 'OPERATIONS_QUEUE',
            id: 'local',
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Bulk operation permission evaluation could not be completed.',
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

    if (
      decision?.allowed === true &&
      AUTHORIZED_ROLES.has(actor.role)
    ) {
      return {
        allowed: true,
        actor,
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
          ? BULK_OPERATION_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : BULK_OPERATION_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'Bulk queue operations are available only to BOS and Admin demo roles.',
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
    entityType,
    entityId,
    after,
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
            type: entityType,
            id: entityId,
          },
        },
        {
          action,
          entity: {
            type: entityType,
            id: entityId,
          },
          before: null,
          after,
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: BULK_OPERATION_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The bulk operation completed, but a local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Lists locally filtered and deterministically sorted requests.
   *
   * @param {Record<string, unknown>} [query] Request filters.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async listRequests(query = {}, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const authorization = await this.authorize(
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
        BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        error.message,
        correlationId,
        this.getRevision(),
        { details: error.details },
      );
    }

    try {
      const result = this.repository.listRequests(
        normalizedQuery,
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
          BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
          'Operations queue filters are invalid.',
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
   * Processes selected requests independently using an eligibility snapshot.
   *
   * Every selected row produces a result. Ineligible or missing rows do not
   * prevent eligible rows from processing.
   *
   * @param {Record<string, unknown>} command Bulk processing command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async bulkProcess(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeBulkCommand(command);
    const initialSnapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      const invalidAction = normalized.errors.some(
        (error) => error.code === 'INVALID_ACTION',
      );

      return createFailure(
        422,
        invalidAction
          ? BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_ACTION
          : BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Bulk processing request validation failed.',
        correlationId,
        initialSnapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const input = normalized.value;
    const requestHash = hashCommand('bulkProcess', {
      requestIds: input.requestIds,
      action: input.action,
      scenario: input.scenario,
      mode: input.mode,
    });
    const existing =
      initialSnapshot.idempotencyResults[input.idempotencyKey];

    if (existing !== undefined) {
      if (
        existing.commandName !== 'bulkProcess' ||
        existing.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          BULK_OPERATION_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another bulk operation.',
          correlationId,
          initialSnapshot.revision,
        );
      }

      return createSuccess(
        200,
        {
          ...existing.result,
          replayed: true,
        },
        correlationId,
        initialSnapshot.revision,
      );
    }

    if (
      this.activeIdempotencyKeys.has(input.idempotencyKey)
    ) {
      return createFailure(
        409,
        BULK_OPERATION_SERVICE_ERROR_CODES.RUN_ALREADY_ACTIVE,
        'This bulk operation is already active.',
        correlationId,
        initialSnapshot.revision,
      );
    }

    const eligibility = createEligibilitySnapshot(
      initialSnapshot,
      input.requestIds,
    );
    const processRequest = getProcessingMethod(this.processor);
    const processable = eligibility.filter(
      (entry) => entry.eligible,
    );
    const operationId = createGeneratedValue(
      this.idGenerator,
      'BULK-',
      100,
    );

    this.activeIdempotencyKeys.add(input.idempotencyKey);

    try {
      const settled = await Promise.allSettled(
        processable.map((entry, index) =>
          processRequest(
            {
              requestId: entry.requestId,
              mode: input.mode,
              scenario: input.scenario,
              idempotencyKey: deriveRowIdempotencyKey(
                input.idempotencyKey,
                entry.requestId,
                index,
              ),
            },
            actor ?? undefined,
          ),
        ),
      );
      const settledByRequestId = new Map();

      processable.forEach((entry, index) => {
        const outcome = settled[index];
        const result =
          outcome.status === 'fulfilled'
            ? normalizeProcessingResult(
                entry.requestId,
                outcome.value,
              )
            : normalizeRejectedResult(
                entry.requestId,
                outcome.reason,
              );

        settledByRequestId.set(entry.requestId, result);
      });

      const results = eligibility.map((entry) =>
        entry.eligible
          ? settledByRequestId.get(entry.requestId)
          : createIneligibleResult(entry),
      );
      const completed = results.filter(
        (result) =>
          result.status === REQUEST_STATUSES.COMPLETE,
      ).length;
      const failed = results.filter(
        (result) =>
          result.status === REQUEST_STATUSES.FAILED,
      ).length;
      const result = {
        operationId,
        action: input.action,
        processed: results.length,
        completed,
        failed,
        results,
        eligibilityRevision: initialSnapshot.revision,
        localOnly: true,
        transmitted: false,
      };
      const createdAt = getCurrentTimestamp(this.clock);
      const persistenceSnapshot =
        this.repository.getSnapshot();
      let storedEnvelope;

      try {
        storedEnvelope = this.repository.transact(
          (draft) => {
            const committed =
              draft.idempotencyResults[input.idempotencyKey];

            if (committed !== undefined) {
              if (
                committed.commandName !== 'bulkProcess' ||
                committed.requestHash !== requestHash
              ) {
                throw new BulkOperationServiceError(
                  BULK_OPERATION_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                  'The idempotency key was already used for another bulk operation.',
                );
              }

              return;
            }

            draft.idempotencyResults[input.idempotencyKey] = {
              idempotencyKey: input.idempotencyKey,
              commandName: 'bulkProcess',
              requestHash,
              result: cloneMutable(result),
              createdAt,
            };
          },
          {
            expectedRevision: persistenceSnapshot.revision,
          },
        );
      } catch (error) {
        return normalizeRepositoryFailure(
          error,
          correlationId,
          persistenceSnapshot.revision,
        );
      }

      const warnings = [];

      for (const rowResult of results) {
        const warning = await this.appendAudit({
          correlationId,
          actor,
          action:
            BULK_OPERATION_AUDIT_ACTIONS.ROW_PROCESSED,
          entityType: 'REPRINT_REQUEST',
          entityId: rowResult.requestId,
          after: {
            operationId,
            requestId: rowResult.requestId,
            action: input.action,
            status: rowResult.status,
            errorCode: rowResult.errorCode,
            eligibilityRevision: initialSnapshot.revision,
            simulated: true,
            transmitted: false,
          },
        });

        if (warning !== null) {
          warnings.push(warning);
        }
      }

      return createSuccess(
        200,
        {
          ...result,
          replayed: false,
        },
        correlationId,
        storedEnvelope.revision,
        warnings,
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        this.getRevision(),
      );
    } finally {
      this.activeIdempotencyKeys.delete(
        input.idempotencyKey,
      );
    }
  }

  /**
   * Exports all matching queue rows to a fictional browser-local CSV Blob.
   *
   * @param {Record<string, unknown>} [input] Export filters and filename.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async exportRows(input = {}, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let normalized;

    try {
      normalized = normalizeExportInput(input);
    } catch (error) {
      return createFailure(
        422,
        BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        error.message,
        correlationId,
        this.getRevision(),
        { details: error.details },
      );
    }

    try {
      const {
        page: ignoredPage,
        offset: ignoredOffset,
        limit: ignoredLimit,
        ...filters
      } = normalized.query;

      void ignoredPage;
      void ignoredOffset;
      void ignoredLimit;

      const rows = [];
      let page = 1;
      let totalPages = 1;
      let revision = this.getRevision();

      while (
        page <= totalPages &&
        rows.length <
          BULK_OPERATION_LIMITS.MAXIMUM_EXPORT_ROWS
      ) {
        const result = this.repository.listRequests({
          ...filters,
          page,
          limit: BULK_OPERATION_LIMITS.EXPORT_PAGE_SIZE,
          offset: null,
        });

        revision = result.revision;
        totalPages = result.totalPages;

        result.items.forEach((request) => {
          if (
            rows.length <
            BULK_OPERATION_LIMITS.MAXIMUM_EXPORT_ROWS
          ) {
            rows.push(request);
          }
        });

        page += 1;
      }

      const csv = formatCsv(
        [
          CSV_HEADERS,
          ...rows.map((request) => [
            request.displayId,
            request.claimNumber,
            request.requestType,
            request.priority,
            request.status,
            request.createdAt,
          ]),
        ],
        {
          formulaSafe: true,
          formulaPrefix: "'",
          lineEnding: '\r\n',
        },
      );
      const content = `${csv}\r\n`;
      const blob = createExportBlob(content);
      const exportedAt = getCurrentTimestamp(this.clock);
      const filename = sanitizeFilename(
        normalized.filename ??
          createExportFilename(exportedAt),
        {
          fallback: 'operations-queue-demo.csv',
          maximumLength:
            BULK_OPERATION_LIMITS.MAXIMUM_FILENAME_LENGTH,
        },
      );
      const truncated =
        page <= totalPages ||
        rows.length >=
          BULK_OPERATION_LIMITS.MAXIMUM_EXPORT_ROWS;
      const auditWarning = await this.appendAudit({
        correlationId,
        actor,
        action: BULK_OPERATION_AUDIT_ACTIONS.EXPORTED,
        entityType: 'OPERATIONS_QUEUE',
        entityId: `EXPORT-${exportedAt}`,
        after: {
          filename,
          rowCount: rows.length,
          truncated,
          notice: BULK_OPERATION_EXPORT_NOTICE,
          localOnly: true,
          transmitted: false,
        },
      });

      return createSuccess(
        200,
        {
          filename,
          fileName: filename,
          mediaType: CSV_MEDIA_TYPE,
          mimeType: 'text/csv',
          byteLength: blob.size,
          rowCount: rows.length,
          truncated,
          notice: BULK_OPERATION_EXPORT_NOTICE,
          localOnly: true,
          transmitted: false,
          downloadToken: 'blob:browser-local',
          blob,
        },
        correlationId,
        revision,
        auditWarning === null ? [] : [auditWarning],
      );
    } catch (error) {
      if (
        getErrorCode(error) ===
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY
      ) {
        return createFailure(
          422,
          BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
          'Operations queue export filters are invalid.',
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

  list(query = {}, context = undefined) {
    return this.listRequests(query, context);
  }

  process(command, context = undefined) {
    return this.bulkProcess(command, context);
  }

  export(query = {}, context = undefined) {
    return this.exportRows(query, context);
  }

  exportQueue(query = {}, context = undefined) {
    return this.exportRows(query, context);
  }

  isActive(idempotencyKey) {
    return (
      typeof idempotencyKey === 'string' &&
      this.activeIdempotencyKeys.has(
        idempotencyKey.trim().toLowerCase(),
      )
    );
  }
}

/**
 * Creates a browser-local bulk operation service.
 *
 * @param {ConstructorParameters<typeof BulkOperationService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof BulkOperationService>[1]} [options]
 * Service options.
 * @returns {BulkOperationService} Bulk operation service.
 */
export function createBulkOperationService(
  repositoryOrOptions,
  options = {},
) {
  return new BulkOperationService(
    repositoryOrOptions,
    options,
  );
}

export const LocalBulkOperationService =
  BulkOperationService;
export const OperationsBulkOperationService =
  BulkOperationService;
export const createLocalBulkOperationService =
  createBulkOperationService;
export const createOperationsBulkOperationService =
  createBulkOperationService;

export default BulkOperationService;