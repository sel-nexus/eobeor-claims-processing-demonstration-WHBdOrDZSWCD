import {
  isAuditEvent,
  isAuditEventCollection,
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';
import { maskObject } from '../security/maskingPolicy.js';

export const AUDIT_REPOSITORY_SCHEMA_VERSION = 1;
export const AUDIT_REPOSITORY_SLICE = 'auditEvents';
export const AUDIT_REPOSITORY_LEGACY_SLICE = 'audit';
export const MAXIMUM_AUDIT_EVENTS = 10000;
export const AUDIT_RETENTION_BATCH_SIZE = 500;
export const AUDIT_TRUNCATION_ACTION = 'LOCAL_AUDIT_TRUNCATED';

export const AUDIT_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_EVENT: 'INVALID_EVENT',
  INVALID_EVENT_COLLECTION: 'INVALID_EVENT_COLLECTION',
  INVALID_QUERY: 'INVALID_QUERY',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  INVALID_REVISION: 'INVALID_REVISION',
});

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 100;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'Audit repository requires a storage gateway with read() and commit().',
    );
  }

  return value;
}

function resolveConstructorArguments(gatewayOrOptions, options) {
  if (
    isPlainObject(gatewayOrOptions) &&
    (gatewayOrOptions.gateway !== undefined ||
      gatewayOrOptions.storageGateway !== undefined)
  ) {
    return {
      gateway:
        gatewayOrOptions.gateway ??
        gatewayOrOptions.storageGateway,
      options: gatewayOrOptions,
    };
  }

  return {
    gateway: gatewayOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function requirePositiveInteger(value, fallback, maximum) {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Audit query pagination values are outside the supported range.',
      {
        value,
        maximum: maximum ?? null,
      },
    );
  }

  return value;
}

function requireRevision(value, name = 'Expected revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringFilter(value, name) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = normalizeString(value);

  if (normalized.length === 0) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      `${name} must be a non-empty string.`,
    );
  }

  return normalized;
}

function normalizeStringCollection(value, name) {
  if (value === undefined || value === null) {
    return null;
  }

  const source = Array.isArray(value) ? value : [value];
  const normalized = source.map((item) =>
    normalizeStringFilter(item, name),
  );

  if (
    normalized.length === 0 ||
    normalized.some((item) => item === null)
  ) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      `${name} must contain non-empty strings.`,
    );
  }

  return new Set(normalized);
}

function parseBoundary(value, name, endOfDay) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      `${name} must be an ISO timestamp or YYYY-MM-DD date.`,
    );
  }

  const source = value.trim();
  const timestamp = DATE_ONLY_PATTERN.test(source)
    ? Date.parse(
        `${source}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`,
      )
    : Date.parse(source);

  if (!Number.isFinite(timestamp)) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      `${name} must be a valid ISO timestamp or YYYY-MM-DD date.`,
      { value },
    );
  }

  return timestamp;
}

function normalizeQuery(filters) {
  if (!isPlainObject(filters)) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Audit query filters must be an object.',
    );
  }

  const page = requirePositiveInteger(
    filters.page,
    DEFAULT_PAGE,
  );
  const limit = requirePositiveInteger(
    filters.limit,
    DEFAULT_LIMIT,
    MAXIMUM_LIMIT,
  );
  const from = parseBoundary(filters.from, 'Audit query from', false);
  const to = parseBoundary(filters.to, 'Audit query to', true);

  if (from !== null && to !== null && from > to) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Audit query from date must not be after the to date.',
    );
  }

  const direction =
    typeof filters.direction === 'string'
      ? filters.direction.trim().toUpperCase()
      : 'DESC';

  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Audit query direction must be ASC or DESC.',
    );
  }

  return {
    actions: normalizeStringCollection(
      filters.actions ?? filters.action,
      'Audit action',
    ),
    outcomes: normalizeStringCollection(
      filters.outcomes ?? filters.outcome,
      'Audit outcome',
    ),
    actorId: normalizeStringFilter(
      filters.actorId ?? filters.userId,
      'Audit actor ID',
    ),
    actorRole: normalizeStringFilter(
      filters.actorRole ?? filters.role,
      'Audit actor role',
    ),
    entityType: normalizeStringFilter(
      filters.entityType,
      'Audit entity type',
    ),
    entityId: normalizeStringFilter(
      filters.entityId,
      'Audit entity ID',
    ),
    correlationId: normalizeStringFilter(
      filters.correlationId,
      'Audit correlation ID',
    ),
    search: normalizeStringFilter(
      filters.query ?? filters.q,
      'Audit search query',
    ),
    from,
    to,
    page,
    limit,
    direction,
  };
}

function eventMatchesQuery(event, query) {
  const timestamp = Date.parse(event.occurredAt);

  if (query.actions !== null && !query.actions.has(event.action)) {
    return false;
  }

  if (query.outcomes !== null && !query.outcomes.has(event.outcome)) {
    return false;
  }

  if (query.actorId !== null && event.actor.userId !== query.actorId) {
    return false;
  }

  if (
    query.actorRole !== null &&
    event.actor.role !== query.actorRole
  ) {
    return false;
  }

  if (
    query.entityType !== null &&
    event.entity.type !== query.entityType
  ) {
    return false;
  }

  if (
    query.entityId !== null &&
    event.entity.id !== query.entityId
  ) {
    return false;
  }

  if (
    query.correlationId !== null &&
    event.correlationId !== query.correlationId
  ) {
    return false;
  }

  if (query.from !== null && timestamp < query.from) {
    return false;
  }

  if (query.to !== null && timestamp > query.to) {
    return false;
  }

  if (query.search !== null) {
    const needle = query.search.toLocaleLowerCase('en-US');
    const searchable = [
      event.action,
      event.outcome,
      event.actor.displayName,
      event.actor.role,
      event.entity.type,
      event.entity.id,
      event.correlationId,
    ]
      .join(' ')
      .toLocaleLowerCase('en-US');

    if (!searchable.includes(needle)) {
      return false;
    }
  }

  return true;
}

function maskAuditDetail(value) {
  if (value === null) {
    return null;
  }

  return maskObject(value);
}

function normalizeEvent(value) {
  if (!isAuditEvent(value)) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT,
      'Audit event does not satisfy its schema.',
    );
  }

  const event = {
    ...value,
    actor: {
      ...value.actor,
    },
    entity: {
      ...value.entity,
    },
    before: maskAuditDetail(value.before),
    after: maskAuditDetail(value.after),
  };

  if (!isAuditEvent(event)) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT,
      'Masked audit event does not satisfy its schema.',
    );
  }

  return deepFreeze(event);
}

function normalizeEventCollection(value) {
  if (!Array.isArray(value)) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT_COLLECTION,
      'Audit event collection must be an array.',
    );
  }

  const events = value.map(normalizeEvent);
  const eventIds = new Set();

  events.forEach((event) => {
    if (eventIds.has(event.eventId)) {
      throw new AuditRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT_COLLECTION,
        'Audit event collection contains duplicate event IDs.',
        { eventId: event.eventId },
      );
    }

    eventIds.add(event.eventId);
  });

  return events;
}

function getCurrentTimestamp(clock) {
  if (clock !== null && typeof clock === 'object') {
    if (typeof clock.nowIso === 'function') {
      return clock.nowIso();
    }

    if (typeof clock.now === 'function') {
      const value = clock.now();
      const date = value instanceof Date ? value : new Date(value);

      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  if (typeof clock === 'function') {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

function createTruncationEvent({
  removedCount,
  retainedCount,
  revision,
  occurredAt,
}) {
  const compactTimestamp = occurredAt.replace(/[^0-9]/g, '');

  return deepFreeze({
    eventId: `AUDIT-TRUNCATED-${compactTimestamp}-${revision}`,
    occurredAt,
    actor: {
      userId: 'system',
      displayName: 'System',
      role: 'ADMIN',
    },
    action: AUDIT_TRUNCATION_ACTION,
    entity: {
      type: 'AUDIT',
      id: 'local',
    },
    before: {
      eventCount: retainedCount + removedCount,
    },
    after: {
      eventCount: retainedCount,
      removedCount,
    },
    outcome: 'SUCCESS',
    correlationId: `audit-truncation-${revision}`,
  });
}

function enforceRetention(events, options) {
  const maximumEvents = options.maximumEvents;
  const batchSize = options.retentionBatchSize;

  if (events.length <= maximumEvents) {
    return events;
  }

  const minimumRemoval =
    events.length - maximumEvents + 1;
  const removalTarget = Math.max(batchSize, minimumRemoval);
  const removableIndexes = [];
  const protectedIndexes = [];

  events.forEach((event, index) => {
    if (event.action === AUDIT_TRUNCATION_ACTION) {
      protectedIndexes.push(index);
    } else {
      removableIndexes.push(index);
    }
  });

  const indexesToRemove = new Set(
    removableIndexes.slice(0, removalTarget),
  );

  if (indexesToRemove.size < removalTarget) {
    protectedIndexes
      .slice(0, removalTarget - indexesToRemove.size)
      .forEach((index) => indexesToRemove.add(index));
  }

  const retained = events.filter(
    (_event, index) => !indexesToRemove.has(index),
  );
  const marker = createTruncationEvent({
    removedCount: indexesToRemove.size,
    retainedCount: retained.length + 1,
    revision: options.revision,
    occurredAt: options.occurredAt,
  });

  retained.push(marker);

  while (retained.length > maximumEvents) {
    retained.shift();
  }

  return retained;
}

function resolveSliceName(envelope, preferredSliceName) {
  const slices = envelope?.slices;

  if (!isPlainObject(slices)) {
    return preferredSliceName;
  }

  if (Array.isArray(slices[preferredSliceName])) {
    return preferredSliceName;
  }

  if (
    preferredSliceName === AUDIT_REPOSITORY_SLICE &&
    Array.isArray(slices[AUDIT_REPOSITORY_LEGACY_SLICE])
  ) {
    return AUDIT_REPOSITORY_LEGACY_SLICE;
  }

  return preferredSliceName;
}

function readEvents(envelope, preferredSliceName) {
  if (envelope === null) {
    return Object.freeze([]);
  }

  const slices = envelope.slices;
  const sliceName = resolveSliceName(envelope, preferredSliceName);
  const events = isPlainObject(slices) ? slices[sliceName] : undefined;

  if (events === undefined) {
    return Object.freeze([]);
  }

  if (!isAuditEventCollection(events)) {
    throw new AuditRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT_COLLECTION,
      'Persisted audit events do not satisfy their schema.',
      { sliceName },
    );
  }

  return deepFreeze(events);
}

function buildNextState(envelope, sliceName, events) {
  const currentSlices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...currentSlices,
      [sliceName]: events,
    },
  };
}

function resolveExpectedRevision(options) {
  if (options === undefined || options === null) {
    return undefined;
  }

  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'Audit repository mutation options must be an object or revision.',
    );
  }

  if (
    options.expectedRevision === undefined ||
    options.expectedRevision === null
  ) {
    return undefined;
  }

  return requireRevision(options.expectedRevision);
}

/**
 * Error raised when an audit repository operation receives invalid data.
 */
export class AuditRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'AuditRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Versioned, append-oriented repository for browser-local audit events.
 */
export class AuditRepository {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or repository options containing `gateway` or `storageGateway`.
   * @param {{
   *   sliceName?: string,
   *   maximumEvents?: number,
   *   retentionBatchSize?: number,
   *   clock?: object|Function,
   *   requireExpectedRevisionForReplace?: boolean
   * }} [options] Repository options.
   */
  constructor(gatewayOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      gatewayOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.gateway = requireGateway(resolved.gateway);
    this.sliceName =
      typeof normalizedOptions.sliceName === 'string' &&
      normalizedOptions.sliceName.trim().length > 0
        ? normalizedOptions.sliceName.trim()
        : AUDIT_REPOSITORY_SLICE;
    this.maximumEvents = requirePositiveInteger(
      normalizedOptions.maximumEvents,
      MAXIMUM_AUDIT_EVENTS,
      MAXIMUM_AUDIT_EVENTS,
    );
    this.retentionBatchSize = requirePositiveInteger(
      normalizedOptions.retentionBatchSize,
      AUDIT_RETENTION_BATCH_SIZE,
      this.maximumEvents,
    );
    this.clock = normalizedOptions.clock ?? null;
    this.requireExpectedRevisionForReplace =
      normalizedOptions.requireExpectedRevisionForReplace !== false;
  }

  /**
   * Returns the current committed root revision.
   *
   * @returns {number} Root revision, or zero before the first commit.
   */
  getRevision() {
    return this.gateway.read()?.rootRevision ?? 0;
  }

  /**
   * Returns all audit events in append order.
   *
   * @returns {readonly Readonly<Record<string, unknown>>[]} Audit events.
   */
  getAll() {
    const envelope = this.gateway.read();

    return readEvents(envelope, this.sliceName);
  }

  /**
   * Returns a versioned audit repository snapshot.
   *
   * @returns {Readonly<{
   *   schemaVersion: number,
   *   revision: number,
   *   events: readonly Readonly<Record<string, unknown>>[]
   * }>} Repository snapshot.
   */
  getSnapshot() {
    const envelope = this.gateway.read();

    return deepFreeze({
      schemaVersion: AUDIT_REPOSITORY_SCHEMA_VERSION,
      revision: envelope?.rootRevision ?? 0,
      events: readEvents(envelope, this.sliceName),
    });
  }

  /**
   * Appends one validated audit event and applies bounded retention.
   *
   * @param {unknown} event Audit event.
   * @param {number|{expectedRevision?: number}} [options] Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored audit event.
   */
  append(event, options = {}) {
    const normalizedEvent = normalizeEvent(event);
    const expectedRevision = resolveExpectedRevision(options);
    const envelope = this.gateway.read();
    const currentRevision = envelope?.rootRevision ?? 0;
    const events = [
      ...readEvents(envelope, this.sliceName),
      normalizedEvent,
    ];
    const retainedEvents = enforceRetention(events, {
      maximumEvents: this.maximumEvents,
      retentionBatchSize: this.retentionBatchSize,
      revision: currentRevision + 1,
      occurredAt: getCurrentTimestamp(this.clock),
    });
    const sliceName = resolveSliceName(envelope, this.sliceName);
    const nextState = buildNextState(
      envelope,
      sliceName,
      retainedEvents,
    );

    this.gateway.commit(
      expectedRevision,
      nextState,
      {},
    );

    return normalizedEvent;
  }

  /**
   * Queries audit events using bounded pagination and exact filters.
   *
   * @param {{
   *   action?: string,
   *   actions?: string[],
   *   outcome?: string,
   *   outcomes?: string[],
   *   actorId?: string,
   *   actorRole?: string,
   *   entityType?: string,
   *   entityId?: string,
   *   correlationId?: string,
   *   from?: string,
   *   to?: string,
   *   query?: string,
   *   page?: number,
   *   limit?: number,
   *   direction?: 'ASC'|'DESC'
   * }} [filters] Query filters.
   * @returns {Readonly<Record<string, unknown>>} Paged query result.
   */
  query(filters = {}) {
    const query = normalizeQuery(filters);
    const envelope = this.gateway.read();
    const matchingEvents = readEvents(envelope, this.sliceName)
      .filter((event) => eventMatchesQuery(event, query))
      .sort((left, right) => {
        const difference =
          Date.parse(left.occurredAt) - Date.parse(right.occurredAt);

        if (difference !== 0) {
          return query.direction === 'ASC'
            ? difference
            : -difference;
        }

        return query.direction === 'ASC'
          ? left.eventId.localeCompare(right.eventId)
          : right.eventId.localeCompare(left.eventId);
      });
    const start = (query.page - 1) * query.limit;
    const items = matchingEvents.slice(start, start + query.limit);

    return deepFreeze({
      items,
      page: query.page,
      limit: query.limit,
      total: matchingEvents.length,
      totalPages:
        matchingEvents.length === 0
          ? 0
          : Math.ceil(matchingEvents.length / query.limit),
      revision: envelope?.rootRevision ?? 0,
      masked: true,
    });
  }

  /**
   * Replaces the audit collection using optimistic revision validation.
   *
   * Supports `replace(events, { expectedRevision })` and
   * `replace(expectedRevision, events)`.
   *
   * @param {number|unknown[]} expectedRevisionOrEvents Expected revision or
   * replacement events.
   * @param {unknown[]|Record<string, unknown>} [eventsOrOptions] Events or
   * options.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Stored events.
   */
  replace(expectedRevisionOrEvents, eventsOrOptions) {
    let expectedRevision;
    let replacementEvents;

    if (Array.isArray(expectedRevisionOrEvents)) {
      replacementEvents = expectedRevisionOrEvents;
      expectedRevision = resolveExpectedRevision(eventsOrOptions);
    } else {
      expectedRevision = requireRevision(expectedRevisionOrEvents);
      replacementEvents = eventsOrOptions;
    }

    if (
      this.requireExpectedRevisionForReplace &&
      expectedRevision === undefined
    ) {
      throw new AuditRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
        'Expected revision is required when replacing audit events.',
      );
    }

    const normalizedEvents =
      normalizeEventCollection(replacementEvents);
    const envelope = this.gateway.read();
    const currentRevision = envelope?.rootRevision ?? 0;
    const retainedEvents = enforceRetention(normalizedEvents, {
      maximumEvents: this.maximumEvents,
      retentionBatchSize: this.retentionBatchSize,
      revision: currentRevision + 1,
      occurredAt: getCurrentTimestamp(this.clock),
    });

    if (
      !isAuditEventCollection(retainedEvents) ||
      !isJsonCompatible(retainedEvents)
    ) {
      throw new AuditRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT_COLLECTION,
        'Replacement audit events do not satisfy their schema.',
      );
    }

    const sliceName = resolveSliceName(envelope, this.sliceName);
    const nextState = buildNextState(
      envelope,
      sliceName,
      retainedEvents,
    );

    this.gateway.commit(expectedRevision, nextState, {});

    return deepFreeze(retainedEvents);
  }

  /**
   * Removes all audit events using optimistic revision validation.
   *
   * @param {number} expectedRevision Expected root revision.
   * @returns {readonly []} Empty event collection.
   */
  clear(expectedRevision) {
    return this.replace(expectedRevision, []);
  }

  /**
   * Subscribes to storage invalidation events.
   *
   * @param {(event: Readonly<Record<string, unknown>>) => void} listener
   * Repository listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Audit repository listener must be a function.',
      );
    }

    if (typeof this.gateway.subscribe !== 'function') {
      return () => {};
    }

    return this.gateway.subscribe(listener);
  }

  list(filters = {}) {
    return this.query(filters);
  }

  find(filters = {}) {
    return this.query(filters);
  }

  load() {
    return this.getSnapshot();
  }

  replaceAll(expectedRevisionOrEvents, eventsOrOptions) {
    return this.replace(
      expectedRevisionOrEvents,
      eventsOrOptions,
    );
  }
}

/**
 * Creates an audit repository.
 *
 * @param {ConstructorParameters<typeof AuditRepository>[0]} gatewayOrOptions
 * Gateway or repository options.
 * @param {ConstructorParameters<typeof AuditRepository>[1]} [options]
 * Repository options.
 * @returns {AuditRepository} Audit repository.
 */
export function createAuditRepository(
  gatewayOrOptions,
  options = {},
) {
  return new AuditRepository(gatewayOrOptions, options);
}

export const LocalAuditRepository = AuditRepository;
export const createLocalAuditRepository = createAuditRepository;
export const AuditEventRepository = AuditRepository;

export default AuditRepository;