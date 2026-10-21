import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  AlertCircle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileSearch,
  FileText,
  Headphones,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CSR_DASHBOARD_FIXTURE,
} from '../../../fixtures/insights.js';
import {
  INITIAL_AUDIT_EVENTS,
} from '../../../fixtures/seedBundle.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import ConfirmDialog from '../../../platform/components/ConfirmDialog.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDateTime,
  formatNumber,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  SNAPSHOT_CONFIRMATIONS,
} from '../../../platform/services/snapshotFacade.js';

const AUTHORIZED_ROLES = new Set(['CSR', 'ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);

const QUICK_ACTIONS = Object.freeze([
  Object.freeze({
    id: 'search',
    type: 'CLAIM_SEARCH',
    title: 'Find a member claim',
    description:
      'Search authorized fictional members and claims.',
    href: '/claims',
    actionLabel: 'Search claims',
    Icon: FileSearch,
  }),
  Object.freeze({
    id: 'request',
    type: 'REPRINT_REQUEST_NEW',
    title: 'Create a reprint request',
    description:
      'Start a browser-local EOB or EOR request.',
    href: '/operations/requests/new',
    actionLabel: 'Create request',
    Icon: FileText,
  }),
  Object.freeze({
    id: 'assistant',
    type: 'ASSISTANT',
    title: 'Open scripted assistant',
    description:
      'Use deterministic explanations without a model call.',
    href: '/assistant',
    actionLabel: 'Open assistant',
    Icon: Headphones,
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

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.error?.message ?? fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeDashboardResult(result) {
  const value = unwrapServiceResult(
    result,
    'The representative CSR dashboard could not be loaded.',
  );
  const dashboard = isPlainObject(value?.dashboard)
    ? value.dashboard
    : value;

  if (
    !isPlainObject(dashboard) ||
    !isPlainObject(dashboard.kpis) ||
    !Array.isArray(dashboard.recentRequests) ||
    !Array.isArray(dashboard.alerts) ||
    !Array.isArray(dashboard.requestChart?.points)
  ) {
    throw new TypeError(
      'The local insights service returned an invalid CSR dashboard.',
    );
  }

  return dashboard;
}

function normalizeAuditResult(result) {
  const value = unwrapServiceResult(
    result,
    'Local audit evidence could not be loaded.',
  );

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.events)) {
    return value.events;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(
    'The local audit service returned an invalid event collection.',
  );
}

function resolveDashboardMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getCsrDashboard === 'function') {
    return service.getCsrDashboard.bind(service);
  }

  if (typeof service.getCsrInsights === 'function') {
    return service.getCsrInsights.bind(service);
  }

  if (typeof service.getDashboard === 'function') {
    return service.getDashboard.bind(service);
  }

  return null;
}

function resolveAuditMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.query === 'function') {
    return service.query.bind(service);
  }

  if (typeof service.list === 'function') {
    return service.list.bind(service);
  }

  if (typeof service.getEvents === 'function') {
    return service.getEvents.bind(service);
  }

  return null;
}

function getPriorityVariant(priority) {
  switch (priority) {
    case 'URGENT':
      return 'error';
    case 'HIGH':
      return 'warning';
    default:
      return 'neutral';
  }
}

function getAlertPresentation(severity) {
  switch (severity) {
    case 'ERROR':
      return {
        Icon: AlertCircle,
        className:
          'border-danger-200 bg-danger-50 dark:border-danger-700 dark:bg-danger-950',
        iconClassName:
          'bg-danger-100 text-danger-700 dark:bg-danger-700 dark:text-white',
      };
    case 'WARNING':
      return {
        Icon: TriangleAlert,
        className:
          'border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-950',
        iconClassName:
          'bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-white',
      };
    default:
      return {
        Icon: BellRing,
        className:
          'border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-950',
        iconClassName:
          'bg-primary-100 text-primary-700 dark:bg-primary-700 dark:text-white',
      };
  }
}

function getRequestKey(request, index) {
  return (
    request.requestId ??
    request.displayId ??
    `csr-request-${index}`
  );
}

function getAlertKey(alert, index) {
  return alert.alertId ?? `csr-alert-${index}`;
}

function getAuditKey(event, index) {
  return event.eventId ?? `csr-audit-${index}`;
}

function createPriorityCounts(requests) {
  return [
    {
      priority: 'URGENT',
      count: requests.filter(
        (request) => request.priority === 'URGENT',
      ).length,
      description: 'Requires immediate local attention',
    },
    {
      priority: 'HIGH',
      count: requests.filter(
        (request) => request.priority === 'HIGH',
      ).length,
      description: 'Elevated browser-local queue priority',
    },
    {
      priority: 'NORMAL',
      count: requests.filter(
        (request) => request.priority === 'NORMAL',
      ).length,
      description: 'Standard deterministic processing',
    },
  ];
}

/**
 * CSR dashboard route for representative local requests, alerts, and activity.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   insightsFacade?: object,
 *   insightsService?: object,
 *   auditFacade?: object,
 *   auditService?: object,
 *   snapshotFacade?: object,
 *   initialDashboard?: Record<string, unknown>,
 *   initialAuditEvents?: readonly Record<string, unknown>[],
 *   onNavigate?: Function,
 *   onRestore?: Function
 * }} props Component props.
 * @returns {JSX.Element} CSR dashboard page.
 */
export function CsrDashboardPage({
  session = null,
  context = null,
  insightsFacade = null,
  insightsService = null,
  auditFacade = null,
  auditService = null,
  snapshotFacade = null,
  initialDashboard = CSR_DASHBOARD_FIXTURE,
  initialAuditEvents = INITIAL_AUDIT_EVENTS,
  onNavigate,
  onRestore,
}) {
  const headingId = useId();
  const feedbackId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const dashboardService =
    insightsFacade ?? insightsService;
  const localAuditService = auditFacade ?? auditService;
  const dashboardReader = useMemo(
    () => resolveDashboardMethod(dashboardService),
    [dashboardService],
  );
  const auditReader = useMemo(
    () => resolveAuditMethod(localAuditService),
    [localAuditService],
  );
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [auditEvents, setAuditEvents] = useState(
    initialAuditEvents,
  );
  const [loading, setLoading] = useState(
    dashboardReader !== null,
  );
  const [auditLoading, setAuditLoading] = useState(
    auditReader !== null,
  );
  const [loadError, setLoadError] = useState(null);
  const [auditError, setAuditError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);
  const [restoreDialogOpen, setRestoreDialogOpen] =
    useState(false);
  const [restorePending, setRestorePending] = useState(false);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (dashboardReader === null) {
        setDashboard(initialDashboard);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const result = await Promise.resolve(
          dashboardReader(accessContext),
        );
        const nextDashboard = normalizeDashboardResult(result);

        if (active) {
          setDashboard(nextDashboard);
        }
      } catch (error) {
        if (active) {
          setDashboard(initialDashboard);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The representative CSR dashboard could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDashboard().catch((error) => {
      if (active) {
        setLoading(false);
        setDashboard(initialDashboard);
        setLoadError(
          normalizeErrorMessage(
            error,
            'The representative CSR dashboard could not be loaded.',
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
    dashboardReader,
    initialDashboard,
    role,
  ]);

  useEffect(() => {
    let active = true;

    const loadAudits = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setAuditLoading(false);
        return;
      }

      if (auditReader === null) {
        setAuditEvents(initialAuditEvents);
        setAuditLoading(false);
        return;
      }

      setAuditLoading(true);
      setAuditError(null);

      try {
        const result = await Promise.resolve(
          auditReader(
            {
              page: 1,
              limit: 5,
              direction: 'DESC',
            },
            accessContext,
          ),
        );
        const events = normalizeAuditResult(result);

        if (active) {
          setAuditEvents(events);
        }
      } catch (error) {
        if (active) {
          setAuditEvents(initialAuditEvents);
          setAuditError(
            normalizeErrorMessage(
              error,
              'Additional local audit evidence is unavailable.',
            ),
          );
        }
      } finally {
        if (active) {
          setAuditLoading(false);
        }
      }
    };

    loadAudits().catch((error) => {
      if (active) {
        setAuditLoading(false);
        setAuditEvents(initialAuditEvents);
        setAuditError(
          normalizeErrorMessage(
            error,
            'Additional local audit evidence is unavailable.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    auditReader,
    authenticated,
    initialAuditEvents,
    role,
  ]);

  const recentRequests = Array.isArray(
    dashboard?.recentRequests,
  )
    ? dashboard.recentRequests
    : EMPTY_COLLECTION;
  const alerts = Array.isArray(dashboard?.alerts)
    ? dashboard.alerts
    : EMPTY_COLLECTION;
  const chartPoints = Array.isArray(
    dashboard?.requestChart?.points,
  )
    ? dashboard.requestChart.points.map((point, index) => ({
        ...point,
        day: `Day ${index + 1}`,
      }))
    : EMPTY_COLLECTION;
  const priorityCounts = useMemo(
    () => createPriorityCounts(recentRequests),
    [recentRequests],
  );
  const kpis = isPlainObject(dashboard?.kpis)
    ? dashboard.kpis
    : CSR_DASHBOARD_FIXTURE.kpis;

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
    setOperationMessage(null);

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

  const handleRestore = async () => {
    setRestorePending(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      let result = null;

      if (typeof onRestore === 'function') {
        result = await Promise.resolve(
          onRestore(
            {
              dashboard: CSR_DASHBOARD_FIXTURE,
              confirmation:
                SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE,
            },
            accessContext,
          ),
        );
      } else if (
        snapshotFacade !== null &&
        typeof snapshotFacade.restoreSample === 'function'
      ) {
        result = await Promise.resolve(
          snapshotFacade.restoreSample({
            confirmation:
              SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE,
          }),
        );
      } else if (
        snapshotFacade !== null &&
        typeof snapshotFacade.restore === 'function'
      ) {
        result = await Promise.resolve(
          snapshotFacade.restore({
            confirmation:
              SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE,
          }),
        );
      }

      if (result?.ok === false) {
        throw new Error(
          result.error?.message ??
            'The canonical fictional sample data could not be restored.',
        );
      }

      setDashboard(CSR_DASHBOARD_FIXTURE);
      setAuditEvents(INITIAL_AUDIT_EVENTS);
      setLoadError(null);
      setAuditError(null);
      setOperationMessage(
        result?.data?.reloadRequired === true
          ? 'Canonical fictional sample data was restored. Reload the application to refresh every route.'
          : 'The exact representative CSR baseline was restored locally.',
      );
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The exact representative CSR baseline could not be restored.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setRestorePending(false);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  if (loading && dashboard === null) {
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
            Loading representative support activity
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Reading browser-local fictional dashboard fixtures.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <Headphones
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Customer service workspace
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                CSR dashboard
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Review representative priorities, recent requests,
                alerts, and local support activity.
              </p>
            </div>
          </div>

          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-primary-950"
            type="button"
            disabled={restorePending}
            onClick={() => {
              setOperationError(null);
              setOperationMessage(null);
              setRestoreDialogOpen(true);
            }}
          >
            <RotateCcw
              className="h-4 w-4"
              aria-hidden="true"
            />
            Restore exact baseline
          </button>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="CSR dashboard disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Representative browser-local support data
            </p>
            <p className="mt-1 leading-6">
              Tiles, priorities, alerts, chart points, requests,
              and audit evidence are fictional local fixtures. No
              payer, provider, healthcare, payment, monitoring, or
              external support system is contacted.
            </p>
          </div>
        </div>
      </aside>

      {loadError !== null ? (
        <div
          className="mt-5 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
          role="alert"
        >
          {loadError} The exact bundled baseline is displayed
          instead.
        </div>
      ) : null}

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
        className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-labelledby="csr-kpis-heading"
        aria-busy={loading}
      >
        <h2 id="csr-kpis-heading" className="sr-only">
          Representative support metrics
        </h2>

        {[
          {
            label: 'Open requests',
            value: kpis.openRequests,
            description: 'Pending, paused, or awaiting review',
            Icon: ClipboardList,
          },
          {
            label: 'Urgent requests',
            value: kpis.urgentRequests,
            description: 'Highest local queue priority',
            Icon: ShieldAlert,
          },
          {
            label: 'Completed today',
            value: kpis.completedToday,
            description: 'Completed in the published fixture',
            Icon: CheckCircle2,
          },
          {
            label: 'Failed requests',
            value: kpis.failedRequests,
            description: 'Retained local exception evidence',
            Icon: AlertCircle,
          },
        ].map((metric) => {
          const MetricIcon = metric.Icon;

          return (
            <article
              key={metric.label}
              className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-content-muted dark:text-content-inverse-muted">
                  {metric.label}
                </p>
                <MetricIcon
                  className="h-5 w-5 text-primary-700 dark:text-primary-300"
                  aria-hidden="true"
                />
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
                {formatNumber(metric.value, { fallback: '0' })}
              </p>
              <p className="mt-1 text-xs leading-5 text-content-subtle dark:text-content-inverse-muted">
                {metric.description}
              </p>
            </article>
          );
        })}
      </section>

      <section
        className="mt-4 grid gap-4 sm:grid-cols-3"
        aria-label="Additional representative metrics"
      >
        <article className="rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
            Average processing
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatNumber(kpis.averageProcessingMinutes, {
              maximumFractionDigits: 1,
            })}{' '}
            <span className="text-sm font-medium">min</span>
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
            Target processing
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatNumber(kpis.targetProcessingMinutes)}{' '}
            <span className="text-sm font-medium">min</span>
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
            Representative downloads
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatNumber(kpis.representativeDownloads, {
              fallback: '0',
            })}
          </p>
        </article>
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 xl:col-span-2"
          aria-labelledby="activity-chart-heading"
        >
          <div className="flex items-start gap-3">
            <Activity
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="activity-chart-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Seven-day request activity
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Seven published fixture points for created,
                completed, and exception requests.
              </p>
            </div>
          </div>

          <div
            className="mt-5 h-72 w-full"
            role="img"
            aria-label="Seven-day line chart of representative created, completed, and exception requests"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartPoints}
                margin={{
                  top: 8,
                  right: 12,
                  bottom: 8,
                  left: -12,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#cbd5e1"
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12 }}
                  stroke="#64748b"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12 }}
                  stroke="#64748b"
                />
                <Tooltip
                  labelFormatter={(label, payload) => {
                    const interval = payload?.[0]?.payload?.interval;

                    return interval
                      ? `${label} · ${interval}`
                      : label;
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="created"
                  name="Created"
                  stroke="#2563eb"
                  strokeWidth={2}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="completed"
                  name="Completed"
                  stroke="#059669"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="exceptions"
                  name="Exceptions"
                  stroke="#dc2626"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-3 text-xs text-content-subtle dark:text-content-inverse-muted">
            {dashboard?.requestChart?.title ??
              'Representative request activity'}{' '}
            · Values are supplied presentation fixtures.
          </p>
        </section>

        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="priority-heading"
        >
          <h2
            id="priority-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Request priorities
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Priority counts from the displayed recent requests.
          </p>

          <div className="mt-5 space-y-3">
            {priorityCounts.map((item) => (
              <article
                key={item.priority}
                className="rounded-lg border border-border p-4 dark:border-border-dark"
              >
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge
                    status={item.priority}
                    variant={getPriorityVariant(item.priority)}
                  />
                  <span className="text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                    {item.count}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section
        className="mt-8"
        aria-labelledby="quick-actions-heading"
      >
        <h2
          id="quick-actions-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Quick actions
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Open common browser-local support workflows.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {QUICK_ACTIONS.map((action) => {
            const ActionIcon = action.Icon;
            const pending = navigationPending === action.id;

            return (
              <a
                key={action.id}
                className="group flex min-h-44 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                href={action.href}
                aria-busy={pending}
                onClick={(event) => {
                  handleNavigation(
                    event,
                    {
                      type: action.type,
                      href: action.href,
                    },
                    action.id,
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The selected support workflow could not be opened.',
                      ),
                    );
                  });
                }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                  <ActionIcon
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
                <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                  {action.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                  {action.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                  {pending ? 'Opening…' : action.actionLabel}
                  {pending ? (
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
      </section>

      <section
        className="mt-8"
        aria-labelledby="csr-alerts-heading"
      >
        <div className="flex items-start gap-3">
          <BellRing
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="csr-alerts-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Representative alerts
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Three exact browser-local alert fixtures.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {alerts.map((alert, index) => {
            const presentation = getAlertPresentation(
              alert.severity,
            );
            const AlertIcon = presentation.Icon;
            const requestHref =
              typeof alert.requestId === 'string'
                ? `/operations/requests/${encodeURIComponent(
                    alert.requestId,
                  )}`
                : '/operations/queue';
            const key = `alert-${alert.alertId ?? index}`;

            return (
              <article
                key={getAlertKey(alert, index)}
                className={`flex min-h-56 flex-col rounded-xl border p-5 shadow-card ${presentation.className}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${presentation.iconClassName}`}
                  >
                    <AlertIcon
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </span>
                  <StatusBadge
                    status={alert.severity ?? 'INFO'}
                  />
                </div>
                <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                  {alert.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                  {alert.message}
                </p>
                <p className="mt-3 text-xs text-content-subtle dark:text-content-inverse-muted">
                  {formatDateTime(alert.createdAt)}
                  {alert.acknowledged === true
                    ? ' · Acknowledged locally'
                    : ' · Not acknowledged'}
                </p>
                <a
                  className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:underline dark:text-primary-300"
                  href={requestHref}
                  onClick={(event) => {
                    handleNavigation(
                      event,
                      {
                        type: 'REPRINT_REQUEST',
                        href: requestHref,
                        requestId: alert.requestId,
                        alert,
                      },
                      key,
                    ).catch((error) => {
                      setOperationError(
                        normalizeErrorMessage(
                          error,
                          'The alert request could not be opened.',
                        ),
                      );
                    });
                  }}
                >
                  {navigationPending === key
                    ? 'Opening…'
                    : 'Open request evidence'}
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
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="recent-requests-heading"
      >
        <div className="flex items-start gap-3">
          <ClipboardList
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="recent-requests-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Recent requests
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Representative support queue activity with masked
              member identifiers.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {recentRequests.map((request, index) => {
            const href =
              `/operations/requests/${encodeURIComponent(
                request.requestId ?? '',
              )}`;
            const key = `request-${request.requestId ?? index}`;

            return (
              <article
                key={getRequestKey(request, index)}
                className="rounded-xl border border-border p-5 dark:border-border-dark"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-base font-semibold text-content dark:text-content-inverse">
                      {request.displayId ??
                        request.requestId ??
                        'Local request'}
                    </p>
                    <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                      {request.memberName ??
                        'Authorized fictional member'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      status={request.priority ?? 'NORMAL'}
                      variant={getPriorityVariant(
                        request.priority,
                      )}
                    />
                    <StatusBadge
                      status={request.status ?? 'UNKNOWN'}
                    />
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Claim
                    </dt>
                    <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                      {request.claimNumber ?? 'Restricted'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Member
                    </dt>
                    <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                      {request.memberIdMasked ?? 'Restricted'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Type
                    </dt>
                    <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                      {formatStatus(request.requestType)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Current stage
                    </dt>
                    <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                      {formatStatus(request.currentStep)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 dark:border-border-dark sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                    <Clock3
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {formatDateTime(request.createdAt)}
                  </p>
                  <a
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                    href={href}
                    onClick={(event) => {
                      handleNavigation(
                        event,
                        {
                          type: 'REPRINT_REQUEST',
                          href,
                          requestId: request.requestId,
                          request,
                        },
                        key,
                      ).catch((error) => {
                        setOperationError(
                          normalizeErrorMessage(
                            error,
                            'The recent request could not be opened.',
                          ),
                        );
                      });
                    }}
                  >
                    {navigationPending === key
                      ? 'Opening…'
                      : 'Open request'}
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
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="local-audit-heading"
        aria-busy={auditLoading}
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="local-audit-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Local audit evidence
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Masked browser-local events available to this
              composed dashboard.
            </p>
          </div>
        </div>

        {auditError !== null ? (
          <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100">
            {auditError} Bundled baseline evidence is displayed
            instead.
          </div>
        ) : null}

        {auditLoading ? (
          <div
            className="mt-5 flex items-center gap-3 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            <Loader2
              className="h-5 w-5 animate-spin text-primary-600 motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading authorized local audit evidence
          </div>
        ) : auditEvents.length === 0 ? (
          <p
            className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            No authorized local audit evidence is available.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {auditEvents.slice(0, 5).map((event, index) => (
              <li
                key={getAuditKey(event, index)}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 dark:border-border-dark sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-content dark:text-content-inverse">
                    {formatStatus(event.action ?? 'Recorded')}
                  </p>
                  <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                    {event.entity?.type
                      ? `${formatStatus(event.entity.type)} · `
                      : ''}
                    Actor{' '}
                    <span className="font-mono">
                      {event.actor?.displayName ??
                        event.actor?.userId ??
                        'system'}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                    {formatDateTime(event.occurredAt)}
                  </p>
                </div>
                <StatusBadge
                  className="self-start sm:self-center"
                  status={event.outcome ?? 'SUCCESS'}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="CSR dashboard disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional support activity only
            </p>
            <p className="mt-1 text-sm leading-6">
              Dashboard values, priorities, requests, alerts,
              chart points, and audits are supplied demonstration
              fixtures. They do not represent live healthcare,
              coverage, payment, benefit, appeal, delivery, or
              operational results.
            </p>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={restoreDialogOpen}
        title="Restore the exact representative baseline?"
        description="This restores the bundled fictional CSR dashboard values. When a snapshot facade is supplied, other governed browser-local sample data may also be restored."
        confirmLabel="Restore exact baseline"
        cancelLabel="Cancel"
        confirmationText={
          SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE
        }
        destructive
        loading={restorePending}
        onConfirm={handleRestore}
        onOpenChange={setRestoreDialogOpen}
      />
    </div>
  );
}

CsrDashboardPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  insightsFacade: PropTypes.object,
  insightsService: PropTypes.object,
  auditFacade: PropTypes.object,
  auditService: PropTypes.object,
  snapshotFacade: PropTypes.object,
  initialDashboard: PropTypes.object,
  initialAuditEvents: PropTypes.arrayOf(PropTypes.object),
  onNavigate: PropTypes.func,
  onRestore: PropTypes.func,
};

export const CsrSupportDashboardPage = CsrDashboardPage;
export const CustomerServiceDashboardPage = CsrDashboardPage;
export const LocalCsrDashboardPage = CsrDashboardPage;

export default CsrDashboardPage;