import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  useParams,
} from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CircleCheckBig,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EMPTY_COLLECTION = Object.freeze([]);
const REQUEST_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
]);
const REVIEW_ROLES = new Set(['BOS', 'ADMIN']);
const ERROR_REPORT_ROLES = new Set([
  'BOS',
  'ITS',
  'ADMIN',
]);
const DOCUMENT_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
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

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeRequestResult(result) {
  const value = unwrapServiceResult(
    result,
    'The browser-local request result could not be loaded.',
  );

  if (isPlainObject(value?.request)) {
    return value.request;
  }

  return isPlainObject(value) ? value : null;
}

function resolveRequestReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getRequestById === 'function') {
    return service.getRequestById.bind(service);
  }

  if (typeof service.getOwnedRequest === 'function') {
    return service.getOwnedRequest.bind(service);
  }

  if (typeof service.findRequestById === 'function') {
    return service.findRequestById.bind(service);
  }

  if (typeof service.get === 'function') {
    return service.get.bind(service);
  }

  return null;
}

async function readRepositorySnapshot(repository) {
  if (repository === null || repository === undefined) {
    return null;
  }

  if (typeof repository.getSnapshot === 'function') {
    return Promise.resolve(repository.getSnapshot());
  }

  if (typeof repository.getState === 'function') {
    return Promise.resolve(repository.getState());
  }

  if (typeof repository.read === 'function') {
    return Promise.resolve(repository.read());
  }

  if (typeof repository.load === 'function') {
    return Promise.resolve(repository.load());
  }

  return null;
}

function resolveOperationsEnvelope(snapshot) {
  if (!isPlainObject(snapshot)) {
    return null;
  }

  const candidates = [
    snapshot,
    snapshot.envelope,
    snapshot.operationsEnvelope,
    snapshot.persistent,
    snapshot.data,
    snapshot.slices?.operationsEnvelope,
    snapshot.slices?.operations,
    snapshot.operations?.initialEnvelope,
  ];

  return (
    candidates.find(
      (candidate) =>
        isPlainObject(candidate) &&
        isPlainObject(candidate.requests) &&
        isPlainObject(candidate.documents) &&
        isPlainObject(candidate.outboundRecords),
    ) ?? null
  );
}

function findPipelineRun(envelope, requestId) {
  if (!isPlainObject(envelope?.pipelineRuns)) {
    return null;
  }

  return (
    Object.values(envelope.pipelineRuns)
      .filter(
        (run) =>
          isPlainObject(run) &&
          run.requestId === requestId,
      )
      .sort((left, right) => {
        const leftTime = Date.parse(
          left.updatedAt ?? left.startedAt ?? 0,
        );
        const rightTime = Date.parse(
          right.updatedAt ?? right.startedAt ?? 0,
        );

        return rightTime - leftTime;
      })[0] ?? null
  );
}

function findReview(envelope, requestId) {
  if (!isPlainObject(envelope?.reviews)) {
    return null;
  }

  return (
    Object.values(envelope.reviews).find(
      (review) =>
        isPlainObject(review) &&
        review.requestId === requestId,
    ) ?? null
  );
}

function findErrorReport(envelope, request) {
  if (!isPlainObject(envelope?.errorReports)) {
    return null;
  }

  if (
    typeof request?.errorReportId === 'string' &&
    isPlainObject(
      envelope.errorReports[request.errorReportId],
    )
  ) {
    return envelope.errorReports[request.errorReportId];
  }

  return (
    Object.values(envelope.errorReports).find(
      (report) =>
        isPlainObject(report) &&
        report.requestId === request?.requestId,
    ) ?? null
  );
}

function getDocuments(envelope, request) {
  if (!isPlainObject(envelope?.documents)) {
    return [];
  }

  const references = new Set(
    Array.isArray(request?.documentReferences)
      ? request.documentReferences
      : [],
  );

  return Object.values(envelope.documents)
    .filter(isPlainObject)
    .filter(
      (document) =>
        references.has(document.documentId) ||
        document.requestId === request?.requestId,
    )
    .sort((left, right) => {
      if (left.documentType !== right.documentType) {
        return String(left.documentType).localeCompare(
          String(right.documentType),
          'en-US',
        );
      }

      return (right.version ?? 0) - (left.version ?? 0);
    });
}

function getOutboundRecords(envelope, documentIds) {
  if (!isPlainObject(envelope?.outboundRecords)) {
    return [];
  }

  const identifiers = new Set(documentIds);

  return Object.values(envelope.outboundRecords)
    .filter(isPlainObject)
    .filter((record) =>
      identifiers.has(record.documentId),
    )
    .sort((left, right) => {
      const timeDifference =
        Date.parse(left.createdAt ?? 0) -
        Date.parse(right.createdAt ?? 0);

      return timeDifference !== 0
        ? timeDifference
        : String(left.outboundId).localeCompare(
            String(right.outboundId),
            'en-US',
          );
    });
}

function isAuthorizationError(error) {
  return [
    'AUTHENTICATION_REQUIRED',
    'FORBIDDEN',
    'PERMISSION_DENIED',
    'ACTION_FORBIDDEN',
  ].includes(error?.code);
}

function getRequestDuration(request) {
  if (
    typeof request?.processingTimeMs === 'number' &&
    Number.isFinite(request.processingTimeMs) &&
    request.processingTimeMs >= 0
  ) {
    return formatDuration(request.processingTimeMs);
  }

  if (
    typeof request?.startedAt === 'string' &&
    typeof request?.completedAt === 'string'
  ) {
    const duration =
      Date.parse(request.completedAt) -
      Date.parse(request.startedAt);

    if (Number.isFinite(duration) && duration >= 0) {
      return formatDuration(duration);
    }
  }

  return '—';
}

function getDocumentTitle(document) {
  return document.documentType === 'EOR'
    ? 'Explanation of Review'
    : 'Explanation of Benefits';
}

function getDocumentKey(document, index) {
  return document.documentId ?? `result-document-${index}`;
}

function getOutboundKey(record, index) {
  return record.outboundId ?? `result-outbound-${index}`;
}

/**
 * Contextual result route for completed, failed, and manual-review requests.
 *
 * @param {{
 *   requestId?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   requestService?: object,
 *   operationsRepository?: object,
 *   operationsStore?: object,
 *   repository?: object,
 *   initialRequest?: Record<string, unknown>|null,
 *   initialPipelineRun?: Record<string, unknown>|null,
 *   initialDocuments?: readonly Record<string, unknown>[],
 *   initialOutboundRecords?: readonly Record<string, unknown>[],
 *   initialReview?: Record<string, unknown>|null,
 *   initialErrorReport?: Record<string, unknown>|null,
 *   onNavigate?: Function
 * }} props Component props.
 * @returns {JSX.Element} Request result page.
 */
export function RequestResultPage({
  requestId,
  session = null,
  context = null,
  requestService = null,
  operationsRepository = null,
  operationsStore = null,
  repository = null,
  initialRequest = null,
  initialPipelineRun = null,
  initialDocuments = EMPTY_COLLECTION,
  initialOutboundRecords = EMPTY_COLLECTION,
  initialReview = null,
  initialErrorReport = null,
  onNavigate,
}) {
  const routeParams = useParams();
  const headingId = useId();
  const resolvedRequestId =
    requestId ??
    routeParams.requestId ??
    routeParams.id ??
    '';
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const dataRepository =
    operationsRepository ??
    operationsStore ??
    repository;
  const [request, setRequest] = useState(initialRequest);
  const [pipelineRun, setPipelineRun] = useState(
    initialPipelineRun,
  );
  const [documents, setDocuments] = useState(
    initialDocuments,
  );
  const [outboundRecords, setOutboundRecords] = useState(
    initialOutboundRecords,
  );
  const [review, setReview] = useState(initialReview);
  const [errorReport, setErrorReport] = useState(
    initialErrorReport,
  );
  const [loading, setLoading] = useState(
    initialRequest === null,
  );
  const [loadError, setLoadError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [navigationPending, setNavigationPending] =
    useState(null);
  const [operationError, setOperationError] = useState(null);

  const loadResult = async (showLoading = true) => {
    if (!authenticated) {
      setLoading(false);
      return;
    }

    if (
      typeof resolvedRequestId !== 'string' ||
      resolvedRequestId.trim().length === 0
    ) {
      setLoading(false);
      setLoadError(
        'A browser-local request identifier is required.',
      );
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    setLoadError(null);
    setOperationError(null);
    setAccessDenied(false);

    try {
      const identifier =
        resolvedRequestId.normalize('NFC').trim();
      const reader = resolveRequestReader(requestService);
      const snapshot = await readRepositorySnapshot(
        dataRepository,
      );
      const envelope = resolveOperationsEnvelope(snapshot);
      let loadedRequest = initialRequest;

      if (loadedRequest === null && reader !== null) {
        loadedRequest = normalizeRequestResult(
          await Promise.resolve(
            reader(identifier, accessContext),
          ),
        );
      }

      if (
        loadedRequest === null &&
        isPlainObject(envelope?.requests)
      ) {
        loadedRequest = envelope.requests[identifier] ?? null;
      }

      if (loadedRequest === null) {
        setRequest(null);
        setPipelineRun(null);
        setDocuments([]);
        setOutboundRecords([]);
        setReview(null);
        setErrorReport(null);
        setLoadError(
          'The request result is unavailable for the current demo role.',
        );
        return;
      }

      if (
        role === 'MEMBER' &&
        accessContext.memberId !== loadedRequest.memberId
      ) {
        setAccessDenied(true);
        setRequest(null);
        return;
      }

      const loadedDocuments =
        initialDocuments.length > 0
          ? initialDocuments
          : getDocuments(envelope, loadedRequest);
      const documentIds = loadedDocuments
        .map((document) => document.documentId)
        .filter(
          (documentId) =>
            typeof documentId === 'string',
        );

      setRequest(loadedRequest);
      setPipelineRun(
        initialPipelineRun ??
          findPipelineRun(
            envelope,
            loadedRequest.requestId,
          ),
      );
      setDocuments(loadedDocuments);
      setOutboundRecords(
        initialOutboundRecords.length > 0
          ? initialOutboundRecords
          : getOutboundRecords(envelope, documentIds),
      );
      setReview(
        initialReview ??
          findReview(envelope, loadedRequest.requestId),
      );
      setErrorReport(
        initialErrorReport ??
          findErrorReport(envelope, loadedRequest),
      );
    } catch (error) {
      if (isAuthorizationError(error)) {
        setAccessDenied(true);
        setRequest(null);
      } else {
        setLoadError(
          normalizeErrorMessage(
            error,
            'The browser-local request result could not be loaded.',
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!active) {
        return;
      }

      await loadResult(initialRequest === null);
    };

    load().catch((error) => {
      if (active) {
        setLoading(false);
        setLoadError(
          normalizeErrorMessage(
            error,
            'The browser-local request result could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
    // Initial values intentionally participate so composed routes can replace
    // their contextual result without retaining evidence from another request.
  }, [
    accessContext,
    authenticated,
    dataRepository,
    initialDocuments,
    initialErrorReport,
    initialOutboundRecords,
    initialPipelineRun,
    initialRequest,
    initialReview,
    requestService,
    resolvedRequestId,
    role,
  ]);

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

  if (
    role === null ||
    !REQUEST_ROLES.has(role) ||
    accessDenied
  ) {
    return <AccessDenied authenticated />;
  }

  if (loading) {
    return (
      <main
        className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6"
        aria-busy="true"
      >
        <section
          className="w-full rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          role="status"
        >
          <Loader2
            className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium text-content dark:text-content-inverse">
            Loading request result
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Reading authorized browser-local processing evidence.
          </p>
        </section>
      </main>
    );
  }

  if (loadError !== null || request === null) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
        <section
          className="w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8"
          role="alert"
        >
          <ShieldAlert
            className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
            aria-hidden="true"
          />
          <h1 className="mt-3 text-xl font-semibold text-content dark:text-content-inverse">
            Request result unavailable
          </h1>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            {loadError ??
              'The request may be unavailable, or the current demo role may not have access.'}
          </p>
          <button
            className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            type="button"
            onClick={() => {
              loadResult(true).catch((error) => {
                setLoadError(
                  normalizeErrorMessage(
                    error,
                    'The browser-local request result could not be loaded.',
                  ),
                );
              });
            }}
          >
            <RefreshCw
              className="h-4 w-4"
              aria-hidden="true"
            />
            Try again
          </button>
        </section>
      </main>
    );
  }

  const status =
    request.status ?? pipelineRun?.status ?? 'PENDING';
  const complete = status === 'COMPLETE';
  const failed = status === 'FAILED';
  const manualReview = status === 'MANUAL_REVIEW';
  const documentAccessAllowed =
    DOCUMENT_ROLES.has(role) &&
    (role !== 'MEMBER' ||
      accessContext.memberId === request.memberId);
  const visibleDocuments = documentAccessAllowed
    ? documents.filter(
        (document) =>
          role !== 'MEMBER' ||
          document.memberId === request.memberId,
      )
    : [];
  const ixitRecords = outboundRecords.filter(
    (record) => record.kind === 'IXIT',
  );
  const otherOutboundRecords = outboundRecords.filter(
    (record) => record.kind !== 'IXIT',
  );
  const errorReportId =
    errorReport?.errorReportId ??
    request.errorReportId ??
    null;
  const reviewId = review?.reviewId ?? null;
  const requestHref =
    `/operations/requests/${encodeURIComponent(
      request.requestId,
    )}`;
  const queueHref = '/operations/queue';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-muted dark:hover:text-content-inverse"
        href={requestHref}
        onClick={(event) => {
          handleNavigation(
            event,
            {
              type: 'REPRINT_REQUEST',
              href: requestHref,
              requestId: request.requestId,
            },
            'request',
          ).catch((error) => {
            setOperationError(
              normalizeErrorMessage(
                error,
                'The request processing route could not be opened.',
              ),
            );
          });
        }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to request processing
      </a>

      <header
        className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              {complete ? (
                <CircleCheckBig
                  className="h-6 w-6"
                  aria-hidden="true"
                />
              ) : failed ? (
                <AlertTriangle
                  className="h-6 w-6"
                  aria-hidden="true"
                />
              ) : (
                <CalendarClock
                  className="h-6 w-6"
                  aria-hidden="true"
                />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Browser-local request result
              </p>
              <h1
                id={headingId}
                className="mt-1 break-all font-mono text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                {request.displayId ?? request.requestId}
              </h1>
              <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                Claim{' '}
                <span className="font-mono font-medium">
                  {request.claimNumber ?? 'Restricted'}
                </span>{' '}
                · {formatStatus(request.requestType)}
              </p>
            </div>
          </div>

          <StatusBadge status={status} />
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="No transmission disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              No external transmission occurred
            </p>
            <p className="mt-1 leading-6">
              Request status, document versions, IXIT references,
              reporting rows, email, CRM, and fax evidence are
              deterministic browser-local records. No payer,
              provider, healthcare, payment, delivery, reporting,
              CRM, email, fax, or IXIT system was contacted.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          {operationError}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 lg:col-span-2"
          aria-labelledby="result-summary-heading"
        >
          <h2
            id="result-summary-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Processing outcome
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Authorized request state and retained local evidence.
          </p>

          <div
            className={`mt-5 rounded-xl border p-5 ${
              complete
                ? 'border-success-200 bg-success-50 dark:border-success-700 dark:bg-surface-dark'
                : failed
                  ? 'border-danger-200 bg-danger-50 dark:border-danger-700 dark:bg-danger-950'
                  : manualReview
                    ? 'border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-950'
                    : 'border-border bg-surface-muted dark:border-border-dark dark:bg-surface-dark'
            }`}
          >
            <h3 className="font-semibold text-content dark:text-content-inverse">
              {complete
                ? 'Representative documents stored'
                : failed
                  ? 'Processing stopped with retained evidence'
                  : manualReview
                    ? 'Authorized manual review required'
                    : `${formatStatus(status)} request`}
            </h3>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              {request.result ??
                (complete
                  ? 'The deterministic workflow completed locally.'
                  : failed
                    ? 'The deterministic workflow stopped before completion.'
                    : manualReview
                      ? 'The request is waiting for an authorized operations decision.'
                      : 'The deterministic workflow has not reached a terminal result.')}
            </p>
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Request ID', request.requestId],
              ['Member ID', request.memberId],
              ['Priority', formatStatus(request.priority)],
              ['Current stage', formatStatus(request.currentStep)],
              ['Created', formatDateTime(request.createdAt)],
              ['Completed', formatDateTime(request.completedAt)],
              ['Processing time', getRequestDuration(request)],
              [
                'Completed stages',
                Array.isArray(pipelineRun?.completedSteps)
                  ? String(pipelineRun.completedSteps.length)
                  : '—',
              ],
              [
                'Document versions',
                String(visibleDocuments.length),
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  {label}
                </dt>
                <dd
                  className={`mt-1 break-all text-sm font-medium text-content dark:text-content-inverse ${
                    label.endsWith('ID') ? 'font-mono' : ''
                  }`}
                >
                  {value ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="result-actions-heading"
        >
          <h2
            id="result-actions-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Contextual actions
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Links are shown only for the current demo role.
          </p>

          <div className="mt-5 space-y-3">
            {manualReview && REVIEW_ROLES.has(role) ? (
              <a
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-warning-700 bg-warning-50 px-4 py-3 text-sm font-semibold text-warning-700 transition hover:bg-warning-100 focus:outline-none focus:ring-2 focus:ring-warning-500 dark:bg-warning-950 dark:text-warning-100"
                href="/operations/reviews"
                onClick={(event) => {
                  handleNavigation(
                    event,
                    {
                      type: 'MANUAL_REVIEW',
                      href: '/operations/reviews',
                      reviewId,
                      requestId: request.requestId,
                    },
                    'review',
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The manual review route could not be opened.',
                      ),
                    );
                  });
                }}
              >
                <span>Open manual reviews</span>
                {navigationPending === 'review' ? (
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

            {failed &&
            errorReportId !== null &&
            ERROR_REPORT_ROLES.has(role) ? (
              <a
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-semibold text-danger-700 transition hover:bg-danger-100 focus:outline-none focus:ring-2 focus:ring-danger-500 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
                href={`/operations/errors/${encodeURIComponent(
                  errorReportId,
                )}`}
                onClick={(event) => {
                  const href =
                    `/operations/errors/${encodeURIComponent(
                      errorReportId,
                    )}`;

                  handleNavigation(
                    event,
                    {
                      type: 'ERROR_REPORT',
                      href,
                      errorReportId,
                      requestId: request.requestId,
                    },
                    'error-report',
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The error report could not be opened.',
                      ),
                    );
                  });
                }}
              >
                <span>Open error report</span>
                {navigationPending === 'error-report' ? (
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

            {role !== 'MEMBER' ? (
              <a
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                href={queueHref}
                onClick={(event) => {
                  handleNavigation(
                    event,
                    {
                      type: 'OPERATIONS_QUEUE',
                      href: queueHref,
                    },
                    'queue',
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The operations queue could not be opened.',
                      ),
                    );
                  });
                }}
              >
                <span>Open operations queue</span>
                {navigationPending === 'queue' ? (
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

          <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm dark:border-border-dark">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-content-muted dark:text-content-inverse-muted">
                Review evidence
              </dt>
              <dd className="font-semibold text-content dark:text-content-inverse">
                {review === null
                  ? 'None'
                  : formatStatus(review.status)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-content-muted dark:text-content-inverse-muted">
                Error evidence
              </dt>
              <dd className="font-semibold text-content dark:text-content-inverse">
                {errorReportId === null
                  ? 'None'
                  : 'Available'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-content-muted dark:text-content-inverse-muted">
                Current role
              </dt>
              <dd className="font-mono font-semibold text-primary-700 dark:text-primary-300">
                {role}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {complete ? (
        <section
          className="mt-8"
          aria-labelledby="result-documents-heading"
        >
          <h2
            id="result-documents-heading"
            className="text-xl font-semibold text-content dark:text-content-inverse"
          >
            Representative document versions
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Immutable browser-local metadata linked to static
            representative artifacts.
          </p>

          {visibleDocuments.length === 0 ? (
            <div
              className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              role="status"
            >
              <FileText
                className="mx-auto h-7 w-7 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted">
                No authorized document version links are available
                to the current demo role.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleDocuments.map((document, index) => {
                const documentId = document.documentId ?? '';
                const href = `/documents/${encodeURIComponent(
                  documentId,
                )}`;
                const key = `document-${documentId}`;

                return (
                  <a
                    key={getDocumentKey(document, index)}
                    className="group flex min-h-48 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
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
                            'The representative document could not be opened.',
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
                      {documentId}
                    </p>
                    <p className="mt-3 text-xs text-content-muted dark:text-content-inverse-muted">
                      {formatDate(document.documentDate)} · Version{' '}
                      {document.version ?? '—'}
                    </p>
                    <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                      {navigationPending === key
                        ? 'Opening…'
                        : 'Open representative document'}
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
      ) : null}

      {complete ? (
        <section
          className="mt-8"
          aria-labelledby="ixit-evidence-heading"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
              <Waypoints
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <div>
              <h2
                id="ixit-evidence-heading"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                Local IXIT and outbox evidence
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Metadata projections only. Transmitted is always
                false in this demonstration.
              </p>
            </div>
          </div>

          {outboundRecords.length === 0 ? (
            <div
              className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              role="status"
            >
              <p className="text-sm text-content-muted dark:text-content-inverse-muted">
                No local outbound evidence was created for the
                authorized document versions.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6">
                <h3 className="font-semibold text-content dark:text-content-inverse">
                  Mock IXIT records
                </h3>
                <div className="mt-4 space-y-3">
                  {ixitRecords.length === 0 ? (
                    <p className="text-sm text-content-muted dark:text-content-inverse-muted">
                      No mock IXIT reference is available.
                    </p>
                  ) : (
                    ixitRecords.map((record, index) => (
                      <article
                        key={getOutboundKey(record, index)}
                        className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-semibold text-content dark:text-content-inverse">
                              {record.outboundId ??
                                'Local IXIT record'}
                            </p>
                            <p className="mt-1 break-all text-xs text-content-subtle dark:text-content-inverse-muted">
                              Document {record.documentId ?? '—'}
                            </p>
                          </div>
                          <StatusBadge
                            status={record.status ?? 'COMPLETE'}
                          />
                        </div>
                        <p className="mt-3 text-xs font-semibold text-success-700 dark:text-success-100">
                          Transmitted: No
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6">
                <h3 className="font-semibold text-content dark:text-content-inverse">
                  Other local outbox records
                </h3>
                <div className="mt-4 space-y-3">
                  {otherOutboundRecords.length === 0 ? (
                    <p className="text-sm text-content-muted dark:text-content-inverse-muted">
                      No reporting, reprint, email, CRM, or fax
                      rows are available.
                    </p>
                  ) : (
                    otherOutboundRecords.map((record, index) => (
                      <article
                        key={getOutboundKey(record, index)}
                        className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-content dark:text-content-inverse">
                              {formatStatus(record.kind)}
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                              {record.outboundId ?? 'Local outbox row'}
                            </p>
                          </div>
                          <StatusBadge
                            status={record.status ?? 'UNKNOWN'}
                          />
                        </div>
                        <p className="mt-3 text-xs text-content-muted dark:text-content-inverse-muted">
                          Created {formatDateTime(record.createdAt)}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-success-700 dark:text-success-100">
                          Transmitted: No
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        role="note"
        aria-label="Request result disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-content dark:text-content-inverse">
              Fictional result evidence
            </p>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              This route displays static and browser-local
              demonstration evidence only. It does not represent
              an authoritative healthcare, coverage, benefit,
              payment, appeal, delivery, or transmission result.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

RequestResultPage.propTypes = {
  requestId: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  requestService: PropTypes.object,
  operationsRepository: PropTypes.object,
  operationsStore: PropTypes.object,
  repository: PropTypes.object,
  initialRequest: PropTypes.object,
  initialPipelineRun: PropTypes.object,
  initialDocuments: PropTypes.arrayOf(PropTypes.object),
  initialOutboundRecords: PropTypes.arrayOf(
    PropTypes.object,
  ),
  initialReview: PropTypes.object,
  initialErrorReport: PropTypes.object,
  onNavigate: PropTypes.func,
};

export const ReprintRequestResultPage = RequestResultPage;
export const RequestOutcomePage = RequestResultPage;
export const LocalRequestResultPage = RequestResultPage;

export default RequestResultPage;