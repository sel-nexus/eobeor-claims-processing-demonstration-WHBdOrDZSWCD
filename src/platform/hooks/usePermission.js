import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ROUTE_PERMISSION_POLICIES,
} from '../services/permissionService.js';
import {
  isPermissionAction,
  isRouteCapability,
} from '../contracts/capabilities.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

const noop = () => {};

function requireOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TypeError('Permission hook options must be an object.');
  }

  return value;
}

function resolvePermissionService(value) {
  const service =
    isPlainObject(value) &&
    value.permissionService !== undefined
      ? value.permissionService
      : value;

  if (
    service === null ||
    typeof service !== 'object' ||
    typeof service.evaluate !== 'function'
  ) {
    throw new TypeError(
      'usePermission requires a PermissionService with evaluate().',
    );
  }

  return service;
}

function resolveSessionProvider(service, options) {
  const provider =
    options.sessionProvider ??
    options.authFacade ??
    service.sessionProvider ??
    null;

  if (
    provider === null ||
    typeof provider === 'function' ||
    (typeof provider === 'object' &&
      (typeof provider.getSession === 'function' ||
        typeof provider.getSnapshot === 'function' ||
        typeof provider.getState === 'function'))
  ) {
    return provider;
  }

  throw new TypeError(
    'Permission session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function readSessionSource(provider) {
  if (provider === null) {
    return null;
  }

  if (typeof provider === 'function') {
    return provider();
  }

  if (typeof provider.getSession === 'function') {
    return provider.getSession();
  }

  if (typeof provider.getSnapshot === 'function') {
    return provider.getSnapshot();
  }

  return provider.getState();
}

function normalizeSessionSnapshot(value) {
  const source = isPlainObject(value) ? value : {};
  const hasSession = Object.prototype.hasOwnProperty.call(
    source,
    'session',
  );
  const sessionValue = hasSession
    ? source.session
    : isPlainObject(source.actor)
      ? source.actor
      : value;
  const status =
    typeof source.status === 'string'
      ? source.status.trim().toUpperCase()
      : null;
  const reason =
    source.reason ??
    source.lastSignOutReason ??
    null;
  const expired =
    status === 'EXPIRED' ||
    reason === 'EXPIRED' ||
    (isPlainObject(sessionValue) &&
      typeof sessionValue.expiresAt === 'string' &&
      Number.isFinite(Date.parse(sessionValue.expiresAt)) &&
      Date.parse(sessionValue.expiresAt) <= Date.now());

  if (
    expired ||
    status === 'SIGNED_OUT' ||
    !isPlainObject(sessionValue)
  ) {
    return Object.freeze({
      session: null,
      status: expired ? 'EXPIRED' : status ?? 'SIGNED_OUT',
      role: null,
      memberId: null,
      authenticated: false,
    });
  }

  const role =
    typeof sessionValue.role === 'string'
      ? sessionValue.role.trim().toUpperCase()
      : sessionValue.role;

  if (!isPlatformRole(role)) {
    return Object.freeze({
      session: null,
      status: status ?? 'SIGNED_OUT',
      role: null,
      memberId: null,
      authenticated: false,
    });
  }

  const session = Object.freeze({
    ...sessionValue,
    role,
    userId:
      typeof sessionValue.userId === 'string'
        ? sessionValue.userId.normalize('NFC').trim()
        : sessionValue.userId,
    memberId:
      typeof sessionValue.memberId === 'string' &&
      sessionValue.memberId.trim().length > 0
        ? sessionValue.memberId.normalize('NFC').trim()
        : null,
  });

  return Object.freeze({
    session,
    status: status ?? 'ACTIVE',
    role,
    memberId: session.memberId,
    authenticated: true,
  });
}

function subscribeToSession(provider, listener) {
  if (provider === null || typeof provider === 'function') {
    return noop;
  }

  if (typeof provider.subscribeSession === 'function') {
    return provider.subscribeSession(listener);
  }

  if (typeof provider.subscribe === 'function') {
    return provider.subscribe(listener);
  }

  return noop;
}

function createSessionAdapter(provider) {
  let snapshot = normalizeSessionSnapshot(
    readSessionSource(provider),
  );

  return {
    getSnapshot() {
      return snapshot;
    },
    refresh(event = undefined) {
      if (
        isPlainObject(event) &&
        (Object.prototype.hasOwnProperty.call(event, 'session') ||
          Object.prototype.hasOwnProperty.call(event, 'actor') ||
          Object.prototype.hasOwnProperty.call(event, 'status') ||
          Object.prototype.hasOwnProperty.call(event, 'reason'))
      ) {
        snapshot = normalizeSessionSnapshot(event);
      } else {
        snapshot = normalizeSessionSnapshot(
          readSessionSource(provider),
        );
      }

      return snapshot;
    },
    subscribe(listener) {
      const unsubscribe = subscribeToSession(
        provider,
        (event) => {
          this.refresh(event);
          listener();
        },
      );

      return typeof unsubscribe === 'function'
        ? unsubscribe
        : noop;
    },
  };
}

function createDecisionKey(action, resource = null) {
  const normalizedAction =
    typeof action === 'string'
      ? action.trim().toUpperCase()
      : String(action);
  const resourceType =
    isPlainObject(resource) &&
    typeof (
      resource.type ??
      resource.resourceType ??
      resource.kind
    ) === 'string'
      ? (
          resource.type ??
          resource.resourceType ??
          resource.kind
        )
          .trim()
          .toUpperCase()
      : '';
  const resourceId =
    isPlainObject(resource) &&
    (typeof resource.id === 'string' ||
      typeof resource.id === 'number')
      ? String(resource.id)
      : '';

  return `${normalizedAction}|${resourceType}|${resourceId}`;
}

function createSessionKey(session) {
  if (session === null) {
    return 'anonymous';
  }

  return [
    session.sessionId ?? '',
    session.userId ?? '',
    session.role ?? '',
    session.memberId ?? '',
    session.expiresAt ?? '',
  ].join('|');
}

function normalizeDecision(value) {
  const decision =
    isPlainObject(value?.data) &&
    typeof value.data.allowed === 'boolean'
      ? value.data
      : value;

  if (
    !isPlainObject(decision) ||
    typeof decision.allowed !== 'boolean'
  ) {
    throw new TypeError(
      'Permission service returned an invalid access decision.',
    );
  }

  return decision;
}

function normalizeOperationError(error) {
  if (error instanceof Error) {
    return error;
  }

  const normalized = new Error(
    'The local permission operation could not be completed.',
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

function getEvaluationParts(inputOrAction, resource) {
  if (typeof inputOrAction === 'string') {
    return {
      action: inputOrAction.trim().toUpperCase(),
      resource: resource ?? null,
    };
  }

  if (isPlainObject(inputOrAction)) {
    return {
      action:
        typeof inputOrAction.action === 'string'
          ? inputOrAction.action.trim().toUpperCase()
          : inputOrAction.action,
      resource: inputOrAction.resource ?? null,
    };
  }

  return {
    action: inputOrAction,
    resource: resource ?? null,
  };
}

/**
 * Exposes current-persona permission decisions and route capability checks.
 *
 * @param {object} permissionService PermissionService instance.
 * @param {{
 *   sessionProvider?: object|Function,
 *   authFacade?: object
 * }} [options] Hook options.
 * @returns {Readonly<Record<string, unknown>>} Permission state and actions.
 */
export function usePermission(permissionService, options = {}) {
  const normalizedOptions = requireOptions(options);
  const service = resolvePermissionService(permissionService);
  const sessionProvider = resolveSessionProvider(
    service,
    normalizedOptions,
  );
  const sessionAdapter = useMemo(
    () => createSessionAdapter(sessionProvider),
    [sessionProvider],
  );
  const subscribe = useCallback(
    (listener) => sessionAdapter.subscribe(listener),
    [sessionAdapter],
  );
  const getSnapshot = useCallback(
    () => sessionAdapter.getSnapshot(),
    [sessionAdapter],
  );
  const sessionSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const [decisionState, setDecisionState] = useState(() => ({
    sessionKey: createSessionKey(sessionSnapshot.session),
    values: Object.freeze({}),
  }));
  const [pendingCount, setPendingCount] = useState(0);
  const [operationError, setOperationError] = useState(null);
  const sessionKey = createSessionKey(sessionSnapshot.session);
  const activeDecisions =
    decisionState.sessionKey === sessionKey
      ? decisionState.values
      : Object.freeze({});

  const visibleCapabilities = useMemo(() => {
    if (!sessionSnapshot.authenticated) {
      return Object.freeze([]);
    }

    if (typeof service.visibleRoutes === 'function') {
      try {
        const visible = service.visibleRoutes(
          sessionSnapshot.session,
          null,
        );

        if (Array.isArray(visible)) {
          return Object.freeze(
            visible.filter(isRouteCapability),
          );
        }
      } catch {
        return Object.freeze([]);
      }
    }

    return Object.freeze(
      Object.entries(ROUTE_PERMISSION_POLICIES)
        .filter(([, roles]) =>
          roles.includes(sessionSnapshot.role),
        )
        .map(([capability]) => capability),
    );
  }, [
    service,
    sessionSnapshot.authenticated,
    sessionSnapshot.role,
    sessionSnapshot.session,
  ]);

  const clearOperationError = useCallback(() => {
    setOperationError(null);
  }, []);

  const clearDecisions = useCallback(() => {
    setDecisionState({
      sessionKey,
      values: Object.freeze({}),
    });
  }, [sessionKey]);

  const refreshSession = useCallback(() => {
    return sessionAdapter.refresh();
  }, [sessionAdapter]);

  const evaluate = useCallback(
    async (
      inputOrAction,
      resource = null,
      context = {},
    ) => {
      setPendingCount((count) => count + 1);
      setOperationError(null);

      try {
        let result;

        if (typeof inputOrAction === 'string') {
          result = await service.evaluate(
            inputOrAction,
            resource,
            {
              ...(isPlainObject(context) ? context : {}),
              session: sessionSnapshot.session,
            },
          );
        } else if (isPlainObject(inputOrAction)) {
          result = await service.evaluate({
            ...inputOrAction,
            session:
              inputOrAction.session ??
              sessionSnapshot.session,
          });
        } else {
          result = await service.evaluate(
            inputOrAction,
            resource,
            {
              session: sessionSnapshot.session,
            },
          );
        }

        const decision = normalizeDecision(result);
        const parts = getEvaluationParts(
          inputOrAction,
          resource,
        );
        const key = createDecisionKey(
          parts.action,
          parts.resource,
        );

        setDecisionState((current) => ({
          sessionKey,
          values: Object.freeze({
            ...(current.sessionKey === sessionKey
              ? current.values
              : {}),
            [key]: decision,
          }),
        }));

        return decision;
      } catch (error) {
        const normalizedError = normalizeOperationError(error);

        setOperationError(normalizedError);
        throw normalizedError;
      } finally {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    },
    [service, sessionKey, sessionSnapshot.session],
  );

  const requirePermission = useCallback(
    async (
      inputOrAction,
      resource = null,
      context = {},
    ) => {
      if (typeof service.require !== 'function') {
        const decision = await evaluate(
          inputOrAction,
          resource,
          context,
        );

        if (!decision.allowed) {
          const error = new Error(
            'The requested action is not permitted.',
          );

          error.code = 'ACCESS_DENIED';
          error.decision = decision;
          throw error;
        }

        return decision;
      }

      setPendingCount((count) => count + 1);
      setOperationError(null);

      try {
        let decision;

        if (typeof inputOrAction === 'string') {
          decision = await service.require(
            inputOrAction,
            resource,
            {
              ...(isPlainObject(context) ? context : {}),
              session: sessionSnapshot.session,
            },
          );
        } else {
          decision = await service.require({
            ...inputOrAction,
            session:
              inputOrAction?.session ??
              sessionSnapshot.session,
          });
        }

        const normalizedDecision = normalizeDecision(decision);
        const parts = getEvaluationParts(
          inputOrAction,
          resource,
        );
        const key = createDecisionKey(
          parts.action,
          parts.resource,
        );

        setDecisionState((current) => ({
          sessionKey,
          values: Object.freeze({
            ...(current.sessionKey === sessionKey
              ? current.values
              : {}),
            [key]: normalizedDecision,
          }),
        }));

        return normalizedDecision;
      } catch (error) {
        const normalizedError = normalizeOperationError(error);

        if (
          isPlainObject(error?.decision) &&
          typeof error.decision.allowed === 'boolean'
        ) {
          const parts = getEvaluationParts(
            inputOrAction,
            resource,
          );
          const key = createDecisionKey(
            parts.action,
            parts.resource,
          );

          setDecisionState((current) => ({
            sessionKey,
            values: Object.freeze({
              ...(current.sessionKey === sessionKey
                ? current.values
                : {}),
              [key]: error.decision,
            }),
          }));
        }

        setOperationError(normalizedError);
        throw normalizedError;
      } finally {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    },
    [
      evaluate,
      service,
      sessionKey,
      sessionSnapshot.session,
    ],
  );

  const getDecision = useCallback(
    (action, resource = null) => {
      if (!isPermissionAction(action)) {
        return null;
      }

      return (
        activeDecisions[
          createDecisionKey(action, resource)
        ] ?? null
      );
    },
    [activeDecisions],
  );

  const isAllowed = useCallback(
    (action, resource = null) =>
      getDecision(action, resource)?.allowed === true,
    [getDecision],
  );

  const isDenied = useCallback(
    (action, resource = null) =>
      getDecision(action, resource)?.allowed === false,
    [getDecision],
  );

  const canPerformRoleAction = useCallback(
    (action) => {
      if (
        !sessionSnapshot.authenticated ||
        !isPermissionAction(action)
      ) {
        return false;
      }

      const decision = getDecision(action);

      if (decision !== null) {
        return decision.allowed === true;
      }

      return false;
    },
    [
      getDecision,
      sessionSnapshot.authenticated,
    ],
  );

  const hasCapability = useCallback(
    (capability) =>
      isRouteCapability(capability) &&
      visibleCapabilities.includes(capability),
    [visibleCapabilities],
  );

  const visibleRoutes = useCallback(
    (routes) => {
      if (
        !Array.isArray(routes) ||
        typeof service.visibleRoutes !== 'function'
      ) {
        return Object.freeze([]);
      }

      try {
        return service.visibleRoutes(
          sessionSnapshot.session,
          routes,
        );
      } catch (error) {
        const normalizedError = normalizeOperationError(error);

        setOperationError(normalizedError);
        return Object.freeze([]);
      }
    },
    [service, sessionSnapshot.session],
  );

  return useMemo(
    () =>
      Object.freeze({
        session: sessionSnapshot.session,
        status: sessionSnapshot.status,
        role: sessionSnapshot.role,
        persona: sessionSnapshot.role,
        memberId: sessionSnapshot.memberId,
        authenticated: sessionSnapshot.authenticated,
        isAuthenticated: sessionSnapshot.authenticated,
        decisions: activeDecisions,
        decisionCount: Object.keys(activeDecisions).length,
        visibleCapabilities,
        pending: pendingCount > 0,
        loading: pendingCount > 0,
        isLoading: pendingCount > 0,
        pendingCount,
        operationError,
        error: operationError,
        evaluate,
        check: evaluate,
        checkPermission: evaluate,
        require: requirePermission,
        requirePermission,
        getDecision,
        can: isAllowed,
        isAllowed,
        isDenied,
        canPerform: canPerformRoleAction,
        hasCapability,
        canAccessCapability: hasCapability,
        visibleRoutes,
        getVisibleRoutes: visibleRoutes,
        clearDecisions,
        clearOperationError,
        refreshSession,
      }),
    [
      activeDecisions,
      canPerformRoleAction,
      clearDecisions,
      clearOperationError,
      evaluate,
      getDecision,
      hasCapability,
      isAllowed,
      isDenied,
      operationError,
      pendingCount,
      refreshSession,
      requirePermission,
      sessionSnapshot,
      visibleCapabilities,
      visibleRoutes,
    ],
  );
}

export default usePermission;