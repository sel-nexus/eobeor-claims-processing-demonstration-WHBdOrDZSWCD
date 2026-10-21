const PLATFORM_ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

const platformRoleValues = new Set(PLATFORM_ROLES);
const blockedPropertyNames = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const SUPPORTED_SCHEMA_VERSIONS = new Set([1, '1', '1.0.0']);

/**
 * Determines whether a value is a non-array record.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is a record.
 */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Determines whether a value is a plain object.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is a plain object.
 */
export function isPlainObject(value) {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Determines whether a value is a finite number.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is finite.
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Determines whether a value is a non-negative integer.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is a non-negative integer.
 */
export function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Determines whether a value is a non-empty string.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is a non-empty string.
 */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Determines whether a value is a supported platform role.
 *
 * @param {unknown} value Candidate role.
 * @returns {boolean} Whether the role is supported.
 */
export function isPlatformRole(value) {
  return typeof value === 'string' && platformRoleValues.has(value);
}

/**
 * Determines whether a value is a valid UTC ISO-8601 timestamp.
 *
 * @param {unknown} value Candidate timestamp.
 * @returns {boolean} Whether the value is a valid timestamp.
 */
export function isIsoDateTime(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);

  return (
    Number.isFinite(timestamp) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  );
}

/**
 * Determines whether a value is safe JSON-compatible platform data.
 *
 * Cycles, non-finite numbers, non-plain objects, undefined values, functions,
 * symbols, bigint values, and prototype-pollution property names are rejected.
 *
 * @param {unknown} value Candidate value.
 * @param {Set<object>} [ancestors] Objects in the current traversal path.
 * @returns {boolean} Whether the value is safe JSON data.
 */
export function isJsonCompatible(value, ancestors = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);

    return value.every((item) => isJsonCompatible(item, nextAncestors));
  }

  if (!isPlainObject(value) || ancestors.has(value)) {
    return false;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  return Object.entries(value).every(
    ([key, item]) =>
      !blockedPropertyNames.has(key) &&
      isJsonCompatible(item, nextAncestors),
  );
}

/**
 * Determines whether a value is a supported platform schema version.
 *
 * @param {unknown} value Candidate version.
 * @returns {boolean} Whether the version is supported.
 */
export function isSupportedSchemaVersion(value) {
  return SUPPORTED_SCHEMA_VERSIONS.has(value);
}

/**
 * Determines whether a value is a valid persisted platform user.
 *
 * @param {unknown} value Candidate user.
 * @returns {boolean} Whether the value satisfies the user schema.
 */
export function isUser(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const hasValidMemberId =
    value.role === 'MEMBER'
      ? isNonEmptyString(value.memberId)
      : value.memberId === null || value.memberId === undefined;

  return (
    isNonEmptyString(value.userId) &&
    typeof value.username === 'string' &&
    /^[a-z0-9._-]{3,40}$/.test(value.username) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length >= 2 &&
    value.displayName.trim().length <= 80 &&
    isPlatformRole(value.role) &&
    hasValidMemberId &&
    typeof value.active === 'boolean' &&
    typeof value.systemSeed === 'boolean' &&
    isIsoDateTime(value.createdAt) &&
    isIsoDateTime(value.updatedAt) &&
    Date.parse(value.updatedAt) >= Date.parse(value.createdAt) &&
    Number.isInteger(value.revision) &&
    value.revision >= 1
  );
}

/**
 * Determines whether a value is an array of valid users with unique IDs and
 * case-insensitive usernames.
 *
 * @param {unknown} value Candidate user collection.
 * @returns {boolean} Whether the collection satisfies the user schema.
 */
export function isUserCollection(value) {
  if (!Array.isArray(value) || !value.every(isUser)) {
    return false;
  }

  const userIds = new Set();
  const usernames = new Set();

  for (const user of value) {
    const normalizedUsername = user.username.toLowerCase();

    if (userIds.has(user.userId) || usernames.has(normalizedUsername)) {
      return false;
    }

    userIds.add(user.userId);
    usernames.add(normalizedUsername);
  }

  return true;
}

/**
 * Determines whether a number has no more than two decimal places.
 *
 * @param {number} value Candidate amount.
 * @returns {boolean} Whether the amount has at most two decimal places.
 */
function hasAtMostTwoDecimalPlaces(value) {
  return Number.isInteger(Math.round(value * 100));
}

/**
 * Determines whether a value is valid platform settings.
 *
 * @param {unknown} value Candidate settings.
 * @returns {boolean} Whether the value satisfies the settings schema.
 */
export function isSettings(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const labelsAreValid =
    value.labels === undefined ||
    (isPlainObject(value.labels) &&
      Object.values(value.labels).every(
        (label) => typeof label === 'string' && label.trim().length > 0,
      ));

  const updaterIsValid =
    value.updatedBy === null ||
    value.updatedBy === undefined ||
    isNonEmptyString(value.updatedBy);

  const updatedAtIsValid =
    value.updatedAt === null ||
    value.updatedAt === undefined ||
    isIsoDateTime(value.updatedAt);

  return (
    Number.isInteger(value.retentionYears) &&
    value.retentionYears >= 1 &&
    value.retentionYears <= 10 &&
    isFiniteNumber(value.autoApproveAmount) &&
    value.autoApproveAmount >= 0 &&
    value.autoApproveAmount <= 10000 &&
    hasAtMostTwoDecimalPlaces(value.autoApproveAmount) &&
    Number.isInteger(value.sessionTimeoutMinutes) &&
    value.sessionTimeoutMinutes >= 2 &&
    value.sessionTimeoutMinutes <= 240 &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    updaterIsValid &&
    updatedAtIsValid &&
    labelsAreValid
  );
}

/**
 * Determines whether a value is a valid persisted session.
 *
 * @param {unknown} value Candidate session.
 * @returns {boolean} Whether the value satisfies the session schema.
 */
export function isSession(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  if (
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.userId) ||
    !isNonEmptyString(value.displayName) ||
    !isPlatformRole(value.role) ||
    !isIsoDateTime(value.createdAt) ||
    !isIsoDateTime(value.lastActivityAt) ||
    !isIsoDateTime(value.expiresAt)
  ) {
    return false;
  }

  const createdAt = Date.parse(value.createdAt);
  const lastActivityAt = Date.parse(value.lastActivityAt);
  const expiresAt = Date.parse(value.expiresAt);

  return lastActivityAt >= createdAt && expiresAt > lastActivityAt;
}

/**
 * Determines whether a value is either a valid session or an empty session.
 *
 * @param {unknown} value Candidate session value.
 * @returns {boolean} Whether the value is nullable session data.
 */
export function isNullableSession(value) {
  return value === null || isSession(value);
}

/**
 * Determines whether an audit actor satisfies the persisted actor schema.
 *
 * @param {unknown} value Candidate actor.
 * @returns {boolean} Whether the actor is valid.
 */
function isAuditActor(value) {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.displayName) &&
    isPlatformRole(value.role)
  );
}

/**
 * Determines whether an audit entity satisfies the persisted entity schema.
 *
 * @param {unknown} value Candidate entity.
 * @returns {boolean} Whether the entity is valid.
 */
function isAuditEntity(value) {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.type) &&
    isNonEmptyString(value.id)
  );
}

/**
 * Determines whether an audit before/after value is valid.
 *
 * @param {unknown} value Candidate audit detail.
 * @returns {boolean} Whether the audit detail is valid.
 */
function isAuditDetail(value) {
  return value === null || (isPlainObject(value) && isJsonCompatible(value));
}

/**
 * Determines whether a value is a valid persisted audit event.
 *
 * @param {unknown} value Candidate event.
 * @returns {boolean} Whether the value satisfies the audit event schema.
 */
export function isAuditEvent(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isNonEmptyString(value.eventId) &&
    isIsoDateTime(value.occurredAt) &&
    isAuditActor(value.actor) &&
    isNonEmptyString(value.action) &&
    isAuditEntity(value.entity) &&
    isAuditDetail(value.before) &&
    isAuditDetail(value.after) &&
    isNonEmptyString(value.outcome) &&
    isNonEmptyString(value.correlationId)
  );
}

/**
 * Determines whether a value is a valid audit event collection.
 *
 * @param {unknown} value Candidate collection.
 * @returns {boolean} Whether every item is a unique audit event.
 */
export function isAuditEventCollection(value) {
  if (!Array.isArray(value) || value.length > 10000) {
    return false;
  }

  const eventIds = new Set();

  return value.every((event) => {
    if (!isAuditEvent(event) || eventIds.has(event.eventId)) {
      return false;
    }

    eventIds.add(event.eventId);
    return true;
  });
}

/**
 * Determines whether a value is a valid monitoring state.
 *
 * @param {unknown} value Candidate monitoring state.
 * @returns {boolean} Whether the value satisfies the monitoring schema.
 */
export function isMonitoringState(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const kpis = value.kpis ?? value.kpi;
  const events = value.events;
  const alerts = value.alerts;

  return (
    value.simulated === true &&
    isNonNegativeInteger(value.tick) &&
    isPlainObject(kpis) &&
    isJsonCompatible(kpis) &&
    Array.isArray(events) &&
    events.length <= 500 &&
    events.every(isJsonCompatible) &&
    Array.isArray(alerts) &&
    alerts.length <= 200 &&
    alerts.every(isJsonCompatible) &&
    Number.isInteger(value.revision) &&
    value.revision >= 1
  );
}

/**
 * Determines whether a value is a valid root commit journal.
 *
 * @param {unknown} value Candidate journal.
 * @returns {boolean} Whether the value satisfies the journal schema.
 */
export function isRootCommitJournal(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const commandIdIsValid =
    value.lastCommandId === null ||
    value.lastCommandId === undefined ||
    isNonEmptyString(value.lastCommandId);

  return (
    isNonNegativeInteger(value.rootRevision) &&
    isPlainObject(value.checksums) &&
    Object.entries(value.checksums).every(
      ([sliceName, checksum]) =>
        isNonEmptyString(sliceName) && isNonEmptyString(checksum),
    ) &&
    commandIdIsValid
  );
}

/**
 * Determines whether a value is a valid platform root envelope.
 *
 * @param {unknown} value Candidate envelope.
 * @returns {boolean} Whether the value satisfies the envelope schema.
 */
export function isPlatformEnvelope(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isSupportedSchemaVersion(value.schemaVersion) &&
    isNonNegativeInteger(value.rootRevision) &&
    isPlainObject(value.slices) &&
    isJsonCompatible(value.slices) &&
    isNonEmptyString(value.checksum)
  );
}

/**
 * Determines whether a value is valid persisted schema metadata.
 *
 * @param {unknown} value Candidate metadata.
 * @returns {boolean} Whether the value satisfies the schema metadata schema.
 */
export function isSchemaMeta(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isSupportedSchemaVersion(value.version) &&
    isNonEmptyString(value.seedVersion) &&
    isNonNegativeInteger(value.rootRevision) &&
    (value.migratedAt === null || isIsoDateTime(value.migratedAt))
  );
}

/**
 * Evaluates a predicate and returns a lightweight validation result.
 *
 * @param {(candidate: unknown) => boolean} predicate Schema predicate.
 * @param {unknown} value Candidate value.
 * @param {string} schemaName Human-readable schema name.
 * @returns {{valid: true, errors: readonly []}|{valid: false, errors: readonly string[]}}
 * Validation result.
 */
export function validateWithSchema(predicate, value, schemaName) {
  if (typeof predicate !== 'function') {
    throw new TypeError('Schema predicate must be a function.');
  }

  if (!isNonEmptyString(schemaName)) {
    throw new TypeError('Schema name must be a non-empty string.');
  }

  if (predicate(value)) {
    return Object.freeze({
      valid: true,
      errors: Object.freeze([]),
    });
  }

  return Object.freeze({
    valid: false,
    errors: Object.freeze([`${schemaName} does not satisfy its schema.`]),
  });
}

export const isPlatformRootEnvelope = isPlatformEnvelope;
export const isPlatformUser = isUser;
export const isPlatformSettings = isSettings;
export const isPlatformSession = isSession;
export const isPlatformAuditEvent = isAuditEvent;
export const isPlatformMonitoringState = isMonitoringState;
export const isPlatformRootCommitJournal = isRootCommitJournal;

export const PLATFORM_SCHEMAS = Object.freeze({
  platformEnvelope: isPlatformEnvelope,
  user: isUser,
  userCollection: isUserCollection,
  settings: isSettings,
  session: isSession,
  nullableSession: isNullableSession,
  auditEvent: isAuditEvent,
  auditEventCollection: isAuditEventCollection,
  monitoringState: isMonitoringState,
  rootCommitJournal: isRootCommitJournal,
  schemaMeta: isSchemaMeta,
});

export { PLATFORM_ROLES };