import { SCHEMA_VERSION } from '../config/constants.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';

export const CURRENT_PERSISTENCE_SCHEMA_VERSION = SCHEMA_VERSION;

export const MIGRATION_ERROR_CODES = Object.freeze({
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  MISSING_SCHEMA_VERSION: 'MISSING_SCHEMA_VERSION',
  INVALID_SCHEMA_VERSION: 'INVALID_SCHEMA_VERSION',
  FUTURE_SCHEMA_VERSION: 'FUTURE_SCHEMA_VERSION',
  UNSUPPORTED_TARGET_VERSION: 'UNSUPPORTED_TARGET_VERSION',
  MIGRATION_PATH_NOT_FOUND: 'MIGRATION_PATH_NOT_FOUND',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  INVALID_MIGRATION_RESULT: 'INVALID_MIGRATION_RESULT',
});

const VERSION_PATTERN = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/;
const ENVELOPE_METADATA_KEYS = new Set([
  'schemaVersion',
  'version',
  'rootRevision',
  'revision',
  'checksum',
  'commitMarker',
]);

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
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.INVALID_SCHEMA_VERSION,
      `${name} must be a non-negative numeric schema version.`,
      { version: value },
    );
  }

  return parsed;
}

function requireEnvelope(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.INVALID_ENVELOPE,
      'Persisted platform data must be a safe JSON-compatible object.',
    );
  }

  if (
    value.schemaVersion === undefined ||
    value.schemaVersion === null
  ) {
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.MISSING_SCHEMA_VERSION,
      'Persisted platform data does not declare a schema version.',
    );
  }

  return value;
}

function resolveLegacySlices(envelope) {
  if (isPlainObject(envelope.slices)) {
    return cloneMutable(envelope.slices);
  }

  return Object.fromEntries(
    Object.entries(envelope)
      .filter(([key]) => !ENVELOPE_METADATA_KEYS.has(key))
      .map(([key, value]) => [key, cloneMutable(value)]),
  );
}

function resolveLegacyRootRevision(envelope) {
  const revision = envelope.rootRevision ?? envelope.revision ?? 0;

  return Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : 0;
}

function canonicalizeCurrentEnvelope(envelope) {
  if (envelope.schemaVersion === SCHEMA_VERSION) {
    return cloneAndFreeze(envelope);
  }

  const {
    checksum: ignoredChecksum,
    commitMarker: ignoredCommitMarker,
    ...data
  } = cloneMutable(envelope);

  void ignoredChecksum;
  void ignoredCommitMarker;

  return cloneAndFreeze({
    ...data,
    schemaVersion: SCHEMA_VERSION,
  });
}

/**
 * Error raised when persisted state cannot be migrated safely.
 */
export class PersistenceMigrationError extends Error {
  /**
   * @param {string} code Stable migration error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured error details.
   * @param {unknown} [cause] Original migration error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PersistenceMigrationError';
    this.code = code;

    if (details !== undefined) {
      this.details = cloneAndFreeze(details);
    }
  }
}

/**
 * Migrates an unversioned v0 root shape to the current v1 root shape.
 *
 * Stale checksums and commit markers are intentionally discarded because the
 * storage gateway must create a new committed envelope after migration.
 *
 * @param {Record<string, unknown>} envelope Legacy platform data.
 * @returns {Readonly<Record<string, unknown>>} Migrated platform data.
 */
export function migrateSchema0To1(envelope) {
  if (!isPlainObject(envelope) || !isJsonCompatible(envelope)) {
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.INVALID_ENVELOPE,
      'Schema 0 platform data must be a safe JSON-compatible object.',
    );
  }

  return cloneAndFreeze({
    schemaVersion: SCHEMA_VERSION,
    rootRevision: resolveLegacyRootRevision(envelope),
    slices: resolveLegacySlices(envelope),
  });
}

export const PLATFORM_MIGRATION_REGISTRY = Object.freeze({
  0: migrateSchema0To1,
});

export const PERSISTENCE_MIGRATIONS = Object.freeze([
  Object.freeze({
    fromVersion: '0.0.0',
    toVersion: SCHEMA_VERSION,
    migrate: migrateSchema0To1,
  }),
]);

/**
 * Compares two numeric schema versions.
 *
 * @param {string|number} left Left schema version.
 * @param {string|number} right Right schema version.
 * @returns {-1|0|1} Version ordering result.
 */
export function compareSchemaVersions(left, right) {
  return compareParsedVersions(
    requireParsedVersion(left, 'Left schema version'),
    requireParsedVersion(right, 'Right schema version'),
  );
}

/**
 * Determines whether a schema version is newer than this application.
 *
 * Invalid versions are not considered future versions.
 *
 * @param {unknown} value Candidate schema version.
 * @returns {boolean} Whether the version is newer than the current schema.
 */
export function isFutureSchemaVersion(value) {
  const candidate = parseSchemaVersion(value);
  const current = parseSchemaVersion(SCHEMA_VERSION);

  return (
    candidate !== null &&
    current !== null &&
    compareParsedVersions(candidate, current) > 0
  );
}

/**
 * Determines whether persisted platform data requires migration.
 *
 * @param {unknown} value Candidate platform envelope.
 * @returns {boolean} Whether an older supported schema is declared.
 */
export function needsPlatformMigration(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  const source = parseSchemaVersion(value.schemaVersion);
  const current = parseSchemaVersion(SCHEMA_VERSION);

  return (
    source !== null &&
    current !== null &&
    compareParsedVersions(source, current) < 0
  );
}

/**
 * Resolves the sequential migration functions for a source schema.
 *
 * @param {string|number} sourceVersion Persisted schema version.
 * @param {string|number} [targetVersion] Desired schema version.
 * @returns {readonly Function[]} Ordered migration functions.
 */
export function getPlatformMigrationPath(
  sourceVersion,
  targetVersion = SCHEMA_VERSION,
) {
  const source = requireParsedVersion(
    sourceVersion,
    'Source schema version',
  );
  const target = requireParsedVersion(
    targetVersion,
    'Target schema version',
  );
  const current = requireParsedVersion(
    SCHEMA_VERSION,
    'Current schema version',
  );

  if (compareParsedVersions(source, current) > 0) {
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.FUTURE_SCHEMA_VERSION,
      `Persisted schema version ${source.canonical} is newer than supported version ${current.canonical}.`,
      {
        sourceVersion: source.canonical,
        supportedVersion: current.canonical,
      },
    );
  }

  if (compareParsedVersions(target, current) !== 0) {
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.UNSUPPORTED_TARGET_VERSION,
      `Migration target must be the current schema version ${current.canonical}.`,
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
    const migration = PLATFORM_MIGRATION_REGISTRY[major];

    if (typeof migration !== 'function') {
      throw new PersistenceMigrationError(
        MIGRATION_ERROR_CODES.MIGRATION_PATH_NOT_FOUND,
        `No migration is registered from schema version ${major}.`,
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
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.MIGRATION_PATH_NOT_FOUND,
      `No migration is registered from schema version ${source.canonical} to ${target.canonical}.`,
      {
        sourceVersion: source.canonical,
        targetVersion: target.canonical,
      },
    );
  }

  return Object.freeze(migrations);
}

/**
 * Migrates persisted platform data sequentially to the current schema.
 *
 * The source object is never mutated. Returned data is a deeply frozen clone.
 * Future schemas are refused so an older build cannot overwrite newer data.
 *
 * @param {unknown} value Persisted platform envelope.
 * @returns {Readonly<Record<string, unknown>>} Current platform data.
 */
export function migratePlatformEnvelope(value) {
  const envelope = requireEnvelope(value);
  const source = requireParsedVersion(
    envelope.schemaVersion,
    'Persisted schema version',
  );
  const current = requireParsedVersion(
    SCHEMA_VERSION,
    'Current schema version',
  );
  const comparison = compareParsedVersions(source, current);

  if (comparison > 0) {
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.FUTURE_SCHEMA_VERSION,
      `Persisted schema version ${source.canonical} is newer than supported version ${current.canonical}.`,
      {
        sourceVersion: source.canonical,
        supportedVersion: current.canonical,
      },
    );
  }

  if (comparison === 0) {
    return canonicalizeCurrentEnvelope(envelope);
  }

  const migrationPath = getPlatformMigrationPath(
    envelope.schemaVersion,
    SCHEMA_VERSION,
  );
  let migrated = cloneMutable(envelope);

  migrationPath.forEach((migration, index) => {
    try {
      migrated = migration(migrated);
    } catch (error) {
      if (error instanceof PersistenceMigrationError) {
        throw error;
      }

      throw new PersistenceMigrationError(
        MIGRATION_ERROR_CODES.MIGRATION_FAILED,
        `Platform migration step ${index + 1} failed.`,
        {
          sourceVersion: source.canonical,
          targetVersion: current.canonical,
          step: index + 1,
        },
        error,
      );
    }

    if (!isPlainObject(migrated) || !isJsonCompatible(migrated)) {
      throw new PersistenceMigrationError(
        MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
        `Platform migration step ${index + 1} returned invalid data.`,
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
    throw new PersistenceMigrationError(
      MIGRATION_ERROR_CODES.INVALID_MIGRATION_RESULT,
      'Platform migration did not produce the current schema version.',
      {
        resultVersion: migrated.schemaVersion,
        expectedVersion: current.canonical,
      },
    );
  }

  return canonicalizeCurrentEnvelope(migrated);
}

/**
 * Determines whether platform data can be migrated by this registry.
 *
 * @param {unknown} value Candidate platform envelope.
 * @returns {boolean} Whether migration or current-version normalization works.
 */
export function canMigratePlatformEnvelope(value) {
  try {
    migratePlatformEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export const MigrationError = PersistenceMigrationError;
export const MIGRATION_REGISTRY = PLATFORM_MIGRATION_REGISTRY;
export const migratePlatformState = migratePlatformEnvelope;
export const migratePersistedState = migratePlatformEnvelope;
export const migrateEnvelope = migratePlatformEnvelope;
export const getMigrationPath = getPlatformMigrationPath;
export const needsMigration = needsPlatformMigration;
export const canMigrate = canMigratePlatformEnvelope;

export default migratePlatformEnvelope;