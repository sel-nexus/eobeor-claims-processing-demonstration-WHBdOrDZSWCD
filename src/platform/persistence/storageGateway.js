import { SCHEMA_VERSION } from '../config/constants.js';
import {
  isJsonCompatible,
  isPlainObject,
  isSupportedSchemaVersion,
} from '../validation/schemas.js';

export const STORAGE_NAMESPACE = 'eob-eor-demo.v1';
export const STORAGE_ROOT_KEY = `${STORAGE_NAMESPACE}.root`;
export const STORAGE_BROADCAST_CHANNEL = `${STORAGE_NAMESPACE}.changes`;

export const STORAGE_ERROR_CODES = Object.freeze({
  INVALID_NAMESPACE: 'INVALID_NAMESPACE',
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  CORRUPT_STATE: 'CORRUPT_STATE',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  STORAGE_DENIED: 'STORAGE_DENIED',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
});

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9.-]{1,98}\.v[1-9]\d*$/;
const COMMIT_MARKER_PATTERN =
  /^revision:(\d+);checksum:([a-z0-9-]+);commit:([a-zA-Z0-9_-]+)$/;
const CHECKSUM_PREFIX = 'fnv1a32-';
const moduleSubscribers = new Map();
const REALM_ID = createRuntimeId('realm');
let runtimeSequence = 0;

function createRuntimeId(prefix) {
  runtimeSequence += 1;

  const cryptoProvider = globalThis.crypto;

  if (
    cryptoProvider !== undefined &&
    typeof cryptoProvider.randomUUID === 'function'
  ) {
    return `${prefix}-${cryptoProvider.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${runtimeSequence.toString(36)}`;
}

function resolveStorage(storage) {
  if (storage !== undefined) {
    if (
      storage === null ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      throw new TypeError(
        'Storage must provide getItem(), setItem(), and removeItem().',
      );
    }

    return storage;
  }

  try {
    const browserStorage = globalThis.localStorage;

    if (
      browserStorage === undefined ||
      browserStorage === null ||
      typeof browserStorage.getItem !== 'function' ||
      typeof browserStorage.setItem !== 'function' ||
      typeof browserStorage.removeItem !== 'function'
    ) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
        'Browser local storage is unavailable.',
        503,
      );
    }

    return browserStorage;
  } catch (error) {
    if (error instanceof StorageGatewayError) {
      throw error;
    }

    throw normalizeStorageError(
      error,
      'Browser local storage is unavailable.',
    );
  }
}

function requireNamespace(namespace) {
  if (
    typeof namespace !== 'string' ||
    !NAMESPACE_PATTERN.test(namespace)
  ) {
    throw new StorageGatewayError(
      STORAGE_ERROR_CODES.INVALID_NAMESPACE,
      'Storage namespace must be a versioned lowercase namespace.',
      400,
      { namespace },
    );
  }

  return namespace;
}

function requireRevision(revision, name = 'Revision') {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }

  return revision;
}

function requireSchemaVersion(schemaVersion) {
  if (!isSupportedSchemaVersion(schemaVersion)) {
    throw new TypeError(
      `Unsupported storage schema version: ${String(schemaVersion)}`,
    );
  }

  return schemaVersion;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    const properties = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(value[key])}`,
      );

    return `{${properties.join(',')}}`;
  }

  return JSON.stringify(value);
}

function checksumSource(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  const source = {};

  Object.entries(value).forEach(([key, item]) => {
    if (key !== 'checksum' && key !== 'commitMarker') {
      source[key] = item;
    }
  });

  return source;
}

function hashFNV1a32(text) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createCommitMarker(revision, checksum, commitId) {
  return `revision:${revision};checksum:${checksum};commit:${commitId}`;
}

function parseCommitMarker(marker) {
  if (typeof marker !== 'string') {
    return null;
  }

  const match = COMMIT_MARKER_PATTERN.exec(marker);

  if (match === null) {
    return null;
  }

  const revision = Number(match[1]);

  if (!Number.isSafeInteger(revision)) {
    return null;
  }

  return Object.freeze({
    revision,
    checksum: match[2],
    commitId: match[3],
  });
}

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

function isQuotaError(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function isDeniedError(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error.name === 'SecurityError' ||
      error.name === 'NotAllowedError')
  );
}

function normalizeStorageError(error, fallbackMessage) {
  if (error instanceof StorageGatewayError) {
    return error;
  }

  if (isQuotaError(error)) {
    return new StorageGatewayError(
      STORAGE_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
      'Browser local storage quota was exceeded.',
      507,
      undefined,
      error,
    );
  }

  if (isDeniedError(error)) {
    return new StorageGatewayError(
      STORAGE_ERROR_CODES.STORAGE_DENIED,
      'Browser local storage access was denied.',
      503,
      undefined,
      error,
    );
  }

  return new StorageGatewayError(
    STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    fallbackMessage,
    503,
    undefined,
    error,
  );
}

function subscribeToModuleEvents(namespace, listener) {
  let listeners = moduleSubscribers.get(namespace);

  if (listeners === undefined) {
    listeners = new Set();
    moduleSubscribers.set(namespace, listeners);
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      moduleSubscribers.delete(namespace);
    }
  };
}

function publishModuleEvent(namespace, event) {
  const listeners = moduleSubscribers.get(namespace);

  if (listeners === undefined) {
    return;
  }

  [...listeners].forEach((listener) => {
    listener(event);
  });
}

function extractEventMetadata(serializedValue) {
  if (typeof serializedValue !== 'string') {
    return {
      revision: null,
      commitMarker: null,
    };
  }

  try {
    const value = JSON.parse(serializedValue);

    return {
      revision: Number.isSafeInteger(value?.rootRevision)
        ? value.rootRevision
        : null,
      commitMarker:
        typeof value?.commitMarker === 'string'
          ? value.commitMarker
          : null,
    };
  } catch {
    return {
      revision: null,
      commitMarker: null,
    };
  }
}

function normalizeCommitArguments(
  expectedRevisionOrState,
  nextStateOrOptions,
  options,
) {
  if (
    isPlainObject(expectedRevisionOrState) &&
    (nextStateOrOptions === undefined ||
      isPlainObject(nextStateOrOptions))
  ) {
    const normalizedOptions = nextStateOrOptions ?? {};

    return {
      expectedRevision: normalizedOptions.expectedRevision,
      nextState: expectedRevisionOrState,
      options: normalizedOptions,
    };
  }

  return {
    expectedRevision: expectedRevisionOrState,
    nextState: nextStateOrOptions,
    options: options ?? {},
  };
}

/**
 * Error raised by browser-local persistence operations.
 */
export class StorageGatewayError extends Error {
  /**
   * @param {string} code Stable storage error code.
   * @param {string} message Human-readable error message.
   * @param {number} status HTTP-like status used by local facades.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original runtime error.
   */
  constructor(code, message, status, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StorageGatewayError';
    this.code = code;
    this.status = status;

    if (details !== undefined) {
      this.details = cloneAndFreeze(details);
    }
  }
}

/**
 * Calculates a deterministic checksum for JSON-compatible storage data.
 *
 * Existing checksum and commit marker properties are excluded so an envelope
 * can verify itself.
 *
 * @param {unknown} value JSON-compatible value.
 * @returns {string} Deterministic checksum.
 */
export function calculateStorageChecksum(value) {
  if (!isJsonCompatible(value)) {
    throw new StorageGatewayError(
      STORAGE_ERROR_CODES.SERIALIZATION_FAILED,
      'Storage data must be safe JSON-compatible data.',
      422,
    );
  }

  const canonicalValue = canonicalize(checksumSource(value));

  return `${CHECKSUM_PREFIX}${hashFNV1a32(canonicalValue)}`;
}

/**
 * Determines whether a value is a valid committed storage envelope.
 *
 * @param {unknown} value Candidate envelope.
 * @param {string|number} [schemaVersion] Expected schema version.
 * @returns {boolean} Whether the envelope is valid.
 */
export function isStorageEnvelope(
  value,
  schemaVersion = SCHEMA_VERSION,
) {
  if (
    !isPlainObject(value) ||
    !isJsonCompatible(value) ||
    !isSupportedSchemaVersion(value.schemaVersion) ||
    value.schemaVersion !== schemaVersion ||
    !Number.isSafeInteger(value.rootRevision) ||
    value.rootRevision < 1 ||
    !isPlainObject(value.slices) ||
    typeof value.checksum !== 'string' ||
    value.checksum.length === 0
  ) {
    return false;
  }

  const marker = parseCommitMarker(value.commitMarker);

  if (
    marker === null ||
    marker.revision !== value.rootRevision ||
    marker.checksum !== value.checksum
  ) {
    return false;
  }

  return calculateStorageChecksum(value) === value.checksum;
}

/**
 * Creates a validated immutable committed envelope.
 *
 * @param {Record<string, unknown>} state State or envelope data.
 * @param {{
 *   revision: number,
 *   schemaVersion?: string|number,
 *   commitId?: string
 * }} options Envelope options.
 * @returns {Readonly<Record<string, unknown>>} Committed envelope.
 */
export function createStorageEnvelope(state, options) {
  if (!isPlainObject(state) || !isJsonCompatible(state)) {
    throw new StorageGatewayError(
      STORAGE_ERROR_CODES.INVALID_ENVELOPE,
      'Storage state must be a safe JSON-compatible object.',
      422,
    );
  }

  if (!isPlainObject(options)) {
    throw new TypeError('Storage envelope options are required.');
  }

  const revision = requireRevision(options.revision);

  if (revision < 1) {
    throw new RangeError('Committed storage revision must be at least 1.');
  }

  const schemaVersion = requireSchemaVersion(
    options.schemaVersion ?? SCHEMA_VERSION,
  );
  const commitId =
    typeof options.commitId === 'string' &&
    options.commitId.trim().length > 0
      ? options.commitId.trim()
      : createRuntimeId('commit');
  const {
    checksum: ignoredChecksum,
    commitMarker: ignoredCommitMarker,
    rootRevision: ignoredRootRevision,
    schemaVersion: ignoredSchemaVersion,
    ...stateData
  } = state;

  void ignoredChecksum;
  void ignoredCommitMarker;
  void ignoredRootRevision;
  void ignoredSchemaVersion;

  const envelopeBase = {
    ...stateData,
    schemaVersion,
    rootRevision: revision,
    slices: isPlainObject(state.slices) ? state.slices : state,
  };
  const checksum = calculateStorageChecksum(envelopeBase);
  const envelope = {
    ...envelopeBase,
    checksum,
    commitMarker: createCommitMarker(
      revision,
      checksum,
      commitId,
    ),
  };

  if (!isStorageEnvelope(envelope, schemaVersion)) {
    throw new StorageGatewayError(
      STORAGE_ERROR_CODES.INVALID_ENVELOPE,
      'Created storage envelope failed validation.',
      422,
    );
  }

  return cloneAndFreeze(envelope);
}

/**
 * Browser-local, versioned persistence adapter.
 */
export class StorageGateway {
  /**
   * @param {{
   *   namespace?: string,
   *   schemaVersion?: string|number,
   *   storage?: Storage|Record<string, Function>,
   *   broadcastChannelFactory?: ((name: string) => object)|null
   * }} [options] Gateway options.
   */
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('Storage gateway options must be an object.');
    }

    this.namespace = requireNamespace(
      options.namespace ?? STORAGE_NAMESPACE,
    );
    this.schemaVersion = requireSchemaVersion(
      options.schemaVersion ?? SCHEMA_VERSION,
    );
    this.rootKey = `${this.namespace}.root`;
    this.channelName = `${this.namespace}.changes`;
    this.sourceId = createRuntimeId('gateway');
    this.storageOverride = options.storage;
    this.listeners = new Set();
    this.destroyed = false;
    this.broadcastChannel = null;

    this.handleModuleEvent = (event) => {
      this.notify(event);
    };

    this.unsubscribeModule = subscribeToModuleEvents(
      this.namespace,
      this.handleModuleEvent,
    );

    this.handleStorageEvent = (event) => {
      if (
        event === null ||
        typeof event !== 'object' ||
        (event.key !== this.rootKey && event.key !== null)
      ) {
        return;
      }

      const metadata = extractEventMetadata(event.newValue);

      this.notify(
        Object.freeze({
          type:
            event.newValue === null ? 'cleared' : 'invalidated',
          namespace: this.namespace,
          key: this.rootKey,
          revision: metadata.revision,
          commitMarker: metadata.commitMarker,
          source: 'storage',
          sourceId: null,
        }),
      );
    };

    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener(
        'storage',
        this.handleStorageEvent,
      );
    }

    this.initializeBroadcastChannel(
      options.broadcastChannelFactory,
    );
  }

  initializeBroadcastChannel(factory) {
    try {
      if (factory === null) {
        return;
      }

      if (typeof factory === 'function') {
        this.broadcastChannel = factory(this.channelName);
      } else if (
        typeof globalThis.BroadcastChannel === 'function'
      ) {
        this.broadcastChannel = new globalThis.BroadcastChannel(
          this.channelName,
        );
      }

      if (this.broadcastChannel === null) {
        return;
      }

      this.broadcastChannel.onmessage = (messageEvent) => {
        const message = messageEvent?.data;

        if (
          !isPlainObject(message) ||
          message.namespace !== this.namespace ||
          message.realmId === REALM_ID
        ) {
          return;
        }

        this.notify(
          Object.freeze({
            type: message.type,
            namespace: this.namespace,
            key: this.rootKey,
            revision: message.revision ?? null,
            commitMarker: message.commitMarker ?? null,
            source: 'broadcast',
            sourceId: message.sourceId ?? null,
          }),
        );
      };
    } catch {
      this.broadcastChannel = null;
    }
  }

  getStorage() {
    return resolveStorage(this.storageOverride);
  }

  ensureActive() {
    if (this.destroyed) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
        'Storage gateway has been destroyed.',
        503,
      );
    }
  }

  readSerialized() {
    this.ensureActive();

    try {
      return this.getStorage().getItem(this.rootKey);
    } catch (error) {
      throw normalizeStorageError(
        error,
        'Browser local storage could not be read.',
      );
    }
  }

  /**
   * Reads and validates the committed root envelope.
   *
   * @returns {Readonly<Record<string, unknown>>|null} Stored envelope.
   */
  read() {
    const serialized = this.readSerialized();

    if (serialized === null) {
      return null;
    }

    let envelope;

    try {
      envelope = JSON.parse(serialized);
    } catch (error) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.CORRUPT_STATE,
        'Persisted browser state contains invalid JSON.',
        422,
        undefined,
        error,
      );
    }

    let valid;

    try {
      valid = isStorageEnvelope(envelope, this.schemaVersion);
    } catch (error) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.CORRUPT_STATE,
        'Persisted browser state could not be validated.',
        422,
        undefined,
        error,
      );
    }

    if (!valid) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.CORRUPT_STATE,
        'Persisted browser state failed envelope validation.',
        422,
      );
    }

    return cloneAndFreeze(envelope);
  }

  /**
   * Reads storage without throwing expected persistence errors.
   *
   * @returns {{ok: true, value: Readonly<Record<string, unknown>>|null}|{ok: false, error: StorageGatewayError}}
   * Safe read result.
   */
  safeRead() {
    try {
      return Object.freeze({
        ok: true,
        value: this.read(),
      });
    } catch (error) {
      const normalizedError =
        error instanceof StorageGatewayError
          ? error
          : normalizeStorageError(
              error,
              'Browser local storage could not be read.',
            );

      return Object.freeze({
        ok: false,
        error: normalizedError,
      });
    }
  }

  /**
   * Commits a new root envelope using optimistic revision validation.
   *
   * Supports `commit(expectedRevision, state, options)` and
   * `commit(state, { expectedRevision, commitId })`.
   *
   * @param {number|Record<string, unknown>|undefined} expectedRevisionOrState
   * Expected revision or next state.
   * @param {Record<string, unknown>|undefined} nextStateOrOptions Next state or
   * options.
   * @param {Record<string, unknown>} [options] Commit options.
   * @returns {Readonly<Record<string, unknown>>} Committed envelope.
   */
  commit(
    expectedRevisionOrState,
    nextStateOrOptions,
    options = {},
  ) {
    this.ensureActive();

    const normalized = normalizeCommitArguments(
      expectedRevisionOrState,
      nextStateOrOptions,
      options,
    );
    const { expectedRevision, nextState } = normalized;
    const commitOptions = normalized.options;

    if (!isPlainObject(nextState) || !isJsonCompatible(nextState)) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        'Next storage state must be a safe JSON-compatible object.',
        422,
      );
    }

    const current = this.read();
    const currentRevision = current?.rootRevision ?? 0;

    if (expectedRevision !== undefined && expectedRevision !== null) {
      requireRevision(expectedRevision, 'Expected revision');

      if (expectedRevision !== currentRevision) {
        throw new StorageGatewayError(
          STORAGE_ERROR_CODES.REVISION_CONFLICT,
          'Persisted browser state changed before the commit.',
          409,
          {
            expectedRevision,
            actualRevision: currentRevision,
          },
        );
      }
    }

    const revision = currentRevision + 1;
    const envelope = createStorageEnvelope(nextState, {
      revision,
      schemaVersion: this.schemaVersion,
      commitId: commitOptions.commitId,
    });

    let serialized;

    try {
      serialized = JSON.stringify(envelope);
    } catch (error) {
      throw new StorageGatewayError(
        STORAGE_ERROR_CODES.SERIALIZATION_FAILED,
        'Storage envelope could not be serialized.',
        422,
        undefined,
        error,
      );
    }

    try {
      this.getStorage().setItem(this.rootKey, serialized);
    } catch (error) {
      throw normalizeStorageError(
        error,
        'Browser local storage could not be updated.',
      );
    }

    const event = Object.freeze({
      type: 'committed',
      namespace: this.namespace,
      key: this.rootKey,
      revision: envelope.rootRevision,
      commitMarker: envelope.commitMarker,
      source: 'same-tab',
      sourceId: this.sourceId,
    });

    this.publish(event);
    return envelope;
  }

  /**
   * Removes the committed root after optional revision validation.
   *
   * @param {number|null} [expectedRevision] Expected current revision.
   * @returns {boolean} Whether persisted state existed.
   */
  clear(expectedRevision = null) {
    this.ensureActive();

    const current = this.read();
    const currentRevision = current?.rootRevision ?? 0;

    if (expectedRevision !== null && expectedRevision !== undefined) {
      requireRevision(expectedRevision, 'Expected revision');

      if (expectedRevision !== currentRevision) {
        throw new StorageGatewayError(
          STORAGE_ERROR_CODES.REVISION_CONFLICT,
          'Persisted browser state changed before it could be cleared.',
          409,
          {
            expectedRevision,
            actualRevision: currentRevision,
          },
        );
      }
    }

    try {
      this.getStorage().removeItem(this.rootKey);
    } catch (error) {
      throw normalizeStorageError(
        error,
        'Browser local storage could not be cleared.',
      );
    }

    if (current === null) {
      return false;
    }

    this.publish(
      Object.freeze({
        type: 'cleared',
        namespace: this.namespace,
        key: this.rootKey,
        revision: 0,
        commitMarker: null,
        source: 'same-tab',
        sourceId: this.sourceId,
      }),
    );

    return true;
  }

  /**
   * Determines whether browser storage can currently be read.
   *
   * @returns {boolean} Whether storage is available.
   */
  isAvailable() {
    try {
      this.readSerialized();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Subscribes to same-tab and cross-tab invalidation events.
   *
   * @param {(event: Readonly<Record<string, unknown>>) => void} listener
   * Invalidation listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Storage listener must be a function.');
    }

    this.ensureActive();
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(event) {
    if (this.destroyed) {
      return;
    }

    [...this.listeners].forEach((listener) => {
      listener(event);
    });
  }

  publish(event) {
    publishModuleEvent(this.namespace, event);

    if (
      this.broadcastChannel === null ||
      typeof this.broadcastChannel.postMessage !== 'function'
    ) {
      return;
    }

    try {
      this.broadcastChannel.postMessage({
        ...event,
        realmId: REALM_ID,
      });
    } catch {
      this.broadcastChannel = null;
    }
  }

  /**
   * Releases event and broadcast resources.
   *
   * @returns {void}
   */
  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.listeners.clear();
    this.unsubscribeModule();

    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener(
        'storage',
        this.handleStorageEvent,
      );
    }

    if (
      this.broadcastChannel !== null &&
      typeof this.broadcastChannel.close === 'function'
    ) {
      try {
        this.broadcastChannel.close();
      } catch {
        this.broadcastChannel = null;
      }
    }

    this.broadcastChannel = null;
  }

  load() {
    return this.read();
  }

  getSnapshot() {
    return this.read();
  }

  replace(expectedRevision, nextState, options = {}) {
    return this.commit(expectedRevision, nextState, options);
  }

  remove(expectedRevision = null) {
    return this.clear(expectedRevision);
  }
}

/**
 * Creates a browser-local storage gateway.
 *
 * @param {ConstructorParameters<typeof StorageGateway>[0]} [options] Gateway
 * options.
 * @returns {StorageGateway} Storage gateway.
 */
export function createStorageGateway(options = {}) {
  return new StorageGateway(options);
}

export const LocalStorageGateway = StorageGateway;
export const createLocalStorageGateway = createStorageGateway;
export const computeStorageChecksum = calculateStorageChecksum;

export default StorageGateway;