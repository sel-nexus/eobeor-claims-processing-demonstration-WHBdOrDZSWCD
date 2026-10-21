import { ACTIONS } from '../contracts/capabilities.js';
import { calculateSnapshotChecksum } from '../validation/snapshotValidator.js';
import { maskObject } from '../security/maskingPolicy.js';
import { browserClock } from '../time/clock.js';
import { formatCsv } from '../utils/formatters.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

export const AUDIT_FACADE_SCHEMA_VERSION = 1;
export const AUDIT_EXPORT_NOTICE = 'Fictional demo data';

export const AUDIT_EXPORT_FORMATS = Object.freeze({
  CSV: 'CSV',
  JSON: 'JSON',
});

export const AUDIT_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  QUERY_FAILED: 'QUERY_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  LOCAL_STORAGE_QUOTA: 'LOCAL_STORAGE_QUOTA',
  READ_ONLY_RECOVERY: 'READ_ONLY_RECOVERY',
});

export const AUDIT_FACADE_ACTIONS = Object.freeze({
  EXPORTED: 'AUDIT_EXPORTED',
});

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 100;
const REPOSITORY_PAGE_LIMIT = 100;
const MAXIMUM_EXPORT_EVENTS = 10000;
const CSV_MEDIA_TYPE = 'text/csv;charset=utf-8';
const JSON_MEDIA_TYPE = 'application/json;charset=utf-8';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CSV_HEADERS = Object.freeze([
  'event_id',
  'occurred_at',
  'actor_user_id',
  'actor_display_name',
  'actor_role',
  'action',
  'entity_type',
  'entity_id',
  'outcome',
  'correlation_id',
  'before',
  'after',
]);

const ITS_ENTITY_TYPES = new Set([
  'AUDIT',
  'INTEGRATION',
  'MONITORING',
  'PLATFORM',
  'SETTINGS',
  'SNAPSHOT',
  'STORAGE',
]);

const ITS_ACTION_PREFIXES = Object.freeze([
  'AUDIT_',
  'INTEGRATION_',
  'MONITORING_',
  'PLATFORM_',
  'SETTINGS_',
  'SNAPSHOT_',
  'STORAGE_',
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

function requireAuditRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.query !== 'function' &&
      typeof value.list !== 'function' &&
      typeof value.find !== 'function')
  ) {
    throw new AuditFacadeError(
      AUDIT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Audit facade requires an audit repository with query(), list(), or find().',
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
    throw new AuditFacadeError(
      AUDIT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Audit facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function normalizeAuditService(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.append !== 'function'
  ) {
    throw new AuditFacadeError(
      AUDIT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Audit facade audit service must provide append().',
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

  throw new AuditFacadeError(
    AUDIT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
    'Audit facade session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.auditRepository !== undefined ||
      repositoryOrOptions.repository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.auditRepository ??
        repositoryOrOptions.repository,
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

function normalizeSession(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const role =
    typeof value.role === 'string'
      ? value.role.trim().toUpperCase()
      : value.role;

  if (
    typeof value.userId !== 'string' ||
    value.userId.trim().length === 0 ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    !isPlatformRole(role)
  ) {
    return null;
  }

  return deepFreeze({
    userId: value.userId.normalize('NFC').trim(),
    displayName: value.displayName.normalize('NFC').trim(),
    role,
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
      'Audit facade clock must provide now() or nowIso().',
    );
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Audit facade clock must provide a valid timestamp.',
    );
  }

  return date;
}

function createCorrelationId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Audit facade ID generator must return a non-empty string.',
    );
  }

  return value.normalize('NFC').trim();
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
      schemaVersion: AUDIT_FACADE_SCHEMA_VERSION,
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

function normalizeOperationFailure(
  error,
  fallbackCode,
  fallbackMessage,
  correlationId,
) {
  const code = getErrorCode(error);

  switch (code) {
    case 'INVALID_QUERY':
    case 'INVALID_EVENT':
    case 'INVALID_EVENT_COLLECTION':
    case 'INVALID_REVISION':
    case 'EXPECTED_REVISION_REQUIRED':
      return createFailure(
        422,
        AUDIT_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Audit request validation failed.',
        correlationId,
        {
          details: {
            dependencyCode: code,
          },
        },
      );
    case 'STORAGE_QUOTA_EXCEEDED':
    case 'LOCAL_STORAGE_QUOTA':
      return createFailure(
        507,
        AUDIT_FACADE_ERROR_CODES.LOCAL_STORAGE_QUOTA,
        'Browser-local storage quota was exceeded.',
        correlationId,
        {
          recoveryAction: 'EXPORT_SNAPSHOT',
        },
      );
    case 'READ_ONLY_RECOVERY':
      return createFailure(
        409,
        AUDIT_FACADE_ERROR_CODES.READ_ONLY_RECOVERY,
        'Local demonstration data is in read-only recovery mode.',
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

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function createAuthorizationFailure(decision, correlationId) {
  const unauthenticated =
    decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
    decision?.reasonCode === 'SESSION_EXPIRED';

  return createFailure(
    unauthenticated ? 401 : 403,
    unauthenticated
      ? AUDIT_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : AUDIT_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : 'The current demo role cannot access local audit data.',
    correlationId,
    {
      details: {
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function normalizePositiveInteger(
  value,
  fallback,
  maximum,
  field,
) {
  if (value === undefined) {
    return {
      value: fallback,
      error: null,
    };
  }

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    return {
      value: fallback,
      error: createFieldError(
        field,
        'OUT_OF_RANGE',
        `${field} must be an integer between 1 and ${maximum}.`,
      ),
    };
  }

  return {
    value,
    error: null,
  };
}

function normalizeStringCollection(value, field) {
  if (value === undefined || value === null) {
    return {
      value: undefined,
      error: null,
    };
  }

  const source = Array.isArray(value) ? value : [value];

  if (
    source.length === 0 ||
    source.some(
      (item) =>
        typeof item !== 'string' ||
        item.trim().length === 0 ||
        item.trim().length > 100,
    )
  ) {
    return {
      value: undefined,
      error: createFieldError(
        field,
        'INVALID_FILTER',
        `${field} must contain non-empty strings of at most 100 characters.`,
      ),
    };
  }

  return {
    value: [
      ...new Set(
        source.map((item) =>
          item.normalize('NFC').trim().toUpperCase(),
        ),
      ),
    ],
    error: null,
  };
}

function normalizeOptionalString(value, field, maximum = 200) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return {
      value: undefined,
      error: null,
    };
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > maximum
  ) {
    return {
      value: undefined,
      error: createFieldError(
        field,
        'INVALID_FILTER',
        `${field} must be a non-empty string of at most ${maximum} characters.`,
      ),
    };
  }

  return {
    value: value.normalize('NFC').trim(),
    error: null,
  };
}

function parseDateBoundary(value, field, endOfDay) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return {
      value: undefined,
      timestamp: null,
      error: null,
    };
  }

  if (typeof value !== 'string') {
    return {
      value: undefined,
      timestamp: null,
      error: createFieldError(
        field,
        'INVALID_DATE',
        `${field} must be an ISO timestamp or YYYY-MM-DD date.`,
      ),
    };
  }

  const normalized = value.trim();
  const timestamp = DATE_ONLY_PATTERN.test(normalized)
    ? Date.parse(
        `${normalized}T${
          endOfDay ? '23:59:59.999' : '00:00:00.000'
        }Z`,
      )
    : Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    return {
      value: undefined,
      timestamp: null,
      error: createFieldError(
        field,
        'INVALID_DATE',
        `${field} must be a valid ISO timestamp or YYYY-MM-DD date.`,
      ),
    };
  }

  return {
    value: normalized,
    timestamp,
    error: null,
  };
}

function normalizeQueryRequest(request) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Audit query must be a safe object.',
        ),
      ],
    };
  }

  const page = normalizePositiveInteger(
    request.page,
    DEFAULT_PAGE,
    Number.MAX_SAFE_INTEGER,
    'page',
  );
  const limit = normalizePositiveInteger(
    request.limit,
    DEFAULT_LIMIT,
    MAXIMUM_LIMIT,
    'limit',
  );
  const actions = normalizeStringCollection(
    request.actions ?? request.action,
    'actions',
  );
  const outcomes = normalizeStringCollection(
    request.outcomes ?? request.outcome,
    'outcomes',
  );
  const actorId = normalizeOptionalString(
    request.actorId ?? request.userId,
    'actorId',
  );
  const actorRole = normalizeOptionalString(
    request.actorRole ?? request.role,
    'actorRole',
  );
  const entityType = normalizeOptionalString(
    request.entityType,
    'entityType',
  );
  const entityId = normalizeOptionalString(
    request.entityId,
    'entityId',
  );
  const correlationId = normalizeOptionalString(
    request.correlationId,
    'correlationId',
  );
  const search = normalizeOptionalString(
    request.query ?? request.q ?? request.search,
    'query',
  );
  const from = parseDateBoundary(
    request.from,
    'from',
    false,
  );
  const to = parseDateBoundary(request.to, 'to', true);
  const direction =
    request.direction === undefined
      ? 'DESC'
      : typeof request.direction === 'string'
        ? request.direction.trim().toUpperCase()
        : request.direction;
  const errors = [
    page.error,
    limit.error,
    actions.error,
    outcomes.error,
    actorId.error,
    actorRole.error,
    entityType.error,
    entityId.error,
    correlationId.error,
    search.error,
    from.error,
    to.error,
  ].filter(Boolean);

  if (direction !== 'ASC' && direction !== 'DESC') {
    errors.push(
      createFieldError(
        'direction',
        'INVALID_DIRECTION',
        'Audit query direction must be ASC or DESC.',
      ),
    );
  }

  if (
    from.timestamp !== null &&
    to.timestamp !== null &&
    from.timestamp > to.timestamp
  ) {
    errors.push(
      createFieldError(
        'from',
        'INVALID_DATE_RANGE',
        'Audit query from date must not be after the to date.',
      ),
    );
  }

  const value = {
    page: page.value,
    limit: limit.value,
    direction,
    ...(actions.value === undefined
      ? {}
      : { actions: actions.value }),
    ...(outcomes.value === undefined
      ? {}
      : { outcomes: outcomes.value }),
    ...(actorId.value === undefined
      ? {}
      : { actorId: actorId.value }),
    ...(actorRole.value === undefined
      ? {}
      : { actorRole: actorRole.value.toUpperCase() }),
    ...(entityType.value === undefined
      ? {}
      : { entityType: entityType.value.toUpperCase() }),
    ...(entityId.value === undefined
      ? {}
      : { entityId: entityId.value }),
    ...(correlationId.value === undefined
      ? {}
      : { correlationId: correlationId.value }),
    ...(search.value === undefined
      ? {}
      : { query: search.value }),
    ...(from.value === undefined ? {} : { from: from.value }),
    ...(to.value === undefined ? {} : { to: to.value }),
  };

  return {
    value,
    errors,
  };
}

function normalizeExportRequest(request) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Audit export request must be a safe object.',
        ),
      ],
    };
  }

  const format =
    request.format === undefined
      ? AUDIT_EXPORT_FORMATS.CSV
      : typeof request.format === 'string'
        ? request.format.trim().toUpperCase()
        : request.format;
  const filters =
    request.filters === undefined ? {} : request.filters;
  const normalizedQuery = normalizeQueryRequest(filters);
  const errors = [...normalizedQuery.errors];

  if (!Object.values(AUDIT_EXPORT_FORMATS).includes(format)) {
    errors.push(
      createFieldError(
        'format',
        'UNSUPPORTED_FORMAT',
        `Audit export format must be one of: ${Object.values(
          AUDIT_EXPORT_FORMATS,
        ).join(', ')}.`,
      ),
    );
  }

  return {
    value: {
      format,
      filters:
        normalizedQuery.value === null
          ? null
          : {
              ...normalizedQuery.value,
              page: 1,
              limit: REPOSITORY_PAGE_LIMIT,
            },
    },
    errors,
  };
}

function queryRepository(repository, filters) {
  if (typeof repository.query === 'function') {
    return repository.query(filters);
  }

  if (typeof repository.list === 'function') {
    return repository.list(filters);
  }

  return repository.find(filters);
}

function isEventVisibleToRole(event, role, session) {
  if (role === 'ADMIN') {
    return true;
  }

  if (role === 'ITS') {
    const entityType =
      typeof event.entity?.type === 'string'
        ? event.entity.type.toUpperCase()
        : '';
    const action =
      typeof event.action === 'string'
        ? event.action.toUpperCase()
        : '';

    return (
      ITS_ENTITY_TYPES.has(entityType) ||
      ITS_ACTION_PREFIXES.some((prefix) =>
        action.startsWith(prefix),
      )
    );
  }

  return (
    session !== null &&
    event.actor?.userId === session.userId
  );
}

function maskAuditEvent(event) {
  const masked = maskObject(event);

  return isPlainObject(masked) ? masked : deepFreeze(event);
}

function paginateEvents(events, page, limit, revision) {
  const start = (page - 1) * limit;
  const items = events.slice(start, start + limit);

  return deepFreeze({
    items,
    page,
    limit,
    total: events.length,
    totalPages:
      events.length === 0
        ? 0
        : Math.ceil(events.length / limit),
    revision,
    masked: true,
  });
}

function serializeAuditDetail(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}

function createCsvRows(events) {
  return [
    CSV_HEADERS,
    ...events.map((event) => [
      event.eventId,
      event.occurredAt,
      event.actor?.userId ?? '',
      event.actor?.displayName ?? '',
      event.actor?.role ?? '',
      event.action,
      event.entity?.type ?? '',
      event.entity?.id ?? '',
      event.outcome,
      event.correlationId,
      serializeAuditDetail(event.before),
      serializeAuditDetail(event.after),
    ]),
  ];
}

function createCsvContent(events) {
  const csv = formatCsv(createCsvRows(events), {
    formulaSafe: true,
    formulaPrefix: "'",
    lineEnding: '\r\n',
  });

  return `# ${AUDIT_EXPORT_NOTICE}\r\n${csv}\r\n`;
}

function createJsonContent(events, exportedAt) {
  return `${JSON.stringify(
    {
      notice: AUDIT_EXPORT_NOTICE,
      exportedAt,
      masked: true,
      rowCount: events.length,
      events,
    },
    null,
    2,
  )}\n`;
}

function createTextBlob(content, mediaType) {
  const BlobConstructor = globalThis.Blob;

  if (typeof BlobConstructor !== 'function') {
    throw new AuditFacadeError(
      AUDIT_FACADE_ERROR_CODES.EXPORT_FAILED,
      'Browser Blob APIs are unavailable.',
    );
  }

  return new BlobConstructor([content], {
    type: mediaType,
  });
}

function formatFilenameTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Error raised when audit facade configuration is invalid.
 */
export class AuditFacadeError extends Error {
  /**
   * @param {string} code Stable facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AuditFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Capability-enforced facade for filtered, masked browser-local audit data.
 */
export class AuditFacade {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Audit
   * repository or facade options containing `auditRepository`.
   * @param {{
   *   permissionService?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Facade options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.auditRepository = requireAuditRepository(
      resolved.repository,
    );
    this.permissionService = requirePermissionService(
      normalizedOptions.permissionService,
    );
    this.auditService = normalizeAuditService(
      normalizedOptions.auditService,
    );
    this.sessionProvider = normalizeSessionProvider(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade ??
        this.permissionService.sessionProvider,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Audit facade ID generator must be a function.',
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

  async authorize(action, correlationId) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action,
          session: this.getSession(),
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          AUDIT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Audit permission evaluation could not be completed.',
          correlationId,
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

    return {
      allowed: false,
      failure: createAuthorizationFailure(
        decision,
        correlationId,
      ),
    };
  }

  collectEvents(filters, role, session) {
    const events = [];
    let page = 1;
    let revision = 0;
    let totalPages = 1;

    while (
      page <= totalPages &&
      events.length < MAXIMUM_EXPORT_EVENTS
    ) {
      const result = queryRepository(this.auditRepository, {
        ...filters,
        page,
        limit: REPOSITORY_PAGE_LIMIT,
      });

      if (
        !isPlainObject(result) ||
        !Array.isArray(result.items)
      ) {
        throw new AuditFacadeError(
          AUDIT_FACADE_ERROR_CODES.QUERY_FAILED,
          'Audit repository returned an invalid query result.',
        );
      }

      revision =
        Number.isSafeInteger(result.revision) &&
        result.revision >= 0
          ? result.revision
          : revision;

      result.items.forEach((event) => {
        if (
          events.length < MAXIMUM_EXPORT_EVENTS &&
          isEventVisibleToRole(event, role, session)
        ) {
          events.push(maskAuditEvent(event));
        }
      });

      totalPages =
        Number.isSafeInteger(result.totalPages) &&
        result.totalPages >= 0
          ? result.totalPages
          : page;

      page += 1;
    }

    return deepFreeze({
      events,
      revision,
    });
  }

  async appendExportAudit({
    correlationId,
    checksum,
    format,
    rowCount,
  }) {
    if (this.auditService === null) {
      return {
        code: 'AUDIT_SERVICE_UNAVAILABLE',
        message:
          'The export completed without an additional local audit event.',
      };
    }

    const session = this.getSession();

    if (session === null) {
      return {
        code: 'SESSION_UNAVAILABLE',
        message:
          'The export completed without an additional local audit event.',
      };
    }

    try {
      await this.auditService.append(
        {
          correlationId,
          actor: session,
          action: AUDIT_FACADE_ACTIONS.EXPORTED,
          entity: {
            type: 'AUDIT',
            id: checksum,
          },
        },
        {
          action: AUDIT_FACADE_ACTIONS.EXPORTED,
          entity: {
            type: 'AUDIT',
            id: checksum,
          },
          before: null,
          after: {
            format,
            rowCount,
            checksum,
            notice: AUDIT_EXPORT_NOTICE,
          },
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: 'AUDIT_APPEND_FAILED',
        message:
          'The export completed, but its local audit event could not be stored.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Returns a filtered page of defensively masked local audit events.
   *
   * @param {Record<string, unknown>} [request] Audit query filters.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async query(request = {}) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.AUDIT_VIEW,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeQueryRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        AUDIT_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Audit query validation failed.',
        correlationId,
        {
          fieldErrors: normalized.errors,
        },
      );
    }

    const session = this.getSession();
    const role =
      authorization.decision.role ??
      session?.role ??
      null;

    try {
      const collected = this.collectEvents(
        {
          ...normalized.value,
          page: 1,
          limit: REPOSITORY_PAGE_LIMIT,
        },
        role,
        session,
      );
      const result = paginateEvents(
        collected.events,
        normalized.value.page,
        normalized.value.limit,
        collected.revision,
      );

      return createSuccess(
        200,
        result,
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        AUDIT_FACADE_ERROR_CODES.QUERY_FAILED,
        'Local audit events could not be queried.',
        correlationId,
      );
    }
  }

  /**
   * Exports filtered, role-scoped audit events to a local CSV or JSON Blob.
   *
   * @param {Record<string, unknown>} [request] Export request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async export(request = {}) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.AUDIT_EXPORT,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeExportRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        AUDIT_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Audit export request validation failed.',
        correlationId,
        {
          fieldErrors: normalized.errors,
        },
      );
    }

    const session = this.getSession();
    const role =
      authorization.decision.role ??
      session?.role ??
      null;

    try {
      const now = getCurrentDate(this.clock);
      const collected = this.collectEvents(
        normalized.value.filters,
        role,
        session,
      );
      const events = collected.events;
      const exportedAt = now.toISOString();
      const isCsv =
        normalized.value.format === AUDIT_EXPORT_FORMATS.CSV;
      const content = isCsv
        ? createCsvContent(events)
        : createJsonContent(events, exportedAt);
      const mediaType = isCsv
        ? CSV_MEDIA_TYPE
        : JSON_MEDIA_TYPE;
      const extension = isCsv ? 'csv' : 'json';
      const filename =
        `audit-events-demo-${formatFilenameTimestamp(now)}.${extension}`;
      const checksum = calculateSnapshotChecksum(
        {
          notice: AUDIT_EXPORT_NOTICE,
          format: normalized.value.format,
          exportedAt,
          masked: true,
          content,
        },
        'SHA-256',
      );
      const blob = createTextBlob(content, mediaType);
      const auditWarning = await this.appendExportAudit({
        correlationId,
        checksum,
        format: normalized.value.format,
        rowCount: events.length,
      });

      return createSuccess(
        200,
        {
          fileName: filename,
          filename,
          format: normalized.value.format,
          mimeType: mediaType.split(';')[0],
          mediaType,
          byteLength: blob.size,
          rowCount: events.length,
          sha256: checksum,
          checksumAlgorithm: 'SHA-256',
          notice: AUDIT_EXPORT_NOTICE,
          masked: true,
          downloadToken: 'blob:browser-local',
          blob,
        },
        correlationId,
        auditWarning === null ? [] : [auditWarning],
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        AUDIT_FACADE_ERROR_CODES.EXPORT_FAILED,
        'The browser-local audit export could not be created.',
        correlationId,
      );
    }
  }

  list(request = {}) {
    return this.query(request);
  }

  getEvents(request = {}) {
    return this.query(request);
  }

  exportEvents(request = {}) {
    return this.export(request);
  }

  exportAudit(request = {}) {
    return this.export(request);
  }
}

/**
 * Creates a filtered local audit facade.
 *
 * @param {ConstructorParameters<typeof AuditFacade>[0]}
 * repositoryOrOptions Audit repository or facade options.
 * @param {ConstructorParameters<typeof AuditFacade>[1]} [options]
 * Facade options.
 * @returns {AuditFacade} Audit facade.
 */
export function createAuditFacade(
  repositoryOrOptions,
  options = {},
) {
  return new AuditFacade(repositoryOrOptions, options);
}

export const LocalAuditFacade = AuditFacade;
export const PlatformAuditFacade = AuditFacade;
export const createLocalAuditFacade = createAuditFacade;
export const createPlatformAuditFacade = createAuditFacade;

export default AuditFacade;