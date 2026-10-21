import PropTypes from 'prop-types';
import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Outlet } from 'react-router-dom';
import {
  ROUTE_CAPABILITIES,
  isRouteCapability,
} from '../contracts/capabilities.js';
import { usePermission } from '../hooks/usePermission.js';
import {
  isPlatformRole,
} from '../validation/schemas.js';

const ACCESS_STATES = Object.freeze({
  CHECKING: 'CHECKING',
  ALLOWED: 'ALLOWED',
  DENIED: 'DENIED',
});

function normalizeStringList(primary, secondary) {
  const source = primary ?? secondary;

  if (source === undefined || source === null) {
    return [];
  }

  return (Array.isArray(source) ? source : [source]).map(
    (value) =>
      typeof value === 'string'
        ? value.trim().toUpperCase()
        : value,
  );
}

function resolveResource(resource, session) {
  return typeof resource === 'function'
    ? resource(session)
    : resource ?? null;
}

/**
 * Generic route-level loading state.
 *
 * @returns {JSX.Element} Loading presentation.
 */
export function RouteGuardLoading() {
  return (
    <main
      className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6"
      aria-busy="true"
    >
      <section
        className="w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8"
        role="status"
        aria-live="polite"
      >
        <h1 className="text-xl font-semibold text-content dark:text-content-inverse">
          Checking access
        </h1>
        <p className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted">
          Verifying the current demo session and route permissions.
        </p>
      </section>
    </main>
  );
}

/**
 * Generic denial state that does not render protected resource data.
 *
 * @param {{authenticated?: boolean}} props Component props.
 * @returns {JSX.Element} Access denial presentation.
 */
export function RouteGuardDenied({ authenticated = false }) {
  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
      <section
        className="w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8"
        role="alert"
      >
        <h1 className="text-xl font-semibold text-content dark:text-content-inverse">
          Access unavailable
        </h1>
        <p className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted">
          {authenticated
            ? 'Your current demo role cannot access this page.'
            : 'Sign in with an authorized demo persona to access this page.'}
        </p>
        <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
          No protected record details were displayed.
        </p>
      </section>
    </main>
  );
}

RouteGuardDenied.propTypes = {
  authenticated: PropTypes.bool,
};

/**
 * Re-evaluates the active session, route capability, role, and resource-aware
 * action permissions before rendering protected route content.
 *
 * @param {{
 *   permissionService: object,
 *   sessionProvider?: object|Function,
 *   capability?: string,
 *   requiredCapability?: string,
 *   capabilities?: string[],
 *   requiredCapabilities?: string[],
 *   action?: string,
 *   requiredAction?: string,
 *   actions?: string[],
 *   requiredActions?: string[],
 *   resource?: object|Function,
 *   roles?: string[],
 *   allowedRoles?: string[],
 *   children?: React.ReactNode,
 *   loadingFallback?: React.ReactNode
 * }} props Guard props.
 * @returns {JSX.Element|React.ReactNode|null} Guarded route content.
 */
export function RouteGuard({
  permissionService,
  sessionProvider,
  capability,
  requiredCapability,
  capabilities,
  requiredCapabilities,
  action,
  requiredAction,
  actions,
  requiredActions,
  resource = null,
  roles,
  allowedRoles,
  children,
  loadingFallback,
}) {
  const permission = usePermission(permissionService, {
    sessionProvider,
  });
  const requestedActions = useMemo(
    () =>
      normalizeStringList(
        actions ?? requiredActions,
        action ?? requiredAction,
      ),
    [action, actions, requiredAction, requiredActions],
  );
  const requestedCapabilities = useMemo(() => {
    const normalized = normalizeStringList(
      capabilities ?? requiredCapabilities,
      capability ?? requiredCapability,
    );

    if (
      normalized.length === 0 &&
      requestedActions.length === 0
    ) {
      return [ROUTE_CAPABILITIES.AUTHENTICATED];
    }

    return normalized;
  }, [
    capability,
    capabilities,
    requestedActions.length,
    requiredCapabilities,
    requiredCapability,
  ]);
  const requestedRoles = useMemo(
    () => normalizeStringList(roles, allowedRoles),
    [allowedRoles, roles],
  );
  const [accessState, setAccessState] = useState(
    ACCESS_STATES.CHECKING,
  );

  useEffect(() => {
    let active = true;

    const capabilitiesValid = requestedCapabilities.every(
      isRouteCapability,
    );
    const capabilitiesAllowed =
      capabilitiesValid &&
      requestedCapabilities.every(
        (requestedCapability) =>
          requestedCapability === ROUTE_CAPABILITIES.PUBLIC ||
          permission.hasCapability(requestedCapability),
      );
    const rolesValid = requestedRoles.every(isPlatformRole);
    const roleAllowed =
      requestedRoles.length === 0 ||
      (rolesValid &&
        permission.role !== null &&
        requestedRoles.includes(permission.role));

    if (!capabilitiesAllowed || !roleAllowed) {
      setAccessState(ACCESS_STATES.DENIED);
      return () => {
        active = false;
      };
    }

    if (requestedActions.length === 0) {
      setAccessState(ACCESS_STATES.ALLOWED);
      return () => {
        active = false;
      };
    }

    if (!permission.authenticated) {
      setAccessState(ACCESS_STATES.DENIED);
      return () => {
        active = false;
      };
    }

    setAccessState(ACCESS_STATES.CHECKING);

    const evaluateAccess = async () => {
      try {
        const resolvedResource = await Promise.resolve(
          resolveResource(resource, permission.session),
        );
        const decisions = await Promise.all(
          requestedActions.map((requestedAction) =>
            permission.evaluate({
              action: requestedAction,
              resource: resolvedResource,
            }),
          ),
        );

        if (active) {
          setAccessState(
            decisions.every(
              (decision) => decision.allowed === true,
            )
              ? ACCESS_STATES.ALLOWED
              : ACCESS_STATES.DENIED,
          );
        }
      } catch {
        if (active) {
          setAccessState(ACCESS_STATES.DENIED);
        }
      }
    };

    evaluateAccess();

    return () => {
      active = false;
    };
  }, [
    permission,
    requestedActions,
    requestedCapabilities,
    requestedRoles,
    resource,
  ]);

  if (accessState === ACCESS_STATES.CHECKING) {
    return loadingFallback ?? <RouteGuardLoading />;
  }

  if (accessState !== ACCESS_STATES.ALLOWED) {
    return (
      <RouteGuardDenied
        authenticated={permission.authenticated}
      />
    );
  }

  return children === undefined ? <Outlet /> : children;
}

RouteGuard.propTypes = {
  permissionService: PropTypes.shape({
    evaluate: PropTypes.func.isRequired,
  }).isRequired,
  sessionProvider: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.object,
  ]),
  capability: PropTypes.string,
  requiredCapability: PropTypes.string,
  capabilities: PropTypes.arrayOf(PropTypes.string),
  requiredCapabilities: PropTypes.arrayOf(PropTypes.string),
  action: PropTypes.string,
  requiredAction: PropTypes.string,
  actions: PropTypes.arrayOf(PropTypes.string),
  requiredActions: PropTypes.arrayOf(PropTypes.string),
  resource: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.object,
  ]),
  roles: PropTypes.arrayOf(PropTypes.string),
  allowedRoles: PropTypes.arrayOf(PropTypes.string),
  children: PropTypes.node,
  loadingFallback: PropTypes.node,
};

export const AccessRouteGuard = RouteGuard;
export const PermissionRouteGuard = RouteGuard;

export default RouteGuard;