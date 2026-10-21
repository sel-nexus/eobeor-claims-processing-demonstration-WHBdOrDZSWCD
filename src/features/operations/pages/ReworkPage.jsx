import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Moon,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDate,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['BOS', 'ADMIN']);
const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const MAXIMUM_REASON_LENGTH = 100;
const MAXIMUM_NOTES_LENGTH = 500;
const EMPTY_COLLECTION = Object.freeze([]);

const EXECUTION_MODES = Object.freeze({
  IMMEDIATE: 'IMMEDIATE',
  NIGHTLY_BATCH: 'NIGHTLY_BATCH',
});

const EXECUTION_OPTIONS = Object.freeze([
  Object.freeze({
    value: EXECUTION_MODES.IMMEDIATE,
    label: 'Process immediately',
    description:
      'Create one BOTH request and run the deterministic document pipeline now.',
    Icon: Activity,
  }),
  Object.freeze({
    value: EXECUTION_MODES.NIGHTLY_BATCH,
    label: 'Add to nightly batch',
    description:
      'Create one BOTH request and add one row to the browser-local nightly queue.',
    Icon: Moon,
  }),
]);

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

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function normalizeContext(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? value.session
    : isPlainObject(value.actor)
      ? value.actor
      : value;
  const role = normalizeRole(source.role);

  if (role === null) {
    return null;
  }

  return {
    ...source,
    role,
    actorId:
      typeof source.actorId === 'string' &&
      source.actorId.trim().length > 0
        ? source.actorId.normalize('NFC').trim()
        : typeof source.userId === 'string' &&
            source.userId.trim().length > 0
          ? source.userId.normalize('NFC').trim()
          : null,
  };
}

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toUpperCase()
    : '';
}

function normalizeReasonCode(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFC')
        .trim()
        .replace(/\s+/g, '_')
        .toUpperCase()
    : '';
}

function resolveReworkMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.reworkClaim === 'function') {
    return service.reworkClaim.bind(service);
  }

  if (typeof service.rework === 'function') {
    return service.rework.bind(service);
  }

  if (typeof service.processClaimRework === 'function') {
    return service.processClaimRework.bind(service);
  }

  return null;
}

function createServiceError(result, fallback) {
  const error = new Error(
    typeof result?.error?.message === 'string' &&
    result.error.message.trim().length > 0
      ? result.error.message
      : fallback,
  );

  if (typeof result?.error?.code === 'string') {
    error.code = result.error.code;
  }

  if (Array.isArray(result?.error?.fieldErrors)) {
    error.fieldErrors = result.error.fieldErrors;
  }

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function getFieldErrors(error) {
  return Array.isArray(error?.fieldErrors)
    ? error.fieldErrors.filter(
        (fieldError) =>
          isPlainObject(fieldError) &&
          typeof fieldError.message === 'string' &&
          fieldError.message.trim().length > 0,
      )
    : [];
}

function validateForm({
  claimNumber,
  execution,
  reasonCode,
  notes,
}) {
  const errors = [];

  if (claimNumber.length === 0) {
    errors.push({
      field: 'claimNumber',
      message: 'Claim number is required.',
    });
  } else if (!IDENTIFIER_PATTERN.test(claimNumber)) {
    errors.push({
      field: 'claimNumber',
      message:
        'Claim number must contain 1–40 letters, numbers, underscores, or hyphens.',
    });
  }

  if (!Object.values(EXECUTION_MODES).includes(execution)) {
    errors.push({
      field: 'execution',
      message:
        'Select immediate processing or the nightly batch.',
    });
  }

  if (reasonCode.length === 0) {
    errors.push({
      field: 'reasonCode',
      message: 'A rework reason code is required.',
    });
  } else if (reasonCode.length > MAXIMUM_REASON_LENGTH) {
    errors.push({
      field: 'reasonCode',
      message: `Reason code must not exceed ${MAXIMUM_REASON_LENGTH} characters.`,
    });
  }

  if (notes.length > MAXIMUM_NOTES_LENGTH) {
    errors.push({
      field: 'notes',
      message: `Notes must not exceed ${MAXIMUM_NOTES_LENGTH} characters.`,
    });
  }

  return errors;
}

function getFieldError(errors, field) {
  return errors.find((error) => error.field === field);
}

function getDocumentId(document) {
  const value =
    document.documentId ?? document.reportId;

  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

function getDocumentKey(document, index) {
  return getDocumentId(document) || `rework-document-${index}`;
}

function getDocumentTitle(document) {
  if (
    typeof document.documentTitle === 'string' &&
    document.documentTitle.trim().length > 0
  ) {
    return document.documentTitle;
  }

  return document.documentType === 'EOR'
    ? 'Explanation of Review'
    : 'Explanation of Benefits';
}

/**
 * Claim-rework route for authorized BOS and Admin demo roles.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   batchService?: object,
 *   reworkService?: object,
 *   initialClaimNumber?: string,
 *   initialExecution?: string,
 *   initialReasonCode?: string,
 *   initialNotes?: string,
 *   initialDocuments?: readonly Record<string, unknown>[],
 *   disabled?: boolean,
 *   onCompleted?: Function,
 *   onNavigate?: Function
 * }} props Component props.
 * @returns {JSX.Element} Claim rework page.
 */
export function ReworkPage({
  session = null,
  context = null,
  batchService = null,
  reworkService = null,
  initialClaimNumber = '',
  initialExecution = EXECUTION_MODES.IMMEDIATE,
  initialReasonCode = 'CORRECTED_CLAIM',
  initialNotes = '',
  initialDocuments = EMPTY_COLLECTION,
  disabled = false,
  onCompleted,
  onNavigate,
}) {
  const headingId = useId();
  const claimNumberId = useId();
  const executionId = useId();
  const reasonCodeId = useId();
  const notesId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service = reworkService ?? batchService;
  const [claimNumber, setClaimNumber] = useState(() =>
    normalizeIdentifier(initialClaimNumber),
  );
  const [execution, setExecution] = useState(() =>
    Object.values(EXECUTION_MODES).includes(
      initialExecution,
    )
      ? initialExecution
      : EXECUTION_MODES.IMMEDIATE,
  );
  const [reasonCode, setReasonCode] = useState(() =>
    normalizeReasonCode(initialReasonCode),
  );
  const [notes, setNotes] = useState(initialNotes);
  const [documents, setDocuments] = useState(
    initialDocuments,
  );
  const [result, setResult] = useState(null);
  const [fieldErrors, setFieldErrors] = useState([]);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [processing, setProcessing] = useState(false);
  const [navigationPending, setNavigationPending] =
    useState(null);

  const claimError = getFieldError(
    fieldErrors,
    'claimNumber',
  );
  const executionError = getFieldError(
    fieldErrors,
    'execution',
  );
  const reasonCodeError = getFieldError(
    fieldErrors,
    'reasonCode',
  );
  const notesError = getFieldError(fieldErrors, 'notes');

  const clearFeedback = (field = null) => {
    setOperationError(null);
    setOperationMessage(null);
    setResult(null);

    if (field !== null) {
      setFieldErrors((current) =>
        current.filter((error) => error.field !== field),
      );
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const normalizedValues = {
      claimNumber: normalizeIdentifier(claimNumber),
      execution,
      reasonCode: normalizeReasonCode(reasonCode),
      notes:
        typeof notes === 'string'
          ? notes.normalize('NFC').trim()
          : '',
    };
    const validationErrors = validateForm(normalizedValues);

    setOperationError(null);
    setOperationMessage(null);
    setResult(null);

    if (validationErrors.length > 0) {
      setFieldErrors(validationErrors);
      return;
    }

    const reworkClaim = resolveReworkMethod(service);

    if (reworkClaim === null) {
      setOperationError(
        'Claim rework is unavailable in this application composition.',
      );
      return;
    }

    setProcessing(true);
    setFieldErrors([]);

    const command = {
      ...normalizedValues,
      idempotencyKey: generateUuid(),
    };

    try {
      const serviceResult = await Promise.resolve(
        reworkClaim(command, accessContext),
      );
      const data = unwrapServiceResult(
        serviceResult,
        'The fictional claim could not be reworked.',
      );

      if (
        !isPlainObject(data) ||
        typeof data.requestId !== 'string' ||
        data.requestId.trim().length === 0
      ) {
        throw new Error(
          'The local rework service returned invalid workflow evidence.',
        );
      }

      const documentIds = Array.isArray(data.documentIds)
        ? data.documentIds.filter(
            (documentId) =>
              typeof documentId === 'string' &&
              documentId.trim().length > 0,
          )
        : [];
      const returnedDocuments = Array.isArray(data.documents)
        ? data.documents.filter(isPlainObject)
        : documentIds.map((documentId) => ({
            documentId,
            documentType: documentId.includes('EOR')
              ? 'EOR'
              : 'EOB',
            status: 'COMPLETE',
          }));

      setClaimNumber(normalizedValues.claimNumber);
      setReasonCode(normalizedValues.reasonCode);
      setNotes(normalizedValues.notes);
      setResult(data);

      if (returnedDocuments.length > 0) {
        setDocuments((current) => {
          const byId = new Map(
            current.map((document) => [
              getDocumentId(document),
              document,
            ]),
          );

          returnedDocuments.forEach((document) => {
            byId.set(getDocumentId(document), document);
          });

          return [...byId.values()];
        });
      }

      setOperationMessage(
        normalizedValues.execution ===
          EXECUTION_MODES.IMMEDIATE
          ? 'One BOTH rework request completed locally. Representative EOB and EOR versions were retained.'
          : 'One BOTH rework request was added to the browser-local nightly queue.',
      );

      if (typeof onCompleted === 'function') {
        await Promise.resolve(
          onCompleted(data, serviceResult, command),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The fictional claim could not be reworked.',
        ),
      );
      setFieldErrors(getFieldErrors(error));
    } finally {
      setProcessing(false);
    }
  };

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
          'The selected browser-local evidence could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  const requestId =
    typeof result?.requestId === 'string'
      ? result.requestId
      : null;
  const requestHref =
    requestId === null
      ? null
      : `/operations/requests/${encodeURIComponent(
          requestId,
        )}`;
  const batchId =
    typeof result?.batchId === 'string'
      ? result.batchId
      : null;
  const batchRowId =
    typeof result?.batchRowId === 'string'
      ? result.batchRowId
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="flex items-start gap-4 px-5 py-6 sm:px-7 sm:py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <Wrench
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <h1
              id={headingId}
              className="text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              Rework a fictional claim
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Create exactly one BOTH request for a corrected
              fictional claim, then process it immediately or add
              one row to the local nightly batch.
            </p>
          </div>
        </div>
      </header>

      {operationError !== null ||
      fieldErrors.length > 0 ? (
        <div
          className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              {operationError !== null ? (
                <p>{operationError}</p>
              ) : null}
              {fieldErrors.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {fieldErrors.map((error, index) => (
                    <li
                      key={`${error.field ?? 'field'}-${index}`}
                    >
                      {error.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {operationMessage !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{operationMessage}</span>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 lg:col-span-2"
          aria-labelledby="claim-rework-form-heading"
          aria-busy={processing}
        >
          <div className="flex items-start gap-3">
            <RefreshCw
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="claim-rework-form-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Rework details
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Supply an eligible fictional claim and a required
                reason code.
              </p>
            </div>
          </div>

          <form
            className="mt-6 space-y-6"
            onSubmit={handleSubmit}
            noValidate
          >
            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={claimNumberId}
              >
                Claim number
                <span
                  className="ml-1 text-danger-600 dark:text-danger-100"
                  aria-hidden="true"
                >
                  *
                </span>
              </label>
              <input
                id={claimNumberId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="text"
                value={claimNumber}
                maxLength={40}
                autoComplete="off"
                spellCheck="false"
                placeholder="CL2024REW"
                disabled={disabled || processing}
                aria-invalid={claimError !== undefined}
                aria-describedby={`${claimNumberId}-hint${
                  claimError === undefined
                    ? ''
                    : ` ${claimNumberId}-error`
                }`}
                onChange={(event) => {
                  setClaimNumber(event.target.value.toUpperCase());
                  clearFeedback('claimNumber');
                }}
              />
              <p
                id={`${claimNumberId}-hint`}
                className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
              >
                The claim must exist in authorized fictional
                fixtures and be eligible for local rework.
              </p>
              {claimError !== undefined ? (
                <p
                  id={`${claimNumberId}-error`}
                  className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                >
                  {claimError.message}
                </p>
              ) : null}
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-content dark:text-content-inverse">
                Execution
                <span
                  className="ml-1 text-danger-600 dark:text-danger-100"
                  aria-hidden="true"
                >
                  *
                </span>
              </legend>
              <p
                id={`${executionId}-hint`}
                className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted"
              >
                Both choices create exactly one EOB and EOR
                rework request.
              </p>

              <div
                className="mt-3 grid gap-3 sm:grid-cols-2"
                aria-describedby={`${executionId}-hint${
                  executionError === undefined
                    ? ''
                    : ` ${executionId}-error`
                }`}
              >
                {EXECUTION_OPTIONS.map((option) => {
                  const optionId = `${executionId}-${option.value}`;
                  const OptionIcon = option.Icon;

                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition focus-within:ring-2 focus-within:ring-primary-500 ${
                        execution === option.value
                          ? 'border-primary-500 bg-primary-50 dark:border-primary-600 dark:bg-primary-950'
                          : 'border-border bg-surface hover:bg-surface-muted dark:border-border-dark dark:bg-surface-dark dark:hover:bg-surface-dark-raised'
                      } ${
                        disabled || processing
                          ? 'cursor-not-allowed opacity-60'
                          : ''
                      }`}
                      htmlFor={optionId}
                    >
                      <input
                        id={optionId}
                        className="mt-1 h-4 w-4 shrink-0 border-border-strong text-primary-600 focus:ring-primary-500"
                        type="radio"
                        name={executionId}
                        value={option.value}
                        checked={execution === option.value}
                        disabled={disabled || processing}
                        onChange={(event) => {
                          setExecution(event.target.value);
                          clearFeedback('execution');
                        }}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-semibold text-content dark:text-content-inverse">
                          <OptionIcon
                            className="h-4 w-4 text-primary-700 dark:text-primary-300"
                            aria-hidden="true"
                          />
                          {option.label}
                        </span>
                        <span className="mt-2 block text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {executionError !== undefined ? (
                <p
                  id={`${executionId}-error`}
                  className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                >
                  {executionError.message}
                </p>
              ) : null}
            </fieldset>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={reasonCodeId}
              >
                Reason code
                <span
                  className="ml-1 text-danger-600 dark:text-danger-100"
                  aria-hidden="true"
                >
                  *
                </span>
              </label>
              <input
                id={reasonCodeId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="text"
                value={reasonCode}
                maxLength={MAXIMUM_REASON_LENGTH}
                autoComplete="off"
                spellCheck="false"
                placeholder="CORRECTED_CLAIM"
                disabled={disabled || processing}
                aria-invalid={reasonCodeError !== undefined}
                aria-describedby={`${reasonCodeId}-hint${
                  reasonCodeError === undefined
                    ? ''
                    : ` ${reasonCodeId}-error`
                }`}
                onChange={(event) => {
                  setReasonCode(event.target.value.toUpperCase());
                  clearFeedback('reasonCode');
                }}
              />
              <p
                id={`${reasonCodeId}-hint`}
                className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
              >
                The reason is retained as browser-local
                demonstration evidence.
              </p>
              {reasonCodeError !== undefined ? (
                <p
                  id={`${reasonCodeId}-error`}
                  className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                >
                  {reasonCodeError.message}
                </p>
              ) : null}
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={notesId}
              >
                Notes
              </label>
              <textarea
                id={notesId}
                className="mt-2 block min-h-28 w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                value={notes}
                maxLength={MAXIMUM_NOTES_LENGTH}
                disabled={disabled || processing}
                aria-invalid={notesError !== undefined}
                aria-describedby={`${notesId}-hint${
                  notesError === undefined
                    ? ''
                    : ` ${notesId}-error`
                }`}
                onChange={(event) => {
                  setNotes(event.target.value);
                  clearFeedback('notes');
                }}
              />
              <div
                id={`${notesId}-hint`}
                className="mt-2 flex items-center justify-between gap-3 text-xs text-content-subtle dark:text-content-inverse-muted"
              >
                <span>
                  Use fictional information only.
                </span>
                <span className="tabular-nums">
                  {notes.length}/{MAXIMUM_NOTES_LENGTH}
                </span>
              </div>
              {notesError !== undefined ? (
                <p
                  id={`${notesId}-error`}
                  className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                >
                  {notesError.message}
                </p>
              ) : null}
            </div>

            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="submit"
              disabled={disabled || processing}
            >
              {processing ? (
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
              {processing
                ? 'Reworking locally…'
                : execution === EXECUTION_MODES.IMMEDIATE
                  ? 'Create and process BOTH request'
                  : 'Create BOTH nightly request'}
            </button>
          </form>
        </section>

        <aside
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="rework-summary-heading"
        >
          <h2
            id="rework-summary-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Rework summary
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Fixed characteristics of this local workflow.
          </p>

          <dl className="mt-5 space-y-4">
            <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                Request type
              </dt>
              <dd className="mt-1 font-semibold text-content dark:text-content-inverse">
                BOTH
              </dd>
              <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
                Explanation of Benefits and Explanation of Review
              </p>
            </div>

            <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                Execution
              </dt>
              <dd className="mt-1 font-semibold text-content dark:text-content-inverse">
                {execution === EXECUTION_MODES.IMMEDIATE
                  ? 'Immediate local pipeline'
                  : 'Local nightly queue'}
              </dd>
            </div>

            <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                Current demo role
              </dt>
              <dd className="mt-1 font-mono font-semibold text-primary-700 dark:text-primary-300">
                {role}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-border pt-5 dark:border-border-dark">
            <div className="flex items-start gap-3">
              <Clock3
                className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-content dark:text-content-inverse">
                  Prior versions remain retained
                </p>
                <p className="mt-1 text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                  Rework allocates new immutable version metadata.
                  Existing representative document versions are
                  not replaced.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {result !== null ? (
        <section
          className="mt-8 rounded-xl border border-success-200 bg-success-50 p-5 shadow-card dark:border-success-700 dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="rework-result-heading"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 h-6 w-6 shrink-0 text-success-700 dark:text-success-100"
                aria-hidden="true"
              />
              <div>
                <h2
                  id="rework-result-heading"
                  className="text-lg font-semibold text-content dark:text-content-inverse"
                >
                  Local rework evidence
                </h2>
                <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                  One BOTH request was created for claim{' '}
                  <span className="font-mono font-semibold">
                    {claimNumber}
                  </span>
                  .
                </p>
              </div>
            </div>
            <StatusBadge
              status={result.status ?? 'PENDING'}
            />
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-surface p-4 dark:bg-surface-dark">
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                Request ID
              </dt>
              <dd className="mt-1 break-all font-mono text-sm font-semibold text-content dark:text-content-inverse">
                {result.requestId}
              </dd>
            </div>
            <div className="rounded-lg bg-surface p-4 dark:bg-surface-dark">
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                Request type
              </dt>
              <dd className="mt-1 text-sm font-semibold text-content dark:text-content-inverse">
                {result.requestType ?? 'BOTH'}
              </dd>
            </div>
            <div className="rounded-lg bg-surface p-4 dark:bg-surface-dark">
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                Execution
              </dt>
              <dd className="mt-1 text-sm font-semibold text-content dark:text-content-inverse">
                {formatStatus(
                  result.execution ?? execution,
                )}
              </dd>
            </div>
            <div className="rounded-lg bg-surface p-4 dark:bg-surface-dark">
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                External transmission
              </dt>
              <dd className="mt-1 text-sm font-semibold text-success-700 dark:text-success-100">
                No
              </dd>
            </div>
          </dl>

          {batchId !== null || batchRowId !== null ? (
            <div className="mt-4 rounded-lg border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark">
              <p className="text-sm font-semibold text-content dark:text-content-inverse">
                Nightly queue evidence
              </p>
              {batchId !== null ? (
                <p className="mt-2 break-all font-mono text-xs text-content-muted dark:text-content-inverse-muted">
                  Batch: {batchId}
                </p>
              ) : null}
              {batchRowId !== null ? (
                <p className="mt-1 break-all font-mono text-xs text-content-muted dark:text-content-inverse-muted">
                  Row: {batchRowId}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {requestHref !== null ? (
              <a
                className="inline-flex min-h-10 items-center justify-between gap-3 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                href={requestHref}
                onClick={(event) => {
                  handleNavigation(
                    event,
                    {
                      type: 'REPRINT_REQUEST',
                      href: requestHref,
                      requestId,
                      request: result,
                    },
                    'request',
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The rework request could not be opened.',
                      ),
                    );
                  });
                }}
              >
                Open request evidence
                {navigationPending === 'request' ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
              </a>
            ) : null}

            {execution === EXECUTION_MODES.NIGHTLY_BATCH ? (
              <a
                className="inline-flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                href="/operations/batch"
                onClick={(event) => {
                  handleNavigation(
                    event,
                    {
                      type: 'BATCH',
                      href: '/operations/batch',
                      batchId,
                      batchRowId,
                    },
                    'batch',
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The nightly batch route could not be opened.',
                      ),
                    );
                  });
                }}
              >
                Open nightly batch
                {navigationPending === 'batch' ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <section
        className="mt-8"
        aria-labelledby="retained-versions-heading"
      >
        <div className="flex items-start gap-3">
          <FileText
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="retained-versions-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Retained EOB and EOR versions
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Immutable representative versions supplied by the
              current local workflow composition.
            </p>
          </div>
        </div>

        {documents.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileText
              className="mx-auto h-7 w-7 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted">
              No retained document versions are displayed yet.
              Immediate successful rework evidence will appear
              here when document identifiers are returned.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((document, index) => {
              const documentId = getDocumentId(document);
              const href = `/documents/${encodeURIComponent(
                documentId,
              )}`;
              const key = `document-${documentId}`;

              return (
                <a
                  key={getDocumentKey(document, index)}
                  className="group flex min-h-44 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                  href={href}
                  aria-busy={navigationPending === key}
                  onClick={(event) => {
                    handleNavigation(
                      event,
                      {
                        type: 'DOCUMENT',
                        href,
                        documentId,
                        document,
                      },
                      key,
                    ).catch((error) => {
                      setOperationError(
                        normalizeErrorMessage(
                          error,
                          'The retained document version could not be opened.',
                        ),
                      );
                    });
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                      <FileText
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                    </span>
                    <StatusBadge
                      status={document.status ?? 'COMPLETE'}
                    />
                  </div>
                  <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                    {getDocumentTitle(document)}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                    {documentId || 'Representative document'}
                  </p>
                  <p className="mt-3 text-xs text-content-muted dark:text-content-inverse-muted">
                    Version {document.version ?? '—'} ·{' '}
                    {formatDate(document.documentDate)}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                    {navigationPending === key
                      ? 'Opening…'
                      : 'Open retained version'}
                    {navigationPending === key ? (
                      <Loader2
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Claim rework disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional claim rework only
            </p>
            <p className="mt-1 text-sm leading-6">
              Requests, batch rows, pipeline outcomes, and document
              versions are deterministic browser-local
              demonstrations. They do not represent an
              authoritative healthcare, coverage, payment, appeal,
              reporting, delivery, or transmission result.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

ReworkPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  batchService: PropTypes.object,
  reworkService: PropTypes.object,
  initialClaimNumber: PropTypes.string,
  initialExecution: PropTypes.string,
  initialReasonCode: PropTypes.string,
  initialNotes: PropTypes.string,
  initialDocuments: PropTypes.arrayOf(PropTypes.object),
  disabled: PropTypes.bool,
  onCompleted: PropTypes.func,
  onNavigate: PropTypes.func,
};

export const ClaimReworkPage = ReworkPage;
export const LocalClaimReworkPage = ReworkPage;
export const OperationsReworkPage = ReworkPage;

export default ReworkPage;