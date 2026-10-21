import PropTypes from 'prop-types';
import { Component } from 'react';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { safeLogger } from '../security/safeLogger.js';

let referenceSequence = 0;

function createReferenceCode() {
  referenceSequence += 1;

  const cryptoProvider = globalThis.crypto;
  let randomValue = '';

  if (
    cryptoProvider !== undefined &&
    typeof cryptoProvider.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(4);

    cryptoProvider.getRandomValues(bytes);
    randomValue = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, '0'),
    )
      .join('')
      .toUpperCase();
  } else {
    randomValue = referenceSequence
      .toString(36)
      .padStart(8, '0')
      .slice(-8)
      .toUpperCase();
  }

  return `UI-${randomValue}`;
}

function resetKeysChanged(previousKeys, nextKeys) {
  if (previousKeys === nextKeys) {
    return false;
  }

  if (
    !Array.isArray(previousKeys) ||
    !Array.isArray(nextKeys) ||
    previousKeys.length !== nextKeys.length
  ) {
    return true;
  }

  return previousKeys.some(
    (value, index) => !Object.is(value, nextKeys[index]),
  );
}

function createInitialState() {
  return {
    hasError: false,
    referenceCode: null,
    actionPending: null,
    actionError: null,
    restored: false,
  };
}

/**
 * Route-level resilience boundary that presents sanitized recovery guidance
 * without displaying or logging raw error or entity data.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = createInitialState();
    this.handleReset = this.handleReset.bind(this);
    this.handleRestore = this.handleRestore.bind(this);
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError() {
    return {
      hasError: true,
      referenceCode: createReferenceCode(),
      actionPending: null,
      actionError: null,
      restored: false,
    };
  }

  componentDidCatch() {
    const { onError } = this.props;
    const { referenceCode } = this.state;
    const safeReference =
      referenceCode ?? createReferenceCode();

    safeLogger.error('UI_ERROR_BOUNDARY', {
      correlationId: safeReference,
    });

    if (typeof onError === 'function') {
      try {
        onError(
          Object.freeze({
            referenceCode: safeReference,
          }),
        );
      } catch {
        safeLogger.warn('UI_ERROR_CALLBACK_FAILED', {
          correlationId: safeReference,
        });
      }
    }
  }

  componentDidUpdate(previousProps) {
    if (
      this.state.hasError &&
      resetKeysChanged(
        previousProps.resetKeys,
        this.props.resetKeys,
      )
    ) {
      this.setState(createInitialState());
    }
  }

  async handleReset() {
    const { onReset } = this.props;

    this.setState({
      actionPending: 'RESET',
      actionError: null,
    });

    try {
      if (typeof onReset === 'function') {
        await Promise.resolve(onReset());
      }

      this.setState(createInitialState());
    } catch {
      this.setState({
        actionPending: null,
        actionError:
          'The page could not be restored automatically. Reload the application or restore the sample data.',
      });
    }
  }

  async handleRestore() {
    const { onRestore } = this.props;

    if (typeof onRestore !== 'function') {
      return;
    }

    this.setState({
      actionPending: 'RESTORE',
      actionError: null,
      restored: false,
    });

    try {
      const result = await Promise.resolve(onRestore());

      if (result === false || result?.ok === false) {
        throw new Error('Restore operation was not completed.');
      }

      this.setState({
        actionPending: null,
        actionError: null,
        restored: true,
      });
    } catch {
      this.setState({
        actionPending: null,
        actionError:
          'Sample data could not be restored. Your existing browser-local data was not intentionally cleared.',
        restored: false,
      });
    }
  }

  async handleReload() {
    const { onReload } = this.props;

    this.setState({
      actionPending: 'RELOAD',
      actionError: null,
    });

    try {
      if (typeof onReload === 'function') {
        await Promise.resolve(onReload());
        return;
      }

      if (
        globalThis.location === undefined ||
        typeof globalThis.location.reload !== 'function'
      ) {
        throw new Error('Browser reload is unavailable.');
      }

      globalThis.location.reload();
    } catch {
      this.setState({
        actionPending: null,
        actionError:
          'The application could not reload automatically. Use your browser reload control to continue.',
      });
    }
  }

  render() {
    const {
      children,
      onRestore,
      title,
    } = this.props;
    const {
      hasError,
      referenceCode,
      actionPending,
      actionError,
      restored,
    } = this.state;

    if (!hasError) {
      return children;
    }

    const pending = actionPending !== null;

    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
        <section
          className="w-full rounded-xl border border-danger-200 bg-surface p-6 shadow-elevated dark:border-danger-700 dark:bg-surface-dark-muted sm:p-8"
          role="alert"
          aria-labelledby="error-boundary-title"
          aria-describedby="error-boundary-description error-boundary-reference"
          aria-busy={pending}
        >
          <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-700 dark:text-white">
              <AlertTriangle
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>

            <div className="mt-4 min-w-0 flex-1 sm:ml-4 sm:mt-0">
              <h1
                id="error-boundary-title"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                {title}
              </h1>
              <p
                id="error-boundary-description"
                className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted"
              >
                This page encountered an unexpected local error.
                No raw error details or protected record data are
                displayed. Try the page again, reload the
                application, or restore the canonical fictional
                sample data.
              </p>

              <p
                id="error-boundary-reference"
                className="mt-4 text-sm text-content-muted dark:text-content-inverse-muted"
              >
                Reference code:{' '}
                <span className="rounded bg-surface-muted px-2 py-1 font-mono font-semibold text-content dark:bg-surface-dark dark:text-content-inverse">
                  {referenceCode}
                </span>
              </p>

              {restored ? (
                <div
                  className="mt-4 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
                  role="status"
                >
                  Sample data was restored. Reload the application
                  to continue with a clean route state.
                </div>
              ) : null}

              {actionError !== null ? (
                <div
                  className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-700 dark:bg-surface-dark dark:text-danger-100"
                  role="alert"
                >
                  {actionError}
                </div>
              ) : null}

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                  type="button"
                  disabled={pending || restored}
                  onClick={this.handleReset}
                >
                  {actionPending === 'RESET' ? (
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <RotateCcw
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                  {actionPending === 'RESET'
                    ? 'Trying again…'
                    : 'Try page again'}
                </button>

                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark"
                  type="button"
                  disabled={pending}
                  onClick={this.handleReload}
                >
                  {actionPending === 'RELOAD' ? (
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                  {actionPending === 'RELOAD'
                    ? 'Reloading…'
                    : 'Reload application'}
                </button>

                {typeof onRestore === 'function' ? (
                  <button
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-warning-700 bg-warning-50 px-4 py-2 text-sm font-semibold text-warning-700 transition hover:bg-warning-100 focus:outline-none focus:ring-2 focus:ring-warning-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface-dark dark:text-warning-100 dark:focus:ring-offset-surface-dark"
                    type="button"
                    disabled={pending || restored}
                    onClick={this.handleRestore}
                  >
                    {actionPending === 'RESTORE' ? (
                      <Loader2
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <RotateCcw
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                    )}
                    {actionPending === 'RESTORE'
                      ? 'Restoring…'
                      : 'Restore sample data'}
                  </button>
                ) : null}
              </div>

              <p className="mt-5 text-xs leading-5 text-content-subtle dark:text-content-inverse-muted">
                This recovery screen uses a sanitized reference
                code only. It does not transmit error details,
                claim information, member information, or other
                browser-local data.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onError: PropTypes.func,
  onReload: PropTypes.func,
  onReset: PropTypes.func,
  onRestore: PropTypes.func,
  resetKeys: PropTypes.arrayOf(PropTypes.any),
  title: PropTypes.string,
};

ErrorBoundary.defaultProps = {
  onError: undefined,
  onReload: undefined,
  onReset: undefined,
  onRestore: undefined,
  resetKeys: [],
  title: 'This page could not be displayed',
};

export const ApplicationErrorBoundary = ErrorBoundary;
export const RouteErrorBoundary = ErrorBoundary;
export const ResilienceBoundary = ErrorBoundary;

export default ErrorBoundary;