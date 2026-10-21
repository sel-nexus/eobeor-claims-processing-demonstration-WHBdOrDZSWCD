import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';

export const CURRENT_OPERATIONS_SCHEMA_VERSION = 1;

export const OPERATIONS_MIGRATION_ERROR_CODES = Object.freeze({
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  MISSING_SCHEMA_VERSION: 'MISSING_SCHEMA_VERSION',
  INVALID_SCHEMA_VERSION: 'INVALID_SCHEMA_VERSION',
  FUTURE_SCHEMA_VERSION: 'FUTURE_SCHEMA_VERSION',
  UNSUPPORTED_TARGET_VERSION: 'UNSUPPORTED_TARGET_VERSION',
  MIGRATION_PATH_NOT_FOUND: 'MIGRATION_PATH_NOT_FOUND',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  INVALID_MIGRATION_RESULT: 'INVALID_MIGRATION_RESULT',
});

const VERSION_PATTERN =
  /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/;
const DEFAULT_COMMIT_ID = '00000000-0000-4000-8000-000000000000';
const DEFAULT_UPDATED_AT = '1970-01-01T00:00:00.000Z';

function cloneAndFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item)));
  }

  if (isPlainObject(value)) {
    const clone = {};

    Object.entries(value).forEach(([key, item]) => {
      clone[key] = cloneAndFreeze(item);
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

function parseSchemaVersion(value) {
  const source =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value;

  if (typeof source !== 'string') {
    return null;
  }

  const match = VERSION_PATTERN.exec(source.trim());

  if (match === null) {
    return null;
  }

  const parts = [
    Number(match[1]),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ];

  if (!parts.every(Number.isSafeInteger)) {
    return null;
  }

  return Object.freeze({
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    canonical: parts.join('.'),
  });
}

function compareParsedVersions(left, right) {
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }

  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }

  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }

  return 0;
}

function requireParsedVersion(value, name) {
  const parsed = parseSchemaVersion(value);

  if (parsed === null) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.INVALID_SCHEMA_VERSION,
      `${name} must be a non-negative numeric schema version.`,
      { version: value },
    );
  }

  return parsed;
}

function requireEnvelope(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.INVALID_ENVELOPE,
      'Persisted operations data must be a safe JSON-compatible object.',
    );
  }

  if (
    value.schemaVersion === undefined ||
    value.schemaVersion === null
  ) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.MISSING_SCHEMA_VERSION,
      'Persisted operations data does not declare a schema version.',
    );
  }

  return value;
}

function getNestedValue(value, path) {
  let current = value;

  for (const property of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    current = current[property];

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

function resolveFirstValue(envelope, paths) {
  for (const path of paths) {
    const value = getNestedValue(envelope, path);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function resolveEntityKey(entity, keyNames) {
  if (!isPlainObject(entity)) {
    return null;
  }

  for (const keyName of keyNames) {
    const value = entity[keyName];

    if (
      (typeof value === 'string' && value.trim().length > 0) ||
      (Number.isSafeInteger(value) && value >= 0)
    ) {
      return String(value);
    }
  }

  return null;
}

function normalizeCollection(value, keyNames, collectionName) {
  if (value === undefined) {
    return {};
  }

  if (isPlainObject(value)) {
    return cloneMutable(value);
  }

  if (!Array.isArray(value)) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
      `${collectionName} must be an object map or an array.`,
      { collection: collectionName },
    );
  }

  const collection = {};

  value.forEach((entity, index) => {
    const key = resolveEntityKey(entity, keyNames);

    if (key === null) {
      throw new OperationsMigrationError(
        OPERATIONS_MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
        `${collectionName} entry ${index} does not have a valid identifier.`,
        {
          collection: collectionName,
          index,
          acceptedKeyNames: keyNames,
        },
      );
    }

    if (Object.prototype.hasOwnProperty.call(collection, key)) {
      throw new OperationsMigrationError(
        OPERATIONS_MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
        `${collectionName} contains a duplicate identifier.`,
        {
          collection: collectionName,
          identifier: key,
        },
      );
    }

    collection[key] = cloneMutable(entity);
  });

  return collection;
}

function resolveCollection(
  envelope,
  paths,
  keyNames,
  collectionName,
) {
  return normalizeCollection(
    resolveFirstValue(envelope, paths),
    keyNames,
    collectionName,
  );
}

function resolveRevision(envelope) {
  const revision =
    envelope.revision ??
    envelope.rootRevision ??
    envelope.operationsRevision ??
    0;

  return Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : 0;
}

function resolveCommitId(envelope) {
  const commitId =
    envelope.commitId ??
    envelope.commit?.commitId ??
    envelope.metadata?.commitId;

  return typeof commitId === 'string' && commitId.trim().length > 0
    ? commitId.trim()
    : DEFAULT_COMMIT_ID;
}

function resolveUpdatedAt(envelope) {
  const updatedAt =
    envelope.updatedAt ??
    envelope.lastUpdatedAt ??
    envelope.metadata?.updatedAt;

  return typeof updatedAt === 'string' && updatedAt.trim().length > 0
    ? updatedAt.trim()
    : DEFAULT_UPDATED_AT;
}

function canonicalizeCurrentEnvelope(envelope) {
  const {
    checksum: ignoredChecksum,
    commitMarker: ignoredCommitMarker,
    rootRevision: ignoredRootRevision,
    operationsRevision: ignoredOperationsRevision,
    ...data
  } = cloneMutable(envelope);

  void ignoredChecksum;
  void ignoredCommitMarker;
  void ignoredRootRevision;
  void ignoredOperationsRevision;

  return cloneAndFreeze({
    ...data,
    schemaVersion: CURRENT_OPERATIONS_SCHEMA_VERSION,
  });
}

/**
 * Error raised when operations state cannot be migrated safely.
 */
export class OperationsMigrationError extends Error {
  /**
   * @param {string} code Stable migration error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original migration error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OperationsMigrationError';
    this.code = code;

    if (details !== undefined) {
      this.details = cloneAndFreeze(details);
    }
  }
}

/**
 * Migrates legacy schema-zero operations stores into the canonical operations
 * envelope.
 *
 * Legacy collections may be object maps or arrays and may be grouped under
 * request, result, document, operations, outbound, or CDC stores. Input data
 * is never mutated.
 *
 * @param {Record<string, unknown>} envelope Legacy operations data.
 * @returns {Readonly<Record<string, unknown>>} Migrated operations envelope.
 */
export function migrateOperationsSchema0To1(envelope) {
  if (!isPlainObject(envelope) || !isJsonCompatible(envelope)) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.INVALID_ENVELOPE,
      'Schema 0 operations data must be a safe JSON-compatible object.',
    );
  }

  const requests = resolveCollection(
    envelope,
    [
      ['requests'],
      ['reprintRequests'],
      ['requestStore', 'requests'],
      ['requestStore', 'reprintRequests'],
      ['stores', 'requests'],
    ],
    ['requestId', 'id'],
    'requests',
  );
  const pipelineRuns = resolveCollection(
    envelope,
    [
      ['pipelineRuns'],
      ['runs'],
      ['resultStore', 'pipelineRuns'],
      ['resultStore', 'runs'],
      ['results', 'pipelineRuns'],
      ['stores', 'pipelineRuns'],
    ],
    ['runId', 'id'],
    'pipelineRuns',
  );
  const documents = resolveCollection(
    envelope,
    [
      ['documents'],
      ['documentVersions'],
      ['documentStore', 'documents'],
      ['documentStore', 'documentVersions'],
      ['stores', 'documents'],
    ],
    ['documentId', 'id'],
    'documents',
  );
  const inboundRuns = resolveCollection(
    envelope,
    [
      ['inboundRuns'],
      ['operations', 'inboundRuns'],
      ['operationsStore', 'inboundRuns'],
      ['stores', 'inboundRuns'],
    ],
    ['feedRunId', 'runId', 'id'],
    'inboundRuns',
  );
  const batchRuns = resolveCollection(
    envelope,
    [
      ['batchRuns'],
      ['operations', 'batchRuns'],
      ['operationsStore', 'batchRuns'],
      ['stores', 'batchRuns'],
    ],
    ['batchId', 'runId', 'id'],
    'batchRuns',
  );
  const reviews = resolveCollection(
    envelope,
    [
      ['reviews'],
      ['manualReviews'],
      ['operations', 'reviews'],
      ['operations', 'manualReviews'],
      ['operationsStore', 'reviews'],
      ['stores', 'reviews'],
    ],
    ['reviewId', 'id'],
    'reviews',
  );
  const errorReports = resolveCollection(
    envelope,
    [
      ['errorReports'],
      ['operations', 'errorReports'],
      ['operationsStore', 'errorReports'],
      ['resultStore', 'errorReports'],
      ['stores', 'errorReports'],
    ],
    ['errorReportId', 'reportId', 'id'],
    'errorReports',
  );
  const outboundRecords = resolveCollection(
    envelope,
    [
      ['outboundRecords'],
      ['outbound'],
      ['outboundStore', 'records'],
      ['outboundStore', 'outboundRecords'],
      ['stores', 'outboundRecords'],
    ],
    ['outboundId', 'id'],
    'outboundRecords',
  );
  const idempotencyResults = resolveCollection(
    envelope,
    [
      ['idempotencyResults'],
      ['idempotencyRecords'],
      ['resultStore', 'idempotencyResults'],
      ['resultStore', 'idempotencyRecords'],
      ['results', 'idempotencyResults'],
      ['stores', 'idempotencyResults'],
    ],
    ['idempotencyKey', 'id'],
    'idempotencyResults',
  );
  const cdcEvents = resolveCollection(
    envelope,
    [
      ['cdcEvents'],
      ['cdc'],
      ['cdcStore', 'events'],
      ['cdcStore', 'cdcEvents'],
      ['operations', 'cdcEvents'],
      ['stores', 'cdcEvents'],
    ],
    ['cdcEventId', 'eventId', 'id'],
    'cdcEvents',
  );

  return cloneAndFreeze({
    schemaVersion: CURRENT_OPERATIONS_SCHEMA_VERSION,
    revision: resolveRevision(envelope),
    commitId: resolveCommitId(envelope),
    updatedAt: resolveUpdatedAt(envelope),
    requests,
    pipelineRuns,
    documents,
    inboundRuns,
    batchRuns,
    reviews,
    errorReports,
    outboundRecords,
    idempotencyResults,
    cdcEvents,
  });
}

export const OPERATIONS_MIGRATION_REGISTRY = Object.freeze({
  0: migrateOperationsSchema0To1,
});

export const OPERATIONS_MIGRATIONS = Object.freeze([
  Object.freeze({
    fromVersion: '0.0.0',
    toVersion: String(CURRENT_OPERATIONS_SCHEMA_VERSION),
    migrate: migrateOperationsSchema0To1,
  }),
]);

/**
 * Compares two numeric operations schema versions.
 *
 * @param {string|number} left Left schema version.
 * @param {string|number} right Right schema version.
 * @returns {-1|0|1} Version ordering result.
 */
export function compareOperationsSchemaVersions(left, right) {
  return compareParsedVersions(
    requireParsedVersion(left, 'Left operations schema version'),
    requireParsedVersion(right, 'Right operations schema version'),
  );
}

/**
 * Determines whether an operations schema version is newer than the version
 * supported by this application.
 *
 * @param {unknown} value Candidate schema version.
 * @returns {boolean} Whether the version is newer.
 */
export function isFutureOperationsSchemaVersion(value) {
  const candidate = parseSchemaVersion(value);
  const current = parseSchemaVersion(
    CURRENT_OPERATIONS_SCHEMA_VERSION,
  );

  return (
    candidate !== null &&
    current !== null &&
    compareParsedVersions(candidate, current) > 0
  );
}

/**
 * Determines whether persisted operations data requires migration.
 *
 * @param {unknown} value Candidate operations envelope.
 * @returns {boolean} Whether an older supported schema is declared.
 */
export function needsOperationsMigration(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  const source = parseSchemaVersion(value.schemaVersion);
  const current = parseSchemaVersion(
    CURRENT_OPERATIONS_SCHEMA_VERSION,
  );

  return (
    source !== null &&
    current !== null &&
    compareParsedVersions(source, current) < 0
  );
}

/**
 * Resolves the sequential operations migration functions for a source schema.
 *
 * @param {string|number} sourceVersion Persisted schema version.
 * @param {string|number} [targetVersion] Desired schema version.
 * @returns {readonly Function[]} Ordered migration functions.
 */
export function getOperationsMigrationPath(
  sourceVersion,
  targetVersion = CURRENT_OPERATIONS_SCHEMA_VERSION,
) {
  const source = requireParsedVersion(
    sourceVersion,
    'Source operations schema version',
  );
  const target = requireParsedVersion(
    targetVersion,
    'Target operations schema version',
  );
  const current = requireParsedVersion(
    CURRENT_OPERATIONS_SCHEMA_VERSION,
    'Current operations schema version',
  );

  if (compareParsedVersions(source, current) > 0) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.FUTURE_SCHEMA_VERSION,
      `Persisted operations schema version ${source.canonical} is newer than supported version ${current.canonical}.`,
      {
        sourceVersion: source.canonical,
        supportedVersion: current.canonical,
      },
    );
  }

  if (compareParsedVersions(target, current) !== 0) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.UNSUPPORTED_TARGET_VERSION,
      `Operations migration target must be the current schema version ${current.canonical}.`,
      {
        targetVersion: target.canonical,
        supportedVersion: current.canonical,
      },
    );
  }

  if (compareParsedVersions(source, target) === 0) {
    return Object.freeze([]);
  }

  const migrations = [];

  for (
    let major = source.major;
    major < target.major;
    major += 1
  ) {
    const migration = OPERATIONS_MIGRATION_REGISTRY[major];

    if (typeof migration !== 'function') {
      throw new OperationsMigrationError(
        OPERATIONS_MIGRATION_ERROR_CODES.MIGRATION_PATH_NOT_FOUND,
        `No operations migration is registered from schema version ${major}.`,
        {
          sourceVersion: source.canonical,
          targetVersion: target.canonical,
          missingFromVersion: major,
        },
      );
    }

    migrations.push(migration);
  }

  if (source.major === target.major) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.MIGRATION_PATH_NOT_FOUND,
      `No operations migration is registered from schema version ${source.canonical} to ${target.canonical}.`,
      {
        sourceVersion: source.canonical,
        targetVersion: target.canonical,
      },
    );
  }

  return Object.freeze(migrations);
}

/**
 * Migrates persisted operations data to the current schema.
 *
 * Future schemas are refused so an older application build cannot overwrite
 * newer state. The source object is never mutated and the result is deeply
 * frozen.
 *
 * @param {unknown} value Persisted operations envelope.
 * @returns {Readonly<Record<string, unknown>>} Current operations envelope.
 */
export function migrateOperationsEnvelope(value) {
  const envelope = requireEnvelope(value);
  const source = requireParsedVersion(
    envelope.schemaVersion,
    'Persisted operations schema version',
  );
  const current = requireParsedVersion(
    CURRENT_OPERATIONS_SCHEMA_VERSION,
    'Current operations schema version',
  );
  const comparison = compareParsedVersions(source, current);

  if (comparison > 0) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.FUTURE_SCHEMA_VERSION,
      `Persisted operations schema version ${source.canonical} is newer than supported version ${current.canonical}.`,
      {
        sourceVersion: source.canonical,
        supportedVersion: current.canonical,
      },
    );
  }

  if (comparison === 0) {
    return canonicalizeCurrentEnvelope(envelope);
  }

  const migrationPath = getOperationsMigrationPath(
    envelope.schemaVersion,
    CURRENT_OPERATIONS_SCHEMA_VERSION,
  );
  let migrated = cloneMutable(envelope);

  migrationPath.forEach((migration, index) => {
    try {
      migrated = migration(migrated);
    } catch (error) {
      if (error instanceof OperationsMigrationError) {
        throw error;
      }

      throw new OperationsMigrationError(
        OPERATIONS_MIGRATION_ERROR_CODES.MIGRATION_FAILED,
        `Operations migration step ${index + 1} failed.`,
        {
          sourceVersion: source.canonical,
          targetVersion: current.canonical,
          step: index + 1,
        },
        error,
      );
    }

    if (!isPlainObject(migrated) || !isJsonCompatible(migrated)) {
      throw new OperationsMigrationError(
        OPERATIONS_MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
        `Operations migration step ${index + 1} returned invalid data.`,
        {
          sourceVersion: source.canonical,
          targetVersion: current.canonical,
          step: index + 1,
        },
      );
    }
  });

  const resultVersion = parseSchemaVersion(migrated.schemaVersion);

  if (
    resultVersion === null ||
    compareParsedVersions(resultVersion, current) !== 0
  ) {
    throw new OperationsMigrationError(
      OPERATIONS_MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
      'Operations migration did not produce the current schema version.',
      {
        resultVersion: migrated.schemaVersion,
        expectedVersion: current.canonical,
      },
    );
  }

  return canonicalizeCurrentEnvelope(migrated);
}

/**
 * Determines whether operations data can be migrated by this registry.
 *
 * @param {unknown} value Candidate operations envelope.
 * @returns {boolean} Whether migration or current-version normalization works.
 */
export function canMigrateOperationsEnvelope(value) {
  try {
    migrateOperationsEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export const OperationsPersistenceMigrationError =
  OperationsMigrationError;
export const MigrationError = OperationsMigrationError;
export const MIGRATION_ERROR_CODES =
  OPERATIONS_MIGRATION_ERROR_CODES;
export const MIGRATION_REGISTRY = OPERATIONS_MIGRATION_REGISTRY;
export const migrateSchema0To1 = migrateOperationsSchema0To1;
export const migrateOperationsState = migrateOperationsEnvelope;
export const migratePersistedOperationsState =
  migrateOperationsEnvelope;
export const migrateEnvelope = migrateOperationsEnvelope;
export const getMigrationPath = getOperationsMigrationPath;
export const needsMigration = needsOperationsMigration;
export const canMigrate = canMigrateOperationsEnvelope;

export default migrateOperationsEnvelope;