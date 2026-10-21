import {
  MASKING_POLICIES,
  maskObject,
  maskValue,
} from '../security/maskingPolicy.js';
import { browserClock } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

export const AUDIT_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_REPOSITORY: 'INVALID_REPOSITORY',
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  INVALID_EVENT: 'INVALID_EVENT',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
});

const DEFAULT_OUTCOME = 'SUCCESS';
const MAXIMUM_DEDUPLICATION_ENTRIES = 1000;

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
    typeof value.append !== 'function'
  ) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'Audit service requires a repository with append().',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.auditRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.auditRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function requireNonEmptyString(value, name, errorCode) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AuditServiceError(
      errorCode,
      `${name} must be a non-empty string.`,
    );
  }

  return value.normalize('NFC').trim();
}

function requireRevision(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_OPTIONS,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
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
      'Audit service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Audit service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createIdentifier(idGenerator, prefix) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Audit service ID generator must return a non-empty string.',
    );
  }

  const normalized = value.normalize('NFC').trim();

  return normalized.startsWith(`${prefix}_`)
    ? normalized
    : `${prefix}_${normalized}`;
}

function normalizeActor(value, errorCode) {
  if (!isPlainObject(value)) {
    throw new AuditServiceError(
      errorCode,
      'Audit command context must include an actor.',
    );
  }

  const role =
    typeof value.role === 'string'
      ? value.role.trim().toUpperCase()
      : value.role;

  if (!isPlatformRole(role)) {
    throw new AuditServiceError(
      errorCode,
      'Audit actor must use a supported platform role.',
      { role: value.role },
    );
  }

  return deepFreeze({
    userId: requireNonEmptyString(
      value.userId,
      'Audit actor user ID',
      errorCode,
    ),
    displayName: requireNonEmptyString(
      value.displayName,
      'Audit actor display name',
      errorCode,
    ),
    role,
  });
}

function normalizeEntity(value) {
  if (!isPlainObject(value)) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
      'Audit event must include an entity.',
    );
  }

  return deepFreeze({
    type: requireNonEmptyString(
      value.type,
      'Audit entity type',
      AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
    ).toUpperCase(),
    id: requireNonEmptyString(
      value.id,
      'Audit entity ID',
      AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
    ),
  });
}

function normalizeAuditDetail(value, name) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
      `${name} must be a safe JSON-compatible object or null.`,
    );
  }

  return value;
}

function normalizeAppendOptions(options, context) {
  if (options === undefined || options === null) {
    return context.expectedRevision === null
      ? {}
      : { expectedRevision: context.expectedRevision };
  }

  if (Number.isSafeInteger(options)) {
    return {
      expectedRevision: requireRevision(
        options,
        'Expected audit revision',
      ),
    };
  }

  if (!isPlainObject(options)) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_OPTIONS,
      'Audit append options must be an object or revision.',
    );
  }

  const expectedRevision =
    options.expectedRevision ??
    options.expectedRootRevision ??
    context.expectedRevision;

  if (expectedRevision === undefined || expectedRevision === null) {
    return {};
  }

  return {
    expectedRevision: requireRevision(
      expectedRevision,
      'Expected audit revision',
    ),
  };
}

function createDeduplicationKey(context, event) {
  return [
    context.correlationId,
    event.action,
    event.entity.type,
    event.entity.id,
  ].join('|');
}

function maskActor(actor) {
  return deepFreeze({
    userId: actor.userId,
    displayName: maskValue(
      actor.displayName,
      MASKING_POLICIES.NAME,
    ),
    role: actor.role,
  });
}

function normalizeEvent(context, value, clock, idGenerator) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
      'Audit event must be a safe JSON-compatible object.',
    );
  }

  const actor = normalizeActor(
    value.actor ?? context.actor,
    AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
  );
  const action = requireNonEmptyString(
    value.action ?? context.action,
    'Audit action',
    AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
  ).toUpperCase();
  const entity = normalizeEntity(value.entity ?? context.entity);
  const outcome = requireNonEmptyString(
    value.outcome ?? DEFAULT_OUTCOME,
    'Audit outcome',
    AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
  ).toUpperCase();
  const before = normalizeAuditDetail(value.before, 'Audit before value');
  const after = normalizeAuditDetail(value.after, 'Audit after value');

  return deepFreeze({
    eventId:
      value.eventId === undefined
        ? createIdentifier(idGenerator, 'aud')
        : requireNonEmptyString(
            value.eventId,
            'Audit event ID',
            AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
          ),
    occurredAt:
      value.occurredAt === undefined
        ? getCurrentTimestamp(clock)
        : requireNonEmptyString(
            value.occurredAt,
            'Audit occurrence timestamp',
            AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
          ),
    actor: maskActor(actor),
    action,
    entity,
    before: before === null ? null : maskObject(before),
    after: after === null ? null : maskObject(after),
    outcome,
    correlationId: context.correlationId,
  });
}

function normalizePersistenceError(error) {
  if (error instanceof AuditServiceError) {
    return error;
  }

  return new AuditServiceError(
    AUDIT_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The audit event could not be persisted.',
    {
      persistenceCode:
        error !== null && typeof error === 'object'
          ? error.code ?? null
          : null,
    },
    error,
  );
}

/**
 * Error raised when audit service input or persistence is invalid.
 */
export class AuditServiceError extends Error {
  /**
   * @param {string} code Stable audit service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AuditServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Creates an immutable command context for one covered command.
 *
 * Session and credential fields are intentionally excluded. The resulting
 * context contains only the actor snapshot, correlation metadata, and optional
 * default audit action and entity.
 *
 * @param {Record<string, unknown>} value Command context input.
 * @param {{idGenerator?: () => string}} [options] Context options.
 * @returns {Readonly<Record<string, unknown>>} Command context.
 */
export function createCommandContext(value, options = {}) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_CONTEXT,
      'Audit command context must be a safe JSON-compatible object.',
    );
  }

  if (!isPlainObject(options)) {
    throw new AuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_OPTIONS,
      'Audit command context options must be an object.',
    );
  }

  const idGenerator = options.idGenerator ?? generateUuid;

  if (typeof idGenerator !== 'function') {
    throw new TypeError(
      'Audit command context ID generator must be a function.',
    );
  }

  const actor = normalizeActor(
    value.actor ?? value.session,
    AUDIT_SERVICE_ERROR_CODES.INVALID_CONTEXT,
  );
  const correlationId =
    value.correlationId === undefined
      ? createIdentifier(idGenerator, 'corr')
      : requireNonEmptyString(
          value.correlationId,
          'Audit correlation ID',
          AUDIT_SERVICE_ERROR_CODES.INVALID_CONTEXT,
        );
  const expectedRevision =
    value.expectedRevision ??
    value.expectedRootRevision ??
    null;

  return deepFreeze({
    correlationId,
    actor,
    action:
      value.action === undefined || value.action === null
        ? null
        : requireNonEmptyString(
            value.action,
            'Audit action',
            AUDIT_SERVICE_ERROR_CODES.INVALID_CONTEXT,
          ).toUpperCase(),
    entity:
      value.entity === undefined || value.entity === null
        ? null
        : normalizeEntity(value.entity),
    expectedRevision:
      expectedRevision === null
        ? null
        : requireRevision(
            expectedRevision,
            'Expected audit revision',
          ),
  });
}

/**
 * Masks a value using the centralized masking policy.
 *
 * @param {unknown} value Value to mask.
 * @param {string|Record<string, unknown>} [policy] Policy or masking options.
 * @param {Record<string, unknown>} [options] Masking options.
 * @returns {unknown} Deeply frozen masked value.
 */
export function mask(
  value,
  policy = MASKING_POLICIES.IDENTIFIER,
  options = {},
) {
  if (value !== null && typeof value === 'object') {
    const maskingOptions =
      isPlainObject(policy) ? policy : options;

    return maskObject(value, maskingOptions);
  }

  return maskValue(value, policy, options);
}

/**
 * Appends masked audit events through an injected audit repository.
 */
export class AuditService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Audit
   * repository or service options containing `repository` or
   * `auditRepository`.
   * @param {{clock?: object|Function, idGenerator?: () => string}} [options]
   * Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );

    this.repository = requireRepository(resolved.repository);
    this.clock = resolved.options.clock ?? browserClock;
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;
    this.persistedCommands = new Map();

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Audit service ID generator must be a function.',
      );
    }
  }

  /**
   * Masks a value using the centralized masking policy.
   *
   * @param {unknown} value Value to mask.
   * @param {string|Record<string, unknown>} [policy] Policy or options.
   * @param {Record<string, unknown>} [options] Masking options.
   * @returns {unknown} Masked value.
   */
  mask(
    value,
    policy = MASKING_POLICIES.IDENTIFIER,
    options = {},
  ) {
    return mask(value, policy, options);
  }

  /**
   * Appends exactly one masked event for a covered command context.
   *
   * Repeated calls with the same correlation ID, action, and entity return the
   * first persisted event without writing a duplicate. Failed persistence is
   * not cached, so callers may explicitly retry.
   *
   * @param {Record<string, unknown>} commandContext Command context.
   * @param {Record<string, unknown>} event Audit event input.
   * @param {number|Record<string, unknown>} [options] Repository options.
   * @returns {Readonly<Record<string, unknown>>} Persisted audit event.
   */
  append(commandContext, event, options = {}) {
    const context = createCommandContext(commandContext, {
      idGenerator: this.idGenerator,
    });
    const normalizedEvent = normalizeEvent(
      context,
      event,
      this.clock,
      this.idGenerator,
    );
    const deduplicationKey = createDeduplicationKey(
      context,
      normalizedEvent,
    );
    const existing = this.persistedCommands.get(deduplicationKey);

    if (existing !== undefined) {
      return existing;
    }

    const repositoryOptions = normalizeAppendOptions(
      options,
      context,
    );
    let persisted;

    try {
      persisted = this.repository.append(
        normalizedEvent,
        repositoryOptions,
      );
    } catch (error) {
      throw normalizePersistenceError(error);
    }

    if (
      !isPlainObject(persisted) ||
      !isJsonCompatible(persisted)
    ) {
      throw new AuditServiceError(
        AUDIT_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'The audit repository returned an invalid persisted event.',
      );
    }

    const result = deepFreeze(persisted);

    this.persistedCommands.set(deduplicationKey, result);

    if (
      this.persistedCommands.size >
      MAXIMUM_DEDUPLICATION_ENTRIES
    ) {
      const oldestKey = this.persistedCommands.keys().next().value;
      this.persistedCommands.delete(oldestKey);
    }

    return result;
  }
}

/**
 * Creates an audit service.
 *
 * @param {ConstructorParameters<typeof AuditService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof AuditService>[1]} [options]
 * Service options.
 * @returns {AuditService} Audit service.
 */
export function createAuditService(
  repositoryOrOptions,
  options = {},
) {
  return new AuditService(repositoryOrOptions, options);
}

/**
 * Appends an event through an audit service or repository.
 *
 * @param {AuditService|object} serviceOrRepository Audit service or repository.
 * @param {Record<string, unknown>} commandContext Command context.
 * @param {Record<string, unknown>} event Audit event input.
 * @param {number|Record<string, unknown>} [options] Append options.
 * @returns {Readonly<Record<string, unknown>>} Persisted event.
 */
export function append(
  serviceOrRepository,
  commandContext,
  event,
  options = {},
) {
  const service =
    serviceOrRepository instanceof AuditService
      ? serviceOrRepository
      : createAuditService(serviceOrRepository);

  return service.append(commandContext, event, options);
}

export const LocalAuditService = AuditService;
export const createLocalAuditService = createAuditService;
export const createAuditCommandContext = createCommandContext;
export const maskAuditValue = mask;
export const appendAuditEvent = append;

export default AuditService;