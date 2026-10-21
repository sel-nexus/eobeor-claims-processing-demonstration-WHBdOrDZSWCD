import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  SESSION_SIGN_OUT_REASONS,
  SESSION_STATUSES,
} from '../services/sessionManager.js';

const sessionAdapters = new WeakMap();
const noop = () => {};

function requireOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError('Session hook options must be an object.');
  }

  return value;
}

function resolveFacade(value) {
  const facade =
    value !== null &&
    typeof value === 'object' &&
    value.authFacade !== undefined
      ? value.authFacade
      : value;

  if (
    facade === null ||
    typeof facade !== 'object' ||
    typeof facade.getSession !== 'function'
  ) {
    throw new TypeError(
      'useSession requires an AuthFacade with getSession().',
    );
  }

  return facade;
}

function resolveSessionManager(facade, options) {
  const manager =
    options.sessionManager ??
    facade.sessionManager ??
    null;

  return manager !== null && typeof manager === 'object'
    ? manager
    : null;
}

function readManagerSnapshot(manager) {
  if (manager === null) {
    return null;
  }

  if (typeof manager.getSnapshot === 'function') {
    return manager.getSnapshot();
  }

  if (typeof manager.getState === 'function') {
    return manager.getState();
  }

  return null;
}

function deriveStatus(session, status, reason) {
  if (
    reason === SESSION_SIGN_OUT_REASONS.EXPIRED ||
    reason === 'EXPIRED'
  ) {
    return SESSION_STATUSES.EXPIRED;
  }

  if (
    status === SESSION_STATUSES.ACTIVE ||
    status === SESSION_STATUSES.WARNING ||
    status === SESSION_STATUSES.EXPIRED ||
    status === SESSION_STATUSES.SIGNED_OUT
  ) {
    return status;
  }

  if (session === null) {
    return SESSION_STATUSES.SIGNED_OUT;
  }

  if (
    typeof session.expiresAt === 'string' &&
    Number.isFinite(Date.parse(session.expiresAt)) &&
    Date.parse(session.expiresAt) <= Date.now()
  ) {
    return SESSION_STATUSES.EXPIRED;
  }

  return SESSION_STATUSES.ACTIVE;
}

function deriveRemainingMs(session, suppliedRemainingMs) {
  if (
    typeof suppliedRemainingMs === 'number' &&
    Number.isFinite(suppliedRemainingMs) &&
    suppliedRemainingMs >= 0
  ) {
    return suppliedRemainingMs;
  }

  if (
    session === null ||
    typeof session.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(session.expiresAt))
  ) {
    return 0;
  }

  return Math.max(0, Date.parse(session.expiresAt) - Date.now());
}

function normalizeSnapshot(value, fallbackSession = null) {
  const source =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
      ? value
      : {};
  const hasSession = Object.prototype.hasOwnProperty.call(
    source,
    'session',
  );
  const session = hasSession
    ? source.session ?? null
    : fallbackSession;
  const reason =
    source.reason ??
    source.lastSignOutReason ??
    null;
  const status = deriveStatus(
    session,
    source.status,
    reason,
  );
  const isAuthenticated =
    session !== null &&
    status !== SESSION_STATUSES.EXPIRED &&
    status !== SESSION_STATUSES.SIGNED_OUT;

  return Object.freeze({
    session,
    status,
    isAuthenticated,
    authenticated: isAuthenticated,
    isWarning: status === SESSION_STATUSES.WARNING,
    warning: status === SESSION_STATUSES.WARNING,
    isExpired: status === SESSION_STATUSES.EXPIRED,
    expired: status === SESSION_STATUSES.EXPIRED,
    isSignedOut: status === SESSION_STATUSES.SIGNED_OUT,
    remainingMs: deriveRemainingMs(
      session,
      source.remainingMs,
    ),
    timeoutMinutes:
      Number.isFinite(source.timeoutMinutes)
        ? source.timeoutMinutes
        : null,
    warningMinutes:
      Number.isFinite(source.warningMinutes)
        ? source.warningMinutes
        : null,
    pendingActivity: source.pendingActivity === true,
    trackingActive: source.started === true,
    reason,
    eventType:
      typeof source.type === 'string'
        ? source.type
        : null,
    sessionError: source.error ?? null,
  });
}

function readSnapshot(facade, manager) {
  const managerSnapshot = readManagerSnapshot(manager);

  if (managerSnapshot !== null) {
    return normalizeSnapshot(
      managerSnapshot,
      facade.getSession() ?? null,
    );
  }

  return normalizeSnapshot(
    null,
    facade.getSession() ?? null,
  );
}

function subscribeToSource(facade, manager, listener) {
  if (
    manager !== null &&
    typeof manager.subscribe === 'function'
  ) {
    return manager.subscribe(listener);
  }

  if (typeof facade.subscribeSession === 'function') {
    return facade.subscribeSession(listener);
  }

  if (typeof facade.subscribe === 'function') {
    return facade.subscribe(listener);
  }

  return noop;
}

function createSessionAdapter(facade, manager) {
  let snapshot = readSnapshot(facade, manager);

  return {
    getSnapshot() {
      return snapshot;
    },
    refresh(event = undefined) {
      if (
        event !== undefined &&
        event !== null &&
        typeof event === 'object' &&
        (Object.prototype.hasOwnProperty.call(event, 'session') ||
          Object.prototype.hasOwnProperty.call(event, 'status') ||
          Object.prototype.hasOwnProperty.call(event, 'reason'))
      ) {
        snapshot = normalizeSnapshot(
          event,
          facade.getSession() ?? null,
        );
      } else {
        snapshot = readSnapshot(facade, manager);
      }

      return snapshot;
    },
    subscribe(listener) {
      const unsubscribe = subscribeToSource(
        facade,
        manager,
        (event) => {
          this.refresh(event);
          listener();
        },
      );

      this.refresh();
      listener();

      return typeof unsubscribe === 'function'
        ? unsubscribe
        : noop;
    },
  };
}

function getSessionAdapter(facade, manager) {
  const existing = sessionAdapters.get(facade);

  if (
    existing !== undefined &&
    existing.manager === manager
  ) {
    return existing.adapter;
  }

  const adapter = createSessionAdapter(facade, manager);

  sessionAdapters.set(facade, {
    manager,
    adapter,
  });

  return adapter;
}

function normalizeOperationError(error) {
  if (error instanceof Error) {
    return error;
  }

  const normalized = new Error(
    'The local session operation could not be completed.',
  );

  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.code === 'string'
  ) {
    normalized.code = error.code;
  }

  return normalized;
}

/**
 * Subscribes a React component to browser-local authentication and session
 * activity state.
 *
 * @param {object} authFacade AuthFacade instance.
 * @param {{sessionManager?: object}} [options] Hook options.
 * @returns {Readonly<Record<string, unknown>>} Session state and actions.
 */
export function useSession(authFacade, options = {}) {
  const normalizedOptions = requireOptions(options);
  const facade = resolveFacade(authFacade);
  const manager = resolveSessionManager(
    facade,
    normalizedOptions,
  );
  const adapter = getSessionAdapter(facade, manager);
  const [operationPending, setOperationPending] =
    useState(false);
  const [operationError, setOperationError] = useState(null);

  const subscribe = useCallback(
    (listener) => adapter.subscribe(listener),
    [adapter],
  );
  const getSnapshot = useCallback(
    () => adapter.getSnapshot(),
    [adapter],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const clearOperationError = useCallback(() => {
    setOperationError(null);
  }, []);

  const refresh = useCallback(() => {
    const next = adapter.refresh();

    return next;
  }, [adapter]);

  const recordActivity = useCallback(
    async (now = undefined) => {
      if (
        manager === null ||
        typeof manager.recordActivity !== 'function'
      ) {
        const error = new TypeError(
          'Session activity recording is unavailable.',
        );

        setOperationError(error);
        throw error;
      }

      setOperationPending(true);
      setOperationError(null);

      try {
        const result = await manager.recordActivity(now);

        adapter.refresh();
        return result;
      } catch (error) {
        const normalizedError = normalizeOperationError(error);

        setOperationError(normalizedError);
        throw normalizedError;
      } finally {
        setOperationPending(false);
      }
    },
    [adapter, manager],
  );

  const evaluateExpiry = useCallback(
    async (now = undefined) => {
      if (
        manager === null ||
        typeof manager.tick !== 'function'
      ) {
        const error = new TypeError(
          'Session expiry evaluation is unavailable.',
        );

        setOperationError(error);
        throw error;
      }

      setOperationPending(true);
      setOperationError(null);

      try {
        const result = await manager.tick(now);

        adapter.refresh();
        return result;
      } catch (error) {
        const normalizedError = normalizeOperationError(error);

        setOperationError(normalizedError);
        throw normalizedError;
      } finally {
        setOperationPending(false);
      }
    },
    [adapter, manager],
  );

  const signOut = useCallback(
    async (reason = SESSION_SIGN_OUT_REASONS.USER_REQUESTED) => {
      setOperationPending(true);
      setOperationError(null);

      try {
        const result = await facade.signOut(reason);

        adapter.refresh();
        return result;
      } catch (error) {
        const normalizedError = normalizeOperationError(error);

        setOperationError(normalizedError);
        throw normalizedError;
      } finally {
        setOperationPending(false);
      }
    },
    [adapter, facade],
  );

  return useMemo(
    () =>
      Object.freeze({
        ...snapshot,
        operationPending,
        operationError,
        canRecordActivity:
          manager !== null &&
          typeof manager.recordActivity === 'function',
        canEvaluateExpiry:
          manager !== null &&
          typeof manager.tick === 'function',
        recordActivity,
        evaluateExpiry,
        signOut,
        refresh,
        clearOperationError,
      }),
    [
      clearOperationError,
      evaluateExpiry,
      manager,
      operationError,
      operationPending,
      recordActivity,
      refresh,
      signOut,
      snapshot,
    ],
  );
}

export default useSession;