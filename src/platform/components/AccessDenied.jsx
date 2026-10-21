import PropTypes from 'prop-types';

/**
 * Generic denial and not-found presentation that does not confirm whether a
 * protected resource exists.
 *
 * @param {{authenticated?: boolean}} props Component props.
 * @returns {JSX.Element} Safe unavailable-page presentation.
 */
export function AccessDenied({ authenticated = false }) {
  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
      <section
        className="w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8"
        role="alert"
        aria-labelledby="access-denied-title"
        aria-describedby="access-denied-message access-denied-privacy"
      >
        <h1
          id="access-denied-title"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Access unavailable
        </h1>
        <p
          id="access-denied-message"
          className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted"
        >
          {authenticated
            ? 'This page may be unavailable, or your current demo role may not have access.'
            : 'This page may be unavailable, or an authorized demo session may be required.'}
        </p>
        <p
          id="access-denied-privacy"
          className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
        >
          No protected record details were displayed.
        </p>
      </section>
    </main>
  );
}

AccessDenied.propTypes = {
  authenticated: PropTypes.bool,
};

export const AccessUnavailable = AccessDenied;
export const SafeAccessDenied = AccessDenied;

export default AccessDenied;