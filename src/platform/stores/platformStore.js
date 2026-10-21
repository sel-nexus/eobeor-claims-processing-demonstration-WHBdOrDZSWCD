import { createStore } from 'zustand/vanilla';
import { CANONICAL_SEED_BUNDLE } from '../../fixtures/seedBundle.js';
import { SCHEMA_VERSION } from '../config/constants.js';
import {
  migratePlatformEnvelope,
  PersistenceMigrationError,
} from '../persistence/migrations.js';
import { browserClock } from '../time/clock.js';
import {
  isAuditEventCollection,
  isJsonCompatible,
  isMonitoringState,
  isPlainObject,
  isSettings,
  isUserCollection,
} from '../validation/schemas.js';

export const PLATFORM_STORE_SCHEMA_VERSION = 1;

export const PLATFORM_STORE_HYDRATION_STATUSES = Object.freeze({
  HYDRATING: 'HYDRATING',
  READY: 'READY',
  RECOVERY: 'RECOVERY',
});

export const PLATFORM_STORE_RECOVERY_MODES = Object.freeze({
  NONE: 'NONE',
  VOLATILE: 'VOLATILE',
  READ_ONLY: 'READ_ONLY',
});

export const PLATFORM_STORE_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_COMMAND: 'INVALID_COMMAND',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_REVISION: 'INVALID_REVISION',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  READ_ONLY_RECOVERY: 'READ_ONLY_RECOVERY',
  HYDRATION_FAILED: 'HYDRATION_FAILED',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
});

const REQUIRED_SLICE_VALIDATORS = Object.freeze({
  users: isUserCollection,
  settings: isSettings,
  auditEvents: isAuditEventCollection,
  monitoring: isMonitoringState,
});

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

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_GATEWAY,
      'Platform store requires a storage gateway with read() and commit().',
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

function requireRevision(value, name = 'Expected root revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function getCurrentTimestamp(clock) {
  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    const value = clock.nowIso();

    if (
      typeof value === 'string' &&
      Number.isFinite(Date.parse(value))
    ) {
      return new Date(value).toISOString();
    }
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
    'Platform store clock must provide a valid current timestamp.',
  );
}

function createSeedSlices(seedBundle) {
  if (!isPlainObject(seedBundle)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_OPTIONS,
      'Platform store seed bundle must be a plain object.',
    );
  }

  const platform = isPlainObject(seedBundle.platform)
    ? seedBundle.platform
    : {};

  return {
    users: platform.users ?? [],
    settings: platform.settings ?? null,
    auditEvents: seedBundle.auditEvents ?? [],
    uiPreferences: seedBundle.preferences ?? null,
    monitoring: platform.monitoring ?? null,
    operationsEnvelope: seedBundle.operationsEnvelope ?? null,
    membersClaims: seedBundle.membersClaims ?? null,
    documents: seedBundle.documents ?? null,
    insights: seedBundle.insights ?? null,
  };
}

function normalizeSlices(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_STATE,
      'Platform slices must be safe JSON-compatible data.',
    );
  }

  Object.entries(REQUIRED_SLICE_VALIDATORS).forEach(
    ([sliceName, predicate]) => {
      if (
        value[sliceName] !== undefined &&
        value[sliceName] !== null &&
        !predicate(value[sliceName])
      ) {
        throw new PlatformStoreError(
          PLATFORM_STORE_ERROR_CODES.INVALID_STATE,
          `Platform slice ${sliceName} does not satisfy its schema.`,
          { sliceName },
        );
      }
    },
  );

  return deepFreeze(value);
}

function normalizeRootEnvelope(value) {
  if (!isPlainObject(value)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_STATE,
      'Platform root envelope must be a plain object.',
    );
  }

  let migrated;

  try {
    migrated = migratePlatformEnvelope(value);
  } catch (error) {
    if (error instanceof PersistenceMigrationError) {
      throw new PlatformStoreError(
        PLATFORM_STORE_ERROR_CODES.MIGRATION_FAILED,
        'Persisted platform state could not be migrated.',
        {
          migrationCode: error.code,
          migrationDetails: error.details,
        },
        error,
      );
    }

    throw error;
  }

  if (
    !Number.isSafeInteger(migrated.rootRevision) ||
    migrated.rootRevision < 0 ||
    !isPlainObject(migrated.slices)
  ) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_STATE,
      'Platform root envelope does not contain a valid revision and slices.',
    );
  }

  return {
    schemaVersion: migrated.schemaVersion,
    rootRevision: migrated.rootRevision,
    slices: normalizeSlices(migrated.slices),
  };
}

function resolveExpectedRevision(options, currentRevision) {
  if (options === undefined || options === null) {
    return currentRevision;
  }

  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_OPTIONS,
      'Platform command options must be an object or revision.',
    );
  }

  const value =
    options.expectedRootRevision ?? options.expectedRevision;

  return value === undefined || value === null
    ? currentRevision
    : requireRevision(value);
}

function resolveCommandExecutor(command) {
  if (typeof command === 'function') {
    return command;
  }

  if (!isPlainObject(command)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_COMMAND,
      'Platform command must be a function or command object.',
    );
  }

  if (typeof command.validateAndApply === 'function') {
    return command.validateAndApply.bind(command);
  }

  if (typeof command.apply === 'function') {
    return command.apply.bind(command);
  }

  if (typeof command.execute === 'function') {
    return command.execute.bind(command);
  }

  throw new PlatformStoreError(
    PLATFORM_STORE_ERROR_CODES.INVALID_COMMAND,
    'Platform command object must provide validateAndApply(), apply(), or execute().',
  );
}

function isPromiseLike(value) {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  );
}

function resolveCommandOutcome(commandResult, draftSlices) {
  if (
    isPlainObject(commandResult) &&
    commandResult.nextSlices !== undefined
  ) {
    return {
      slices: commandResult.nextSlices,
      result:
        commandResult.value ??
        commandResult.result ??
        commandResult.data,
    };
  }

  if (
    isPlainObject(commandResult) &&
    commandResult.nextState !== undefined
  ) {
    const nextState = commandResult.nextState;

    return {
      slices:
        isPlainObject(nextState) && isPlainObject(nextState.slices)
          ? nextState.slices
          : nextState,
      result:
        commandResult.value ??
        commandResult.result ??
        commandResult.data,
    };
  }

  return {
    slices: draftSlices,
    result: commandResult,
  };
}

function appendCommandAudit(slices, command) {
  if (
    !isPlainObject(command) ||
    command.auditEvent === undefined ||
    command.auditEvent === null
  ) {
    return slices;
  }

  const currentEvents = slices.auditEvents;

  if (!Array.isArray(currentEvents)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_STATE,
      'Platform audit slice must be an array before appending an event.',
    );
  }

  const nextEvents = [...currentEvents, cloneMutable(command.auditEvent)];

  if (!isAuditEventCollection(nextEvents)) {
    throw new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.INVALID_COMMAND,
      'Platform command audit event does not satisfy its schema.',
    );
  }

  return {
    ...slices,
    auditEvents: nextEvents,
  };
}

function getPersistenceCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function isReadOnlyStorageFailure(error) {
  const code = getPersistenceCode(error);

  return (
    code === 'CORRUPT_STATE' ||
    code === 'INVALID_ENVELOPE' ||
    code === 'FUTURE_SCHEMA_VERSION' ||
    code === PLATFORM_STORE_ERROR_CODES.MIGRATION_FAILED
  );
}

function createRecoveryState({
  mode,
  code,
  message,
  timestamp,
  pendingChanges = false,
}) {
  return deepFreeze({
    active: mode !== PLATFORM_STORE_RECOVERY_MODES.NONE,
    mode,
    code,
    message,
    retryable: mode === PLATFORM_STORE_RECOVERY_MODES.VOLATILE,
    pendingChanges,
    enteredAt:
      mode === PLATFORM_STORE_RECOVERY_MODES.NONE
        ? null
        : timestamp,
  });
}

function createReadyRecoveryState() {
  return createRecoveryState({
    mode: PLATFORM_STORE_RECOVERY_MODES.NONE,
    code: null,
    message: null,
    timestamp: null,
  });
}

function createFixtureView(slices, seedSlices) {
  return Object.freeze({
    membersClaims:
      slices.membersClaims ?? seedSlices.membersClaims ?? null,
    documents: slices.documents ?? seedSlices.documents ?? null,
    operations:
      slices.operations ??
      slices.operationsEnvelope ??
      seedSlices.operationsEnvelope ??
      null,
    insights: slices.insights ?? seedSlices.insights ?? null,
  });
}

function createStoreSnapshot({
  schemaVersion = SCHEMA_VERSION,
  rootRevision,
  persistedRootRevision = rootRevision,
  slices,
  seedSlices,
  hydrationStatus,
  persisted,
  storageRecovery,
  lastUpdatedAt,
}) {
  const fixtures = createFixtureView(slices, seedSlices);
  const auditEvents = slices.auditEvents ?? Object.freeze([]);

  return Object.freeze({
    storeSchemaVersion: PLATFORM_STORE_SCHEMA_VERSION,
    schemaVersion,
    rootRevision,
    persistedRootRevision,
    hydrationStatus,
    hydrated:
      hydrationStatus ===
      PLATFORM_STORE_HYDRATION_STATUSES.READY,
    persisted,
    storageRecovery,
    recoveryState: storageRecovery,
    lastUpdatedAt,
    users: slices.users ?? Object.freeze([]),
    settings: slices.settings ?? null,
    auditEvents,
    audits: auditEvents,
    uiPreferences: slices.uiPreferences ?? null,
    monitoring: slices.monitoring ?? null,
    operationsEnvelope: slices.operationsEnvelope ?? null,
    fixtures,
    slices,
  });
}

function normalizePersistenceError(error) {
  if (error instanceof PlatformStoreError) {
    return error;
  }

  const persistenceCode = getPersistenceCode(error);

  if (persistenceCode === 'REVISION_CONFLICT') {
    return new PlatformStoreError(
      PLATFORM_STORE_ERROR_CODES.REVISION_CONFLICT,
      'Persisted platform state changed before the command was committed.',
      error.details,
      error,
    );
  }

  return new PlatformStoreError(
    PLATFORM_STORE_ERROR_CODES.PERSISTENCE_FAILED,
    'Platform state could not be persisted.',
    { persistenceCode },
    error,
  );
}

/**
 * Error raised when platform store state or commands are invalid.
 */
export class PlatformStoreError extends Error {
  /**
   * @param {string} code Stable platform store error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PlatformStoreError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Zustand-backed platform root for hydrated local state and atomic commands.
 */
export class PlatformStore {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or store options containing `gateway` or `storageGateway`.
   * @param {{
   *   seedBundle?: Record<string, unknown>,
   *   initialSlices?: Record<string, unknown>,
   *   clock?: object|Function,
   *   persistBaseline?: boolean
   * }} [options] Store options.
   */
  constructor(gatewayOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      gatewayOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.gateway = requireGateway(resolved.gateway);
    this.clock = normalizedOptions.clock ?? browserClock;
    this.seedBundle =
      normalizedOptions.seedBundle ?? CANONICAL_SEED_BUNDLE;
    this.seedSlices = normalizeSlices(
      normalizedOptions.initialSlices ??
        createSeedSlices(this.seedBundle),
    );
    this.persistBaseline =
      normalizedOptions.persistBaseline !== false;
    this.destroyed = false;
    this.unsubscribeGateway = () => {};

    const initialRecovery = createReadyRecoveryState();
    const initialSnapshot = createStoreSnapshot({
      rootRevision: 0,
      persistedRootRevision: 0,
      slices: this.seedSlices,
      seedSlices: this.seedSlices,
      hydrationStatus:
        PLATFORM_STORE_HYDRATION_STATUSES.HYDRATING,
      persisted: false,
      storageRecovery: initialRecovery,
      lastUpdatedAt: null,
    });

    this.store = createStore(() => initialSnapshot);
    this.storeApi = this.store;

    this.hydrate();

    if (typeof this.gateway.subscribe === 'function') {
      this.unsubscribeGateway = this.gateway.subscribe(() => {
        if (!this.destroyed) {
          this.refresh();
        }
      });
    }
  }

  setSnapshot(snapshot) {
    if (this.destroyed) {
      return;
    }

    const current = this.store.getState();

    if (
      current.rootRevision === snapshot.rootRevision &&
      current.persistedRootRevision ===
        snapshot.persistedRootRevision &&
      current.hydrationStatus === snapshot.hydrationStatus &&
      current.persisted === snapshot.persisted &&
      current.slices === snapshot.slices &&
      current.storageRecovery.mode ===
        snapshot.storageRecovery.mode
    ) {
      return;
    }

    this.store.setState(snapshot, true);
  }

  createSnapshot(root, options = {}) {
    return createStoreSnapshot({
      schemaVersion: root.schemaVersion ?? SCHEMA_VERSION,
      rootRevision: root.rootRevision,
      persistedRootRevision:
        options.persistedRootRevision ?? root.rootRevision,
      slices: root.slices,
      seedSlices: this.seedSlices,
      hydrationStatus:
        options.hydrationStatus ??
        PLATFORM_STORE_HYDRATION_STATUSES.READY,
      persisted: options.persisted !== false,
      storageRecovery:
        options.storageRecovery ?? createReadyRecoveryState(),
      lastUpdatedAt:
        options.lastUpdatedAt ?? getCurrentTimestamp(this.clock),
    });
  }

  createRecoverySnapshot(error, mode, options = {}) {
    const current = this.store.getState();
    const slices = options.slices ?? current.slices;
    const rootRevision =
      options.rootRevision ?? current.rootRevision;
    const persistedRootRevision =
      options.persistedRootRevision ??
      current.persistedRootRevision;
    const normalizedError = normalizePersistenceError(error);
    const timestamp = getCurrentTimestamp(this.clock);
    const recovery = createRecoveryState({
      mode,
      code: normalizedError.code,
      message: normalizedError.message,
      timestamp,
      pendingChanges: options.pendingChanges === true,
    });

    return createStoreSnapshot({
      rootRevision,
      persistedRootRevision,
      slices,
      seedSlices: this.seedSlices,
      hydrationStatus:
        PLATFORM_STORE_HYDRATION_STATUSES.RECOVERY,
      persisted: options.persisted === true,
      storageRecovery: recovery,
      lastUpdatedAt: timestamp,
    });
  }

  /**
   * Hydrates the store from persistence or installs the fixture baseline.
   *
   * @returns {Readonly<Record<string, unknown>>} Current store snapshot.
   */
  hydrate() {
    if (this.destroyed) {
      return this.store.getState();
    }

    try {
      const persistedEnvelope = this.gateway.read();

      if (persistedEnvelope !== null) {
        const normalized = normalizeRootEnvelope(persistedEnvelope);
        const snapshot = this.createSnapshot(normalized, {
          persisted: true,
        });

        this.setSnapshot(snapshot);
        return snapshot;
      }

      if (!this.persistBaseline) {
        const snapshot = this.createSnapshot(
          {
            schemaVersion: SCHEMA_VERSION,
            rootRevision: 0,
            slices: this.seedSlices,
          },
          {
            persisted: false,
            persistedRootRevision: 0,
          },
        );

        this.setSnapshot(snapshot);
        return snapshot;
      }

      const committed = this.gateway.commit(
        0,
        {
          schemaVersion: SCHEMA_VERSION,
          slices: this.seedSlices,
        },
        {},
      );
      const normalized = normalizeRootEnvelope(
        committed ?? this.gateway.read(),
      );
      const snapshot = this.createSnapshot(normalized, {
        persisted: true,
      });

      this.setSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      const mode = isReadOnlyStorageFailure(error)
        ? PLATFORM_STORE_RECOVERY_MODES.READ_ONLY
        : PLATFORM_STORE_RECOVERY_MODES.VOLATILE;
      const recoverySnapshot = this.createRecoverySnapshot(
        error,
        mode,
        {
          slices: this.seedSlices,
          rootRevision: 0,
          persistedRootRevision: 0,
          persisted: false,
        },
      );

      this.setSnapshot(recoverySnapshot);
      return recoverySnapshot;
    }
  }

  /**
   * Reloads state after a storage invalidation event.
   *
   * @returns {Readonly<Record<string, unknown>>} Current store snapshot.
   */
  refresh() {
    if (this.destroyed) {
      return this.store.getState();
    }

    try {
      const persistedEnvelope = this.gateway.read();

      if (persistedEnvelope === null) {
        return this.hydrate();
      }

      const normalized = normalizeRootEnvelope(persistedEnvelope);
      const current = this.store.getState();

      if (
        current.persisted &&
        current.persistedRootRevision ===
          normalized.rootRevision &&
        current.storageRecovery.mode ===
          PLATFORM_STORE_RECOVERY_MODES.NONE
      ) {
        return current;
      }

      const snapshot = this.createSnapshot(normalized, {
        persisted: true,
      });

      this.setSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      const current = this.store.getState();
      const mode = isReadOnlyStorageFailure(error)
        ? PLATFORM_STORE_RECOVERY_MODES.READ_ONLY
        : PLATFORM_STORE_RECOVERY_MODES.VOLATILE;
      const recoverySnapshot = this.createRecoverySnapshot(
        error,
        mode,
        {
          slices: current.slices,
          rootRevision: current.rootRevision,
          persistedRootRevision: current.persistedRootRevision,
          persisted: current.persisted,
          pendingChanges:
            current.storageRecovery.pendingChanges === true,
        },
      );

      this.setSnapshot(recoverySnapshot);
      return recoverySnapshot;
    }
  }

  /**
   * Returns the immutable current platform snapshot.
   *
   * @returns {Readonly<Record<string, unknown>>} Platform snapshot.
   */
  getSnapshot() {
    return this.store.getState();
  }

  /**
   * Alias for getSnapshot().
   *
   * @returns {Readonly<Record<string, unknown>>} Platform snapshot.
   */
  snapshot() {
    return this.getSnapshot();
  }

  /**
   * Returns the Zustand state snapshot.
   *
   * @returns {Readonly<Record<string, unknown>>} Platform snapshot.
   */
  getState() {
    return this.getSnapshot();
  }

  /**
   * Returns the current logical root revision.
   *
   * @returns {number} Root revision.
   */
  getRootRevision() {
    return this.store.getState().rootRevision;
  }

  /**
   * Executes a synchronous copy-on-write platform command.
   *
   * The command receives mutable logical slices and an immutable context.
   * Returning `{nextSlices, value}` may replace the draft explicitly.
   *
   * @param {Function|Record<string, unknown>} command Platform command.
   * @param {number|Record<string, unknown>} [options] Command options.
   * @returns {unknown} Command result, or the committed snapshot when the
   * command returns undefined.
   */
  execute(command, options = {}) {
    if (this.destroyed) {
      throw new PlatformStoreError(
        PLATFORM_STORE_ERROR_CODES.INVALID_STATE,
        'Platform store has been destroyed.',
      );
    }

    const current = this.store.getState();

    if (
      current.storageRecovery.mode ===
      PLATFORM_STORE_RECOVERY_MODES.READ_ONLY
    ) {
      throw new PlatformStoreError(
        PLATFORM_STORE_ERROR_CODES.READ_ONLY_RECOVERY,
        'Platform state is in read-only recovery mode.',
        {
          recoveryCode: current.storageRecovery.code,
        },
      );
    }

    const expectedRevision = resolveExpectedRevision(
      options,
      current.rootRevision,
    );

    if (expectedRevision !== current.rootRevision) {
      throw new PlatformStoreError(
        PLATFORM_STORE_ERROR_CODES.REVISION_CONFLICT,
        'Platform state changed before the command was executed.',
        {
          expectedRevision,
          actualRevision: current.rootRevision,
        },
      );
    }

    const executor = resolveCommandExecutor(command);
    const draftSlices = cloneMutable(current.slices);
    const context = Object.freeze({
      rootRevision: current.rootRevision,
      persistedRootRevision: current.persistedRootRevision,
      schemaVersion: current.schemaVersion,
      recoveryMode: current.storageRecovery.mode,
      snapshot: current,
    });
    const commandResult = executor(draftSlices, context);

    if (isPromiseLike(commandResult)) {
      throw new PlatformStoreError(
        PLATFORM_STORE_ERROR_CODES.INVALID_COMMAND,
        'Platform commands must complete synchronously.',
      );
    }

    const outcome = resolveCommandOutcome(
      commandResult,
      draftSlices,
    );
    const withAudit = appendCommandAudit(
      outcome.slices,
      command,
    );
    const nextSlices = normalizeSlices(withAudit);
    const nextRevision = current.rootRevision + 1;

    if (
      current.storageRecovery.mode ===
      PLATFORM_STORE_RECOVERY_MODES.VOLATILE
    ) {
      const volatileSnapshot = createStoreSnapshot({
        schemaVersion: current.schemaVersion,
        rootRevision: nextRevision,
        persistedRootRevision: current.persistedRootRevision,
        slices: nextSlices,
        seedSlices: this.seedSlices,
        hydrationStatus:
          PLATFORM_STORE_HYDRATION_STATUSES.RECOVERY,
        persisted: false,
        storageRecovery: createRecoveryState({
          mode: PLATFORM_STORE_RECOVERY_MODES.VOLATILE,
          code:
            current.storageRecovery.code ??
            PLATFORM_STORE_ERROR_CODES.PERSISTENCE_FAILED,
          message:
            current.storageRecovery.message ??
            'Platform changes are retained in memory only.',
          timestamp: getCurrentTimestamp(this.clock),
          pendingChanges: true,
        }),
        lastUpdatedAt: getCurrentTimestamp(this.clock),
      });

      this.setSnapshot(volatileSnapshot);

      return outcome.result === undefined
        ? volatileSnapshot
        : deepFreeze(outcome.result);
    }

    try {
      const committed = this.gateway.commit(
        current.persistedRootRevision,
        {
          schemaVersion: SCHEMA_VERSION,
          slices: nextSlices,
        },
        {},
      );
      const normalized = normalizeRootEnvelope(
        committed ?? this.gateway.read(),
      );
      const snapshot = this.createSnapshot(normalized, {
        persisted: true,
      });

      this.setSnapshot(snapshot);

      return outcome.result === undefined
        ? snapshot
        : deepFreeze(outcome.result);
    } catch (error) {
      const normalizedError = normalizePersistenceError(error);

      if (
        normalizedError.code ===
        PLATFORM_STORE_ERROR_CODES.REVISION_CONFLICT
      ) {
        this.refresh();
        throw normalizedError;
      }

      const recoverySnapshot = this.createRecoverySnapshot(
        normalizedError,
        PLATFORM_STORE_RECOVERY_MODES.VOLATILE,
        {
          slices: nextSlices,
          rootRevision: nextRevision,
          persistedRootRevision: current.persistedRootRevision,
          persisted: false,
          pendingChanges: true,
        },
      );

      this.setSnapshot(recoverySnapshot);
      throw normalizedError;
    }
  }

  /**
   * Subscribes to platform snapshot changes.
   *
   * @param {(snapshot: Readonly<Record<string, unknown>>, previousSnapshot: Readonly<Record<string, unknown>>) => void}
   * listener Snapshot listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Platform store listener must be a function.',
      );
    }

    if (this.destroyed) {
      return () => {};
    }

    return this.store.subscribe(listener);
  }

  /**
   * Retries persistence by committing the current in-memory state.
   *
   * @returns {Readonly<Record<string, unknown>>} Persisted snapshot.
   */
  recoverPersistence() {
    const current = this.store.getState();

    if (
      current.storageRecovery.mode ===
      PLATFORM_STORE_RECOVERY_MODES.READ_ONLY
    ) {
      throw new PlatformStoreError(
        PLATFORM_STORE_ERROR_CODES.READ_ONLY_RECOVERY,
        'Read-only recovery state cannot be overwritten.',
      );
    }

    if (
      current.storageRecovery.mode ===
      PLATFORM_STORE_RECOVERY_MODES.NONE
    ) {
      return current;
    }

    try {
      const persisted = this.gateway.read();
      const persistedRevision = persisted?.rootRevision ?? 0;
      const committed = this.gateway.commit(
        persistedRevision,
        {
          schemaVersion: SCHEMA_VERSION,
          slices: current.slices,
        },
        {},
      );
      const normalized = normalizeRootEnvelope(
        committed ?? this.gateway.read(),
      );
      const snapshot = this.createSnapshot(normalized, {
        persisted: true,
      });

      this.setSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      const normalizedError = normalizePersistenceError(error);
      const recoverySnapshot = this.createRecoverySnapshot(
        normalizedError,
        PLATFORM_STORE_RECOVERY_MODES.VOLATILE,
        {
          slices: current.slices,
          rootRevision: current.rootRevision,
          persistedRootRevision: current.persistedRootRevision,
          persisted: false,
          pendingChanges: true,
        },
      );

      this.setSnapshot(recoverySnapshot);
      throw normalizedError;
    }
  }

  /**
   * Releases storage subscriptions.
   *
   * @returns {void}
   */
  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.unsubscribeGateway();
    this.unsubscribeGateway = () => {};
  }
}

/**
 * Creates a Zustand-backed platform store.
 *
 * @param {ConstructorParameters<typeof PlatformStore>[0]}
 * gatewayOrOptions Gateway or store options.
 * @param {ConstructorParameters<typeof PlatformStore>[1]} [options]
 * Store options.
 * @returns {PlatformStore} Platform store.
 */
export function createPlatformStore(
  gatewayOrOptions,
  options = {},
) {
  return new PlatformStore(gatewayOrOptions, options);
}

export const LocalPlatformStore = PlatformStore;
export const BrowserPlatformStore = PlatformStore;
export const createLocalPlatformStore = createPlatformStore;

export default PlatformStore;