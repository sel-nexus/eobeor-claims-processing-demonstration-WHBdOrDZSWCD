import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  FileText,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/i;

export const REQUEST_FORM_TYPES = Object.freeze([
  Object.freeze({
    value: 'EOB',
    label: 'EOB',
    description: 'Explanation of Benefits',
  }),
  Object.freeze({
    value: 'EOR',
    label: 'EOR',
    description: 'Explanation of Review',
  }),
  Object.freeze({
    value: 'BOTH',
    label: 'Both',
    description: 'EOB and EOR',
  }),
]);

export const REQUEST_FORM_PRIORITIES = Object.freeze([
  Object.freeze({
    value: 'URGENT',
    label: 'Urgent',
  }),
  Object.freeze({
    value: 'HIGH',
    label: 'High',
  }),
  Object.freeze({
    value: 'NORMAL',
    label: 'Normal',
  }),
]);

const REQUEST_TYPE_VALUES = new Set(
  REQUEST_FORM_TYPES.map((option) => option.value),
);
const PRIORITY_VALUES = new Set(
  REQUEST_FORM_PRIORITIES.map((option) => option.value),
);

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

function normalizeResultError(result) {
  if (
    result !== null &&
    typeof result === 'object' &&
    typeof result.error?.message === 'string' &&
    result.error.message.trim().length > 0
  ) {
    return result.error.message;
  }

  return 'The browser-local reprint request could not be created.';
}

function normalizeFieldErrors(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (error) =>
        error !== null &&
        typeof error === 'object' &&
        typeof error.field === 'string' &&
        typeof error.message === 'string' &&
        error.message.trim().length > 0,
    )
    .map((error) => ({
      field: error.field,
      message: error.message.trim(),
    }));
}

function normalizeRole(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : null;
}

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toUpperCase()
    : '';
}

function resolveFormValues({
  value,
  values,
  claimNumber,
  memberId,
  requestType,
  priority,
}) {
  const source = values ?? value ?? {};

  return {
    ...source,
    claimNumber:
      claimNumber ??
      source.claimNumber ??
      source.claimId ??
      '',
    memberId:
      memberId ??
      source.memberId ??
      '',
    requestType:
      requestType ??
      source.requestType ??
      'EOB',
    priority:
      priority ??
      source.priority ??
      'NORMAL',
  };
}

function validateForm(values) {
  const errors = [];
  const claimNumber = normalizeIdentifier(
    values.claimNumber,
  );
  const memberId = normalizeIdentifier(values.memberId);
  const requestType =
    typeof values.requestType === 'string'
      ? values.requestType.trim().toUpperCase()
      : '';
  const priority =
    typeof values.priority === 'string'
      ? values.priority.trim().toUpperCase()
      : '';

  if (claimNumber.length === 0) {
    errors.push({
      field: 'claimNumber',
      message: 'Claim ID is required.',
    });
  } else if (!IDENTIFIER_PATTERN.test(claimNumber)) {
    errors.push({
      field: 'claimNumber',
      message:
        'Claim ID must contain 1–40 letters, numbers, underscores, or hyphens.',
    });
  }

  if (memberId.length === 0) {
    errors.push({
      field: 'memberId',
      message: 'Member ID is required.',
    });
  } else if (!IDENTIFIER_PATTERN.test(memberId)) {
    errors.push({
      field: 'memberId',
      message:
        'Member ID must contain 1–40 letters, numbers, underscores, or hyphens.',
    });
  }

  if (!REQUEST_TYPE_VALUES.has(requestType)) {
    errors.push({
      field: 'requestType',
      message: 'Select EOB, EOR, or both document types.',
    });
  }

  if (!PRIORITY_VALUES.has(priority)) {
    errors.push({
      field: 'priority',
      message: 'Select Urgent, High, or Normal priority.',
    });
  }

  return errors;
}

function getFieldError(errors, field) {
  return errors.find((error) => error.field === field);
}

/**
 * Controlled reprint-request input form with local required-field validation.
 *
 * @param {{
 *   value?: Record<string, unknown>,
 *   values?: Record<string, unknown>,
 *   claimNumber?: string,
 *   memberId?: string,
 *   requestType?: string,
 *   priority?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   allowed?: boolean,
 *   permissionAllowed?: boolean,
 *   permissionFeedback?: React.ReactNode,
 *   ownershipFeedback?: React.ReactNode,
 *   disabled?: boolean,
 *   loading?: boolean,
 *   submitLabel?: string,
 *   className?: string,
 *   onChange?: Function,
 *   onFieldChange?: Function,
 *   onSubmit: Function,
 *   onSuccess?: Function
 * }} props Component props.
 * @returns {JSX.Element} Reprint request form.
 */
export function RequestForm({
  value,
  values,
  claimNumber,
  memberId,
  requestType,
  priority,
  session = null,
  context = null,
  allowed,
  permissionAllowed,
  permissionFeedback,
  ownershipFeedback,
  disabled = false,
  loading = false,
  submitLabel = 'Create reprint request',
  className = '',
  onChange,
  onFieldChange,
  onSubmit,
  onSuccess,
}) {
  const claimId = useId();
  const memberIdInput = useId();
  const requestTypeId = useId();
  const priorityId = useId();
  const feedbackId = useId();
  const [fieldErrors, setFieldErrors] = useState([]);
  const [operationError, setOperationError] = useState(null);
  const [operationPending, setOperationPending] =
    useState(false);
  const formValues = resolveFormValues({
    value,
    values,
    claimNumber,
    memberId,
    requestType,
    priority,
  });
  const actor = context?.session ?? context?.actor ?? context ?? session;
  const role = normalizeRole(actor?.role);
  const actorMemberId = normalizeIdentifier(
    actor?.memberId,
  );
  const normalizedMemberId = normalizeIdentifier(
    formValues.memberId,
  );
  const ownershipMismatch =
    role === 'MEMBER' &&
    actorMemberId.length > 0 &&
    normalizedMemberId.length > 0 &&
    actorMemberId !== normalizedMemberId;
  const permissionGranted =
    permissionAllowed ?? allowed ?? true;
  const pending = loading || operationPending;
  const unavailable =
    disabled ||
    pending ||
    permissionGranted !== true ||
    ownershipMismatch;
  const claimError = getFieldError(
    fieldErrors,
    'claimNumber',
  );
  const memberError = getFieldError(fieldErrors, 'memberId');
  const requestTypeError = getFieldError(
    fieldErrors,
    'requestType',
  );
  const priorityError = getFieldError(
    fieldErrors,
    'priority',
  );
  const displayedPermissionFeedback =
    permissionFeedback ??
    'Your current demo role cannot create a reprint request.';
  const displayedOwnershipFeedback =
    ownershipFeedback ??
    'Members may request documents only for their own fictional claims.';
  const normalizedRequestType =
    typeof formValues.requestType === 'string'
      ? formValues.requestType.toUpperCase()
      : '';
  const normalizedPriority =
    typeof formValues.priority === 'string'
      ? formValues.priority.toUpperCase()
      : '';

  const requestSummary = useMemo(() => {
    const selectedType = REQUEST_FORM_TYPES.find(
      (option) => option.value === normalizedRequestType,
    );
    const selectedPriority = REQUEST_FORM_PRIORITIES.find(
      (option) => option.value === normalizedPriority,
    );

    return {
      documentType:
        selectedType?.description ?? 'Document type not selected',
      priority:
        selectedPriority?.label ?? 'Priority not selected',
    };
  }, [normalizedPriority, normalizedRequestType]);

  const updateField = (field, nextValue, event) => {
    const nextValues = {
      ...formValues,
      [field]: nextValue,
    };

    setFieldErrors((current) =>
      current.filter((error) => error.field !== field),
    );
    setOperationError(null);

    if (typeof onFieldChange === 'function') {
      onFieldChange(field, nextValue, nextValues, event);
    }

    if (typeof onChange === 'function') {
      onChange(nextValues, {
        field,
        value: nextValue,
        event,
      });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setOperationError(null);

    const validationErrors = validateForm(formValues);

    if (validationErrors.length > 0) {
      setFieldErrors(validationErrors);
      return;
    }

    if (permissionGranted !== true) {
      setOperationError(
        'Your current demo role cannot create a reprint request.',
      );
      return;
    }

    if (ownershipMismatch) {
      setOperationError(
        'The member ID does not match the current demo member.',
      );
      return;
    }

    const command = {
      ...formValues,
      claimNumber: normalizeIdentifier(
        formValues.claimNumber,
      ),
      memberId: normalizeIdentifier(formValues.memberId),
      requestType: normalizedRequestType,
      priority: normalizedPriority,
    };

    setOperationPending(true);
    setFieldErrors([]);

    try {
      const result = await Promise.resolve(
        onSubmit(command, event),
      );

      if (result?.ok === false) {
        setOperationError(normalizeResultError(result));
        setFieldErrors(
          normalizeFieldErrors(result.error?.fieldErrors),
        );
        return;
      }

      if (typeof onSuccess === 'function') {
        await Promise.resolve(onSuccess(result, command));
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The browser-local reprint request could not be created.',
        ),
      );
    } finally {
      setOperationPending(false);
    }
  };

  return (
    <form
      className={`space-y-6 ${className}`.trim()}
      noValidate
      aria-busy={pending}
      onSubmit={handleSubmit}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
          <FileText
            className="h-5 w-5"
            aria-hidden="true"
          />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-content dark:text-content-inverse">
            Request an EOB or EOR
          </h2>
          <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
            Enter an authorized fictional claim and member ID,
            then choose the representative document type and
            priority.
          </p>
        </div>
      </div>

      {permissionGranted !== true ? (
        <div
          className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Request permission unavailable
              </p>
              <div className="mt-1 leading-6">
                {displayedPermissionFeedback}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {ownershipMismatch ? (
        <div
          className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Member ownership does not match
              </p>
              <div className="mt-1 leading-6">
                {displayedOwnershipFeedback}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            className="block text-sm font-medium text-content dark:text-content-inverse"
            htmlFor={claimId}
          >
            Claim ID
            <span
              className="ml-1 text-danger-600 dark:text-danger-100"
              aria-hidden="true"
            >
              *
            </span>
          </label>
          <input
            id={claimId}
            className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
            type="text"
            value={formValues.claimNumber}
            maxLength={40}
            autoComplete="off"
            spellCheck="false"
            required
            disabled={disabled || pending}
            aria-invalid={claimError !== undefined}
            aria-describedby={`${claimId}-hint${
              claimError === undefined
                ? ''
                : ` ${claimId}-error`
            }`}
            onChange={(event) =>
              updateField(
                'claimNumber',
                event.target.value,
                event,
              )
            }
          />
          <p
            id={`${claimId}-hint`}
            className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
          >
            Enter the fictional claim identifier exactly as shown
            in the local fixture.
          </p>
          {claimError !== undefined ? (
            <p
              id={`${claimId}-error`}
              className="mt-2 text-sm text-danger-700 dark:text-danger-100"
            >
              {claimError.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            className="block text-sm font-medium text-content dark:text-content-inverse"
            htmlFor={memberIdInput}
          >
            Member ID
            <span
              className="ml-1 text-danger-600 dark:text-danger-100"
              aria-hidden="true"
            >
              *
            </span>
          </label>
          <input
            id={memberIdInput}
            className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
            type="text"
            value={formValues.memberId}
            maxLength={40}
            autoComplete="off"
            spellCheck="false"
            required
            disabled={disabled || pending}
            aria-invalid={
              memberError !== undefined || ownershipMismatch
            }
            aria-describedby={`${memberIdInput}-hint${
              memberError === undefined
                ? ''
                : ` ${memberIdInput}-error`
            }`}
            onChange={(event) =>
              updateField(
                'memberId',
                event.target.value,
                event,
              )
            }
          />
          <p
            id={`${memberIdInput}-hint`}
            className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
          >
            The member must own the fictional claim when using a
            member persona.
          </p>
          {memberError !== undefined ? (
            <p
              id={`${memberIdInput}-error`}
              className="mt-2 text-sm text-danger-700 dark:text-danger-100"
            >
              {memberError.message}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-content dark:text-content-inverse">
          Document type
          <span
            className="ml-1 text-danger-600 dark:text-danger-100"
            aria-hidden="true"
          >
            *
          </span>
        </legend>
        <p
          id={`${requestTypeId}-hint`}
          className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted"
        >
          Choose one or both representative document types.
        </p>
        <div
          className="mt-3 grid gap-3 sm:grid-cols-3"
          aria-describedby={`${requestTypeId}-hint${
            requestTypeError === undefined
              ? ''
              : ` ${requestTypeId}-error`
          }`}
        >
          {REQUEST_FORM_TYPES.map((option) => {
            const optionId = `${requestTypeId}-${option.value}`;

            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition focus-within:ring-2 focus-within:ring-primary-500 ${
                  normalizedRequestType === option.value
                    ? 'border-primary-500 bg-primary-50 dark:border-primary-600 dark:bg-primary-950'
                    : 'border-border bg-surface hover:bg-surface-muted dark:border-border-dark dark:bg-surface-dark dark:hover:bg-surface-dark-raised'
                } ${
                  disabled || pending
                    ? 'cursor-not-allowed opacity-60'
                    : ''
                }`}
                htmlFor={optionId}
              >
                <input
                  id={optionId}
                  className="mt-0.5 h-4 w-4 border-border-strong text-primary-600 focus:ring-primary-500"
                  type="radio"
                  name={requestTypeId}
                  value={option.value}
                  checked={
                    normalizedRequestType === option.value
                  }
                  required
                  disabled={disabled || pending}
                  onChange={(event) =>
                    updateField(
                      'requestType',
                      event.target.value,
                      event,
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-content dark:text-content-inverse">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {requestTypeError !== undefined ? (
          <p
            id={`${requestTypeId}-error`}
            className="mt-2 text-sm text-danger-700 dark:text-danger-100"
          >
            {requestTypeError.message}
          </p>
        ) : null}
      </fieldset>

      <div>
        <label
          className="block text-sm font-medium text-content dark:text-content-inverse"
          htmlFor={priorityId}
        >
          Priority
          <span
            className="ml-1 text-danger-600 dark:text-danger-100"
            aria-hidden="true"
          >
            *
          </span>
        </label>
        <select
          id={priorityId}
          className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse sm:max-w-sm"
          value={normalizedPriority}
          required
          disabled={disabled || pending}
          aria-invalid={priorityError !== undefined}
          aria-describedby={`${priorityId}-hint${
            priorityError === undefined
              ? ''
              : ` ${priorityId}-error`
          }`}
          onChange={(event) =>
            updateField(
              'priority',
              event.target.value,
              event,
            )
          }
        >
          {REQUEST_FORM_PRIORITIES.map((option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </select>
        <p
          id={`${priorityId}-hint`}
          className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
        >
          Priority controls only the deterministic local queue
          ordering.
        </p>
        {priorityError !== undefined ? (
          <p
            id={`${priorityId}-error`}
            className="mt-2 text-sm text-danger-700 dark:text-danger-100"
          >
            {priorityError.message}
          </p>
        ) : null}
      </div>

      <aside
        className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        aria-label="Reprint request summary"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Browser-local request summary
            </p>
            <p className="mt-1 leading-6">
              {requestSummary.documentType} ·{' '}
              {requestSummary.priority} priority
            </p>
            <p className="mt-1 text-xs leading-5">
              This creates a deterministic local request only. No
              payer, provider, healthcare, document delivery, or
              payment system is contacted.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          id={feedbackId}
          className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>{operationError}</span>
          </div>
        </div>
      ) : null}

      <button
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
        type="submit"
        disabled={unavailable}
        aria-describedby={
          operationError !== null ? feedbackId : undefined
        }
      >
        {pending ? (
          <Loader2
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <FileText
            className="h-4 w-4"
            aria-hidden="true"
          />
        )}
        {pending ? 'Creating locally…' : submitLabel}
      </button>
    </form>
  );
}

RequestForm.propTypes = {
  value: PropTypes.object,
  values: PropTypes.object,
  claimNumber: PropTypes.string,
  memberId: PropTypes.string,
  requestType: PropTypes.string,
  priority: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  allowed: PropTypes.bool,
  permissionAllowed: PropTypes.bool,
  permissionFeedback: PropTypes.node,
  ownershipFeedback: PropTypes.node,
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  submitLabel: PropTypes.string,
  className: PropTypes.string,
  onChange: PropTypes.func,
  onFieldChange: PropTypes.func,
  onSubmit: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};

export const ReprintRequestForm = RequestForm;
export const CreateRequestForm = RequestForm;

export default RequestForm;