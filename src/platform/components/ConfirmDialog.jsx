import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Loader2,
} from 'lucide-react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getErrorMessage(error) {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return 'The local action could not be completed.';
}

/**
 * Keyboard- and focus-safe confirmation dialog for consequential local actions.
 *
 * @param {{
 *   open?: boolean,
 *   isOpen?: boolean,
 *   title: React.ReactNode,
 *   description?: React.ReactNode,
 *   children?: React.ReactNode,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   confirmationText?: string,
 *   confirmationLabel?: string,
 *   confirmationPlaceholder?: string,
 *   destructive?: boolean,
 *   confirmDisabled?: boolean,
 *   loading?: boolean,
 *   error?: React.ReactNode,
 *   closeOnBackdrop?: boolean,
 *   initialFocusRef?: {current?: HTMLElement|null},
 *   onConfirm: Function,
 *   onCancel?: Function,
 *   onClose?: Function,
 *   onOpenChange?: Function
 * }} props Component props.
 * @returns {JSX.Element|null} Confirmation dialog.
 */
export function ConfirmDialog({
  open,
  isOpen,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmationText,
  confirmationLabel = 'Type the confirmation text to continue',
  confirmationPlaceholder = '',
  destructive = false,
  confirmDisabled = false,
  loading = false,
  error = null,
  closeOnBackdrop = true,
  initialFocusRef,
  onConfirm,
  onCancel,
  onClose,
  onOpenChange,
}) {
  const visible = open ?? isOpen ?? false;
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const confirmationId = useId();
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [confirmationValue, setConfirmationValue] = useState('');
  const [operationPending, setOperationPending] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const pending = loading || operationPending;
  const requiresConfirmation =
    typeof confirmationText === 'string' &&
    confirmationText.length > 0;
  const confirmationMatches =
    !requiresConfirmation ||
    confirmationValue === confirmationText;
  const confirmUnavailable =
    pending || confirmDisabled || !confirmationMatches;
  const displayedError = error ?? operationError;
  const hasDescription =
    description !== undefined ||
    children !== undefined;

  useEffect(() => {
    if (!visible || typeof globalThis.document === 'undefined') {
      return undefined;
    }

    previousFocusRef.current =
      globalThis.document.activeElement;
    setConfirmationValue('');
    setOperationError(null);

    const preferredFocus =
      initialFocusRef?.current ??
      (destructive
        ? cancelButtonRef.current
        : confirmButtonRef.current) ??
      dialogRef.current;

    preferredFocus?.focus();

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
  }, [destructive, initialFocusRef, visible]);

  const requestClose = async () => {
    if (pending) {
      return;
    }

    setOperationError(null);
    setOperationPending(true);

    try {
      const cancelHandler = onCancel ?? onClose;

      if (typeof cancelHandler === 'function') {
        await Promise.resolve(cancelHandler());
      }

      if (typeof onOpenChange === 'function') {
        await Promise.resolve(onOpenChange(false));
      }
    } catch (operationFailure) {
      setOperationError(getErrorMessage(operationFailure));
    } finally {
      setOperationPending(false);
    }
  };

  const handleConfirm = async (event) => {
    event.preventDefault();

    if (confirmUnavailable) {
      return;
    }

    setOperationError(null);
    setOperationPending(true);

    try {
      await Promise.resolve(
        onConfirm(
          requiresConfirmation
            ? confirmationValue
            : undefined,
        ),
      );

      if (typeof onOpenChange === 'function') {
        await Promise.resolve(onOpenChange(false));
      }
    } catch (operationFailure) {
      setOperationError(getErrorMessage(operationFailure));
    } finally {
      setOperationPending(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();

      if (!pending) {
        requestClose();
      }

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

  const handleBackdropMouseDown = (event) => {
    if (
      closeOnBackdrop &&
      event.target === event.currentTarget &&
      !pending
    ) {
      requestClose();
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
      onMouseDown={handleBackdropMouseDown}
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-elevated outline-none dark:border-border-dark dark:bg-surface-dark-muted"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={
          hasDescription ? descriptionId : undefined
        }
        aria-errormessage={
          displayedError !== null ? errorId : undefined
        }
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleConfirm}>
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              {destructive ? (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-950 dark:text-danger-100">
                  <AlertTriangle
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
              ) : null}

              <div className="min-w-0 flex-1">
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-content dark:text-content-inverse"
                >
                  {title}
                </h2>

                {hasDescription ? (
                  <div
                    id={descriptionId}
                    className="mt-2 space-y-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted"
                  >
                    {description !== undefined ? (
                      <p>{description}</p>
                    ) : null}
                    {children}
                  </div>
                ) : null}
              </div>
            </div>

            {requiresConfirmation ? (
              <div className="mt-5">
                <label
                  htmlFor={confirmationId}
                  className="block text-sm font-medium text-content dark:text-content-inverse"
                >
                  {confirmationLabel}
                </label>
                <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                  Enter{' '}
                  <span className="font-mono font-semibold text-content dark:text-content-inverse">
                    {confirmationText}
                  </span>
                </p>
                <input
                  id={confirmationId}
                  className="mt-2 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="text"
                  value={confirmationValue}
                  placeholder={confirmationPlaceholder}
                  autoComplete="off"
                  spellCheck="false"
                  disabled={pending}
                  onChange={(event) => {
                    setConfirmationValue(event.target.value);
                    setOperationError(null);
                  }}
                />
              </div>
            ) : null}

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
              ref={cancelButtonRef}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark"
              type="button"
              disabled={pending}
              onClick={requestClose}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmButtonRef}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark ${
                destructive
                  ? 'border-danger-600 bg-danger-600 hover:bg-danger-700 focus:ring-danger-500'
                  : 'border-primary-600 bg-primary-600 hover:bg-primary-700 focus:ring-primary-500'
              }`}
              type="submit"
              disabled={confirmUnavailable}
            >
              {pending ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              {pending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>,
    globalThis.document.body,
  );
}

ConfirmDialog.propTypes = {
  open: PropTypes.bool,
  isOpen: PropTypes.bool,
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  children: PropTypes.node,
  confirmLabel: PropTypes.string,
  cancelLabel: PropTypes.string,
  confirmationText: PropTypes.string,
  confirmationLabel: PropTypes.string,
  confirmationPlaceholder: PropTypes.string,
  destructive: PropTypes.bool,
  confirmDisabled: PropTypes.bool,
  loading: PropTypes.bool,
  error: PropTypes.node,
  closeOnBackdrop: PropTypes.bool,
  initialFocusRef: PropTypes.shape({
    current: PropTypes.object,
  }),
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func,
  onClose: PropTypes.func,
  onOpenChange: PropTypes.func,
};

export const ConfirmationDialog = ConfirmDialog;
export const DestructiveConfirmDialog = ConfirmDialog;

export default ConfirmDialog;