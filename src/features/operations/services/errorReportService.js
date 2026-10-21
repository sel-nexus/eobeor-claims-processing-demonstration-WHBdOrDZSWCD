import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { redactForRole } from '../../../platform/security/maskingPolicy.js';
import { browserClock } from '../../../platform/time/clock.js';
import { sanitizeFilename } from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  ERROR_REPORT_STATUSES,
  isOperationsUuid,
} from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';

export const ERROR_REPORT_SERVICE_SCHEMA_VERSION = 1;

export const ERROR_REPORT_ACTIONS = Object.freeze({
  EXPORT: 'EXPORT',
  QUEUE: 'QUEUE',
  CLOSE: 'CLOSE',
});

export const ERROR_REPORT_AUDIT_ACTIONS = Object.freeze({
  VIEWED: 'ERROR_REPORT_VIEWED',
  EXPORTED: 'ERROR_REPORT_EXPORTED',
  QUEUED: 'ERROR_REPORT_QUEUED',
  CLOSED: 'ERROR_REPORT_CLOSED',
});

export const ERROR_REPORT_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  ERROR_REPORT_NOT_FOUND: 'ERROR_REPORT_NOT_FOUND',
  INVALID_ACTION: 'INVALID_ACTION',
  INVALID_STATE: 'INVALID_STATE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  EXPORT_UNAVAILABLE: 'EXPORT_UNAVAILABLE',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const ERROR_REPORT_EXPORT_NOTICE = 'Fictional demo data';

const ERROR_REPORT_ACTION_VALUES = new Set(
  Object.values(ERROR_REPORT_ACTIONS),
);
const READ_ROLES = new Set(['BOS', 'ITS', 'ADMIN']);
const ACTION_ROLES = Object.freeze({
  [ERROR_REPORT_ACTIONS.EXPORT]: new Set(['BOS', 'ITS', 'ADMIN']),
  [ERROR_REPORT_ACTIONS.QUEUE]: new Set(['BOS', 'ADMIN']),
  [ERROR_REPORT_ACTIONS.CLOSE]: new Set(['BOS', 'ADMIN']),
});
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
    typeof value.transact !== 'function'
  ) {
    throw new ErrorReportServiceError(
      ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Error report service requires an operations repository with getSnapshot() and transact().',
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
    throw new ErrorReportServiceError(
      ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Error report service permission gateway must provide evaluate().',
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
    throw new ErrorReportServiceError(
      ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Error report service audit gateway must provide append().',
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

  throw new ErrorReportServiceError(
    ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Error report service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
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
      'Error report service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Error report service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedValue(idGenerator, prefix, maximumLength) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Error report service ID generator must return a non-empty string.',
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
      `Error report service generated an identifier longer than ${maximumLength} characters.`,
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

  return createGeneratedValue(
    idGenerator,
    'corr-',
    MAXIMUM_CORRELATION_ID_LENGTH,
  );
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
      schemaVersion: ERROR_REPORT_SERVICE_SCHEMA_VERSION,
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
      schemaVersion: ERROR_REPORT_SERVICE_SCHEMA_VERSION,
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

function normalizeReportQuery(value) {
  const reportId = isPlainObject(value)
    ? value.errorReportId
    : value;
  const errors = [];
  const errorReportId = normalizeIdentifier(
    reportId,
    'errorReportId',
    errors,
  );

  return {
    value: {
      errorReportId,
    },
    errors,
  };
}

function normalizeActionCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Error report action request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    'errorReportId',
    'action',
    'idempotencyKey',
  ]);
  const errors = Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Error report action field ${field} is not supported.`,
      ),
    );
  const errorReportId = normalizeIdentifier(
    value.errorReportId,
    'errorReportId',
    errors,
  );
  const action =
    typeof value.action === 'string'
      ? value.action.trim().toUpperCase()
      : value.action;
  const idempotencyKey =
    typeof value.idempotencyKey === 'string'
      ? value.idempotencyKey.trim().toLowerCase()
      : value.idempotencyKey;

  if (!ERROR_REPORT_ACTION_VALUES.has(action)) {
    errors.push(
      createFieldError(
        'action',
        'INVALID_ACTION',
        'Error report action must be EXPORT, QUEUE, or CLOSE.',
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
      errorReportId,
      action,
      idempotencyKey,
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

  return `fnv1a32-${(hash >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function createReportDto(report, actor) {
  const dto = {
    errorReportId: report.errorReportId,
    requestId: report.requestId,
    claimNumber: report.claimNumber,
    severity: report.severity,
    status: report.status,
    summary: report.summary,
    details: report.details,
    context: report.context,
    resolution: report.resolution,
    createdAt: report.createdAt,
    relatedEntities: report.relatedEntities ?? {},
    auditTrail: report.auditTrail ?? [],
    stackTrace: report.stackTrace ?? null,
    footer: report.footer ?? ERROR_REPORT_EXPORT_NOTICE,
  };

  return redactForRole(dto, actor.role, {
    owned: false,
    fieldPolicies: {
      errorReportId: 'PRESERVE',
      requestId: 'PRESERVE',
      correlationId: 'PRESERVE',
      summary: 'PRESERVE',
      details: 'PRESERVE',
      context: 'PRESERVE',
      resolution: 'PRESERVE',
      relatedEntities: 'PRESERVE',
      auditTrail: 'PRESERVE',
      stackTrace: 'PRESERVE',
      footer: 'PRESERVE',
    },
  });
}

function createExportContent(report, exportedAt) {
  return `${JSON.stringify(
    {
      notice: ERROR_REPORT_EXPORT_NOTICE,
      exportedAt,
      representativeOnly: true,
      transmitted: false,
      errorReport: report,
    },
    null,
    2,
  )}\n`;
}

function createExportBlob(content) {
  const BlobConstructor = globalThis.Blob;

  if (typeof BlobConstructor !== 'function') {
    throw new ErrorReportServiceError(
      ERROR_REPORT_SERVICE_ERROR_CODES.EXPORT_UNAVAILABLE,
      'Browser Blob APIs are unavailable.',
    );
  }

  return new BlobConstructor([content], {
    type: 'application/json;charset=utf-8',
  });
}

function createExportFilename(report) {
  return sanitizeFilename(
    `error-report-${report.errorReportId}.json`,
    {
      fallback: 'error-report-demo.json',
    },
  );
}

function createExportResult(report, exportedAt) {
  const content = createExportContent(report, exportedAt);
  const blob = createExportBlob(content);
  const filename = createExportFilename(report);

  return {
    errorReportId: report.errorReportId,
    action: ERROR_REPORT_ACTIONS.EXPORT,
    status: report.status,
    filename,
    fileName: filename,
    mediaType: 'application/json',
    mimeType: 'application/json',
    byteLength: blob.size,
    notice: ERROR_REPORT_EXPORT_NOTICE,
    localOnly: true,
    transmitted: false,
    downloadToken: 'blob:browser-local',
    exportedAt,
    report,
    blob,
  };
}

function createStoredActionResult({
  report,
  action,
  actedAt,
  exceptionQueueId,
}) {
  return {
    errorReportId: report.errorReportId,
    action,
    status: report.status,
    actedAt,
    exceptionQueueId: exceptionQueueId ?? null,
    localOnly: true,
    transmitted: false,
  };
}

function getAuditAction(action) {
  switch (action) {
    case ERROR_REPORT_ACTIONS.EXPORT:
      return ERROR_REPORT_AUDIT_ACTIONS.EXPORTED;
    case ERROR_REPORT_ACTIONS.QUEUE:
      return ERROR_REPORT_AUDIT_ACTIONS.QUEUED;
    case ERROR_REPORT_ACTIONS.CLOSE:
      return ERROR_REPORT_AUDIT_ACTIONS.CLOSED;
    default:
      return ERROR_REPORT_AUDIT_ACTIONS.VIEWED;
  }
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
      ERROR_REPORT_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before the error report operation completed.',
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
      ERROR_REPORT_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof ErrorReportServiceError) {
    const status =
      error.code ===
      ERROR_REPORT_SERVICE_ERROR_CODES.ERROR_REPORT_NOT_FOUND
        ? 404
        : error.code ===
              ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_STATE ||
            error.code ===
              ERROR_REPORT_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT
          ? 409
          : error.code ===
              ERROR_REPORT_SERVICE_ERROR_CODES.FORBIDDEN
            ? 403
            : error.code ===
                ERROR_REPORT_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
              ? 401
              : error.code ===
                  ERROR_REPORT_SERVICE_ERROR_CODES.EXPORT_UNAVAILABLE
                ? 503
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
          ERROR_REPORT_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      },
    );
  }

  return createFailure(
    500,
    ERROR_REPORT_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The local error report operation could not be completed.',
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
 * Error raised when error-report service input, dependencies, or state are
 * invalid.
 */
export class ErrorReportServiceError extends Error {
  /**
   * @param {string} code Stable service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ErrorReportServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Provides role-checked local error-report viewing, export, queue, and close
 * operations without contacting external systems.
 */
export class ErrorReportService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options.
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
        'Error report service ID generator must be a function.',
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

  async authorize(actor, action, correlationId) {
    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          ERROR_REPORT_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
          'An active demo session is required.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    const allowedRoles =
      action === null ? READ_ROLES : ACTION_ROLES[action];

    if (
      allowedRoles === undefined ||
      !allowedRoles.has(actor.role)
    ) {
      return {
        allowed: false,
        failure: createFailure(
          403,
          ERROR_REPORT_SERVICE_ERROR_CODES.FORBIDDEN,
          'This demo role cannot perform the error report operation.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    if (this.permissionGateway === null) {
      return {
        allowed: true,
        actor,
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action: ACTIONS.OPERATIONAL_SUMMARY_VIEW,
          resource: {
            type: 'ERROR_REPORT',
            id: 'local',
            operation: action ?? 'VIEW',
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Error report permission evaluation could not be completed.',
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
          ? ERROR_REPORT_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : ERROR_REPORT_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'This demo role cannot perform the error report operation.',
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
    report,
    after,
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
            type: 'ERROR_REPORT',
            id: report.errorReportId,
          },
        },
        {
          action,
          entity: {
            type: 'ERROR_REPORT',
            id: report.errorReportId,
          },
          before: null,
          after,
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: ERROR_REPORT_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The error report operation completed, but its local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Returns one role-filtered error report with all supported report sections.
   *
   * @param {string|Record<string, unknown>} query Error report query.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async getErrorReport(query, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeReportQuery(query);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ERROR_REPORT_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Error report query validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      null,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const report =
      snapshot.errorReports[
        normalized.value.errorReportId
      ] ?? null;

    if (report === null) {
      return createFailure(
        404,
        ERROR_REPORT_SERVICE_ERROR_CODES.ERROR_REPORT_NOT_FOUND,
        'The error report does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const dto = createReportDto(report, actor);
    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: ERROR_REPORT_AUDIT_ACTIONS.VIEWED,
      report,
      after: {
        errorReportId: report.errorReportId,
        status: report.status,
        severity: report.severity,
        viewed: true,
      },
    });

    return createSuccess(
      200,
      dto,
      correlationId,
      snapshot.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  /**
   * Exports, queues, or closes one browser-local error report.
   *
   * Export creates a local JSON Blob. Queue and close update only browser-local
   * metadata and never transmit the report.
   *
   * @param {Record<string, unknown>} command Error report action command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async actOnErrorReport(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeActionCommand(command);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      const hasInvalidAction = normalized.errors.some(
        (error) => error.code === 'INVALID_ACTION',
      );

      return createFailure(
        422,
        hasInvalidAction
          ? ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_ACTION
          : ERROR_REPORT_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Error report action request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const authorization = await this.authorize(
      actor,
      input.action,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const initialReport =
      snapshot.errorReports[input.errorReportId] ?? null;

    if (initialReport === null) {
      return createFailure(
        404,
        ERROR_REPORT_SERVICE_ERROR_CODES.ERROR_REPORT_NOT_FOUND,
        'The error report does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const requestHash = hashCommand('actOnErrorReport', [
      input.errorReportId,
      input.action,
    ]);
    const existingIdempotency =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existingIdempotency !== undefined) {
      if (
        existingIdempotency.commandName !==
          'actOnErrorReport' ||
        existingIdempotency.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          ERROR_REPORT_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another error report operation.',
          correlationId,
          snapshot.revision,
        );
      }

      const currentReport =
        snapshot.errorReports[input.errorReportId] ??
        initialReport;
      const dto = createReportDto(currentReport, actor);

      if (input.action === ERROR_REPORT_ACTIONS.EXPORT) {
        try {
          const result = createExportResult(
            dto,
            existingIdempotency.result.actedAt,
          );

          return createSuccess(
            200,
            {
              ...result,
              replayed: true,
            },
            correlationId,
            snapshot.revision,
          );
        } catch (error) {
          return normalizeRepositoryFailure(
            error,
            correlationId,
            snapshot.revision,
          );
        }
      }

      return createSuccess(
        200,
        {
          ...existingIdempotency.result,
          report: dto,
          replayed: true,
          transmitted: false,
        },
        correlationId,
        snapshot.revision,
      );
    }

    if (
      input.action === ERROR_REPORT_ACTIONS.QUEUE &&
      initialReport.status !== ERROR_REPORT_STATUSES.OPEN
    ) {
      return createFailure(
        409,
        ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_STATE,
        'Only an open error report may be queued.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: initialReport.status,
          },
        },
      );
    }

    if (
      input.action === ERROR_REPORT_ACTIONS.CLOSE &&
      initialReport.status === ERROR_REPORT_STATUSES.CLOSED
    ) {
      return createFailure(
        409,
        ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_STATE,
        'The error report is already closed.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: initialReport.status,
          },
        },
      );
    }

    const actedAt = getCurrentTimestamp(this.clock);
    const exceptionQueueId =
      input.action === ERROR_REPORT_ACTIONS.QUEUE
        ? createGeneratedValue(
            this.idGenerator,
            'EXQ-',
            MAXIMUM_IDENTIFIER_LENGTH,
          )
        : null;
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const report =
            draft.errorReports[input.errorReportId];
          const committed =
            draft.idempotencyResults[input.idempotencyKey];

          if (committed !== undefined) {
            if (
              committed.commandName !==
                'actOnErrorReport' ||
              committed.requestHash !== requestHash
            ) {
              throw new ErrorReportServiceError(
                ERROR_REPORT_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another error report operation.',
              );
            }

            return;
          }

          if (report === undefined) {
            throw new ErrorReportServiceError(
              ERROR_REPORT_SERVICE_ERROR_CODES.ERROR_REPORT_NOT_FOUND,
              'The error report no longer exists.',
            );
          }

          if (input.action === ERROR_REPORT_ACTIONS.QUEUE) {
            if (
              report.status !== ERROR_REPORT_STATUSES.OPEN
            ) {
              throw new ErrorReportServiceError(
                ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_STATE,
                'Only an open error report may be queued.',
                { status: report.status },
              );
            }

            report.status = ERROR_REPORT_STATUSES.QUEUED;
          }

          if (input.action === ERROR_REPORT_ACTIONS.CLOSE) {
            if (
              report.status === ERROR_REPORT_STATUSES.CLOSED
            ) {
              throw new ErrorReportServiceError(
                ERROR_REPORT_SERVICE_ERROR_CODES.INVALID_STATE,
                'The error report is already closed.',
                { status: report.status },
              );
            }

            report.status = ERROR_REPORT_STATUSES.CLOSED;
          }

          if (
            input.action !== ERROR_REPORT_ACTIONS.EXPORT
          ) {
            const auditTrail = Array.isArray(report.auditTrail)
              ? report.auditTrail
              : [];

            report.auditTrail = [
              ...auditTrail,
              {
                at: actedAt,
                action:
                  input.action === ERROR_REPORT_ACTIONS.QUEUE
                    ? 'QUEUED'
                    : 'CLOSED',
                actor: actor.actorId,
              },
            ];
          }

          const storedResult = createStoredActionResult({
            report,
            action: input.action,
            actedAt,
            exceptionQueueId,
          });

          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'actOnErrorReport',
            requestHash,
            result: cloneMutable(storedResult),
            createdAt: actedAt,
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

    const storedReport =
      storedEnvelope.errorReports[input.errorReportId];
    const reportDto = createReportDto(storedReport, actor);
    let data;

    try {
      if (input.action === ERROR_REPORT_ACTIONS.EXPORT) {
        data = {
          ...createExportResult(reportDto, actedAt),
          replayed: false,
        };
      } else {
        data = {
          ...storedEnvelope.idempotencyResults[
            input.idempotencyKey
          ].result,
          report: reportDto,
          replayed: false,
          transmitted: false,
          disclosure:
            input.action === ERROR_REPORT_ACTIONS.QUEUE
              ? 'Error report queued locally; no external system was contacted.'
              : 'Error report closed locally; no external system was contacted.',
        };
      }
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        storedEnvelope.revision,
      );
    }

    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: getAuditAction(input.action),
      report: storedReport,
      after: {
        errorReportId: storedReport.errorReportId,
        action: input.action,
        status: storedReport.status,
        exceptionQueueId,
        localOnly: true,
        transmitted: false,
      },
    });

    return createSuccess(
      200,
      data,
      correlationId,
      storedEnvelope.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  getErrorReportById(errorReportId) {
    if (
      typeof errorReportId !== 'string' ||
      errorReportId.trim().length === 0 ||
      errorReportId.trim().length > MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new ErrorReportServiceError(
        ERROR_REPORT_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Error report ID must be a non-empty string of at most 100 characters.',
      );
    }

    return (
      this.repository.getSnapshot().errorReports[
        errorReportId.normalize('NFC').trim()
      ] ?? null
    );
  }

  get(query, context = undefined) {
    return this.getErrorReport(query, context);
  }

  act(command, context = undefined) {
    return this.actOnErrorReport(command, context);
  }

  exportErrorReport(command, context = undefined) {
    return this.actOnErrorReport(
      {
        ...command,
        action: ERROR_REPORT_ACTIONS.EXPORT,
      },
      context,
    );
  }

  queueErrorReport(command, context = undefined) {
    return this.actOnErrorReport(
      {
        ...command,
        action: ERROR_REPORT_ACTIONS.QUEUE,
      },
      context,
    );
  }

  closeErrorReport(command, context = undefined) {
    return this.actOnErrorReport(
      {
        ...command,
        action: ERROR_REPORT_ACTIONS.CLOSE,
      },
      context,
    );
  }

  findErrorReportById(errorReportId) {
    return this.getErrorReportById(errorReportId);
  }
}

/**
 * Creates a browser-local error report service.
 *
 * @param {ConstructorParameters<typeof ErrorReportService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof ErrorReportService>[1]} [options]
 * Service options.
 * @returns {ErrorReportService} Error report service.
 */
export function createErrorReportService(
  repositoryOrOptions,
  options = {},
) {
  return new ErrorReportService(
    repositoryOrOptions,
    options,
  );
}

export const LocalErrorReportService = ErrorReportService;
export const OperationsErrorReportService = ErrorReportService;
export const createLocalErrorReportService =
  createErrorReportService;
export const createOperationsErrorReportService =
  createErrorReportService;

export default ErrorReportService;