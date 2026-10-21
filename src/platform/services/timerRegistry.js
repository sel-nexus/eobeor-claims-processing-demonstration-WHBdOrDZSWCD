export const TIMER_REGISTRY_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_TIMER_API: 'INVALID_TIMER_API',
  INVALID_KEY: 'INVALID_KEY',
  INVALID_CALLBACK: 'INVALID_CALLBACK',
  INVALID_DELAY: 'INVALID_DELAY',
  INVALID_SCOPE: 'INVALID_SCOPE',
  TIMER_ALREADY_REGISTERED: 'TIMER_ALREADY_REGISTERED',
  REGISTRY_DESTROYED: 'REGISTRY_DESTROYED',
});

export const TIMER_TYPES = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  INTERVAL: 'INTERVAL',
});

const MAXIMUM_TIMER_KEY_LENGTH = 200;
const MAXIMUM_SCOPE_LENGTH = 100;

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

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

function requireOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TimerRegistryError(
      TIMER_REGISTRY_ERROR_CODES.INVALID_OPTIONS,
      'Timer registry options must be a plain object.',
    );
  }

  return value;
}

function requireTimerKey(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > MAXIMUM_TIMER_KEY_LENGTH
  ) {
    throw new TimerRegistryError(
      TIMER_REGISTRY_ERROR_CODES.INVALID_KEY,
      `Timer key must be a non-empty string of at most ${MAXIMUM_TIMER_KEY_LENGTH} characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function requireCallback(value) {
  if (typeof value !== 'function') {
    throw new TimerRegistryError(
      TIMER_REGISTRY_ERROR_CODES.INVALID_CALLBACK,
      'Timer callback must be a function.',
    );
  }

  return value;
}

function requireDelay(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TimerRegistryError(
      TIMER_REGISTRY_ERROR_CODES.INVALID_DELAY,
      'Timer delay must be a non-negative finite number of milliseconds.',
      { delayMs: value },
    );
  }

  return value;
}

function normalizeScope(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > MAXIMUM_SCOPE_LENGTH
  ) {
    throw new TimerRegistryError(
      TIMER_REGISTRY_ERROR_CODES.INVALID_SCOPE,
      `Timer scope must be a non-empty string of at most ${MAXIMUM_SCOPE_LENGTH} characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function resolveTimerApi(value) {
  const timerApi = value ?? globalThis;

  if (
    timerApi === null ||
    typeof timerApi !== 'object' ||
    typeof timerApi.setTimeout !== 'function' ||
    typeof timerApi.clearTimeout !== 'function' ||
    typeof timerApi.setInterval !== 'function' ||
    typeof timerApi.clearInterval !== 'function'
  ) {
    throw new TimerRegistryError(
      TIMER_REGISTRY_ERROR_CODES.INVALID_TIMER_API,
      'Timer registry requires setTimeout(), clearTimeout(), setInterval(), and clearInterval().',
    );
  }

  return Object.freeze({
    setTimeout: timerApi.setTimeout.bind(timerApi),
    clearTimeout: timerApi.clearTimeout.bind(timerApi),
    setInterval: timerApi.setInterval.bind(timerApi),
    clearInterval: timerApi.clearInterval.bind(timerApi),
  });
}

function normalizeRegistrationArguments(
  callbackOrDelay,
  delayOrCallback,
) {
  if (
    typeof callbackOrDelay === 'function' &&
    typeof delayOrCallback === 'number'
  ) {
    return {
      callback: requireCallback(callbackOrDelay),
      delayMs: requireDelay(delayOrCallback),
    };
  }

  if (
    typeof callbackOrDelay === 'number' &&
    typeof delayOrCallback === 'function'
  ) {
    return {
      callback: requireCallback(delayOrCallback),
      delayMs: requireDelay(callbackOrDelay),
    };
  }

  requireCallback(callbackOrDelay);
  requireDelay(delayOrCallback);

  return {
    callback: callbackOrDelay,
    delayMs: delayOrCallback,
  };
}

function isPromiseLike(value) {
  return (
    value !== null &&
    (typeof value === 'object' ||
      typeof value === 'function') &&
    typeof value.then === 'function'
  );
}

function createTimerMetadata(record) {
  return deepFreeze({
    key: record.key,
    type: record.type,
    scope: record.scope,
    delayMs: record.delayMs,
    generation: record.generation,
  });
}

/**
 * Error raised when timer registry input or state is invalid.
 */
export class TimerRegistryError extends Error {
  /**
   * @param {string} code Stable timer registry error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'TimerRegistryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Central registry for keyed, cancellable browser timers.
 *
 * Registering the same key replaces the previous timer by default, making
 * registrations safe across React StrictMode effect replays. Timer callbacks
 * are isolated so synchronous throws and rejected promises can be reported
 * without becoming unhandled runtime errors.
 */
export class TimerRegistry {
  /**
   * @param {{
   *   timerApi?: object,
   *   onError?: (error: unknown, metadata: Readonly<Record<string, unknown>>) => void
   * }} [options] Registry options.
   */
  constructor(options = {}) {
    const normalizedOptions = requireOptions(options);

    if (
      normalizedOptions.onError !== undefined &&
      typeof normalizedOptions.onError !== 'function'
    ) {
      throw new TimerRegistryError(
        TIMER_REGISTRY_ERROR_CODES.INVALID_OPTIONS,
        'Timer registry onError option must be a function.',
      );
    }

    this.timerApi = resolveTimerApi(normalizedOptions.timerApi);
    this.onError = normalizedOptions.onError ?? null;
    this.timers = new Map();
    this.generation = 0;
    this.destroyed = false;
    this.lastError = null;
  }

  ensureActive() {
    if (this.destroyed) {
      throw new TimerRegistryError(
        TIMER_REGISTRY_ERROR_CODES.REGISTRY_DESTROYED,
        'Timer registry has been destroyed.',
      );
    }
  }

  reportError(error, record) {
    const metadata = createTimerMetadata(record);

    this.lastError = Object.freeze({
      error,
      metadata,
    });

    if (this.onError === null) {
      return;
    }

    try {
      this.onError(error, metadata);
    } catch (reportingError) {
      this.lastError = Object.freeze({
        error: reportingError,
        metadata,
      });
    }
  }

  invoke(record) {
    if (
      this.destroyed ||
      this.timers.get(record.key) !== record
    ) {
      return;
    }

    if (
      record.type === TIMER_TYPES.INTERVAL &&
      record.running &&
      record.allowOverlap !== true
    ) {
      return;
    }

    if (record.type === TIMER_TYPES.TIMEOUT) {
      this.timers.delete(record.key);
    }

    record.running = true;

    let result;

    try {
      result = record.callback();
    } catch (error) {
      record.running = false;
      this.reportError(error, record);
      return;
    }

    if (isPromiseLike(result)) {
      Promise.resolve(result)
        .catch((error) => {
          this.reportError(error, record);
        })
        .finally(() => {
          record.running = false;
        });
      return;
    }

    record.running = false;
  }

  register(type, key, callbackOrDelay, delayOrCallback, options) {
    this.ensureActive();

    const normalizedKey = requireTimerKey(key);
    const registration = normalizeRegistrationArguments(
      callbackOrDelay,
      delayOrCallback,
    );
    const normalizedOptions = requireOptions(options);
    const replace = normalizedOptions.replace !== false;

    if (this.timers.has(normalizedKey)) {
      if (!replace) {
        throw new TimerRegistryError(
          TIMER_REGISTRY_ERROR_CODES.TIMER_ALREADY_REGISTERED,
          'A timer is already registered with this key.',
          { key: normalizedKey },
        );
      }

      this.clear(normalizedKey);
    }

    this.generation += 1;

    const record = {
      key: normalizedKey,
      type,
      callback: registration.callback,
      delayMs: registration.delayMs,
      scope: normalizeScope(
        normalizedOptions.scope ?? normalizedOptions.group,
      ),
      allowOverlap: normalizedOptions.allowOverlap === true,
      generation: this.generation,
      handle: null,
      running: false,
    };
    const invoke = () => {
      this.invoke(record);
    };

    record.handle =
      type === TIMER_TYPES.TIMEOUT
        ? this.timerApi.setTimeout(invoke, record.delayMs)
        : this.timerApi.setInterval(invoke, record.delayMs);

    this.timers.set(normalizedKey, record);

    const cancel = () => this.clearIfCurrent(
      normalizedKey,
      record.generation,
    );

    Object.defineProperty(cancel, 'key', {
      value: normalizedKey,
      enumerable: true,
    });

    return cancel;
  }

  clearIfCurrent(key, generation) {
    const record = this.timers.get(key);

    if (
      record === undefined ||
      record.generation !== generation
    ) {
      return false;
    }

    return this.clear(key);
  }

  /**
   * Registers a one-shot timeout.
   *
   * Supports `(key, callback, delayMs, options)` and
   * `(key, delayMs, callback, options)`.
   *
   * @param {string} key Stable timer key.
   * @param {Function|number} callbackOrDelay Callback or delay.
   * @param {number|Function} delayOrCallback Delay or callback.
   * @param {{scope?: string, group?: string, replace?: boolean}} [options]
   * Registration options.
   * @returns {Function} Idempotent cancellation function.
   */
  registerTimeout(
    key,
    callbackOrDelay,
    delayOrCallback,
    options = {},
  ) {
    return this.register(
      TIMER_TYPES.TIMEOUT,
      key,
      callbackOrDelay,
      delayOrCallback,
      options,
    );
  }

  /**
   * Registers a repeating interval.
   *
   * Overlapping asynchronous invocations are skipped unless
   * `allowOverlap` is true.
   *
   * @param {string} key Stable timer key.
   * @param {Function|number} callbackOrDelay Callback or delay.
   * @param {number|Function} delayOrCallback Delay or callback.
   * @param {{
   *   scope?: string,
   *   group?: string,
   *   replace?: boolean,
   *   allowOverlap?: boolean
   * }} [options] Registration options.
   * @returns {Function} Idempotent cancellation function.
   */
  registerInterval(
    key,
    callbackOrDelay,
    delayOrCallback,
    options = {},
  ) {
    return this.register(
      TIMER_TYPES.INTERVAL,
      key,
      callbackOrDelay,
      delayOrCallback,
      options,
    );
  }

  /**
   * Schedules a timeout and returns its normalized key.
   *
   * @returns {string} Registered timer key.
   */
  scheduleTimeout(
    key,
    callbackOrDelay,
    delayOrCallback,
    options = {},
  ) {
    const cancel = this.registerTimeout(
      key,
      callbackOrDelay,
      delayOrCallback,
      options,
    );

    return cancel.key;
  }

  /**
   * Schedules an interval and returns its normalized key.
   *
   * @returns {string} Registered timer key.
   */
  scheduleInterval(
    key,
    callbackOrDelay,
    delayOrCallback,
    options = {},
  ) {
    const cancel = this.registerInterval(
      key,
      callbackOrDelay,
      delayOrCallback,
      options,
    );

    return cancel.key;
  }

  /**
   * Cancels one registered timer.
   *
   * @param {string} key Timer key.
   * @returns {boolean} Whether a timer was cancelled.
   */
  clear(key) {
    const normalizedKey = requireTimerKey(key);
    const record = this.timers.get(normalizedKey);

    if (record === undefined) {
      return false;
    }

    if (record.type === TIMER_TYPES.TIMEOUT) {
      this.timerApi.clearTimeout(record.handle);
    } else {
      this.timerApi.clearInterval(record.handle);
    }

    this.timers.delete(normalizedKey);
    return true;
  }

  /**
   * Cancels every timer in a scope.
   *
   * @param {string} scope Timer scope.
   * @returns {number} Number of cancelled timers.
   */
  clearScope(scope) {
    const normalizedScope = normalizeScope(scope);

    if (normalizedScope === null) {
      throw new TimerRegistryError(
        TIMER_REGISTRY_ERROR_CODES.INVALID_SCOPE,
        'Timer scope must be a non-empty string.',
      );
    }

    const keys = [...this.timers.values()]
      .filter((record) => record.scope === normalizedScope)
      .map((record) => record.key);

    keys.forEach((key) => {
      this.clear(key);
    });

    return keys.length;
  }

  /**
   * Cancels every registered timer.
   *
   * @returns {number} Number of cancelled timers.
   */
  clearAll() {
    const keys = [...this.timers.keys()];

    keys.forEach((key) => {
      this.clear(key);
    });

    return keys.length;
  }

  /**
   * Determines whether a timer key is registered.
   *
   * @param {string} key Timer key.
   * @returns {boolean} Whether the timer exists.
   */
  has(key) {
    return this.timers.has(requireTimerKey(key));
  }

  /**
   * Returns immutable timer metadata without exposing callbacks or handles.
   *
   * @returns {Readonly<Record<string, unknown>>} Registry snapshot.
   */
  getSnapshot() {
    return deepFreeze({
      active: !this.destroyed,
      size: this.timers.size,
      keys: [...this.timers.keys()],
      timers: [...this.timers.values()].map((record) =>
        createTimerMetadata(record),
      ),
      lastError:
        this.lastError === null
          ? null
          : {
              metadata: this.lastError.metadata,
              code:
                this.lastError.error !== null &&
                typeof this.lastError.error === 'object'
                  ? this.lastError.error.code ?? null
                  : null,
              message:
                this.lastError.error instanceof Error
                  ? this.lastError.error.message
                  : 'Timer callback failed.',
            },
    });
  }

  get size() {
    return this.timers.size;
  }

  getKeys() {
    return Object.freeze([...this.timers.keys()]);
  }

  getLastError() {
    return this.lastError;
  }

  clearLastError() {
    const previous = this.lastError;

    this.lastError = null;
    return previous;
  }

  cancel(key) {
    return this.clear(key);
  }

  cancelScope(scope) {
    return this.clearScope(scope);
  }

  cancelAll() {
    return this.clearAll();
  }

  setTimeout(
    key,
    callbackOrDelay,
    delayOrCallback,
    options = {},
  ) {
    return this.registerTimeout(
      key,
      callbackOrDelay,
      delayOrCallback,
      options,
    );
  }

  setInterval(
    key,
    callbackOrDelay,
    delayOrCallback,
    options = {},
  ) {
    return this.registerInterval(
      key,
      callbackOrDelay,
      delayOrCallback,
      options,
    );
  }

  remove(key) {
    return this.clear(key);
  }

  stop(key) {
    return this.clear(key);
  }

  stopAll() {
    return this.clearAll();
  }

  /**
   * Cancels all timers and permanently disables this registry.
   *
   * @returns {number} Number of cancelled timers.
   */
  destroy() {
    if (this.destroyed) {
      return 0;
    }

    const count = this.clearAll();

    this.destroyed = true;
    return count;
  }

  dispose() {
    return this.destroy();
  }
}

/**
 * Creates an isolated timer registry.
 *
 * @param {ConstructorParameters<typeof TimerRegistry>[0]} [options]
 * Registry options.
 * @returns {TimerRegistry} Timer registry.
 */
export function createTimerRegistry(options = {}) {
  return new TimerRegistry(options);
}

export const timerRegistry = createTimerRegistry();

export const CentralTimerRegistry = TimerRegistry;
export const BrowserTimerRegistry = TimerRegistry;
export const createCentralTimerRegistry = createTimerRegistry;
export const createBrowserTimerRegistry = createTimerRegistry;

export default timerRegistry;