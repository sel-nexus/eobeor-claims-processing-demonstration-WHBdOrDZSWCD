import PropTypes from 'prop-types';
import { useState } from 'react';
import {
  ArrowRight,
  HelpCircle,
  Home,
  Loader2,
  SearchX,
  ShieldCheck,
} from 'lucide-react';

function normalizeErrorMessage(error, fallback) {
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

/**
 * Generic fallback route that does not disclose whether a protected fixture
 * identifier exists.
 *
 * @param {{
 *   homeHref?: string,
 *   helpHref?: string,
 *   onNavigate?: Function
 * }} props Component props.
 * @returns {JSX.Element} Safe not-found page.
 */
export function NotFoundPage({
  homeHref = '/',
  helpHref = '/help',
  onNavigate,
}) {
  const [navigationPending, setNavigationPending] =
    useState(null);
  const [operationError, setOperationError] = useState(null);

  const handleNavigation = async (
    event,
    destination,
    key,
  ) => {
    if (typeof onNavigate !== 'function') {
      return;
    }

    event.preventDefault();
    setNavigationPending(key);
    setOperationError(null);

    try {
      await Promise.resolve(
        onNavigate(destination, event),
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The selected browser-local route could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
      <section
        className="w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated dark:border-border-dark dark:bg-surface-dark-muted"
        aria-labelledby="not-found-heading"
        aria-describedby="not-found-description not-found-privacy"
        aria-busy={navigationPending !== null}
      >
        <div className="border-b border-primary-200 bg-primary-50 px-5 py-8 text-center dark:border-primary-800 dark:bg-primary-950 sm:px-8 sm:py-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-card">
            <SearchX
              className="h-7 w-7"
              aria-hidden="true"
            />
          </span>
          <p className="mt-5 font-mono text-sm font-semibold text-primary-700 dark:text-primary-300">
            404
          </p>
          <h1
            id="not-found-heading"
            className="mt-2 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
          >
            Page unavailable
          </h1>
          <p
            id="not-found-description"
            className="mx-auto mt-3 max-w-xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base"
          >
            The requested page may not exist, may have moved, or
            may be unavailable to the current demo role.
          </p>
        </div>

        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <div
            id="not-found-privacy"
            className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck
                className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">
                  Protected details remain private
                </p>
                <p className="mt-1 leading-6">
                  This fallback does not confirm whether any
                  member, claim, request, document, report, or
                  other protected fictional identifier exists.
                </p>
              </div>
            </div>
          </div>

          {operationError !== null ? (
            <div
              className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
              role="alert"
            >
              {operationError}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark-muted"
              href={homeHref}
              aria-busy={navigationPending === 'home'}
              onClick={(event) => {
                handleNavigation(
                  event,
                  {
                    type: 'HOME',
                    href: homeHref,
                  },
                  'home',
                ).catch((error) => {
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The browser-local home route could not be opened.',
                    ),
                  );
                });
              }}
            >
              {navigationPending === 'home' ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Home
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {navigationPending === 'home'
                ? 'Opening home…'
                : 'Go to home'}
            </a>

            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-5 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark-muted"
              href={helpHref}
              aria-busy={navigationPending === 'help'}
              onClick={(event) => {
                handleNavigation(
                  event,
                  {
                    type: 'HELP',
                    href: helpHref,
                  },
                  'help',
                ).catch((error) => {
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The browser-local help route could not be opened.',
                    ),
                  );
                });
              }}
            >
              {navigationPending === 'help' ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <HelpCircle
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              <span>
                {navigationPending === 'help'
                  ? 'Opening help…'
                  : 'Open help'}
              </span>
              {navigationPending !== 'help' ? (
                <ArrowRight
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              ) : null}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

NotFoundPage.propTypes = {
  homeHref: PropTypes.string,
  helpHref: PropTypes.string,
  onNavigate: PropTypes.func,
};

export const SafeNotFoundPage = NotFoundPage;
export const RouteNotFoundPage = NotFoundPage;

export default NotFoundPage;