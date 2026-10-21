import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Clock3,
  Loader2,
  LogOut,
} from 'lucide-react';

export const SESSION_WARNING_WINDOW_MS = 60_000;

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function normalizeRemainingMilliseconds(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : SESSION_WARNING_WINDOW_MS;
}

function resolveInitialRemainingMilliseconds({
  expiresAt,
  remainingMs,
  remainingTimeMs,
  remainingSeconds,
}) {
  if (
    expiresAt !== undefined &&
    expiresAt !== null &&
    Number.isFinite(Date.parse(expiresAt))
  ) {
    return Math.max(0, Date.parse(expiresAt) - Date.now());
  }

  if (
    typeof remainingSeconds === 'number' &&
    Number.isFinite(remainingSeconds) &&
    remainingSeconds >= 0
  ) {
    return remainingSeconds * 1000;
  }

  return normalizeRemainingMilliseconds(
    remainingMs ?? remainingTimeMs,
  );
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(milliseconds / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatRemainingAnnouncement(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(milliseconds / 1000),
  );

  if (totalSeconds === 0) {
    return 'Session expired.';
  }

  if (totalSeconds === 60) {
    return 'Your session will expire in 1 minute.';
  }

  if (totalSeconds > 60) {
    const minutes = Math.ceil(totalSeconds / 60);

    return `Your session will expire in ${minutes} minutes.`;
  }

  return `Your session will expire in ${totalSeconds} ${
    totalSeconds === 1 ? 'second' : 'seconds'
  }.`;
}

function getErrorMessage(error) {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return 'The local session action could not be completed.';
}

/**
 * Displays an accessible inactivity warning before the local demo session
 * expires.
 *
 * @param {{
 *   open?: boolean,
 *   isOpen?: boolean,
 *   remainingMs?: number,
 *   remainingTimeMs?: number,
 *   remainingSeconds?: number,
 *   expiresAt?: Date|string|number,
 *   continueLabel?: string,
 *   signOutLabel?: string,
 *   title?: string,
 *   description?: React.ReactNode,
 *   loading?: boolean,
 *   error?: React.ReactNode,
 *   onContinue: Function,
 *   onSignOut: Function,
 *   onExpire?: Function,
 *   onOpenChange?: Function
 * }} props Component props.
 * @returns {JSX.Element|null} Session warning dialog.
 */
export function SessionWarning({
  open,
  isOpen,
  remainingMs,
  remainingTimeMs,
  remainingSeconds,
  expiresAt,
  continueLabel = 'Continue session',
  signOutLabel = 'Sign out',
  title = 'Your session is about to expire',
  description = 'For your privacy, this browser-local demo session will end after one minute of inactivity.',
  loading = false,
  error = null,
  onContinue,
  onSignOut,
  onExpire,
  onOpenChange,
}) {
  const visible = open ?? isOpen ?? false;
  const titleId = useId();
  const descriptionId = useId();
  const timerId = useId();
  const errorId = useId();
  const dialogRef = useRef(null);
  const continueButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const expirationHandledRef = useRef(false);
  const [remaining, setRemaining] = useState(() =>
    resolveInitialRemainingMilliseconds({
      expiresAt,
      remainingMs,
      remainingTimeMs,
      remainingSeconds,
    }),
  );
  const [pendingAction, setPendingAction] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const pending = loading || pendingAction !== null;
  const displayedError = error ?? operationError;
  const expired = remaining <= 0;

  useEffect(() => {
    if (!visible) {
      expirationHandledRef.current = false;
      return undefined;
    }

    const initialRemaining =
      resolveInitialRemainingMilliseconds({
        expiresAt,
        remainingMs,
        remainingTimeMs,
        remainingSeconds,
      });
    const deadline = Date.now() + initialRemaining;

    setRemaining(initialRemaining);
    setOperationError(null);
    expirationHandledRef.current = false;

    const updateRemaining = () => {
      setRemaining(Math.max(0, deadline - Date.now()));
    };
    const interval = globalThis.setInterval(
      updateRemaining,
      1000,
    );

    return () => {
      globalThis.clearInterval(interval);
    };
  }, [
    expiresAt,
    remainingMs,
    remainingSeconds,
    remainingTimeMs,
    visible,
  ]);

  useEffect(() => {
    if (
      !visible ||
      remaining > 0 ||
      expirationHandledRef.current
    ) {
      return;
    }

    expirationHandledRef.current = true;

    if (typeof onExpire === 'function') {
      Promise.resolve(onExpire()).catch((operationFailure) => {
        setOperationError(getErrorMessage(operationFailure));
      });
    }
  }, [onExpire, remaining, visible]);

  useEffect(() => {
    if (!visible || typeof globalThis.document === 'undefined') {
      return undefined;
    }

    previousFocusRef.current =
      globalThis.document.activeElement;
    continueButtonRef.current?.focus();

    return () => {
      const previousFocus = previousFocusRef.current;

      if (
        previousFocus !== null &&
        typeof previousFocus.focus === 'function' &&
        previousFocus.isConnected
      ) {
        previousFocus.focus();
      }

      previousFocusRef.current = null;
    };
  }, [visible]);

  const handleContinue = async () => {
    if (pending || expired) {
      return;
    }

    setPendingAction('CONTINUE');
    setOperationError(null);

    try {
      await Promise.resolve(onContinue());

      if (typeof onOpenChange === 'function') {
        await Promise.resolve(onOpenChange(false));
      }
    } catch (operationFailure) {
      setOperationError(getErrorMessage(operationFailure));
    } finally {
      setPendingAction(null);
    }
  };

  const handleSignOut = async () => {
    if (pending) {
      return;
    }

    setPendingAction('SIGN_OUT');
    setOperationError(null);

    try {
      await Promise.resolve(onSignOut());

      if (typeof onOpenChange === 'function') {
        await Promise.resolve(onOpenChange(false));
      }
    } catch (operationFailure) {
      setOperationError(getErrorMessage(operationFailure));
    } finally {
      setPendingAction(null);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll(
        FOCUSABLE_SELECTOR,
      ) ?? [],
    ).filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true',
    );

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement =
      focusableElements[focusableElements.length - 1];
    const activeElement = globalThis.document?.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (
      !event.shiftKey &&
      activeElement === lastElement
    ) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (
    !visible ||
    typeof globalThis.document === 'undefined' ||
    globalThis.document.body === null
  ) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border border-warning-200 bg-surface shadow-elevated outline-none dark:border-warning-700 dark:bg-surface-dark-muted"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${timerId}`}
        aria-errormessage={
          displayedError !== null ? errorId : undefined
        }
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-white">
              <Clock3
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>

            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                {title}
              </h2>
              <div
                id={descriptionId}
                className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted"
              >
                {description}
              </div>
            </div>
          </div>

          <div
            id={timerId}
            className="mt-5 rounded-lg border border-warning-200 bg-warning-50 px-4 py-4 text-center dark:border-warning-700 dark:bg-surface-dark"
            role="timer"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-100">
              {expired
                ? 'Session expired'
                : 'Time remaining'}
            </p>
            <p
              className="mt-1 font-mono text-3xl font-semibold tabular-nums text-content dark:text-content-inverse"
              aria-hidden="true"
            >
              {formatRemainingTime(remaining)}
            </p>
            <span className="sr-only">
              {formatRemainingAnnouncement(remaining)}
            </span>
          </div>

          <p className="mt-4 text-xs leading-5 text-content-subtle dark:text-content-inverse-muted">
            Continuing records local activity only. No credentials
            or session data are transmitted.
          </p>

          {displayedError !== null ? (
            <div
              id={errorId}
              className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
              role="alert"
            >
              {displayedError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-muted px-5 py-4 dark:border-border-dark dark:bg-surface-dark sm:flex-row sm:justify-end sm:px-6">
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark"
            type="button"
            disabled={pending}
            onClick={handleSignOut}
          >
            {pendingAction === 'SIGN_OUT' ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <LogOut
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
            {pendingAction === 'SIGN_OUT'
              ? 'Signing out…'
              : signOutLabel}
          </button>
          <button
            ref={continueButtonRef}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
            type="button"
            disabled={pending || expired}
            onClick={handleContinue}
          >
            {pendingAction === 'CONTINUE' ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {pendingAction === 'CONTINUE'
              ? 'Continuing…'
              : continueLabel}
          </button>
        </div>
      </section>
    </div>,
    globalThis.document.body,
  );
}

SessionWarning.propTypes = {
  open: PropTypes.bool,
  isOpen: PropTypes.bool,
  remainingMs: PropTypes.number,
  remainingTimeMs: PropTypes.number,
  remainingSeconds: PropTypes.number,
  expiresAt: PropTypes.oneOfType([
    PropTypes.instanceOf(Date),
    PropTypes.string,
    PropTypes.number,
  ]),
  continueLabel: PropTypes.string,
  signOutLabel: PropTypes.string,
  title: PropTypes.string,
  description: PropTypes.node,
  loading: PropTypes.bool,
  error: PropTypes.node,
  onContinue: PropTypes.func.isRequired,
  onSignOut: PropTypes.func.isRequired,
  onExpire: PropTypes.func,
  onOpenChange: PropTypes.func,
};

export const SessionExpiryWarning = SessionWarning;
export const InactivityWarning = SessionWarning;

export default SessionWarning;