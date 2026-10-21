import {
  isJsonCompatible,
  isPlainObject,
  isSettings,
  PLATFORM_ROLES,
} from '../validation/schemas.js';
import { browserClock } from '../time/clock.js';

export const SETTINGS_REPOSITORY_SCHEMA_VERSION = 1;
export const SETTINGS_REPOSITORY_SLICE = 'settings';

export const SETTINGS_FIELDS = Object.freeze({
  RETENTION_YEARS: 'retentionYears',
  AUTO_APPROVE_AMOUNT: 'autoApproveAmount',
  SESSION_TIMEOUT_MINUTES: 'sessionTimeoutMinutes',
  FIXTURE_VERSION: 'fixtureVersion',
  PERMITTED_ROLES: 'permittedRoles',
});

export const SETTINGS_UPDATE_FIELDS = Object.freeze([
  SETTINGS_FIELDS.RETENTION_YEARS,
  SETTINGS_FIELDS.AUTO_APPROVE_AMOUNT,
  SETTINGS_FIELDS.SESSION_TIMEOUT_MINUTES,
]);

export const SETTINGS_FIELD_PERMISSIONS = Object.freeze({
  [SETTINGS_FIELDS.RETENTION_YEARS]: Object.freeze(['ADMIN', 'ITS']),
  [SETTINGS_FIELDS.AUTO_APPROVE_AMOUNT]: Object.freeze([
    'ADMIN',
    'ITS',
  ]),
  [SETTINGS_FIELDS.SESSION_TIMEOUT_MINUTES]: Object.freeze([
    'ADMIN',
    'ITS',
  ]),
  [SETTINGS_FIELDS.FIXTURE_VERSION]: Object.freeze(['ADMIN']),
  [SETTINGS_FIELDS.PERMITTED_ROLES]: Object.freeze(['ADMIN']),
});

export const SETTINGS_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  INVALID_UPDATE: 'INVALID_UPDATE',
  INVALID_REVISION: 'INVALID_REVISION',
  INVALID_ACTOR: 'INVALID_ACTOR',
  INVALID_ROLE: 'INVALID_ROLE',
  SETTINGS_NOT_FOUND: 'SETTINGS_NOT_FOUND',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IMMUTABLE_FIELD: 'IMMUTABLE_FIELD',
  FIELD_NOT_PERMITTED: 'FIELD_NOT_PERMITTED',
});

const MUTABLE_FIELDS = new Set(SETTINGS_UPDATE_FIELDS);
const IMMUTABLE_FIELDS = new Set([
  'revision',
  'updatedAt',
  'updatedBy',
  SETTINGS_FIELDS.FIXTURE_VERSION,
  SETTINGS_FIELDS.PERMITTED_ROLES,
]);
const PLATFORM_ROLE_VALUES = new Set(PLATFORM_ROLES);

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
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'Settings repository requires a storage gateway with read() and commit().',
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

function requireRevision(value, name = 'Expected revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : value;
}

function normalizeLabels(value) {
  if (value === undefined) {
    return value;
  }

  if (!isPlainObject(value)) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
      'Settings labels must be a plain object.',
    );
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, label]) => [
      key,
      normalizeText(label),
    ]),
  );
}

function normalizePermittedRoles(value) {
  if (value === undefined) {
    return value;
  }

  if (!isPlainObject(value)) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
      'Permitted settings roles must be a plain object.',
    );
  }

  const normalized = {};

  Object.entries(value).forEach(([field, roles]) => {
    if (
      typeof field !== 'string' ||
      field.trim().length === 0 ||
      !Array.isArray(roles) ||
      roles.length === 0
    ) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
        'Each permitted settings role entry must contain at least one role.',
        { field },
      );
    }

    const normalizedRoles = roles.map((role) =>
      typeof role === 'string' ? role.trim().toUpperCase() : role,
    );

    if (
      normalizedRoles.some(
        (role) => !PLATFORM_ROLE_VALUES.has(role),
      ) ||
      new Set(normalizedRoles).size !== normalizedRoles.length
    ) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
        'Permitted settings roles must contain unique supported roles.',
        { field },
      );
    }

    normalized[field.trim()] = normalizedRoles;
  });

  return normalized;
}

function normalizeSettings(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
      'Settings must be a safe JSON-compatible object.',
    );
  }

  const normalized = {
    ...value,
    updatedBy:
      typeof value.updatedBy === 'string'
        ? normalizeText(value.updatedBy)
        : value.updatedBy,
    updatedAt:
      typeof value.updatedAt === 'string'
        ? normalizeText(value.updatedAt)
        : value.updatedAt,
  };

  if (value.labels !== undefined) {
    normalized.labels = normalizeLabels(value.labels);
  }

  if (value.fixtureVersion !== undefined) {
    normalized.fixtureVersion = normalizeText(value.fixtureVersion);

    if (
      typeof normalized.fixtureVersion !== 'string' ||
      normalized.fixtureVersion.length === 0
    ) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
        'Settings fixture version must be a non-empty string.',
      );
    }
  }

  if (value.permittedRoles !== undefined) {
    normalized.permittedRoles = normalizePermittedRoles(
      value.permittedRoles,
    );
  }

  if (!isSettings(normalized)) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
      'Settings do not satisfy their schema.',
    );
  }

  return deepFreeze(normalized);
}

function readSettings(envelope, sliceName) {
  if (envelope === null) {
    return null;
  }

  const settings = isPlainObject(envelope.slices)
    ? envelope.slices[sliceName]
    : undefined;

  if (settings === undefined || settings === null) {
    return null;
  }

  try {
    return normalizeSettings(settings);
  } catch (error) {
    if (error instanceof SettingsRepositoryError) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.INVALID_SETTINGS,
        'Persisted settings do not satisfy their schema.',
        { sliceName },
      );
    }

    throw error;
  }
}

function buildNextState(envelope, sliceName, settings) {
  const currentSlices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...currentSlices,
      [sliceName]: settings,
    },
  };
}

function requireExpectedEntityRevision(options) {
  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'Settings mutation options must be an object or revision.',
    );
  }

  if (
    options.expectedRevision === undefined ||
    options.expectedRevision === null
  ) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
      'Expected settings revision is required.',
    );
  }

  return requireRevision(options.expectedRevision);
}

function resolveExpectedRootRevision(options, currentRevision) {
  if (!isPlainObject(options)) {
    return currentRevision;
  }

  const expectedRootRevision =
    options.expectedRootRevision ?? options.rootRevision;

  if (
    expectedRootRevision === undefined ||
    expectedRootRevision === null
  ) {
    return currentRevision;
  }

  const normalized = requireRevision(
    expectedRootRevision,
    'Expected root revision',
  );

  if (normalized !== currentRevision) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted settings changed before the mutation.',
      {
        expectedRevision: normalized,
        actualRevision: currentRevision,
      },
    );
  }

  return normalized;
}

function assertSettingsRevision(settings, expectedRevision) {
  if (settings.revision !== expectedRevision) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Settings changed before the mutation.',
      {
        expectedRevision,
        actualRevision: settings.revision,
      },
    );
  }
}

function normalizeUpdate(changes) {
  if (!isPlainObject(changes) || !isJsonCompatible(changes)) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Settings changes must be a safe plain object.',
    );
  }

  const keys = Object.keys(changes);

  if (keys.length === 0) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Settings changes must include at least one editable field.',
    );
  }

  keys.forEach((key) => {
    if (IMMUTABLE_FIELDS.has(key)) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.IMMUTABLE_FIELD,
        `Settings field ${key} is immutable.`,
        { field: key },
      );
    }

    if (!MUTABLE_FIELDS.has(key)) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
        `Settings field ${key} cannot be updated.`,
        { field: key },
      );
    }
  });

  return { ...changes };
}

function normalizeActor(options, currentSettings) {
  if (!isPlainObject(options)) {
    return currentSettings.updatedBy ?? 'system';
  }

  const actor =
    options.updatedBy ?? options.actorId ?? currentSettings.updatedBy;

  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_ACTOR,
      'Settings updater must be a non-empty string.',
    );
  }

  return normalizeText(actor);
}

function normalizeActorRole(options) {
  if (
    !isPlainObject(options) ||
    options.actorRole === undefined ||
    options.actorRole === null
  ) {
    return null;
  }

  if (typeof options.actorRole !== 'string') {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_ROLE,
      'Settings actor role must be a supported platform role.',
    );
  }

  const role = options.actorRole.trim().toUpperCase();

  if (!PLATFORM_ROLE_VALUES.has(role)) {
    throw new SettingsRepositoryError(
      SETTINGS_REPOSITORY_ERROR_CODES.INVALID_ROLE,
      'Settings actor role must be a supported platform role.',
      { role: options.actorRole },
    );
  }

  return role;
}

function requireFieldPermissions(changes, options, settings) {
  const actorRole = normalizeActorRole(options);

  if (actorRole === null) {
    return;
  }

  const configuredPermissions = isPlainObject(settings.permittedRoles)
    ? settings.permittedRoles
    : SETTINGS_FIELD_PERMISSIONS;

  Object.keys(changes).forEach((field) => {
    const allowedRoles =
      configuredPermissions[field] ??
      SETTINGS_FIELD_PERMISSIONS[field] ??
      [];

    if (!allowedRoles.includes(actorRole)) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.FIELD_NOT_PERMITTED,
        `Role ${actorRole} cannot update settings field ${field}.`,
        {
          field,
          role: actorRole,
          allowedRoles,
        },
      );
    }
  });
}

function getCurrentTimestamp(clock) {
  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    return clock.nowIso();
  }

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    const value = clock.now();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  if (typeof clock === 'function') {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  throw new TypeError(
    'Settings repository clock must provide a valid current timestamp.',
  );
}

/**
 * Error raised when settings repository data or operations are invalid.
 */
export class SettingsRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'SettingsRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Revision-safe repository for browser-local demonstration settings.
 */
export class SettingsRepository {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or repository options containing `gateway` or `storageGateway`.
   * @param {{
   *   sliceName?: string,
   *   clock?: object|Function
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
        : SETTINGS_REPOSITORY_SLICE;
    this.clock = normalizedOptions.clock ?? browserClock;
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
   * Returns persisted settings.
   *
   * @returns {Readonly<Record<string, unknown>>|null} Settings or null.
   */
  get() {
    return readSettings(this.gateway.read(), this.sliceName);
  }

  /**
   * Returns a versioned settings repository snapshot.
   *
   * @returns {Readonly<Record<string, unknown>>} Settings snapshot.
   */
  getSnapshot() {
    const envelope = this.gateway.read();

    return deepFreeze({
      schemaVersion: SETTINGS_REPOSITORY_SCHEMA_VERSION,
      revision: envelope?.rootRevision ?? 0,
      settings: readSettings(envelope, this.sliceName),
    });
  }

  /**
   * Updates editable settings using entity and root revision validation.
   *
   * @param {Record<string, unknown>} changes Editable settings changes.
   * @param {number|{
   *   expectedRevision: number,
   *   expectedRootRevision?: number,
   *   updatedBy?: string,
   *   actorId?: string,
   *   actorRole?: string
   * }} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Updated settings.
   */
  update(changes, options = {}) {
    const expectedRevision = requireExpectedEntityRevision(options);
    const normalizedChanges = normalizeUpdate(changes);
    const envelope = this.gateway.read();
    const currentRootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      currentRootRevision,
    );
    const current = readSettings(envelope, this.sliceName);

    if (current === null) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.SETTINGS_NOT_FOUND,
        'Settings were not found.',
      );
    }

    assertSettingsRevision(current, expectedRevision);
    requireFieldPermissions(normalizedChanges, options, current);

    const updated = normalizeSettings({
      ...current,
      ...normalizedChanges,
      updatedBy: normalizeActor(options, current),
      updatedAt: getCurrentTimestamp(this.clock),
      revision: current.revision + 1,
    });

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, updated),
      {},
    );

    return updated;
  }

  /**
   * Replaces all settings using root revision validation.
   *
   * Supports `replace(expectedRootRevision, settings)` and
   * `replace(settings, { expectedRootRevision })`.
   *
   * @param {number|Record<string, unknown>} expectedRevisionOrSettings Root
   * revision or replacement settings.
   * @param {Record<string, unknown>} [settingsOrOptions] Settings or options.
   * @returns {Readonly<Record<string, unknown>>} Stored settings.
   */
  replace(expectedRevisionOrSettings, settingsOrOptions) {
    let expectedRootRevision;
    let replacementSettings;

    if (isPlainObject(expectedRevisionOrSettings)) {
      replacementSettings = expectedRevisionOrSettings;

      if (
        !isPlainObject(settingsOrOptions) ||
        settingsOrOptions.expectedRootRevision === undefined
      ) {
        throw new SettingsRepositoryError(
          SETTINGS_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
          'Expected root revision is required when replacing settings.',
        );
      }

      expectedRootRevision = requireRevision(
        settingsOrOptions.expectedRootRevision,
        'Expected root revision',
      );
    } else {
      expectedRootRevision = requireRevision(
        expectedRevisionOrSettings,
        'Expected root revision',
      );
      replacementSettings = settingsOrOptions;
    }

    const settings = normalizeSettings(replacementSettings);
    const envelope = this.gateway.read();
    const currentRevision = envelope?.rootRevision ?? 0;

    if (expectedRootRevision !== currentRevision) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
        'Persisted settings changed before replacement.',
        {
          expectedRevision: expectedRootRevision,
          actualRevision: currentRevision,
        },
      );
    }

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, settings),
      {},
    );

    return settings;
  }

  /**
   * Restores validated default settings while advancing entity revision.
   *
   * @param {Record<string, unknown>} defaults Default settings values.
   * @param {number|{
   *   expectedRevision: number,
   *   expectedRootRevision?: number,
   *   updatedBy?: string,
   *   actorId?: string
   * }} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Restored settings.
   */
  restore(defaults, options = {}) {
    const expectedRevision = requireExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const currentRootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      currentRootRevision,
    );
    const current = readSettings(envelope, this.sliceName);

    if (current === null) {
      throw new SettingsRepositoryError(
        SETTINGS_REPOSITORY_ERROR_CODES.SETTINGS_NOT_FOUND,
        'Settings were not found.',
      );
    }

    assertSettingsRevision(current, expectedRevision);

    const candidate = normalizeSettings(defaults);
    const restored = normalizeSettings({
      ...candidate,
      revision: current.revision + 1,
      updatedBy: normalizeActor(options, current),
      updatedAt: getCurrentTimestamp(this.clock),
    });

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, restored),
      {},
    );

    return restored;
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
        'Settings repository listener must be a function.',
      );
    }

    if (typeof this.gateway.subscribe !== 'function') {
      return () => {};
    }

    return this.gateway.subscribe(listener);
  }

  load() {
    return this.getSnapshot();
  }

  getSettings() {
    return this.get();
  }

  updateSettings(changes, options = {}) {
    return this.update(changes, options);
  }

  replaceAll(expectedRevisionOrSettings, settingsOrOptions) {
    return this.replace(
      expectedRevisionOrSettings,
      settingsOrOptions,
    );
  }

  replaceSettings(expectedRevisionOrSettings, settingsOrOptions) {
    return this.replace(
      expectedRevisionOrSettings,
      settingsOrOptions,
    );
  }

  restoreDefaults(defaults, options = {}) {
    return this.restore(defaults, options);
  }

  reset(defaults, options = {}) {
    return this.restore(defaults, options);
  }
}

/**
 * Creates a settings repository.
 *
 * @param {ConstructorParameters<typeof SettingsRepository>[0]}
 * gatewayOrOptions Gateway or repository options.
 * @param {ConstructorParameters<typeof SettingsRepository>[1]} [options]
 * Repository options.
 * @returns {SettingsRepository} Settings repository.
 */
export function createSettingsRepository(
  gatewayOrOptions,
  options = {},
) {
  return new SettingsRepository(gatewayOrOptions, options);
}

export const LocalSettingsRepository = SettingsRepository;
export const PlatformSettingsRepository = SettingsRepository;
export const createLocalSettingsRepository =
  createSettingsRepository;

export default SettingsRepository;