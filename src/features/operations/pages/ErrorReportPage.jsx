import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  FileWarning,
  Info,
  Loader2,
  LockKeyhole,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import ConfirmDialog from '../../../platform/components/ConfirmDialog.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { downloadBlob } from '../../../platform/utils/download.js';
import {
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const ERROR_REPORT_ROLES = new Set(['BOS', 'ITS', 'ADMIN']);
const ACTION_ROLES = new Set(['BOS', 'ADMIN']);
const ERROR_REPORT_ACTIONS = Object.freeze({
  EXPORT: 'EXPORT',
  QUEUE: 'QUEUE',
  CLOSE: 'CLOSE',
});
const EMPTY_COLLECTION = Object.freeze([]);

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

  if (result?.error?.retryable === true) {
    error.retryable = true;
  }

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeReportResult(result, fallback) {
  const value = unwrapServiceResult(result, fallback);

  if (isPlainObject(value?.errorReport)) {
    return value.errorReport;
  }

  if (isPlainObject(value?.report)) {
    return value.report;
  }

  return isPlainObject(value) ? value : null;
}

function resolveReadMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getErrorReport === 'function') {
    return service.getErrorReport.bind(service);
  }

  if (typeof service.get === 'function') {
    return service.get.bind(service);
  }

  return null;
}

function resolveActionMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.actOnErrorReport === 'function') {
    return service.actOnErrorReport.bind(service);
  }

  if (typeof service.act === 'function') {
    return service.act.bind(service);
  }

  return null;
}

function isAuthorizationError(error) {
  return [
    'AUTHENTICATION_REQUIRED',
    'FORBIDDEN',
    'PERMISSION_DENIED',
    'ACTION_FORBIDDEN',
  ].includes(error?.code);
}

function getSeverityPresentation(severity) {
  switch (
    typeof severity === 'string'
      ? severity.trim().toUpperCase()
      : ''
  ) {
    case 'ERROR':
      return {
        Icon: XCircle,
        containerClass:
          'border-danger-200 bg-danger-50 dark:border-danger-700 dark:bg-danger-950',
        iconClass:
          'bg-danger-100 text-danger-700 dark:bg-danger-700 dark:text-white',
        textClass:
          'text-danger-700 dark:text-danger-100',
      };
    case 'WARNING':
      return {
        Icon: AlertTriangle,
        containerClass:
          'border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-950',
        iconClass:
          'bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-white',
        textClass:
          'text-warning-700 dark:text-warning-100',
      };
    case 'INFO':
    default:
      return {
        Icon: Info,
        containerClass:
          'border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-950',
        iconClass:
          'bg-primary-100 text-primary-700 dark:bg-primary-700 dark:text-white',
        textClass:
          'text-primary-900 dark:text-primary-100',
      };
  }
}

function formatDetailValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Sanitized detail unavailable';
  }
}

function getEntityLabel(key) {
  return formatStatus(key);
}

function getEntityDestination(key, value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return null;
  }

  const normalizedKey = key
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  const identifier = value.normalize('NFC').trim();

  if (normalizedKey === 'requestid') {
    return {
      type: 'REPRINT_REQUEST',
      href: `/operations/requests/${encodeURIComponent(
        identifier,
      )}`,
      requestId: identifier,
    };
  }

  if (
    normalizedKey === 'claimnumber' ||
    normalizedKey === 'claimid'
  ) {
    return {
      type: 'CLAIM',
      href: `/claims/${encodeURIComponent(identifier)}`,
      claimNumber: identifier,
    };
  }

  if (normalizedKey === 'documentid') {
    return {
      type: 'DOCUMENT',
      href: `/documents/${encodeURIComponent(identifier)}`,
      documentId: identifier,
    };
  }

  if (
    normalizedKey === 'batchid' ||
    normalizedKey === 'batchrowid' ||
    normalizedKey === 'rowid'
  ) {
    return {
      type: 'BATCH',
      href: '/operations/batch',
      batchId:
        normalizedKey === 'batchid' ? identifier : undefined,
      rowId:
        normalizedKey === 'batchid' ? undefined : identifier,
    };
  }

  if (normalizedKey === 'reviewid') {
    return {
      type: 'MANUAL_REVIEW',
      href: '/operations/reviews',
      reviewId: identifier,
    };
  }

  return null;
}

function getAuditKey(entry, index) {
  return (
    entry.auditId ??
    entry.eventId ??
    `${entry.at ?? 'audit'}-${entry.action ?? index}-${index}`
  );
}

/**
 * Role-scoped local error-report view and action route.
 *
 * @param {{
 *   errorReportId?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   errorReportService?: object,
 *   reportService?: object,
 *   initialReport?: Record<string, unknown>|null,
 *   onNavigate?: Function,
 *   onActionCompleted?: Function,
 *   onExported?: Function
 * }} props Component props.
 * @returns {JSX.Element} Error report page.
 */
export function ErrorReportPage({
  errorReportId,
  session = null,
  context = null,
  errorReportService = null,
  reportService = null,
  initialReport = null,
  onNavigate,
  onActionCompleted,
  onExported,
}) {
  const routeParams = useParams();
  const headingId = useId();
  const feedbackId = useId();
  const resolvedErrorReportId =
    errorReportId ??
    routeParams.errorReportId ??
    routeParams.id ??
    '';
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service = errorReportService ?? reportService;
  const canManage =
    role !== null && ACTION_ROLES.has(role);
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(
    initialReport === null,
  );
  const [loadError, setLoadError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [dialogAction, setDialogAction] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        typeof resolvedErrorReportId !== 'string' ||
        resolvedErrorReportId.trim().length === 0
      ) {
        setLoading(false);
        setLoadError(
          'A browser-local error report identifier is required.',
        );
        return;
      }

      if (
        !authenticated ||
        role === null ||
        !ERROR_REPORT_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (initialReport !== null) {
        setReport(initialReport);
        setLoading(false);
        setLoadError(null);
        return;
      }

      const readReport = resolveReadMethod(service);

      if (readReport === null) {
        setLoading(false);
        setLoadError(
          'Error report viewing is unavailable in this application composition.',
        );
        return;
      }

      setLoading(true);
      setLoadError(null);
      setAccessDenied(false);
      setOperationError(null);

      try {
        const identifier =
          resolvedErrorReportId.normalize('NFC').trim();
        const loadedReport = normalizeReportResult(
          await Promise.resolve(
            readReport(
              { errorReportId: identifier },
              accessContext,
            ),
          ),
          'The browser-local error report could not be loaded.',
        );

        if (!active) {
          return;
        }

        if (loadedReport === null) {
          setReport(null);
          setLoadError(
            'The error report is unavailable for the current demo role.',
          );
          return;
        }

        setReport(loadedReport);
      } catch (error) {
        if (!active) {
          return;
        }

        if (isAuthorizationError(error)) {
          setAccessDenied(true);
          setReport(null);
        } else {
          setReport(null);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The browser-local error report could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load().catch((error) => {
      if (active) {
        setLoading(false);
        setLoadError(
          normalizeErrorMessage(
            error,
            'The browser-local error report could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    authenticated,
    initialReport,
    resolvedErrorReportId,
    role,
    service,
  ]);

  const runAction = async (action) => {
    if (report === null) {
      throw new Error(
        'The browser-local error report is unavailable.',
      );
    }

    if (
      action !== ERROR_REPORT_ACTIONS.EXPORT &&
      !canManage
    ) {
      throw new Error(
        'The current demo role cannot change error report status.',
      );
    }

    const act = resolveActionMethod(service);

    if (act === null) {
      throw new Error(
        'Error report actions are unavailable in this application composition.',
      );
    }

    setPendingAction(action);
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        act(
          {
            errorReportId: report.errorReportId,
            action,
            idempotencyKey: generateUuid(),
          },
          accessContext,
        ),
      );
      const data = unwrapServiceResult(
        result,
        'The browser-local error report action could not be completed.',
      );

      if (action === ERROR_REPORT_ACTIONS.EXPORT) {
        if (
          !isPlainObject(data) ||
          typeof data.filename !== 'string' ||
          data.filename.trim().length === 0 ||
          typeof globalThis.Blob !== 'function' ||
          !(data.blob instanceof globalThis.Blob)
        ) {
          throw new Error(
            'The local error report service returned an invalid export descriptor.',
          );
        }

        downloadBlob(data.blob, data.filename, {
          cleanupDelayMs: 0,
        });
        setOperationMessage(
          'The sanitized fictional error report export was created locally.',
        );

        if (typeof onExported === 'function') {
          await Promise.resolve(
            onExported(data, report, result),
          );
        }
      } else {
        const updatedReport = isPlainObject(data?.report)
          ? data.report
          : {
              ...report,
              status:
                data?.status ??
                (action === ERROR_REPORT_ACTIONS.QUEUE
                  ? 'QUEUED'
                  : 'CLOSED'),
            };

        setReport(updatedReport);
        setOperationMessage(
          action === ERROR_REPORT_ACTIONS.QUEUE
            ? 'The fictional error report was added to the browser-local exception queue. No external system was contacted.'
            : 'The fictional error report was closed locally. No external system was contacted.',
        );
      }

      if (typeof onActionCompleted === 'function') {
        await Promise.resolve(
          onActionCompleted(action, data, result),
        );
      }

      return result;
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The browser-local error report action could not be completed.',
      );

      setOperationError(message);
      throw new Error(message);
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

  if (
    role === null ||
    !ERROR_REPORT_ROLES.has(role) ||
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
            Loading sanitized error report
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Reading authorized browser-local failure evidence.
          </p>
        </section>
      </main>
    );
  }

  if (loadError !== null || report === null) {
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
            Error report unavailable
          </h1>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            {loadError ??
              'The error report may be unavailable, or the current demo role may not have access.'}
          </p>
          <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
            No claim, request, trace, related-entity, or audit
            details were displayed.
          </p>
        </section>
      </main>
    );
  }

  const severityPresentation = getSeverityPresentation(
    report.severity,
  );
  const SeverityIcon = severityPresentation.Icon;
  const reportContext = isPlainObject(report.context)
    ? report.context
    : {};
  const resolution = isPlainObject(report.resolution)
    ? report.resolution
    : {};
  const relatedEntities = isPlainObject(
    report.relatedEntities,
  )
    ? report.relatedEntities
    : {};
  const auditTrail = Array.isArray(report.auditTrail)
    ? report.auditTrail
    : EMPTY_COLLECTION;
  const reportOpen = report.status === 'OPEN';
  const reportClosed = report.status === 'CLOSED';
  const queueHref = '/operations/queue';
  const trace =
    typeof report.stackTrace === 'string' &&
    report.stackTrace.trim().length > 0
      ? report.stackTrace.trim()
      : null;
  const recommendation =
    typeof resolution.recommendation === 'string' &&
    resolution.recommendation.trim().length > 0
      ? resolution.recommendation
      : report.claimNumber === 'CL2024BAD'
        ? 'Correct the fictional fixture claim and retry the request.'
        : 'Correct the fictional fixture data and retry the associated operation.';
  const dialogIsQueue =
    dialogAction === ERROR_REPORT_ACTIONS.QUEUE;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-muted dark:hover:text-content-inverse"
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
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to operations queue
        {navigationPending === 'queue' ? (
          <Loader2
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : null}
      </a>

      <header
        className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <FileWarning
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Sanitized browser-local evidence
              </p>
              <h1
                id={headingId}
                className="mt-1 break-all font-mono text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                {report.errorReportId}
              </h1>
              <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                Created {formatDateTime(report.createdAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StatusBadge
              status={report.severity ?? 'INFO'}
            />
            <StatusBadge
              status={report.status ?? 'OPEN'}
            />
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Error report privacy disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional local error evidence
            </p>
            <p className="mt-1 leading-6">
              This report contains deterministic, sanitized
              demonstration details. Export, queue, and close
              actions update browser-local state only. No payer,
              provider, healthcare, payment, monitoring, reporting,
              exception-management, or external system is
              contacted.
            </p>
            {role === 'ITS' ? (
              <p className="mt-1 leading-6">
                ITS access is read-only except for creating a
                sanitized local export.
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          id={feedbackId}
          className="mt-5 flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{operationError}</span>
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
        className={`mt-6 rounded-xl border p-5 shadow-card sm:p-6 ${severityPresentation.containerClass}`}
        aria-labelledby="error-summary-heading"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${severityPresentation.iconClass}`}
          >
            <SeverityIcon
              className="h-5 w-5"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${severityPresentation.textClass}`}
            >
              {formatStatus(report.severity ?? 'INFO')} severity
            </p>
            <h2
              id="error-summary-heading"
              className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
            >
              {report.summary ?? 'Local processing exception'}
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              {report.details ??
                'No additional sanitized details are available.'}
            </p>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 lg:col-span-2"
          aria-labelledby="error-context-heading"
        >
          <div className="flex items-start gap-3">
            <ClipboardList
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="error-context-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Failure context
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Sanitized stage, rule, and correlation metadata.
              </p>
            </div>
          </div>

          {Object.keys(reportContext).length === 0 ? (
            <p
              className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
              role="status"
            >
              No additional sanitized context is available.
            </p>
          ) : (
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {Object.entries(reportContext).map(
                ([key, value]) => (
                  <div
                    key={key}
                    className="min-w-0 rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
                  >
                    <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                      {getEntityLabel(key)}
                    </dt>
                    <dd className="mt-2 whitespace-pre-wrap break-words font-mono text-sm text-content dark:text-content-inverse">
                      {formatDetailValue(value)}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          )}
        </section>

        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="error-actions-heading"
          aria-busy={pendingAction !== null}
        >
          <h2
            id="error-actions-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Local actions
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Actions never transmit this report.
          </p>

          <div className="mt-5 space-y-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => {
                runAction(
                  ERROR_REPORT_ACTIONS.EXPORT,
                ).catch(() => {});
              }}
            >
              {pendingAction ===
              ERROR_REPORT_ACTIONS.EXPORT ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Download
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {pendingAction === ERROR_REPORT_ACTIONS.EXPORT
                ? 'Creating export…'
                : 'Export sanitized JSON'}
            </button>

            {canManage ? (
              <>
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-warning-700 bg-warning-50 px-4 py-2 text-sm font-semibold text-warning-700 transition hover:bg-warning-100 focus:outline-none focus:ring-2 focus:ring-warning-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-warning-950 dark:text-warning-100"
                  type="button"
                  disabled={
                    pendingAction !== null || !reportOpen
                  }
                  onClick={() =>
                    setDialogAction(
                      ERROR_REPORT_ACTIONS.QUEUE,
                    )
                  }
                >
                  <Send
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  {reportOpen
                    ? 'Queue locally'
                    : 'Queue unavailable'}
                </button>

                <button
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                  type="button"
                  disabled={
                    pendingAction !== null || reportClosed
                  }
                  onClick={() =>
                    setDialogAction(
                      ERROR_REPORT_ACTIONS.CLOSE,
                    )
                  }
                >
                  <LockKeyhole
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  {reportClosed
                    ? 'Already closed'
                    : 'Close report locally'}
                </button>
              </>
            ) : null}
          </div>

          <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm dark:border-border-dark">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-content-muted dark:text-content-inverse-muted">
                Current status
              </dt>
              <dd>
                <StatusBadge
                  status={report.status ?? 'OPEN'}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-content-muted dark:text-content-inverse-muted">
                Current role
              </dt>
              <dd className="font-mono font-semibold text-primary-700 dark:text-primary-300">
                {role}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-content-muted dark:text-content-inverse-muted">
                External transmission
              </dt>
              <dd className="font-semibold text-success-700 dark:text-success-100">
                No
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section
        className="mt-6 rounded-xl border border-primary-200 bg-primary-50 p-5 shadow-card dark:border-primary-800 dark:bg-primary-950 sm:p-6"
        aria-labelledby="resolution-heading"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2
              id="resolution-heading"
              className="text-lg font-semibold text-primary-900 dark:text-primary-100"
            >
              Recommended local resolution
            </h2>
            <p className="mt-2 text-sm leading-6 text-primary-900 dark:text-primary-100">
              {recommendation}
            </p>

            {resolution.retryFrom ? (
              <p className="mt-3 text-sm text-primary-900 dark:text-primary-100">
                Suggested retry point:{' '}
                <span className="font-mono font-semibold">
                  {formatStatus(resolution.retryFrom)}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section
        className="mt-8"
        aria-labelledby="related-entities-heading"
      >
        <h2
          id="related-entities-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Related browser-local entities
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Authorized identifiers retained with the sanitized
          report.
        </p>

        {Object.keys(relatedEntities).length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              No related entity references are available.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(relatedEntities).map(
              ([key, value]) => {
                const destination = getEntityDestination(
                  key,
                  value,
                );
                const navigationKey = `entity-${key}`;

                return (
                  <article
                    key={key}
                    className="flex min-h-36 flex-col rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                      {getEntityLabel(key)}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-all font-mono text-sm font-semibold text-content dark:text-content-inverse">
                      {formatDetailValue(value)}
                    </p>

                    {destination !== null ? (
                      <a
                        className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:underline dark:text-primary-300"
                        href={destination.href}
                        onClick={(event) => {
                          handleNavigation(
                            event,
                            destination,
                            navigationKey,
                          ).catch((error) => {
                            setOperationError(
                              normalizeErrorMessage(
                                error,
                                'The related local entity could not be opened.',
                              ),
                            );
                          });
                        }}
                      >
                        Open related evidence
                        {navigationPending === navigationKey ? (
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
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="sanitized-trace-heading"
      >
        <div className="flex items-start gap-3">
          <LockKeyhole
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="sanitized-trace-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Sanitized trace
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Constant fictional trace text only. Runtime errors,
              credentials, member details, and raw browser state
              are not included.
            </p>
          </div>
        </div>

        {trace === null ? (
          <p
            className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            No sanitized trace is available for this report.
          </p>
        ) : (
          <pre className="mt-5 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-muted p-4 font-mono text-xs leading-6 text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse">
            {trace}
          </pre>
        )}
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="error-audit-heading"
      >
        <div className="flex items-start gap-3">
          <ClipboardList
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="error-audit-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Local report audit trail
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Sanitized actions retained with this fictional
              report.
            </p>
          </div>
        </div>

        {auditTrail.length === 0 ? (
          <p
            className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            No report-level audit entries are available.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {auditTrail.map((entry, index) => (
              <li
                key={getAuditKey(entry, index)}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 dark:border-border-dark sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-content dark:text-content-inverse">
                    {formatStatus(
                      entry.action ?? 'Recorded',
                    )}
                  </p>
                  <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                    Actor:{' '}
                    <span className="font-mono">
                      {entry.actor ?? 'system'}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                    {formatDateTime(
                      entry.at ?? entry.occurredAt,
                    )}
                  </p>
                </div>
                <StatusBadge
                  className="self-start sm:self-center"
                  status={entry.status ?? 'COMPLETE'}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Error report disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Not an authoritative error or claim record
            </p>
            <p className="mt-1 text-sm leading-6">
              This error report, its recommendation, related
              entities, trace, and audit trail are deterministic
              fictional fixtures. They do not represent a live
              healthcare, coverage, payment, benefit, appeal,
              delivery, monitoring, or operational decision.
            </p>
            {report.footer ? (
              <p className="mt-2 text-xs font-semibold">
                {report.footer}
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={dialogAction !== null}
        title={
          dialogIsQueue
            ? 'Queue this fictional error report locally?'
            : 'Close this fictional error report locally?'
        }
        description={
          dialogIsQueue
            ? 'This changes only browser-local metadata from Open to Queued and creates no external exception-management task.'
            : 'This changes only browser-local metadata to Closed. It does not resolve a live claim, payment, healthcare, or operational error.'
        }
        confirmLabel={
          dialogIsQueue
            ? 'Queue locally'
            : 'Close report locally'
        }
        cancelLabel="Cancel"
        destructive={!dialogIsQueue}
        loading={pendingAction !== null}
        onConfirm={() =>
          runAction(
            dialogIsQueue
              ? ERROR_REPORT_ACTIONS.QUEUE
              : ERROR_REPORT_ACTIONS.CLOSE,
          )
        }
        onOpenChange={(open) => {
          if (!open) {
            setDialogAction(null);
          }
        }}
      />
    </div>
  );
}

ErrorReportPage.propTypes = {
  errorReportId: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  errorReportService: PropTypes.object,
  reportService: PropTypes.object,
  initialReport: PropTypes.object,
  onNavigate: PropTypes.func,
  onActionCompleted: PropTypes.func,
  onExported: PropTypes.func,
};

export const OperationsErrorReportPage = ErrorReportPage;
export const LocalErrorReportPage = ErrorReportPage;
export const SanitizedErrorReportPage = ErrorReportPage;

export default ErrorReportPage;