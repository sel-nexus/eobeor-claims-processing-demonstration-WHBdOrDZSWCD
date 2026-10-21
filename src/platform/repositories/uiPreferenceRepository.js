import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';
import { browserClock } from '../time/clock.js';

export const UI_PREFERENCE_REPOSITORY_SCHEMA_VERSION = 1;
export const UI_PREFERENCE_REPOSITORY_SLICE = 'uiPreferences';
export const UI_PREFERENCE_REPOSITORY_LEGACY_SLICE = 'ui';

export const UI_PREFERENCE_FIELDS = Object.freeze({
  THEME: 'theme',
  REDUCED_MOTION: 'reducedMotion',
  DEFAULT_PAGE_SIZE: 'defaultPageSize',
  MONITORING_DARK_MODE: 'monitoringDarkMode',
  DASHBOARD: 'dashboard',
  MONITORING: 'monitoring',
  DOCUMENTS: 'documents',
});

export const UI_PREFERENCE_THEMES = Object.freeze([
  'system',
  'light',
  'dark',
]);

export const UI_PREFERENCE_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_PREFERENCES: 'INVALID_PREFERENCES',
  INVALID_UPDATE: 'INVALID_UPDATE',
  INVALID_REVISION: 'INVALID_REVISION',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IMMUTABLE_FIELD: 'IMMUTABLE_FIELD',
  SENSITIVE_FIELD: 'SENSITIVE_FIELD',
});

const UI_PREFERENCE_THEME_VALUES = new Set(UI_PREFERENCE_THEMES);
const SLICE_ALIASES = Object.freeze([
  UI_PREFERENCE_REPOSITORY_SLICE,
  UI_PREFERENCE_REPOSITORY_LEGACY_SLICE,
  'preferences',
]);

const MUTABLE_FIELDS = new Set(Object.values(UI_PREFERENCE_FIELDS));
const IMMUTABLE_FIELDS = new Set([
  'revision',
  'updatedAt',
  'updatedBy',
]);

const BLOCKED_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const SENSITIVE_KEY_PARTS = Object.freeze([
  'account',
  'address',
  'apikey',
  'authorization',
  'card',
  'claim',
  'cookie',
  'credential',
  'diagnosis',
  'email',
  'member',
  'mfa',
  'password',
  'patient',
  'payment',
  'phone',
  'procedure',
  'secret',
  'session',
  'ssn',
  'token',
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

export const DEFAULT_UI_PREFERENCES = deepFreeze({
  theme: 'system',
  reducedMotion: false,
  defaultPageSize: 10,
  monitoringDarkMode: false,
  dashboard: {
    compactTables: false,
    showFixtureDisclosures: true,
    showRepresentativeCharts: true,
  },
  monitoring: {
    autoRefresh: false,
    refreshIntervalSeconds: 30,
    showAcknowledgedAlerts: true,
  },
  documents: {
    openDownloadsInNewTab: true,
    showDownloadNotice: true,
  },
  revision: 0,
  updatedAt: null,
});

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'UI preference repository requires a storage gateway with read() and commit().',
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
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function normalizeFieldName(value) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function isSensitiveFieldName(value) {
  const normalized = normalizeFieldName(value);

  return SENSITIVE_KEY_PARTS.some(
    (part) => normalized === part || normalized.includes(part),
  );
}

function assertSafePreferenceKeys(value, path = 'preferences') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafePreferenceKeys(item, `${path}[${index}]`);
    });
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  Object.entries(value).forEach(([key, item]) => {
    if (BLOCKED_PROPERTY_NAMES.has(key)) {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_PREFERENCES,
        `UI preferences contain a prohibited property: ${key}.`,
        { path: `${path}.${key}` },
      );
    }

    if (isSensitiveFieldName(key)) {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.SENSITIVE_FIELD,
        `Sensitive field ${key} cannot be stored as a UI preference.`,
        { path: `${path}.${key}` },
      );
    }

    assertSafePreferenceKeys(item, `${path}.${key}`);
  });
}

function hasOnlyBooleanFields(value, fields) {
  return (
    isPlainObject(value) &&
    Object.keys(value).every((key) => fields.includes(key)) &&
    fields.every(
      (key) =>
        value[key] === undefined || typeof value[key] === 'boolean',
    )
  );
}

function isDashboardPreferences(value) {
  return hasOnlyBooleanFields(value, [
    'compactTables',
    'showFixtureDisclosures',
    'showRepresentativeCharts',
  ]);
}

function isMonitoringPreferences(value) {
  if (
    !isPlainObject(value) ||
    !Object.keys(value).every((key) =>
      [
        'autoRefresh',
        'refreshIntervalSeconds',
        'showAcknowledgedAlerts',
        'monitoringDarkMode',
      ].includes(key),
    )
  ) {
    return false;
  }

  return (
    (value.autoRefresh === undefined ||
      typeof value.autoRefresh === 'boolean') &&
    (value.showAcknowledgedAlerts === undefined ||
      typeof value.showAcknowledgedAlerts === 'boolean') &&
    (value.monitoringDarkMode === undefined ||
      typeof value.monitoringDarkMode === 'boolean') &&
    (value.refreshIntervalSeconds === undefined ||
      (Number.isSafeInteger(value.refreshIntervalSeconds) &&
        value.refreshIntervalSeconds >= 30 &&
        value.refreshIntervalSeconds <= 3600))
  );
}

function isDocumentPreferences(value) {
  return hasOnlyBooleanFields(value, [
    'openDownloadsInNewTab',
    'showDownloadNotice',
  ]);
}

/**
 * Determines whether a value is valid non-sensitive UI preference data.
 *
 * @param {unknown} value Candidate UI preferences.
 * @returns {boolean} Whether the value satisfies the preference schema.
 */
export function isUiPreferences(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  try {
    assertSafePreferenceKeys(value);
  } catch {
    return false;
  }

  const allowedFields = new Set([
    ...MUTABLE_FIELDS,
    ...IMMUTABLE_FIELDS,
  ]);

  if (!Object.keys(value).every((key) => allowedFields.has(key))) {
    return false;
  }

  return (
    (value.theme === undefined ||
      UI_PREFERENCE_THEME_VALUES.has(value.theme)) &&
    (value.reducedMotion === undefined ||
      typeof value.reducedMotion === 'boolean') &&
    (value.defaultPageSize === undefined ||
      (Number.isSafeInteger(value.defaultPageSize) &&
        value.defaultPageSize >= 1 &&
        value.defaultPageSize <= 100)) &&
    (value.monitoringDarkMode === undefined ||
      typeof value.monitoringDarkMode === 'boolean') &&
    (value.dashboard === undefined ||
      isDashboardPreferences(value.dashboard)) &&
    (value.monitoring === undefined ||
      isMonitoringPreferences(value.monitoring)) &&
    (value.documents === undefined ||
      isDocumentPreferences(value.documents)) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    (value.updatedAt === undefined ||
      value.updatedAt === null ||
      (typeof value.updatedAt === 'string' &&
        Number.isFinite(Date.parse(value.updatedAt)))) &&
    (value.updatedBy === undefined ||
      value.updatedBy === null ||
      (typeof value.updatedBy === 'string' &&
        value.updatedBy.trim().length > 0))
  );
}

function normalizePreferences(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_PREFERENCES,
      'UI preferences must be a safe JSON-compatible object.',
    );
  }

  assertSafePreferenceKeys(value);

  const normalized = {
    ...value,
    theme:
      typeof value.theme === 'string'
        ? value.theme.trim().toLowerCase()
        : value.theme,
    updatedBy:
      typeof value.updatedBy === 'string'
        ? value.updatedBy.normalize('NFC').trim()
        : value.updatedBy,
    updatedAt:
      typeof value.updatedAt === 'string'
        ? value.updatedAt.trim()
        : value.updatedAt,
  };

  if (!isUiPreferences(normalized)) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_PREFERENCES,
      'UI preferences do not satisfy their schema.',
    );
  }

  return deepFreeze(normalized);
}

function resolveSliceName(envelope, preferredSliceName) {
  const slices = envelope?.slices;

  if (!isPlainObject(slices)) {
    return preferredSliceName;
  }

  if (slices[preferredSliceName] !== undefined) {
    return preferredSliceName;
  }

  const alias = SLICE_ALIASES.find(
    (sliceName) => slices[sliceName] !== undefined,
  );

  return alias ?? preferredSliceName;
}

function readPreferences(envelope, preferredSliceName) {
  if (envelope === null) {
    return DEFAULT_UI_PREFERENCES;
  }

  const sliceName = resolveSliceName(envelope, preferredSliceName);
  const value = isPlainObject(envelope.slices)
    ? envelope.slices[sliceName]
    : undefined;

  if (value === undefined || value === null) {
    return DEFAULT_UI_PREFERENCES;
  }

  try {
    return normalizePreferences(value);
  } catch (error) {
    if (error instanceof UiPreferenceRepositoryError) {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_PREFERENCES,
        'Persisted UI preferences do not satisfy their schema.',
        { sliceName },
      );
    }

    throw error;
  }
}

function buildNextState(envelope, sliceName, preferences) {
  const currentSlices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...currentSlices,
      [sliceName]: preferences,
    },
  };
}

function requireExpectedEntityRevision(options) {
  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'UI preference mutation options must be an object or revision.',
    );
  }

  if (
    options.expectedRevision === undefined ||
    options.expectedRevision === null
  ) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
      'Expected UI preference revision is required.',
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
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted UI preferences changed before the mutation.',
      {
        expectedRevision: normalized,
        actualRevision: currentRevision,
      },
    );
  }

  return normalized;
}

function assertPreferenceRevision(preferences, expectedRevision) {
  if (preferences.revision !== expectedRevision) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'UI preferences changed before the mutation.',
      {
        expectedRevision,
        actualRevision: preferences.revision,
      },
    );
  }
}

function normalizeUpdate(changes) {
  if (!isPlainObject(changes) || !isJsonCompatible(changes)) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'UI preference changes must be a safe plain object.',
    );
  }

  const keys = Object.keys(changes);

  if (keys.length === 0) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'UI preference changes must include at least one editable field.',
    );
  }

  assertSafePreferenceKeys(changes, 'changes');

  keys.forEach((key) => {
    if (IMMUTABLE_FIELDS.has(key)) {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.IMMUTABLE_FIELD,
        `UI preference field ${key} is immutable.`,
        { field: key },
      );
    }

    if (!MUTABLE_FIELDS.has(key)) {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
        `UI preference field ${key} cannot be updated.`,
        { field: key },
      );
    }
  });

  return { ...changes };
}

function mergePreferences(current, changes) {
  const merged = {
    ...current,
    ...changes,
  };

  ['dashboard', 'monitoring', 'documents'].forEach((field) => {
    if (changes[field] !== undefined) {
      merged[field] = {
        ...(isPlainObject(current[field]) ? current[field] : {}),
        ...changes[field],
      };
    }
  });

  return merged;
}

function normalizeActor(options, current) {
  if (!isPlainObject(options)) {
    return current.updatedBy;
  }

  const actor = options.updatedBy ?? options.actorId;

  if (actor === undefined || actor === null) {
    return current.updatedBy;
  }

  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new UiPreferenceRepositoryError(
      UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'UI preference updater must be a non-empty string.',
    );
  }

  return actor.normalize('NFC').trim();
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
    'UI preference repository clock must provide a valid current timestamp.',
  );
}

/**
 * Error raised when UI preference repository data or operations are invalid.
 */
export class UiPreferenceRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'UiPreferenceRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Revision-safe repository for non-sensitive browser-local UI preferences.
 */
export class UiPreferenceRepository {
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
        : UI_PREFERENCE_REPOSITORY_SLICE;
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
   * Returns current UI preferences or immutable defaults.
   *
   * @returns {Readonly<Record<string, unknown>>} UI preferences.
   */
  get() {
    return readPreferences(this.gateway.read(), this.sliceName);
  }

  /**
   * Returns a versioned UI preference repository snapshot.
   *
   * @returns {Readonly<Record<string, unknown>>} Preference snapshot.
   */
  getSnapshot() {
    const envelope = this.gateway.read();

    return deepFreeze({
      schemaVersion: UI_PREFERENCE_REPOSITORY_SCHEMA_VERSION,
      revision: envelope?.rootRevision ?? 0,
      preferences: readPreferences(envelope, this.sliceName),
    });
  }

  /**
   * Updates editable preferences using entity and root revision validation.
   *
   * @param {Record<string, unknown>} changes Preference changes.
   * @param {number|{
   *   expectedRevision: number,
   *   expectedRootRevision?: number,
   *   updatedBy?: string,
   *   actorId?: string
   * }} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Updated preferences.
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
    const current = readPreferences(envelope, this.sliceName);

    assertPreferenceRevision(current, expectedRevision);

    const updated = normalizePreferences({
      ...mergePreferences(current, normalizedChanges),
      revision: current.revision + 1,
      updatedAt: getCurrentTimestamp(this.clock),
      updatedBy: normalizeActor(options, current),
    });
    const sliceName = resolveSliceName(envelope, this.sliceName);

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, sliceName, updated),
      {},
    );

    return updated;
  }

  /**
   * Updates the monitoring dark-mode preference.
   *
   * @param {boolean} enabled Whether monitoring dark mode is enabled.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Updated preferences.
   */
  setMonitoringDarkMode(enabled, options = {}) {
    if (typeof enabled !== 'boolean') {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
        'Monitoring dark mode preference must be a boolean.',
      );
    }

    return this.update(
      { monitoringDarkMode: enabled },
      options,
    );
  }

  /**
   * Replaces all UI preferences using root revision validation.
   *
   * Supports `replace(expectedRootRevision, preferences)` and
   * `replace(preferences, { expectedRootRevision })`.
   *
   * @param {number|Record<string, unknown>} expectedRevisionOrPreferences Root
   * revision or replacement preferences.
   * @param {Record<string, unknown>} [preferencesOrOptions] Preferences or
   * options.
   * @returns {Readonly<Record<string, unknown>>} Stored preferences.
   */
  replace(expectedRevisionOrPreferences, preferencesOrOptions) {
    let expectedRootRevision;
    let replacementPreferences;

    if (isPlainObject(expectedRevisionOrPreferences)) {
      replacementPreferences = expectedRevisionOrPreferences;

      if (
        !isPlainObject(preferencesOrOptions) ||
        preferencesOrOptions.expectedRootRevision === undefined
      ) {
        throw new UiPreferenceRepositoryError(
          UI_PREFERENCE_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
          'Expected root revision is required when replacing UI preferences.',
        );
      }

      expectedRootRevision = requireRevision(
        preferencesOrOptions.expectedRootRevision,
        'Expected root revision',
      );
    } else {
      expectedRootRevision = requireRevision(
        expectedRevisionOrPreferences,
        'Expected root revision',
      );
      replacementPreferences = preferencesOrOptions;
    }

    const preferences = normalizePreferences(replacementPreferences);
    const envelope = this.gateway.read();
    const currentRevision = envelope?.rootRevision ?? 0;

    if (expectedRootRevision !== currentRevision) {
      throw new UiPreferenceRepositoryError(
        UI_PREFERENCE_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
        'Persisted UI preferences changed before replacement.',
        {
          expectedRevision: expectedRootRevision,
          actualRevision: currentRevision,
        },
      );
    }

    const sliceName = resolveSliceName(envelope, this.sliceName);

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, sliceName, preferences),
      {},
    );

    return preferences;
  }

  /**
   * Restores default preferences while advancing the entity revision.
   *
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Restored preferences.
   */
  restoreDefaults(options = {}) {
    const current = this.get();

    return this.update(
      {
        theme: DEFAULT_UI_PREFERENCES.theme,
        reducedMotion: DEFAULT_UI_PREFERENCES.reducedMotion,
        defaultPageSize: DEFAULT_UI_PREFERENCES.defaultPageSize,
        monitoringDarkMode:
          DEFAULT_UI_PREFERENCES.monitoringDarkMode,
        dashboard: DEFAULT_UI_PREFERENCES.dashboard,
        monitoring: DEFAULT_UI_PREFERENCES.monitoring,
        documents: DEFAULT_UI_PREFERENCES.documents,
      },
      {
        ...(isPlainObject(options) ? options : {}),
        expectedRevision:
          Number.isSafeInteger(options)
            ? options
            : options.expectedRevision ?? current.revision,
      },
    );
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
        'UI preference repository listener must be a function.',
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

  getPreferences() {
    return this.get();
  }

  updatePreferences(changes, options = {}) {
    return this.update(changes, options);
  }

  replaceAll(expectedRevisionOrPreferences, preferencesOrOptions) {
    return this.replace(
      expectedRevisionOrPreferences,
      preferencesOrOptions,
    );
  }

  replacePreferences(
    expectedRevisionOrPreferences,
    preferencesOrOptions,
  ) {
    return this.replace(
      expectedRevisionOrPreferences,
      preferencesOrOptions,
    );
  }

  reset(options = {}) {
    return this.restoreDefaults(options);
  }
}

/**
 * Creates a UI preference repository.
 *
 * @param {ConstructorParameters<typeof UiPreferenceRepository>[0]}
 * gatewayOrOptions Gateway or repository options.
 * @param {ConstructorParameters<typeof UiPreferenceRepository>[1]} [options]
 * Repository options.
 * @returns {UiPreferenceRepository} UI preference repository.
 */
export function createUiPreferenceRepository(
  gatewayOrOptions,
  options = {},
) {
  return new UiPreferenceRepository(gatewayOrOptions, options);
}

export const UIPreferenceRepository = UiPreferenceRepository;
export const UiPreferencesRepository = UiPreferenceRepository;
export const LocalUiPreferenceRepository = UiPreferenceRepository;
export const createUIPreferenceRepository =
  createUiPreferenceRepository;
export const createLocalUiPreferenceRepository =
  createUiPreferenceRepository;
export const isUIPreferences = isUiPreferences;

export default UiPreferenceRepository;