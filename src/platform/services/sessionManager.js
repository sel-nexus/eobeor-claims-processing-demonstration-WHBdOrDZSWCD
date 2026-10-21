import { browserClock, toDate } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
  isSession,
} from '../validation/schemas.js';

export const SESSION_MANAGER_SLICE = 'session';

export const SESSION_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  WARNING: 'WARNING',
  EXPIRED: 'EXPIRED',
  SIGNED_OUT: 'SIGNED_OUT',
});

export const SESSION_EVENT_TYPES = Object.freeze({
  CREATED: 'SESSION_CREATED',
  ACTIVITY_RECORDED: 'SESSION_ACTIVITY_RECORDED',
  WARNING: 'SESSION_WARNING',
  EXPIRED: 'SESSION_EXPIRED',
  SIGNED_OUT: 'SESSION_SIGNED_OUT',
  CHANGED: 'SESSION_CHANGED',
  ERROR: 'SESSION_ERROR',
});

export const SESSION_SIGN_OUT_REASONS = Object.freeze({
  USER_REQUESTED: 'USER_REQUESTED',
  EXPIRED: 'EXPIRED',
  ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
  EXTERNAL: 'EXTERNAL',
});

export const SESSION_MANAGER_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_SESSION: 'INVALID_SESSION',
  INVALID_ACTOR: 'INVALID_ACTOR',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_TIMEOUT: 'INVALID_TIMEOUT',
  INVALID_WARNING_WINDOW: 'INVALID_WARNING_WINDOW',
  INVALID_ACTIVITY_THROTTLE: 'INVALID_ACTIVITY_THROTTLE',
  INVALID_EVENT_TARGET: 'INVALID_EVENT_TARGET',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  MANAGER_DESTROYED: 'MANAGER_DESTROYED',
});

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
export const DEFAULT_SESSION_WARNING_MINUTES = 1;
export const DEFAULT_ACTIVITY_THROTTLE_MS = 15000;
export const DEFAULT_SESSION_TICK_INTERVAL_MS = 1000;

const MINIMUM_SESSION_TIMEOUT_MINUTES = 2;
const MAXIMUM_SESSION_TIMEOUT_MINUTES = 240;
const MINIMUM_TICK_INTERVAL_MS = 100;
const ACTIVITY_EVENT_NAMES = Object.freeze([
  'keydown',
  'pointerdown',
  'touchstart',
  'focus',
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

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_GATEWAY,
      'Session manager requires a storage gateway with read() and commit().',
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

function requireTimeoutMinutes(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < MINIMUM_SESSION_TIMEOUT_MINUTES ||
    value > MAXIMUM_SESSION_TIMEOUT_MINUTES
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_TIMEOUT,
      `Session timeout must be an integer between ${MINIMUM_SESSION_TIMEOUT_MINUTES} and ${MAXIMUM_SESSION_TIMEOUT_MINUTES} minutes.`,
      { timeoutMinutes: value },
    );
  }

  return value;
}

function requireWarningMinutes(value, timeoutMinutes) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value >= timeoutMinutes
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_WARNING_WINDOW,
      'Session warning window must be greater than zero and shorter than the session timeout.',
      {
        warningMinutes: value,
        timeoutMinutes,
      },
    );
  }

  return value;
}

function requireActivityThrottle(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_ACTIVITY_THROTTLE,
      'Session activity throttle must be a non-negative finite number of milliseconds.',
      { activityThrottleMs: value },
    );
  }

  return value;
}

function requireTickInterval(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < MINIMUM_TICK_INTERVAL_MS
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_OPTIONS,
      `Session tick interval must be at least ${MINIMUM_TICK_INTERVAL_MS} milliseconds.`,
      { tickIntervalMs: value },
    );
  }

  return value;
}

function requireEventTarget(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.addEventListener !== 'function' ||
    typeof value.removeEventListener !== 'function'
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_EVENT_TARGET,
      'Session activity target must provide addEventListener() and removeEventListener().',
    );
  }

  return value;
}

function getCurrentDate(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Session manager clock must provide now() or nowIso().',
    );
  }

  try {
    return toDate(value);
  } catch (error) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_TIMESTAMP,
      'Session manager clock returned an invalid timestamp.',
      undefined,
      error,
    );
  }
}

function normalizeDate(value, clock, name) {
  if (value === undefined || value === null) {
    return getCurrentDate(clock);
  }

  try {
    return toDate(value);
  } catch (error) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_TIMESTAMP,
      `${name} must be a valid date or timestamp.`,
      undefined,
      error,
    );
  }
}

function createSessionId(idGenerator) {
  const generated = idGenerator();

  if (typeof generated !== 'string' || generated.trim().length === 0) {
    throw new TypeError(
      'Session manager ID generator must return a non-empty string.',
    );
  }

  const identifier = generated.normalize('NFC').trim();

  return identifier.startsWith('ses_')
    ? identifier
    : `ses_${identifier}`;
}

function normalizeActor(value) {
  if (!isPlainObject(value)) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_ACTOR,
      'Session actor must be a plain object.',
    );
  }

  const userId =
    typeof value.userId === 'string'
      ? value.userId.normalize('NFC').trim()
      : '';
  const displayName =
    typeof value.displayName === 'string'
      ? value.displayName.normalize('NFC').trim()
      : '';
  const role =
    typeof value.role === 'string'
      ? value.role.trim().toUpperCase()
      : value.role;

  if (
    userId.length === 0 ||
    displayName.length === 0 ||
    !isPlatformRole(role)
  ) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_ACTOR,
      'Session actor must include a user ID, display name, and supported role.',
    );
  }

  return Object.freeze({
    userId,
    displayName,
    role,
  });
}

function resolveConfiguredTimeout(envelope, configuredTimeoutMinutes) {
  if (configuredTimeoutMinutes !== null) {
    return configuredTimeoutMinutes;
  }

  const settings = envelope?.slices?.settings;
  const timeoutMinutes = settings?.sessionTimeoutMinutes;

  return Number.isSafeInteger(timeoutMinutes) &&
    timeoutMinutes >= MINIMUM_SESSION_TIMEOUT_MINUTES &&
    timeoutMinutes <= MAXIMUM_SESSION_TIMEOUT_MINUTES
    ? timeoutMinutes
    : DEFAULT_SESSION_TIMEOUT_MINUTES;
}

function calculateExpiry(lastActivityAt, timeoutMinutes) {
  return new Date(
    Date.parse(lastActivityAt) + timeoutMinutes * 60 * 1000,
  ).toISOString();
}

function normalizeStoredSession(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isSession(value)) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_SESSION,
      'Persisted session does not satisfy its schema.',
    );
  }

  return deepFreeze(value);
}

function readSession(envelope, sliceName) {
  if (envelope === null || !isPlainObject(envelope.slices)) {
    return null;
  }

  return normalizeStoredSession(envelope.slices[sliceName]);
}

function buildNextState(envelope, sliceName, session) {
  const slices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...slices,
      [sliceName]: session,
    },
  };
}

function calculateStatus(session, now, warningMinutes) {
  if (session === null) {
    return SESSION_STATUSES.SIGNED_OUT;
  }

  const remainingMs =
    Date.parse(session.expiresAt) - now.getTime();

  if (remainingMs <= 0) {
    return SESSION_STATUSES.EXPIRED;
  }

  if (remainingMs <= warningMinutes * 60 * 1000) {
    return SESSION_STATUSES.WARNING;
  }

  return SESSION_STATUSES.ACTIVE;
}

function normalizePersistenceError(error) {
  if (error instanceof SessionManagerError) {
    return error;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    error.code === 'REVISION_CONFLICT'
  ) {
    return new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.REVISION_CONFLICT,
      'Persisted session changed before the update.',
      error.details,
      error,
    );
  }

  return new SessionManagerError(
    SESSION_MANAGER_ERROR_CODES.PERSISTENCE_FAILED,
    'Session data could not be persisted.',
    {
      persistenceCode:
        error !== null && typeof error === 'object'
          ? error.code ?? null
          : null,
    },
    error,
  );
}

function normalizeSignOutReason(value) {
  if (value === undefined || value === null) {
    return SESSION_SIGN_OUT_REASONS.USER_REQUESTED;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SessionManagerError(
      SESSION_MANAGER_ERROR_CODES.INVALID_OPTIONS,
      'Session sign-out reason must be a non-empty string.',
    );
  }

  return value.normalize('NFC').trim().toUpperCase();
}

/**
 * Error raised when session state or manager input is invalid.
 */
export class SessionManagerError extends Error {
  /**
   * @param {string} code Stable session manager error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SessionManagerError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Manages one browser-local inactivity session.
 *
 * Activity updates are held in memory and persisted at most once per throttle
 * interval. The manager subscribes to the storage gateway so sign-out and
 * session changes in another tab are reflected locally.
 */
export class SessionManager {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or options containing `gateway` or `storageGateway`.
   * @param {{
   *   sliceName?: string,
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   timeoutMinutes?: number,
   *   warningMinutes?: number,
   *   activityThrottleMs?: number,
   *   tickIntervalMs?: number,
   *   eventTarget?: EventTarget,
   *   documentTarget?: Document,
   *   autoStart?: boolean
   * }} [options] Manager options.
   */
  constructor(gatewayOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      gatewayOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    if (!isPlainObject(normalizedOptions)) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_OPTIONS,
        'Session manager options must be a plain object.',
      );
    }

    this.gateway = requireGateway(resolved.gateway);
    this.sliceName =
      typeof normalizedOptions.sliceName === 'string' &&
      normalizedOptions.sliceName.trim().length > 0
        ? normalizedOptions.sliceName.trim()
        : SESSION_MANAGER_SLICE;
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;
    this.configuredTimeoutMinutes =
      normalizedOptions.timeoutMinutes === undefined
        ? null
        : requireTimeoutMinutes(
            normalizedOptions.timeoutMinutes,
          );
    const initialTimeout =
      this.configuredTimeoutMinutes ??
      DEFAULT_SESSION_TIMEOUT_MINUTES;

    this.warningMinutes = requireWarningMinutes(
      normalizedOptions.warningMinutes ??
        DEFAULT_SESSION_WARNING_MINUTES,
      initialTimeout,
    );
    this.activityThrottleMs = requireActivityThrottle(
      normalizedOptions.activityThrottleMs ??
        DEFAULT_ACTIVITY_THROTTLE_MS,
    );
    this.tickIntervalMs = requireTickInterval(
      normalizedOptions.tickIntervalMs ??
        DEFAULT_SESSION_TICK_INTERVAL_MS,
    );
    this.eventTarget =
      normalizedOptions.eventTarget ??
      (typeof globalThis.addEventListener === 'function'
        ? globalThis
        : null);
    this.documentTarget =
      normalizedOptions.documentTarget ??
      globalThis.document ??
      null;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Session manager ID generator must be a function.',
      );
    }

    if (this.eventTarget !== null) {
      requireEventTarget(this.eventTarget);
    }

    if (
      this.documentTarget !== null &&
      (typeof this.documentTarget.addEventListener !== 'function' ||
        typeof this.documentTarget.removeEventListener !== 'function')
    ) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_EVENT_TARGET,
        'Session document target must provide addEventListener() and removeEventListener().',
      );
    }

    this.listeners = new Set();
    this.pendingActivityAt = null;
    this.activityTimer = null;
    this.tickTimer = null;
    this.started = false;
    this.destroyed = false;
    this.isCommitting = false;
    this.lastStatus = null;
    this.lastSignOutReason = null;

    let envelope;

    try {
      envelope = this.gateway.read();
      this.currentSession = readSession(envelope, this.sliceName);
    } catch (error) {
      throw normalizePersistenceError(error);
    }

    this.handleBrowserActivity = () => {
      if (!this.destroyed && this.currentSession !== null) {
        try {
          this.recordActivity();
        } catch (error) {
          this.emitError(normalizePersistenceError(error));
        }
      }
    };

    this.handleVisibilityChange = () => {
      if (
        this.documentTarget?.visibilityState !== 'hidden'
      ) {
        this.handleBrowserActivity();
      }
    };

    this.unsubscribeGateway =
      typeof this.gateway.subscribe === 'function'
        ? this.gateway.subscribe(() => {
            if (!this.destroyed && !this.isCommitting) {
              this.refreshFromStorage();
            }
          })
        : () => {};

    if (normalizedOptions.autoStart === true) {
      this.start();
    }
  }

  ensureActive() {
    if (this.destroyed) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.MANAGER_DESTROYED,
        'Session manager has been destroyed.',
      );
    }
  }

  getTimeoutMinutes(envelope = undefined) {
    const source =
      envelope === undefined ? this.gateway.read() : envelope;

    return resolveConfiguredTimeout(
      source,
      this.configuredTimeoutMinutes,
    );
  }

  createEffectiveSession(session, envelope = undefined) {
    if (session === null) {
      return null;
    }

    const lastActivityAt =
      this.pendingActivityAt !== null &&
      Date.parse(this.pendingActivityAt) >
        Date.parse(session.lastActivityAt)
        ? this.pendingActivityAt
        : session.lastActivityAt;
    const timeoutMinutes = this.getTimeoutMinutes(envelope);
    const effective = {
      ...session,
      lastActivityAt,
      expiresAt: calculateExpiry(
        lastActivityAt,
        timeoutMinutes,
      ),
    };

    if (!isSession(effective)) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_SESSION,
        'Computed session does not satisfy its schema.',
      );
    }

    return deepFreeze(effective);
  }

  createEvent(type, options = {}) {
    const now = getCurrentDate(this.clock);
    const session =
      options.session === undefined
        ? this.getSession()
        : options.session;
    const status =
      options.status ??
      calculateStatus(session, now, this.warningMinutes);

    return deepFreeze({
      type,
      status,
      session,
      reason: options.reason ?? null,
      occurredAt: now.toISOString(),
      error: options.error ?? null,
    });
  }

  notify(event) {
    [...this.listeners].forEach((listener) => {
      listener(event);
    });
  }

  emitError(error) {
    this.notify(
      this.createEvent(SESSION_EVENT_TYPES.ERROR, {
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  commitSession(session, eventType, reason = null) {
    let envelope;

    try {
      envelope = this.gateway.read();
      const revision = envelope?.rootRevision ?? 0;

      this.isCommitting = true;
      this.gateway.commit(
        revision,
        buildNextState(envelope, this.sliceName, session),
        {},
      );
    } catch (error) {
      throw normalizePersistenceError(error);
    } finally {
      this.isCommitting = false;
    }

    this.currentSession = session;
    this.pendingActivityAt = null;
    this.clearActivityTimer();

    const event = this.createEvent(eventType, {
      session,
      reason,
    });

    this.lastStatus = event.status;
    this.lastSignOutReason = reason;
    this.notify(event);

    return session;
  }

  /**
   * Creates and persists a local session for an authenticated demo actor.
   *
   * @param {Record<string, unknown>} actor Actor identity.
   * @param {{now?: Date|string|number, sessionId?: string}} [options]
   * Creation options.
   * @returns {Readonly<Record<string, unknown>>} Created session.
   */
  createSession(actor, options = {}) {
    this.ensureActive();

    if (!isPlainObject(options)) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_OPTIONS,
        'Session creation options must be a plain object.',
      );
    }

    const normalizedActor = normalizeActor(actor);
    const now = normalizeDate(
      options.now,
      this.clock,
      'Session creation time',
    );
    const envelope = this.gateway.read();
    const timeoutMinutes = this.getTimeoutMinutes(envelope);
    const createdAt = now.toISOString();
    const sessionId =
      options.sessionId === undefined
        ? createSessionId(this.idGenerator)
        : createSessionId(() => options.sessionId);
    const session = {
      sessionId,
      userId: normalizedActor.userId,
      displayName: normalizedActor.displayName,
      role: normalizedActor.role,
      createdAt,
      lastActivityAt: createdAt,
      expiresAt: calculateExpiry(
        createdAt,
        timeoutMinutes,
      ),
    };

    if (!isSession(session)) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_SESSION,
        'Created session does not satisfy its schema.',
      );
    }

    return this.commitSession(
      deepFreeze(session),
      SESSION_EVENT_TYPES.CREATED,
    );
  }

  /**
   * Returns the current session including any throttled activity update.
   *
   * @returns {Readonly<Record<string, unknown>>|null} Current session.
   */
  getSession() {
    this.ensureActive();

    return this.createEffectiveSession(this.currentSession);
  }

  /**
   * Returns current session state and inactivity metadata.
   *
   * @param {Date|string|number} [now] Evaluation time.
   * @returns {Readonly<Record<string, unknown>>} Session snapshot.
   */
  getSnapshot(now = undefined) {
    this.ensureActive();

    const currentDate = normalizeDate(
      now,
      this.clock,
      'Session evaluation time',
    );
    const session = this.getSession();
    const status = calculateStatus(
      session,
      currentDate,
      this.warningMinutes,
    );
    const remainingMs =
      session === null
        ? 0
        : Math.max(
            0,
            Date.parse(session.expiresAt) -
              currentDate.getTime(),
          );

    return deepFreeze({
      status,
      session,
      timeoutMinutes: this.getTimeoutMinutes(),
      warningMinutes: this.warningMinutes,
      remainingMs,
      pendingActivity:
        this.pendingActivityAt !== null,
      started: this.started,
      lastSignOutReason: this.lastSignOutReason,
    });
  }

  scheduleActivityFlush() {
    if (
      this.activityTimer !== null ||
      this.pendingActivityAt === null ||
      this.currentSession === null
    ) {
      return;
    }

    const elapsed =
      Date.parse(this.pendingActivityAt) -
      Date.parse(this.currentSession.lastActivityAt);
    const delay = Math.max(
      0,
      this.activityThrottleMs - elapsed,
    );

    this.activityTimer = globalThis.setTimeout(() => {
      this.activityTimer = null;

      if (
        this.destroyed ||
        this.pendingActivityAt === null ||
        this.currentSession === null
      ) {
        return;
      }

      try {
        this.flushActivity();
      } catch (error) {
        this.emitError(normalizePersistenceError(error));
      }
    }, delay);
  }

  clearActivityTimer() {
    if (this.activityTimer !== null) {
      globalThis.clearTimeout(this.activityTimer);
      this.activityTimer = null;
    }
  }

  /**
   * Records browser activity and throttles persistence writes.
   *
   * @param {Date|string|number} [now] Activity time.
   * @returns {Readonly<Record<string, unknown>>|null} Effective session.
   */
  recordActivity(now = undefined) {
    this.ensureActive();

    if (this.currentSession === null) {
      return null;
    }

    const activityDate = normalizeDate(
      now,
      this.clock,
      'Session activity time',
    );
    const activityAt = activityDate.toISOString();
    const currentActivityMs = Date.parse(
      this.currentSession.lastActivityAt,
    );
    const pendingActivityMs =
      this.pendingActivityAt === null
        ? currentActivityMs
        : Date.parse(this.pendingActivityAt);

    if (activityDate.getTime() < pendingActivityMs) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_TIMESTAMP,
        'Session activity time cannot move backwards.',
        {
          previousActivityAt:
            this.pendingActivityAt ??
            this.currentSession.lastActivityAt,
          activityAt,
        },
      );
    }

    this.pendingActivityAt = activityAt;

    if (
      this.activityThrottleMs === 0 ||
      activityDate.getTime() - currentActivityMs >=
        this.activityThrottleMs
    ) {
      return this.flushActivity();
    }

    this.scheduleActivityFlush();
    return this.getSession();
  }

  /**
   * Persists the latest throttled activity value.
   *
   * @returns {Readonly<Record<string, unknown>>|null} Persisted session.
   */
  flushActivity() {
    this.ensureActive();

    if (
      this.currentSession === null ||
      this.pendingActivityAt === null
    ) {
      return this.currentSession;
    }

    const activityAt = this.pendingActivityAt;
    const timeoutMinutes = this.getTimeoutMinutes();
    const session = {
      ...this.currentSession,
      lastActivityAt: activityAt,
      expiresAt: calculateExpiry(
        activityAt,
        timeoutMinutes,
      ),
    };

    if (!isSession(session)) {
      throw new SessionManagerError(
        SESSION_MANAGER_ERROR_CODES.INVALID_SESSION,
        'Updated session does not satisfy its schema.',
      );
    }

    return this.commitSession(
      deepFreeze(session),
      SESSION_EVENT_TYPES.ACTIVITY_RECORDED,
    );
  }

  /**
   * Evaluates inactivity and clears an expired session.
   *
   * @param {Date|string|number} [now] Evaluation time.
   * @returns {'ACTIVE'|'WARNING'|'EXPIRED'|'SIGNED_OUT'} Session status.
   */
  tick(now = undefined) {
    this.ensureActive();

    const currentDate = normalizeDate(
      now,
      this.clock,
      'Session evaluation time',
    );
    const session = this.getSession();
    const status = calculateStatus(
      session,
      currentDate,
      this.warningMinutes,
    );

    if (status === SESSION_STATUSES.EXPIRED) {
      this.signOut(SESSION_SIGN_OUT_REASONS.EXPIRED);
      this.lastStatus = SESSION_STATUSES.EXPIRED;
      return SESSION_STATUSES.EXPIRED;
    }

    if (
      status === SESSION_STATUSES.WARNING &&
      this.lastStatus !== SESSION_STATUSES.WARNING
    ) {
      this.notify(
        this.createEvent(SESSION_EVENT_TYPES.WARNING, {
          session,
          status,
        }),
      );
    }

    this.lastStatus = status;
    return status;
  }

  /**
   * Clears the current persisted session.
   *
   * @param {string} [reason] Sign-out reason.
   * @returns {boolean} Whether a session existed.
   */
  signOut(reason = SESSION_SIGN_OUT_REASONS.USER_REQUESTED) {
    this.ensureActive();

    const normalizedReason = normalizeSignOutReason(reason);
    const existed =
      this.currentSession !== null ||
      this.pendingActivityAt !== null;

    if (!existed) {
      this.lastSignOutReason = normalizedReason;
      return false;
    }

    this.commitSession(
      null,
      normalizedReason ===
        SESSION_SIGN_OUT_REASONS.EXPIRED
        ? SESSION_EVENT_TYPES.EXPIRED
        : SESSION_EVENT_TYPES.SIGNED_OUT,
      normalizedReason,
    );

    return true;
  }

  /**
   * Overrides the configured timeout and recalculates the active session.
   *
   * @param {number|null} timeoutMinutes Timeout override, or null to use
   * persisted settings.
   * @param {Date|string|number} [now] Evaluation time.
   * @returns {Readonly<Record<string, unknown>>|null} Updated session.
   */
  setTimeoutMinutes(timeoutMinutes, now = undefined) {
    this.ensureActive();

    this.configuredTimeoutMinutes =
      timeoutMinutes === null
        ? null
        : requireTimeoutMinutes(timeoutMinutes);

    const effectiveTimeout =
      this.getTimeoutMinutes();

    requireWarningMinutes(
      this.warningMinutes,
      effectiveTimeout,
    );

    if (this.currentSession === null) {
      return null;
    }

    const lastActivityAt =
      this.pendingActivityAt ??
      this.currentSession.lastActivityAt;
    const session = deepFreeze({
      ...this.currentSession,
      lastActivityAt,
      expiresAt: calculateExpiry(
        lastActivityAt,
        effectiveTimeout,
      ),
    });
    const currentDate = normalizeDate(
      now,
      this.clock,
      'Session timeout evaluation time',
    );

    if (
      calculateStatus(
        session,
        currentDate,
        this.warningMinutes,
      ) === SESSION_STATUSES.EXPIRED
    ) {
      this.signOut(SESSION_SIGN_OUT_REASONS.EXPIRED);
      return null;
    }

    return this.commitSession(
      session,
      SESSION_EVENT_TYPES.CHANGED,
      'TIMEOUT_CHANGED',
    );
  }

  /**
   * Updates the inactivity warning window.
   *
   * @param {number} warningMinutes Warning window in minutes.
   * @returns {number} Updated warning window.
   */
  setWarningMinutes(warningMinutes) {
    this.ensureActive();

    this.warningMinutes = requireWarningMinutes(
      warningMinutes,
      this.getTimeoutMinutes(),
    );

    return this.warningMinutes;
  }

  refreshFromStorage() {
    this.ensureActive();

    let envelope;
    let nextSession;

    try {
      envelope = this.gateway.read();
      nextSession = readSession(envelope, this.sliceName);
    } catch (error) {
      this.emitError(normalizePersistenceError(error));
      return this.currentSession;
    }

    const previousSession = this.currentSession;
    const previousSessionId = previousSession?.sessionId ?? null;
    const nextSessionId = nextSession?.sessionId ?? null;

    if (
      previousSessionId === nextSessionId &&
      previousSession?.lastActivityAt ===
        nextSession?.lastActivityAt &&
      previousSession?.expiresAt === nextSession?.expiresAt &&
      previousSession?.role === nextSession?.role
    ) {
      return this.currentSession;
    }

    this.currentSession = nextSession;
    this.pendingActivityAt = null;
    this.clearActivityTimer();

    const externallySignedOut =
      previousSession !== null && nextSession === null;
    const reason = externallySignedOut
      ? SESSION_SIGN_OUT_REASONS.EXTERNAL
      : null;
    const eventType = externallySignedOut
      ? SESSION_EVENT_TYPES.SIGNED_OUT
      : SESSION_EVENT_TYPES.CHANGED;
    const event = this.createEvent(eventType, {
      session: nextSession,
      reason,
    });

    this.lastStatus = event.status;
    this.lastSignOutReason = reason;
    this.notify(event);

    return nextSession;
  }

  /**
   * Starts browser activity listeners and inactivity ticks.
   *
   * @returns {() => void} Stop function.
   */
  start() {
    this.ensureActive();

    if (this.started) {
      return () => this.stop();
    }

    if (this.eventTarget !== null) {
      ACTIVITY_EVENT_NAMES.forEach((eventName) => {
        this.eventTarget.addEventListener(
          eventName,
          this.handleBrowserActivity,
          { passive: true },
        );
      });
    }

    if (this.documentTarget !== null) {
      this.documentTarget.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );
    }

    this.tickTimer = globalThis.setInterval(() => {
      if (!this.destroyed) {
        try {
          this.tick();
        } catch (error) {
          this.emitError(normalizePersistenceError(error));
        }
      }
    }, this.tickIntervalMs);
    this.started = true;

    return () => this.stop();
  }

  /**
   * Stops browser activity listeners and inactivity ticks.
   *
   * @returns {boolean} Whether the manager was running.
   */
  stop() {
    if (!this.started) {
      return false;
    }

    if (this.eventTarget !== null) {
      ACTIVITY_EVENT_NAMES.forEach((eventName) => {
        this.eventTarget.removeEventListener(
          eventName,
          this.handleBrowserActivity,
        );
      });
    }

    if (this.documentTarget !== null) {
      this.documentTarget.removeEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );
    }

    if (this.tickTimer !== null) {
      globalThis.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.started = false;
    return true;
  }

  /**
   * Subscribes to session lifecycle events.
   *
   * @param {(event: Readonly<Record<string, unknown>>) => void} listener
   * Session listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Session manager listener must be a function.',
      );
    }

    this.ensureActive();
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Releases timers, browser listeners, and storage subscriptions.
   *
   * @returns {void}
   */
  destroy() {
    if (this.destroyed) {
      return;
    }

    this.stop();
    this.clearActivityTimer();
    this.unsubscribeGateway();
    this.unsubscribeGateway = () => {};
    this.listeners.clear();
    this.pendingActivityAt = null;
    this.destroyed = true;
  }

  create(actor, options = {}) {
    return this.createSession(actor, options);
  }

  startSession(actor, options = {}) {
    return this.createSession(actor, options);
  }

  recordUserActivity(now = undefined) {
    return this.recordActivity(now);
  }

  evaluate(now = undefined) {
    return this.tick(now);
  }

  getState(now = undefined) {
    return this.getSnapshot(now);
  }

  clear(reason = SESSION_SIGN_OUT_REASONS.USER_REQUESTED) {
    return this.signOut(reason);
  }

  configureTimeout(timeoutMinutes, now = undefined) {
    return this.setTimeoutMinutes(timeoutMinutes, now);
  }

  startActivityTracking() {
    return this.start();
  }

  stopActivityTracking() {
    return this.stop();
  }
}

/**
 * Creates a browser-local session manager.
 *
 * @param {ConstructorParameters<typeof SessionManager>[0]}
 * gatewayOrOptions Gateway or manager options.
 * @param {ConstructorParameters<typeof SessionManager>[1]} [options]
 * Manager options.
 * @returns {SessionManager} Session manager.
 */
export function createSessionManager(
  gatewayOrOptions,
  options = {},
) {
  return new SessionManager(gatewayOrOptions, options);
}

export const LocalSessionManager = SessionManager;
export const BrowserSessionManager = SessionManager;
export const createLocalSessionManager = createSessionManager;

export default SessionManager;