import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  HelpCircle,
  LogOut,
  Menu,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import SessionWarning from './SessionWarning.jsx';

const EMPTY_NAVIGATION = Object.freeze([]);
const PORTAL_STORAGE_KEY = 'eob-eor-demo.v1.portal';

function normalizeRole(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : null;
}

function resolvePersona(session, persona, role) {
  const source =
    session !== null && typeof session === 'object'
      ? session
      : {};

  return Object.freeze({
    displayName:
      typeof source.displayName === 'string' &&
      source.displayName.trim().length > 0
        ? source.displayName.normalize('NFC').trim()
        : typeof persona === 'string' &&
            persona.trim().length > 0
          ? persona.normalize('NFC').trim()
          : 'Demo user',
    role:
      normalizeRole(role) ??
      normalizeRole(source.role),
  });
}

function resolveNavigationItemHref(item) {
  const value = item.href ?? item.to ?? item.path;

  return typeof value === 'string' &&
    value.trim().length > 0
    ? value.trim()
    : '#';
}

function defaultPortalForRole(role) {
  if (role === 'MEMBER') {
    return 'Member';
  }

  if (
    role === 'CSR' ||
    role === 'BOS' ||
    role === 'ITS' ||
    role === 'ADMIN'
  ) {
    return 'Operations';
  }

  return 'Workspace';
}

function isNavigationItemVisible(item, role) {
  if (item.hidden === true) {
    return false;
  }

  const roles = item.roles ?? item.allowedRoles;

  if (!Array.isArray(roles) || roles.length === 0) {
    return true;
  }

  return (
    role !== null &&
    roles
      .map(normalizeRole)
      .filter(Boolean)
      .includes(role)
  );
}

function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '/';
  }

  const path = value.split(/[?#]/, 1)[0];

  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }

  return path;
}

function isItemActive(item, href, currentPath) {
  if (typeof item.active === 'boolean') {
    return item.active;
  }

  if (href === '#' || href.startsWith('http')) {
    return false;
  }

  const normalizedHref = normalizePath(href);
  const normalizedCurrentPath = normalizePath(currentPath);

  if (item.end === true) {
    return normalizedCurrentPath === normalizedHref;
  }

  return (
    normalizedCurrentPath === normalizedHref ||
    (normalizedHref !== '/' &&
      normalizedCurrentPath.startsWith(
        `${normalizedHref}/`,
      ))
  );
}

function getOperationErrorMessage(error, fallback) {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function NavigationLink({
  item,
  currentPath,
  mobile,
  onNavigate,
}) {
  const href = resolveNavigationItemHref(item);
  const active = isItemActive(item, href, currentPath);
  const label = item.label ?? item.title ?? 'Navigation item';

  return (
    <a
      className={`inline-flex min-h-10 items-center rounded-lg py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark ${
        mobile
          ? 'w-full px-3'
          : 'shrink-0 whitespace-nowrap px-2.5'
      } ${
        active
          ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100'
          : 'text-content-muted hover:bg-surface-muted hover:text-content dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse'
      }`}
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(item)}
    >
      {label}
    </a>
  );
}

NavigationLink.propTypes = {
  item: PropTypes.shape({
    active: PropTypes.bool,
    allowedRoles: PropTypes.arrayOf(PropTypes.string),
    end: PropTypes.bool,
    hidden: PropTypes.bool,
    href: PropTypes.string,
    portal: PropTypes.string,
    label: PropTypes.string,
    path: PropTypes.string,
    roles: PropTypes.arrayOf(PropTypes.string),
    title: PropTypes.string,
    to: PropTypes.string,
  }).isRequired,
  currentPath: PropTypes.string.isRequired,
  mobile: PropTypes.bool.isRequired,
  onNavigate: PropTypes.func.isRequired,
};

/**
 * Responsive application shell for authenticated demonstration routes.
 *
 * @param {{
 *   children: React.ReactNode,
 *   session?: Record<string, unknown>|null,
 *   persona?: string,
 *   role?: string,
 *   navigation?: readonly Record<string, unknown>[],
 *   navigationItems?: readonly Record<string, unknown>[],
 *   currentPath?: string,
 *   applicationName?: string,
 *   homeHref?: string,
 *   helpHref?: string,
 *   helpLabel?: string,
 *   onNavigate?: Function,
 *   onSignOut?: Function,
 *   signingOut?: boolean,
 *   sessionStatus?: string,
 *   sessionWarningOpen?: boolean,
 *   sessionRemainingMs?: number,
 *   sessionExpiresAt?: Date|string|number,
 *   onContinueSession?: Function,
 *   onSessionExpire?: Function,
 *   onSessionWarningOpenChange?: Function
 * }} props Component props.
 * @returns {JSX.Element} Application shell.
 */
export function AppShell({
  children,
  session = null,
  persona,
  role,
  navigation,
  navigationItems,
  currentPath = '/',
  applicationName = 'EOB/EOR Claims Processing',
  homeHref = '/',
  helpHref = '/help',
  helpLabel = 'Help',
  onNavigate,
  onSignOut,
  signingOut = false,
  sessionStatus,
  sessionWarningOpen,
  sessionRemainingMs,
  sessionExpiresAt,
  onContinueSession,
  onSessionExpire,
  onSessionWarningOpenChange,
}) {
  const mobileMenuId = useId();
  const mobileMenuButtonRef = useRef(null);
  const desktopNavRef = useRef(null);
  const desktopNavMeasureRef = useRef(null);
  const moreMenuRef = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const actor = useMemo(
    () => resolvePersona(session, persona, role),
    [persona, role, session],
  );
  const items = navigation ?? navigationItems ?? EMPTY_NAVIGATION;
  const visibleNavigation = useMemo(
    () =>
      items.filter((item) =>
        isNavigationItemVisible(item, actor.role),
      ),
    [actor.role, items],
  );
  const portalNames = useMemo(() => {
    const names = [];

    visibleNavigation.forEach((item) => {
      const name =
        typeof item.portal === 'string' &&
        item.portal.trim().length > 0
          ? item.portal.trim()
          : 'Workspace';

      if (!names.includes(name)) {
        names.push(name);
      }
    });

    return names;
  }, [visibleNavigation]);
  const [selectedPortal, setSelectedPortal] = useState(() => {
    try {
      return (
        globalThis.sessionStorage?.getItem(
          PORTAL_STORAGE_KEY,
        ) ?? ''
      );
    } catch {
      return '';
    }
  });
  const preferredPortal = defaultPortalForRole(actor.role);
  const activePortal = portalNames.includes(selectedPortal)
    ? selectedPortal
    : portalNames.includes(preferredPortal)
      ? preferredPortal
      : (portalNames[0] ?? 'Workspace');
  const portalNavigation = useMemo(
    () =>
      visibleNavigation.filter((item) => {
        const name =
          typeof item.portal === 'string' &&
          item.portal.trim().length > 0
            ? item.portal.trim()
            : 'Workspace';

        return name === activePortal;
      }),
    [activePortal, visibleNavigation],
  );
  const [visibleNavCount, setVisibleNavCount] = useState(
    () => portalNavigation.length,
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  useEffect(() => {
    try {
      globalThis.sessionStorage?.setItem(
        PORTAL_STORAGE_KEY,
        activePortal,
      );
    } catch {
      // The portal choice is only a local navigation preference.
    }
  }, [activePortal]);
  const normalizedSessionStatus =
    normalizeRole(sessionStatus) ??
    normalizeRole(session?.status);
  const warningVisible =
    sessionWarningOpen ??
    normalizedSessionStatus === 'WARNING';
  const pending = signingOut || signOutPending;

  useEffect(() => {
    setMobileMenuOpen(false);
    setMoreMenuOpen(false);
  }, [currentPath]);

  useEffect(() => {
    const container = desktopNavRef.current;
    const measure = desktopNavMeasureRef.current;

    if (container === null || measure === null) {
      return undefined;
    }

    const measureVisibleCount = () => {
      const items = [...measure.children];
      const available = container.clientWidth;
      let count = items.length;
      const overflows = items.some(
        (item) =>
          item.offsetLeft + item.offsetWidth > available,
      );
      const limit = overflows ? available - 88 : available;

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];

        if (item.offsetLeft + item.offsetWidth > limit) {
          count = index;
          break;
        }
      }

      setVisibleNavCount((current) =>
        current === count ? current : count,
      );
    };

    measureVisibleCount();

    const observer = new ResizeObserver(measureVisibleCount);

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [portalNavigation]);

  useEffect(() => {
    if (!moreMenuOpen) {
      return undefined;
    }

    const closeMenu = (event) => {
      if (
        moreMenuRef.current !== null &&
        !moreMenuRef.current.contains(event.target)
      ) {
        setMoreMenuOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    };

    globalThis.addEventListener?.('pointerdown', closeMenu);
    globalThis.addEventListener?.('keydown', closeOnEscape);

    return () => {
      globalThis.removeEventListener?.(
        'pointerdown',
        closeMenu,
      );
      globalThis.removeEventListener?.(
        'keydown',
        closeOnEscape,
      );
    };
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };

    globalThis.addEventListener?.('keydown', handleKeyDown);

    return () => {
      globalThis.removeEventListener?.(
        'keydown',
        handleKeyDown,
      );
    };
  }, [mobileMenuOpen]);

  const handleNavigate = (item) => {
    setMobileMenuOpen(false);
    setOperationError(null);

    if (typeof onNavigate !== 'function') {
      return;
    }

    try {
      const result = onNavigate(item);

      if (
        result !== null &&
        (typeof result === 'object' ||
          typeof result === 'function') &&
        typeof result.then === 'function'
      ) {
        Promise.resolve(result).catch((error) => {
          setOperationError(
            getOperationErrorMessage(
              error,
              'The local navigation action could not be completed.',
            ),
          );
        });
      }
    } catch (error) {
      setOperationError(
        getOperationErrorMessage(
          error,
          'The local navigation action could not be completed.',
        ),
      );
    }
  };

  const handleSignOut = async () => {
    if (pending || typeof onSignOut !== 'function') {
      return;
    }

    setSignOutPending(true);
    setOperationError(null);

    try {
      await Promise.resolve(onSignOut());
      setMobileMenuOpen(false);
    } catch (error) {
      const message = getOperationErrorMessage(
        error,
        'The browser-local session could not be cleared.',
      );

      setOperationError(message);
      throw error;
    } finally {
      setSignOutPending(false);
    }
  };

  const handleContinueSession = async () => {
    if (typeof onContinueSession !== 'function') {
      return;
    }

    setOperationError(null);

    try {
      await Promise.resolve(onContinueSession());
    } catch (error) {
      setOperationError(
        getOperationErrorMessage(
          error,
          'The browser-local session could not be continued.',
        ),
      );
      throw error;
    }
  };

  const handleSessionExpire = async () => {
    if (typeof onSessionExpire !== 'function') {
      return;
    }

    try {
      await Promise.resolve(onSessionExpire());
    } catch (error) {
      setOperationError(
        getOperationErrorMessage(
          error,
          'The expired browser-local session could not be cleared.',
        ),
      );
      throw error;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted text-content dark:bg-surface-dark dark:text-content-inverse">
      <a
        className="sr-only z-[60] rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 shadow-sm backdrop-blur dark:border-border-dark dark:bg-surface-dark/95">
        <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <a
            className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark"
            href={homeHref}
            aria-label={`${applicationName} home`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
              <ShieldCheck
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <span className="hidden whitespace-nowrap text-sm font-semibold text-content dark:text-content-inverse sm:block">
              {applicationName}
            </span>
          </a>

          {portalNames.length > 1 ? (
            <label className="ml-2 hidden min-w-0 items-center gap-2 text-xs font-semibold text-content-muted dark:text-content-inverse-muted lg:flex">
              <span className="sr-only">Portal</span>
              <select
                className="max-w-40 rounded-full border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-content outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                aria-label="Portal"
                value={activePortal}
                onChange={(event) => {
                  setSelectedPortal(event.target.value);
                }}
              >
                {portalNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div
            ref={desktopNavRef}
            className="relative ml-1 hidden min-w-0 flex-1 items-center lg:flex"
          >
            <div
              ref={desktopNavMeasureRef}
              className="pointer-events-none invisible absolute left-0 top-0 flex items-center"
              aria-hidden="true"
            >
              {portalNavigation.map((item, index) => (
                <NavigationLink
                  key={`measure-${
                    item.id ??
                    item.href ??
                    item.to ??
                    item.path ??
                    index
                  }`}
                  item={item}
                  currentPath={currentPath}
                  mobile={false}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
            <nav
              className="flex min-w-0 flex-1 items-center overflow-hidden"
              aria-label="Primary navigation"
            >
              {portalNavigation
                .slice(0, visibleNavCount)
                .map((item, index) => (
                  <NavigationLink
                    key={
                      item.id ??
                      item.href ??
                      item.to ??
                      item.path ??
                      index
                    }
                    item={item}
                    currentPath={currentPath}
                    mobile={false}
                    onNavigate={handleNavigate}
                  />
                ))}
            </nav>
            {visibleNavCount < portalNavigation.length ? (
              <div
                ref={moreMenuRef}
                className="relative shrink-0"
              >
                <button
                  className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse dark:focus:ring-offset-surface-dark"
                  type="button"
                  aria-expanded={moreMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setMoreMenuOpen((open) => !open);
                  }}
                >
                  More
                  <ChevronDown
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
                {moreMenuOpen ? (
                  <div
                    className="absolute left-0 top-full z-50 mt-2 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-card dark:border-border-dark dark:bg-surface-dark"
                    role="menu"
                  >
                    {portalNavigation
                      .slice(visibleNavCount)
                      .map((item, index) => (
                        <NavigationLink
                          key={
                            item.id ??
                            item.href ??
                            item.to ??
                            item.path ??
                            index
                          }
                          item={item}
                          currentPath={currentPath}
                          mobile
                          onNavigate={handleNavigate}
                        />
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
            <a
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse dark:focus:ring-offset-surface-dark"
              href={helpHref}
            >
              <HelpCircle
                className="h-4 w-4"
                aria-hidden="true"
              />
              {helpLabel}
            </a>

            <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3 dark:border-border-dark">
              <UserRound
                className="h-5 w-5 shrink-0 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <div className="hidden min-w-0 xl:block">
                <p className="max-w-44 truncate text-sm font-medium text-content dark:text-content-inverse">
                  {actor.displayName}
                </p>
                {actor.role !== null ? (
                  <p className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    {actor.role}
                  </p>
                ) : null}
              </div>
            </div>

            {typeof onSignOut === 'function' ? (
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark"
                type="button"
                disabled={pending}
                onClick={() => {
                  handleSignOut().catch(() => {});
                }}
              >
                <LogOut
                  className="h-4 w-4"
                  aria-hidden="true"
                />
                {pending ? 'Signing out…' : 'Sign out'}
              </button>
            ) : null}
          </div>

          <button
            ref={mobileMenuButtonRef}
            className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse dark:focus:ring-offset-surface-dark lg:hidden"
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls={mobileMenuId}
            aria-label={
              mobileMenuOpen
                ? 'Close navigation menu'
                : 'Open navigation menu'
            }
            onClick={() => {
              setMobileMenuOpen((open) => !open);
            }}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>

        {operationError !== null ? (
          <div
            className="border-t border-danger-200 bg-danger-50 px-4 py-2 text-center text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
            role="alert"
          >
            {operationError}
          </div>
        ) : null}

        {mobileMenuOpen ? (
          <div
            id={mobileMenuId}
            className="border-t border-border bg-surface px-4 py-4 dark:border-border-dark dark:bg-surface-dark-muted lg:hidden"
          >
            <div className="mx-auto w-full max-w-7xl">
              <div className="mb-3 flex items-center gap-3 rounded-lg bg-surface-muted px-3 py-3 dark:bg-surface-dark">
                <UserRound
                  className="h-5 w-5 shrink-0 text-content-subtle dark:text-content-inverse-muted"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-content dark:text-content-inverse">
                    {actor.displayName}
                  </p>
                  {actor.role !== null ? (
                    <p className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Demo role: {actor.role}
                    </p>
                  ) : null}
                </div>
              </div>

              {portalNames.length > 1 ? (
                <label className="mb-3 block text-xs font-semibold text-content-muted dark:text-content-inverse-muted">
                  Portal
                  <select
                    className="mt-1 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-content outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    aria-label="Portal"
                    value={activePortal}
                    onChange={(event) => {
                      setSelectedPortal(event.target.value);
                    }}
                  >
                    {portalNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <nav
                className="space-y-1"
                aria-label="Mobile primary navigation"
              >
                {portalNavigation.map((item, index) => (
                  <NavigationLink
                    key={
                      item.id ??
                      item.href ??
                      item.to ??
                      item.path ??
                      index
                    }
                    item={item}
                    currentPath={currentPath}
                    mobile
                    onNavigate={handleNavigate}
                  />
                ))}
              </nav>

              <div className="mt-3 space-y-2 border-t border-border pt-3 dark:border-border-dark">
                <a
                  className="inline-flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse"
                  href={helpHref}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <HelpCircle
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  {helpLabel}
                </a>

                {typeof onSignOut === 'function' ? (
                  <button
                    className="inline-flex min-h-10 w-full items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      handleSignOut().catch(() => {});
                    }}
                  >
                    <LogOut
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {pending ? 'Signing out…' : 'Sign out'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      {warningVisible &&
      typeof onContinueSession === 'function' &&
      typeof onSignOut === 'function' ? (
        <SessionWarning
          open
          remainingMs={sessionRemainingMs}
          expiresAt={sessionExpiresAt}
          onContinue={handleContinueSession}
          onSignOut={handleSignOut}
          onExpire={
            typeof onSessionExpire === 'function'
              ? handleSessionExpire
              : handleSignOut
          }
          onOpenChange={onSessionWarningOpenChange}
        />
      ) : null}
    </div>
  );
}

AppShell.propTypes = {
  children: PropTypes.node.isRequired,
  session: PropTypes.shape({
    displayName: PropTypes.string,
    role: PropTypes.string,
    status: PropTypes.string,
  }),
  persona: PropTypes.string,
  role: PropTypes.string,
  navigation: PropTypes.arrayOf(PropTypes.object),
  navigationItems: PropTypes.arrayOf(PropTypes.object),
  currentPath: PropTypes.string,
  applicationName: PropTypes.string,
  homeHref: PropTypes.string,
  helpHref: PropTypes.string,
  helpLabel: PropTypes.string,
  onNavigate: PropTypes.func,
  onSignOut: PropTypes.func,
  signingOut: PropTypes.bool,
  sessionStatus: PropTypes.string,
  sessionWarningOpen: PropTypes.bool,
  sessionRemainingMs: PropTypes.number,
  sessionExpiresAt: PropTypes.oneOfType([
    PropTypes.instanceOf(Date),
    PropTypes.string,
    PropTypes.number,
  ]),
  onContinueSession: PropTypes.func,
  onSessionExpire: PropTypes.func,
  onSessionWarningOpenChange: PropTypes.func,
};

export const ApplicationShell = AppShell;
export const ResponsiveAppShell = AppShell;

export default AppShell;