import {
  DEMO_CREDENTIAL_NOTICE,
  DEMO_MFA_CODE,
  DEMO_PASSWORD,
  SEEDED_ACCOUNTS,
} from '../../fixtures/accounts.js';
import { browserClock } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';
import { isPlainObject } from '../validation/schemas.js';

export const AUTH_FACADE_SCHEMA_VERSION = 1;

export const AUTH_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_DEMO_CREDENTIALS: 'INVALID_DEMO_CREDENTIALS',
  DEMO_THROTTLED: 'DEMO_THROTTLED',
  SESSION_UNAVAILABLE: 'SESSION_UNAVAILABLE',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  LOCAL_STORAGE_QUOTA: 'LOCAL_STORAGE_QUOTA',
  SIGN_IN_FAILED: 'SIGN_IN_FAILED',
  SIGN_OUT_FAILED: 'SIGN_OUT_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const AUTH_AUDIT_ACTIONS = Object.freeze({
  SIGN_IN: 'SIGN_IN',
});

export const AUTH_THROTTLE_DEFAULTS = Object.freeze({
  maximumFailures: 5,
  failureWindowMs: 60_000,
  throttleDurationMs: 30_000,
});

const DEMO_DISCLOSURE =
  'Demo only — no credentials are transmitted.';

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

function requireSessionManager(value) {
  const canCreateSession =
    value !== null &&
    typeof value === 'object' &&
    (typeof value.createSession === 'function' ||
      typeof value.startSession === 'function' ||
      typeof value.create === 'function');
  const canReadSession =
    value !== null &&
    typeof value === 'object' &&
    (typeof value.getSession === 'function' ||
      typeof value.getSnapshot === 'function' ||
      typeof value.getState === 'function');
  const canSignOut =
    value !== null &&
    typeof value === 'object' &&
    (typeof value.signOut === 'function' ||
      typeof value.clear === 'function');

  if (!canCreateSession || !canReadSession || !canSignOut) {
    throw new AuthFacadeError(
      AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Auth facade requires a session manager that can create, read, and clear sessions.',
    );
  }

  return value;
}

function requireAuditService(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.append !== 'function'
  ) {
    throw new AuthFacadeError(
      AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Auth facade requires an audit service with append().',
    );
  }

  return value;
}

function resolveConstructorArguments(
  sessionManagerOrOptions,
  options,
) {
  if (
    isPlainObject(sessionManagerOrOptions) &&
    (sessionManagerOrOptions.sessionManager !== undefined ||
      sessionManagerOrOptions.auditService !== undefined)
  ) {
    return {
      sessionManager: sessionManagerOrOptions.sessionManager,
      auditService: sessionManagerOrOptions.auditService,
      options: sessionManagerOrOptions,
    };
  }

  const normalizedOptions = isPlainObject(options) ? options : {};

  return {
    sessionManager: sessionManagerOrOptions,
    auditService: normalizedOptions.auditService,
    options: normalizedOptions,
  };
}

function normalizeAccounts(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AuthFacadeError(
      AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Auth facade accounts must be a non-empty array.',
    );
  }

  const usernames = new Set();

  value.forEach((account) => {
    if (
      !isPlainObject(account) ||
      typeof account.userId !== 'string' ||
      account.userId.trim().length === 0 ||
      typeof account.username !== 'string' ||
      account.username.trim().length === 0 ||
      typeof account.displayName !== 'string' ||
      account.displayName.trim().length === 0 ||
      typeof account.role !== 'string' ||
      !isPlainObject(account.credentials)
    ) {
      throw new AuthFacadeError(
        AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Auth facade account data is invalid.',
      );
    }

    const username = account.username.trim().toLocaleLowerCase('en-US');

    if (usernames.has(username)) {
      throw new AuthFacadeError(
        AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Auth facade account usernames must be unique.',
      );
    }

    usernames.add(username);
  });

  return value;
}

function requirePositiveInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AuthFacadeError(
      AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      `${name} must be a positive safe integer.`,
    );
  }

  return value;
}

function requireNonNegativeNumber(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new AuthFacadeError(
      AUTH_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      `${name} must be a non-negative finite number.`,
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
      'Auth facade clock must provide now() or nowIso().',
    );
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Auth facade clock must provide a valid timestamp.',
    );
  }

  return date;
}

function createCorrelationId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Auth facade ID generator must return a non-empty string.',
    );
  }

  return value.normalize('NFC').trim();
}

function normalizeSignInRequest(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  if (
    typeof value.username !== 'string' ||
    typeof value.password !== 'string' ||
    typeof value.mfaCode !== 'string' ||
    typeof value.requestedRole !== 'string'
  ) {
    return null;
  }

  const username = value.username
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('en-US');
  const requestedRole = value.requestedRole
    .normalize('NFC')
    .trim()
    .toUpperCase();

  if (
    username.length === 0 ||
    username.length > 80 ||
    value.password.length > 200 ||
    value.mfaCode.length > 20 ||
    requestedRole.length === 0 ||
    requestedRole.length > 40
  ) {
    return null;
  }

  return {
    username,
    password: value.password,
    mfaCode: value.mfaCode,
    requestedRole,
  };
}

function findValidAccount(accounts, request) {
  if (request === null) {
    return null;
  }

  const account = accounts.find(
    (candidate) =>
      candidate.username.toLocaleLowerCase('en-US') ===
      request.username,
  );

  if (
    account === undefined ||
    account.active !== true ||
    account.role !== request.requestedRole ||
    account.credentials.requestedRole !== request.requestedRole ||
    account.credentials.localOnly !== true ||
    request.password !== DEMO_PASSWORD ||
    request.mfaCode !== DEMO_MFA_CODE ||
    request.password !== account.credentials.password ||
    request.mfaCode !== account.credentials.mfaCode ||
    account.credentials.mfaRequired !== true
  ) {
    return null;
  }

  return account;
}

function createSuccess(status, data, correlationId) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      schemaVersion: AUTH_FACADE_SCHEMA_VERSION,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      correlationId,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: options.retryAfterMs }),
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
    },
  });
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizeOperationFailure(
  error,
  fallbackCode,
  fallbackMessage,
  correlationId,
) {
  const code = getErrorCode(error);

  if (code === 'REVISION_CONFLICT') {
    return createFailure(
      409,
      AUTH_FACADE_ERROR_CODES.REVISION_CONFLICT,
      'Local session data changed before the operation completed.',
      correlationId,
      { retryable: true },
    );
  }

  if (
    code === 'STORAGE_QUOTA_EXCEEDED' ||
    code === 'LOCAL_STORAGE_QUOTA'
  ) {
    return createFailure(
      507,
      AUTH_FACADE_ERROR_CODES.LOCAL_STORAGE_QUOTA,
      'Browser-local storage quota was exceeded.',
      correlationId,
      {
        recoveryAction: 'EXPORT_SNAPSHOT',
      },
    );
  }

  return createFailure(
    500,
    fallbackCode,
    fallbackMessage,
    correlationId,
  );
}

function createSession(sessionManager, actor) {
  if (typeof sessionManager.createSession === 'function') {
    return sessionManager.createSession(actor);
  }

  if (typeof sessionManager.startSession === 'function') {
    return sessionManager.startSession(actor);
  }

  return sessionManager.create(actor);
}

function clearSession(sessionManager, reason) {
  if (typeof sessionManager.signOut === 'function') {
    return sessionManager.signOut(reason);
  }

  return sessionManager.clear(reason);
}

function readSession(sessionManager) {
  if (typeof sessionManager.getSession === 'function') {
    return sessionManager.getSession();
  }

  const snapshot =
    typeof sessionManager.getSnapshot === 'function'
      ? sessionManager.getSnapshot()
      : sessionManager.getState();

  return snapshot?.session ?? null;
}

/**
 * Error raised when auth facade configuration is invalid.
 */
export class AuthFacadeError extends Error {
  /**
   * @param {string} code Stable auth facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AuthFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Browser-local authentication facade for seeded demonstration accounts.
 */
export class AuthFacade {
  /**
   * @param {object|Record<string, unknown>} sessionManagerOrOptions Session
   * manager or facade options containing `sessionManager` and `auditService`.
   * @param {{
   *   auditService?: object,
   *   accounts?: readonly Record<string, unknown>[],
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   maximumFailures?: number,
   *   failureWindowMs?: number,
   *   throttleDurationMs?: number
   * }} [options] Facade options.
   */
  constructor(sessionManagerOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      sessionManagerOrOptions,
      options,
    );

    this.sessionManager = requireSessionManager(
      resolved.sessionManager,
    );
    this.auditService = requireAuditService(
      resolved.auditService,
    );
    this.accounts = normalizeAccounts(
      resolved.options.accounts ?? SEEDED_ACCOUNTS,
    );
    this.clock = resolved.options.clock ?? browserClock;
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;
    this.maximumFailures = requirePositiveInteger(
      resolved.options.maximumFailures,
      AUTH_THROTTLE_DEFAULTS.maximumFailures,
      'Maximum authentication failures',
    );
    this.failureWindowMs = requireNonNegativeNumber(
      resolved.options.failureWindowMs,
      AUTH_THROTTLE_DEFAULTS.failureWindowMs,
      'Authentication failure window',
    );
    this.throttleDurationMs = requireNonNegativeNumber(
      resolved.options.throttleDurationMs,
      AUTH_THROTTLE_DEFAULTS.throttleDurationMs,
      'Authentication throttle duration',
    );
    this.failedAttempts = [];
    this.throttledUntil = 0;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Auth facade ID generator must be a function.',
      );
    }
  }

  pruneFailures(nowMs) {
    const cutoff = nowMs - this.failureWindowMs;

    this.failedAttempts = this.failedAttempts.filter(
      (timestamp) => timestamp >= cutoff,
    );

    if (nowMs >= this.throttledUntil) {
      this.throttledUntil = 0;
    }
  }

  recordFailure(nowMs) {
    this.pruneFailures(nowMs);
    this.failedAttempts.push(nowMs);

    if (this.failedAttempts.length >= this.maximumFailures) {
      this.throttledUntil = nowMs + this.throttleDurationMs;
    }
  }

  /**
   * Validates seeded credentials locally and creates a browser-local session.
   *
   * @param {Record<string, unknown>} request Sign-in request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Auth result.
   */
  async signIn(request) {
    const correlationId = createCorrelationId(this.idGenerator);
    const nowMs = getCurrentDate(this.clock).getTime();

    this.pruneFailures(nowMs);

    if (this.throttledUntil > nowMs) {
      return createFailure(
        429,
        AUTH_FACADE_ERROR_CODES.DEMO_THROTTLED,
        'Too many unsuccessful demo sign-in attempts. Try again shortly.',
        correlationId,
        {
          retryable: true,
          retryAfterMs: this.throttledUntil - nowMs,
        },
      );
    }

    const normalizedRequest = normalizeSignInRequest(request);
    const account = findValidAccount(
      this.accounts,
      normalizedRequest,
    );

    if (account === null) {
      this.recordFailure(nowMs);

      return createFailure(
        401,
        AUTH_FACADE_ERROR_CODES.INVALID_DEMO_CREDENTIALS,
        'The demo credentials could not be validated.',
        correlationId,
      );
    }

    let session;

    try {
      session = await createSession(this.sessionManager, {
        userId: account.userId,
        displayName: account.displayName,
        role: account.role,
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        AUTH_FACADE_ERROR_CODES.SIGN_IN_FAILED,
        'The local demo session could not be created.',
        correlationId,
      );
    }

    if (
      !isPlainObject(session) ||
      typeof session.sessionId !== 'string' ||
      session.sessionId.trim().length === 0
    ) {
      try {
        await clearSession(this.sessionManager, 'SIGN_IN_FAILED');
      } catch (error) {
        return normalizeOperationFailure(
          error,
          AUTH_FACADE_ERROR_CODES.SESSION_UNAVAILABLE,
          'The local demo session could not be validated or cleared.',
          correlationId,
        );
      }

      return createFailure(
        500,
        AUTH_FACADE_ERROR_CODES.SESSION_UNAVAILABLE,
        'The local demo session could not be validated.',
        correlationId,
      );
    }

    try {
      await this.auditService.append(
        {
          correlationId,
          actor: {
            userId: account.userId,
            displayName: account.displayName,
            role: account.role,
          },
          action: AUTH_AUDIT_ACTIONS.SIGN_IN,
          entity: {
            type: 'SESSION',
            id: session.sessionId,
          },
        },
        {
          action: AUTH_AUDIT_ACTIONS.SIGN_IN,
          entity: {
            type: 'SESSION',
            id: session.sessionId,
          },
          before: null,
          after: {
            role: account.role,
            status: 'ACTIVE',
          },
          outcome: 'SUCCESS',
        },
      );
    } catch (error) {
      try {
        await clearSession(this.sessionManager, 'AUDIT_FAILED');
      } catch (rollbackError) {
        return createFailure(
          500,
          AUTH_FACADE_ERROR_CODES.AUDIT_FAILED,
          'The sign-in audit could not be stored and the local session could not be cleared.',
          correlationId,
          {
            retryable:
              getErrorCode(error) === 'REVISION_CONFLICT' ||
              getErrorCode(rollbackError) === 'REVISION_CONFLICT',
          },
        );
      }

      return normalizeOperationFailure(
        error,
        AUTH_FACADE_ERROR_CODES.AUDIT_FAILED,
        'The sign-in audit could not be stored.',
        correlationId,
      );
    }

    this.failedAttempts = [];
    this.throttledUntil = 0;

    return createSuccess(
      200,
      {
        session,
        disclosure:
          account.credentialNotice ?? DEMO_CREDENTIAL_NOTICE ?? DEMO_DISCLOSURE,
      },
      correlationId,
    );
  }

  /**
   * Clears the current browser-local session.
   *
   * @param {string} [reason] Sign-out reason.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Sign-out result.
   */
  async signOut(reason = 'USER_REQUESTED') {
    const correlationId = createCorrelationId(this.idGenerator);
    const normalizedReason =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.normalize('NFC').trim().toUpperCase()
        : 'USER_REQUESTED';

    try {
      const signedOut = await clearSession(
        this.sessionManager,
        normalizedReason,
      );

      return createSuccess(
        200,
        {
          signedOut: signedOut !== false,
        },
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        AUTH_FACADE_ERROR_CODES.SIGN_OUT_FAILED,
        'The local demo session could not be cleared.',
        correlationId,
      );
    }
  }

  /**
   * Returns the current browser-local session.
   *
   * @returns {Readonly<Record<string, unknown>>|null} Current session.
   */
  getSession() {
    return readSession(this.sessionManager);
  }

  /**
   * Subscribes to session lifecycle changes.
   *
   * @param {(event: Readonly<Record<string, unknown>>) => void} listener
   * Session listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribeSession(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Auth session listener must be a function.',
      );
    }

    if (typeof this.sessionManager.subscribe !== 'function') {
      return () => {};
    }

    return this.sessionManager.subscribe(listener);
  }

  subscribe(listener) {
    return this.subscribeSession(listener);
  }
}

/**
 * Creates a browser-local authentication facade.
 *
 * @param {ConstructorParameters<typeof AuthFacade>[0]}
 * sessionManagerOrOptions Session manager or facade options.
 * @param {ConstructorParameters<typeof AuthFacade>[1]} [options]
 * Facade options.
 * @returns {AuthFacade} Authentication facade.
 */
export function createAuthFacade(
  sessionManagerOrOptions,
  options = {},
) {
  return new AuthFacade(sessionManagerOrOptions, options);
}

export const LocalAuthFacade = AuthFacade;
export const DemoAuthFacade = AuthFacade;
export const createLocalAuthFacade = createAuthFacade;
export const AUTH_DISCLOSURE = DEMO_DISCLOSURE;

export default AuthFacade;