import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Loader2,
  Scale,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  INITIAL_MANUAL_REVIEWS,
  INITIAL_REQUESTS,
} from '../../../fixtures/operations.js';
import { CLAIMS } from '../../../fixtures/membersClaims.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatCurrencyFromCents,
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EMPTY_COLLECTION = Object.freeze([]);
const REVIEW_ROLES = new Set(['CSR', 'BOS', 'ADMIN']);
const DECISION_ROLES = new Set(['BOS', 'ADMIN']);
const MAXIMUM_REASON_LENGTH = 100;
const MAXIMUM_COMMENT_LENGTH = 500;

const REVIEW_DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
});

const ADJUSTMENT_FIELDS = Object.freeze([
  Object.freeze({
    value: 'patientResponsibilityCents',
    label: 'Patient responsibility',
  }),
  Object.freeze({
    value: 'memberResponsibilityCents',
    label: 'Member responsibility',
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

function normalizeReasonCode(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFC')
        .trim()
        .replace(/\s+/g, '_')
        .toUpperCase()
    : '';
}

function normalizeComment(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

function resolveDecisionMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.decideReview === 'function') {
    return service.decideReview.bind(service);
  }

  if (typeof service.decide === 'function') {
    return service.decide.bind(service);
  }

  return null;
}

function resolveAdjustmentMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.adjustClaim === 'function') {
    return service.adjustClaim.bind(service);
  }

  if (typeof service.adjust === 'function') {
    return service.adjust.bind(service);
  }

  return null;
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

function getRequestForReview(review, requests) {
  return (
    requests.find(
      (request) => request.requestId === review.requestId,
    ) ?? null
  );
}

function getClaimForRequest(request, claims) {
  if (request === null) {
    return null;
  }

  return (
    claims.find(
      (claim) =>
        claim.claimNumber === request.claimNumber,
    ) ?? null
  );
}

function getResponsibilityCents(claim) {
  if (
    Number.isSafeInteger(
      claim?.patientResponsibilityCents,
    ) &&
    claim.patientResponsibilityCents >= 0
  ) {
    return claim.patientResponsibilityCents;
  }

  if (
    Number.isSafeInteger(
      claim?.memberResponsibilityCents,
    ) &&
    claim.memberResponsibilityCents >= 0
  ) {
    return claim.memberResponsibilityCents;
  }

  if (
    typeof claim?.memberResponsibilityAmount === 'number' &&
    Number.isFinite(claim.memberResponsibilityAmount) &&
    claim.memberResponsibilityAmount >= 0
  ) {
    return Math.round(
      claim.memberResponsibilityAmount * 100,
    );
  }

  return null;
}

function getReviewKey(review, index) {
  return review.reviewId ?? `manual-review-${index}`;
}

function getRequestStatus(result, fallback) {
  return (
    result?.requestStatus ??
    result?.pipelineResult?.status ??
    result?.status ??
    fallback
  );
}

/**
 * Manual-review details, decision controls, and reason-coded claim adjustment
 * route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   reviewService?: object,
 *   initialReviews?: readonly Record<string, unknown>[],
 *   initialRequests?: readonly Record<string, unknown>[],
 *   initialClaims?: readonly Record<string, unknown>[],
 *   onNavigate?: Function,
 *   onDecided?: Function,
 *   onAdjusted?: Function
 * }} props Component props.
 * @returns {JSX.Element} Manual review page.
 */
export function ReviewPage({
  session = null,
  context = null,
  reviewService = null,
  initialReviews = INITIAL_MANUAL_REVIEWS,
  initialRequests = INITIAL_REQUESTS,
  initialClaims = CLAIMS,
  onNavigate,
  onDecided,
  onAdjusted,
}) {
  const headingId = useId();
  const decisionReasonId = useId();
  const decisionCommentId = useId();
  const adjustmentFieldId = useId();
  const adjustmentAmountId = useId();
  const adjustmentReasonId = useId();
  const adjustmentCommentId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const canDecide =
    role !== null && DECISION_ROLES.has(role);
  const [reviews, setReviews] = useState(initialReviews);
  const [requests, setRequests] = useState(initialRequests);
  const [selectedReviewId, setSelectedReviewId] =
    useState(null);
  const [decision, setDecision] = useState(
    REVIEW_DECISIONS.APPROVE,
  );
  const [decisionReason, setDecisionReason] = useState(
    'VERIFIED_HIGH_RESPONSIBILITY',
  );
  const [decisionComment, setDecisionComment] =
    useState('');
  const [adjustmentField, setAdjustmentField] = useState(
    ADJUSTMENT_FIELDS[0].value,
  );
  const [adjustmentAmount, setAdjustmentAmount] =
    useState('');
  const [adjustmentReason, setAdjustmentReason] = useState(
    'COORDINATION_OF_BENEFITS',
  );
  const [adjustmentComment, setAdjustmentComment] =
    useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [fieldErrors, setFieldErrors] = useState([]);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);

  const reviewRows = useMemo(
    () =>
      reviews
        .map((review) => {
          const request = getRequestForReview(
            review,
            requests,
          );
          const claim = getClaimForRequest(
            request,
            initialClaims,
          );

          return {
            review,
            request,
            claim,
            responsibilityCents:
              getResponsibilityCents(claim),
          };
        })
        .sort((left, right) => {
          const leftTime = Date.parse(
            left.request?.createdAt ?? 0,
          );
          const rightTime = Date.parse(
            right.request?.createdAt ?? 0,
          );

          return rightTime - leftTime;
        }),
    [initialClaims, requests, reviews],
  );

  const selectedRow =
    reviewRows.find(
      (row) =>
        row.review.reviewId === selectedReviewId,
    ) ?? null;

  const clearFeedback = () => {
    setOperationError(null);
    setOperationMessage(null);
    setFieldErrors([]);
  };

  const openDecision = (row, nextDecision) => {
    setSelectedReviewId(row.review.reviewId);
    setDecision(nextDecision);
    setDecisionReason(
      nextDecision === REVIEW_DECISIONS.APPROVE
        ? 'VERIFIED_HIGH_RESPONSIBILITY'
        : 'REVIEW_REJECTED',
    );
    setDecisionComment('');
    clearFeedback();
  };

  const openAdjustment = (row) => {
    const currentCents = row.responsibilityCents;

    setSelectedReviewId(row.review.reviewId);
    setAdjustmentField(
      ADJUSTMENT_FIELDS[0].value,
    );
    setAdjustmentAmount(
      currentCents === null
        ? ''
        : (currentCents / 100).toFixed(2),
    );
    setAdjustmentReason(
      'COORDINATION_OF_BENEFITS',
    );
    setAdjustmentComment('');
    clearFeedback();
  };

  const handleDecision = async (event) => {
    event.preventDefault();

    if (!canDecide || selectedRow === null) {
      return;
    }

    const reasonCode = normalizeReasonCode(
      decisionReason,
    );
    const comment = normalizeComment(decisionComment);
    const errors = [];

    if (
      reasonCode.length === 0 ||
      reasonCode.length > MAXIMUM_REASON_LENGTH
    ) {
      errors.push({
        field: 'reasonCode',
        message:
          'Reason code is required and must not exceed 100 characters.',
      });
    }

    if (comment.length > MAXIMUM_COMMENT_LENGTH) {
      errors.push({
        field: 'comment',
        message:
          'Comment must not exceed 500 characters.',
      });
    }

    if (errors.length > 0) {
      setFieldErrors(errors);
      setOperationError(
        'Review decision validation failed.',
      );
      return;
    }

    const decideReview = resolveDecisionMethod(
      reviewService,
    );

    if (decideReview === null) {
      setOperationError(
        'Manual review decisions are unavailable in this application composition.',
      );
      return;
    }

    const command = {
      reviewId: selectedRow.review.reviewId,
      decision,
      reasonCode,
      comment,
      idempotencyKey: generateUuid(),
    };

    setPendingAction('DECISION');
    clearFeedback();

    try {
      const serviceResult = await Promise.resolve(
        decideReview(command, accessContext),
      );
      const data = unwrapServiceResult(
        serviceResult,
        'The manual review decision could not be completed.',
      );
      const nextReviewStatus =
        data?.reviewStatus ??
        (decision === REVIEW_DECISIONS.APPROVE
          ? 'APPROVED'
          : 'REJECTED');
      const nextRequestStatus = getRequestStatus(
        data,
        decision === REVIEW_DECISIONS.APPROVE
          ? 'PROCESSING'
          : 'FAILED',
      );

      setReviews((current) =>
        current.map((review) =>
          review.reviewId ===
          selectedRow.review.reviewId
            ? {
                ...review,
                status: nextReviewStatus,
                decisionBy:
                  data?.decidedBy ??
                  accessContext.actorId ??
                  'system',
                decidedAt:
                  data?.decidedAt ??
                  new Date().toISOString(),
              }
            : review,
        ),
      );
      setRequests((current) =>
        current.map((request) =>
          request.requestId ===
          selectedRow.review.requestId
            ? {
                ...request,
                status: nextRequestStatus,
                errorReportId:
                  data?.errorReportId ??
                  request.errorReportId,
              }
            : request,
        ),
      );
      setOperationMessage(
        decision === REVIEW_DECISIONS.APPROVE
          ? 'The fictional review was approved locally and the deterministic workflow was resumed.'
          : 'The fictional review was rejected locally and failure evidence was retained.',
      );
      setSelectedReviewId(null);

      if (typeof onDecided === 'function') {
        await Promise.resolve(
          onDecided(
            data,
            serviceResult,
            command,
          ),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The manual review decision could not be completed.',
        ),
      );
      setFieldErrors(getFieldErrors(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleAdjustment = async (event) => {
    event.preventDefault();

    if (
      !canDecide ||
      selectedRow === null ||
      selectedRow.request === null
    ) {
      return;
    }

    const amount = Number(adjustmentAmount);
    const newValue =
      Number.isFinite(amount) && amount >= 0
        ? Math.round(amount * 100)
        : null;
    const reasonCode = normalizeReasonCode(
      adjustmentReason,
    );
    const comment = normalizeComment(
      adjustmentComment,
    );
    const errors = [];

    if (newValue === null) {
      errors.push({
        field: 'newValue',
        message:
          'Adjustment amount must be a non-negative monetary value.',
      });
    }

    if (
      reasonCode.length === 0 ||
      reasonCode.length > MAXIMUM_REASON_LENGTH
    ) {
      errors.push({
        field: 'reasonCode',
        message:
          'Reason code is required and must not exceed 100 characters.',
      });
    }

    if (comment.length > MAXIMUM_COMMENT_LENGTH) {
      errors.push({
        field: 'comment',
        message:
          'Comment must not exceed 500 characters.',
      });
    }

    if (errors.length > 0) {
      setFieldErrors(errors);
      setOperationError(
        'Claim adjustment validation failed.',
      );
      return;
    }

    const adjustClaim = resolveAdjustmentMethod(
      reviewService,
    );

    if (adjustClaim === null) {
      setOperationError(
        'Claim adjustment is unavailable in this application composition.',
      );
      return;
    }

    const command = {
      claimNumber: selectedRow.request.claimNumber,
      field: adjustmentField,
      newValue,
      reasonCode,
      comment,
      idempotencyKey: generateUuid(),
    };

    setPendingAction('ADJUSTMENT');
    clearFeedback();

    try {
      const serviceResult = await Promise.resolve(
        adjustClaim(command, accessContext),
      );
      const data = unwrapServiceResult(
        serviceResult,
        'The fictional claim adjustment could not be completed.',
      );

      setOperationMessage(
        `The fictional responsibility value was adjusted locally from ${formatCurrencyFromCents(
          data?.beforeValue ??
            selectedRow.responsibilityCents,
        )} to ${formatCurrencyFromCents(
          data?.newValue ?? newValue,
        )}.`,
      );
      setSelectedReviewId(null);

      if (typeof onAdjusted === 'function') {
        await Promise.resolve(
          onAdjusted(
            data,
            serviceResult,
            command,
          ),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The fictional claim adjustment could not be completed.',
        ),
      );
      setFieldErrors(getFieldErrors(error));
    } finally {
      setPendingAction(null);
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

  if (role === null || !REVIEW_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  const reasonError = fieldErrors.find(
    (error) => error.field === 'reasonCode',
  );
  const commentError = fieldErrors.find(
    (error) => error.field === 'comment',
  );
  const amountError = fieldErrors.find(
    (error) => error.field === 'newValue',
  );
  const pending = pendingAction !== null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="flex items-start gap-4 px-5 py-6 sm:px-7 sm:py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <Scale
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Browser-local operations review
            </p>
            <h1
              id={headingId}
              className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              Manual reviews
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Review deterministic threshold evidence, record an
              authorized decision, or apply a reason-coded
              fictional responsibility adjustment.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Manual review disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional review evidence only
            </p>
            <p className="mt-1 leading-6">
              Decisions and financial adjustments update
              browser-local demonstration data only. No payer,
              provider, healthcare, payment, appeal, or external
              review system is contacted.
            </p>
            {role === 'CSR' ? (
              <p className="mt-1 leading-6">
                CSR access is read-only. Decision and adjustment
                controls are not available for this demo role.
              </p>
            ) : null}
          </div>
        </div>
      </aside>

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
                <ul className="mt-1 list-disc space-y-1 pl-5">
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

      <section
        className="mt-8"
        aria-labelledby="manual-review-list-heading"
        aria-busy={pending}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="manual-review-list-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Review evidence
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              {reviews.length}{' '}
              {reviews.length === 1 ? 'review' : 'reviews'} in
              browser-local state.
            </p>
          </div>
          <p className="font-mono text-xs font-semibold text-primary-700 dark:text-primary-300">
            Current role: {role}
          </p>
        </div>

        {reviewRows.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <Scale
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No manual reviews available
            </h3>
            <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
              No authorized browser-local review evidence is
              currently available.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {reviewRows.map((row, index) => {
              const { review, request, claim } = row;
              const requestHref =
                request === null
                  ? '/operations/queue'
                  : `/operations/requests/${encodeURIComponent(
                      request.requestId,
                    )}`;
              const navigationKey = `request-${
                request?.requestId ?? index
              }`;
              const open = review.status === 'OPEN';

              return (
                <article
                  key={getReviewKey(review, index)}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Manual review
                      </p>
                      <h3 className="mt-1 break-all font-mono text-base font-semibold text-content dark:text-content-inverse">
                        {review.reviewId}
                      </h3>
                      <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                        {formatStatus(review.triggerCode)}
                      </p>
                    </div>
                    <StatusBadge
                      status={review.status ?? 'OPEN'}
                    />
                  </div>

                  <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Request
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                        {request?.displayId ??
                          request?.requestId ??
                          'Unavailable'}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Claim
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                        {request?.claimNumber ?? 'Unavailable'}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Review threshold
                      </dt>
                      <dd className="mt-1 text-sm font-semibold tabular-nums text-content dark:text-content-inverse">
                        {formatCurrencyFromCents(
                          review.thresholdCents,
                        )}
                      </dd>
                      <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                        Demo default
                      </p>
                    </div>
                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Responsibility
                      </dt>
                      <dd className="mt-1 text-sm font-semibold tabular-nums text-content dark:text-content-inverse">
                        {formatCurrencyFromCents(
                          row.responsibilityCents,
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-border p-4 dark:border-border-dark">
                      <p className="text-sm font-semibold text-content dark:text-content-inverse">
                        Request state
                      </p>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-content-muted dark:text-content-inverse-muted">
                            Status
                          </dt>
                          <dd>
                            <StatusBadge
                              status={
                                request?.status ?? 'UNKNOWN'
                              }
                            />
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-content-muted dark:text-content-inverse-muted">
                            Current stage
                          </dt>
                          <dd className="font-medium text-content dark:text-content-inverse">
                            {formatStatus(
                              request?.currentStep,
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-content-muted dark:text-content-inverse-muted">
                            Created
                          </dt>
                          <dd className="text-right font-medium text-content dark:text-content-inverse">
                            {formatDateTime(
                              request?.createdAt,
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="rounded-lg border border-border p-4 dark:border-border-dark">
                      <p className="text-sm font-semibold text-content dark:text-content-inverse">
                        Claim context
                      </p>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-content-muted dark:text-content-inverse-muted">
                            Claim status
                          </dt>
                          <dd className="font-medium text-content dark:text-content-inverse">
                            {formatStatus(claim?.status)}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-content-muted dark:text-content-inverse-muted">
                            Request type
                          </dt>
                          <dd className="font-medium text-content dark:text-content-inverse">
                            {formatStatus(
                              request?.requestType,
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-content-muted dark:text-content-inverse-muted">
                            Decision
                          </dt>
                          <dd className="font-medium text-content dark:text-content-inverse">
                            {review.decisionBy
                              ? `${review.decisionBy} · ${formatDateTime(
                                  review.decidedAt,
                                )}`
                              : 'Not decided'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5 dark:border-border-dark sm:flex-row sm:flex-wrap">
                    <a
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                      href={requestHref}
                      onClick={(event) => {
                        handleNavigation(
                          event,
                          {
                            type: 'REPRINT_REQUEST',
                            href: requestHref,
                            requestId: request?.requestId,
                            request,
                            review,
                          },
                          navigationKey,
                        ).catch((error) => {
                          setOperationError(
                            normalizeErrorMessage(
                              error,
                              'The review request could not be opened.',
                            ),
                          );
                        });
                      }}
                    >
                      <FileText
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                      Open request evidence
                      {navigationPending === navigationKey ? (
                        <Loader2
                          className="h-4 w-4 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowRight
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      )}
                    </a>

                    {canDecide && open ? (
                      <>
                        <button
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-success-600 bg-success-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-success-500 disabled:opacity-60"
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            openDecision(
                              row,
                              REVIEW_DECISIONS.APPROVE,
                            )
                          }
                        >
                          <CheckCircle2
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Approve review
                        </button>
                        <button
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-danger-600 bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 focus:outline-none focus:ring-2 focus:ring-danger-500 disabled:opacity-60"
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            openDecision(
                              row,
                              REVIEW_DECISIONS.REJECT,
                            )
                          }
                        >
                          <XCircle
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Reject review
                        </button>
                        <button
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                          type="button"
                          disabled={
                            pending ||
                            request === null ||
                            claim === null
                          }
                          onClick={() =>
                            openAdjustment(row)
                          }
                        >
                          <CircleDollarSign
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Adjust responsibility
                        </button>
                      </>
                    ) : null}
                  </div>

                  {selectedReviewId === review.reviewId &&
                  canDecide ? (
                    <div className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-950 sm:p-5">
                      {decision ===
                        REVIEW_DECISIONS.APPROVE ||
                      decision ===
                        REVIEW_DECISIONS.REJECT ? (
                        <form
                          className="space-y-5"
                          onSubmit={handleDecision}
                        >
                          <div>
                            <h4 className="font-semibold text-content dark:text-content-inverse">
                              {decision ===
                              REVIEW_DECISIONS.APPROVE
                                ? 'Approve manual review'
                                : 'Reject manual review'}
                            </h4>
                            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                              A reason code is required. Rejection
                              creates local failure evidence;
                              approval resumes deterministic
                              processing.
                            </p>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <label
                              className="block text-sm font-medium text-content dark:text-content-inverse"
                              htmlFor={decisionReasonId}
                            >
                              Reason code
                              <input
                                id={decisionReasonId}
                                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                                type="text"
                                value={decisionReason}
                                maxLength={
                                  MAXIMUM_REASON_LENGTH
                                }
                                disabled={pending}
                                aria-invalid={
                                  reasonError !== undefined
                                }
                                onChange={(event) => {
                                  setDecisionReason(
                                    event.target.value,
                                  );
                                  setFieldErrors([]);
                                  setOperationError(null);
                                }}
                              />
                            </label>

                            <label
                              className="block text-sm font-medium text-content dark:text-content-inverse"
                              htmlFor={decisionCommentId}
                            >
                              Comment
                              <textarea
                                id={decisionCommentId}
                                className="mt-2 block min-h-24 w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                                value={decisionComment}
                                maxLength={
                                  MAXIMUM_COMMENT_LENGTH
                                }
                                disabled={pending}
                                aria-invalid={
                                  commentError !== undefined
                                }
                                onChange={(event) => {
                                  setDecisionComment(
                                    event.target.value,
                                  );
                                  setFieldErrors([]);
                                  setOperationError(null);
                                }}
                              />
                            </label>
                          </div>

                          <div className="flex flex-col-reverse gap-2 sm:flex-row">
                            <button
                              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setSelectedReviewId(null);
                                clearFeedback();
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 disabled:opacity-60 ${
                                decision ===
                                REVIEW_DECISIONS.APPROVE
                                  ? 'border-success-600 bg-success-600 focus:ring-success-500'
                                  : 'border-danger-600 bg-danger-600 focus:ring-danger-500'
                              }`}
                              type="submit"
                              disabled={pending}
                            >
                              {pendingAction ===
                              'DECISION' ? (
                                <Loader2
                                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              ) : decision ===
                                REVIEW_DECISIONS.APPROVE ? (
                                <CheckCircle2
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              ) : (
                                <XCircle
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              )}
                              {pendingAction ===
                              'DECISION'
                                ? 'Recording locally…'
                                : decision ===
                                    REVIEW_DECISIONS.APPROVE
                                  ? 'Approve and resume'
                                  : 'Reject review'}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedReviewId === review.reviewId &&
                  canDecide &&
                  decision !== REVIEW_DECISIONS.APPROVE &&
                  decision !== REVIEW_DECISIONS.REJECT ? null : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedRow !== null &&
      canDecide &&
      adjustmentAmount !== '' &&
      pendingAction !== 'DECISION' ? (
        <section
          className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="claim-adjustment-heading"
          aria-busy={pendingAction === 'ADJUSTMENT'}
        >
          <div className="flex items-start gap-3">
            <CircleDollarSign
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="claim-adjustment-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Reason-coded financial adjustment
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Claim{' '}
                <span className="font-mono font-semibold">
                  {selectedRow.request?.claimNumber}
                </span>
                . Values are entered in dollars and retained as
                integer cents.
              </p>
            </div>
          </div>

          <form
            className="mt-6 space-y-5"
            onSubmit={handleAdjustment}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={adjustmentFieldId}
              >
                Adjustment field
                <select
                  id={adjustmentFieldId}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  value={adjustmentField}
                  disabled={pending}
                  onChange={(event) => {
                    setAdjustmentField(event.target.value);
                    clearFeedback();
                  }}
                >
                  {ADJUSTMENT_FIELDS.map((field) => (
                    <option
                      key={field.value}
                      value={field.value}
                    >
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={adjustmentAmountId}
              >
                New amount
                <div className="relative mt-2">
                  <span
                    className="pointer-events-none absolute left-3 top-2.5 text-sm text-content-subtle dark:text-content-inverse-muted"
                    aria-hidden="true"
                  >
                    $
                  </span>
                  <input
                    id={adjustmentAmountId}
                    className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-7 pr-3 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={adjustmentAmount}
                    disabled={pending}
                    aria-invalid={amountError !== undefined}
                    onChange={(event) => {
                      setAdjustmentAmount(
                        event.target.value,
                      );
                      setFieldErrors([]);
                      setOperationError(null);
                    }}
                  />
                </div>
              </label>

              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={adjustmentReasonId}
              >
                Reason code
                <input
                  id={adjustmentReasonId}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="text"
                  value={adjustmentReason}
                  maxLength={MAXIMUM_REASON_LENGTH}
                  disabled={pending}
                  aria-invalid={reasonError !== undefined}
                  onChange={(event) => {
                    setAdjustmentReason(event.target.value);
                    setFieldErrors([]);
                    setOperationError(null);
                  }}
                />
              </label>

              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={adjustmentCommentId}
              >
                Comment
                <textarea
                  id={adjustmentCommentId}
                  className="mt-2 block min-h-24 w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  value={adjustmentComment}
                  maxLength={MAXIMUM_COMMENT_LENGTH}
                  disabled={pending}
                  aria-invalid={commentError !== undefined}
                  onChange={(event) => {
                    setAdjustmentComment(event.target.value);
                    setFieldErrors([]);
                    setOperationError(null);
                  }}
                />
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="button"
                disabled={pending}
                onClick={() => {
                  setSelectedReviewId(null);
                  setAdjustmentAmount('');
                  clearFeedback();
                }}
              >
                Cancel
              </button>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                type="submit"
                disabled={pending}
              >
                {pendingAction === 'ADJUSTMENT' ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDollarSign
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
                {pendingAction === 'ADJUSTMENT'
                  ? 'Adjusting locally…'
                  : 'Apply local adjustment'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Manual review disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Not an authoritative review decision
            </p>
            <p className="mt-1 text-sm leading-6">
              Review states, thresholds, decisions, adjustments,
              and error evidence are deterministic fictional
              fixtures. They do not represent healthcare,
              coverage, payment, benefit, appeal, or clinical
              decisions.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

ReviewPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  reviewService: PropTypes.object,
  initialReviews: PropTypes.arrayOf(PropTypes.object),
  initialRequests: PropTypes.arrayOf(PropTypes.object),
  initialClaims: PropTypes.arrayOf(PropTypes.object),
  onNavigate: PropTypes.func,
  onDecided: PropTypes.func,
  onAdjusted: PropTypes.func,
};

export const ManualReviewPage = ReviewPage;
export const OperationsReviewPage = ReviewPage;
export const LocalReviewPage = ReviewPage;

export default ReviewPage;