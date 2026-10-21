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
  Clock3,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  MemoryStick,
  Moon,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
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
  MONITORING_DASHBOARD_FIXTURE,
} from '../../../fixtures/insights.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  MONITORING_REFRESH_INTERVAL_MS,
} from '../../../platform/services/monitoringFacade.js';
import {
  formatDateTime,
  formatNumber,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['ITS', 'ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);

const SEVERITY_OPTIONS = Object.freeze([
  'INFO',
  'WARNING',
  'ERROR',
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
    const error = new Error(
      result.error?.message ?? fallback,
    );

    if (typeof result.error?.code === 'string') {
      error.code = result.error.code;
    }

    throw error;
  }

  return result?.ok === true ? result.data : result;
}

function normalizeDashboardResult(result) {
  const value = unwrapServiceResult(
    result,
    'The simulated monitoring dashboard could not be loaded.',
  );
  const dashboard = isPlainObject(value?.dashboard)
    ? value.dashboard
    : value;

  if (
    !isPlainObject(dashboard) ||
    !isPlainObject(dashboard.kpis) ||
    !Array.isArray(dashboard.syncLatency?.points) ||
    !Array.isArray(dashboard.throughput?.bars) ||
    !Array.isArray(dashboard.resourceGauges) ||
    !Array.isArray(dashboard.diskTimeline) ||
    !Array.isArray(dashboard.events) ||
    !Array.isArray(dashboard.alerts)
  ) {
    throw new TypeError(
      'The local monitoring facade returned an invalid dashboard.',
    );
  }

  return dashboard;
}

function resolveDashboardReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getDashboard === 'function') {
    return service.getDashboard.bind(service);
  }

  if (typeof service.getMonitoringDashboard === 'function') {
    return service.getMonitoringDashboard.bind(service);
  }

  if (typeof service.getMonitoring === 'function') {
    return service.getMonitoring.bind(service);
  }

  return null;
}

function resolveRefreshMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.refreshOnce === 'function') {
    return service.refreshOnce.bind(service);
  }

  if (typeof service.tick === 'function') {
    return service.tick.bind(service);
  }

  if (typeof service.advance === 'function') {
    return service.advance.bind(service);
  }

  return null;
}

function resolveStartRefreshMethod(service) {
  if (
    service !== null &&
    service !== undefined &&
    typeof service.startRefresh === 'function'
  ) {
    return service.startRefresh.bind(service);
  }

  if (
    service !== null &&
    service !== undefined &&
    typeof service.startPlayback === 'function'
  ) {
    return service.startPlayback.bind(service);
  }

  return null;
}

function resolveDarkModeMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.setDarkModePreference === 'function') {
    return service.setDarkModePreference.bind(service);
  }

  if (typeof service.setMonitoringDarkMode === 'function') {
    return service.setMonitoringDarkMode.bind(service);
  }

  return null;
}

function normalizeSearchText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
    : '';
}

function getAlertPresentation(severity) {
  switch (severity) {
    case 'ERROR':
      return {
        Icon: AlertCircle,
        containerClass:
          'border-danger-200 bg-danger-50 dark:border-danger-700 dark:bg-danger-950',
        iconClass:
          'bg-danger-100 text-danger-700 dark:bg-danger-700 dark:text-white',
      };
    case 'WARNING':
      return {
        Icon: ShieldAlert,
        containerClass:
          'border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-950',
        iconClass:
          'bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-white',
      };
    default:
      return {
        Icon: BellRing,
        containerClass:
          'border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-950',
        iconClass:
          'bg-primary-100 text-primary-700 dark:bg-primary-700 dark:text-white',
      };
  }
}

function getEventKey(event, index) {
  return event.eventId ?? `monitoring-event-${index}`;
}

function getAlertKey(alert, index) {
  return alert.alertId ?? `monitoring-alert-${index}`;
}

function getGaugeKey(gauge, index) {
  return gauge.resource ?? `resource-gauge-${index}`;
}

function getGaugeVariant(status) {
  switch (status) {
    case 'CRITICAL':
      return 'error';
    case 'WARNING':
      return 'warning';
    default:
      return 'success';
  }
}

function getGaugeStrokeClass(status) {
  switch (status) {
    case 'CRITICAL':
      return 'stroke-danger-600';
    case 'WARNING':
      return 'stroke-warning-600';
    default:
      return 'stroke-success-600';
  }
}

function ResourceGauge({ resource }) {
  const value = Math.max(
    0,
    Math.min(
      100,
      typeof resource.valuePercent === 'number'
        ? resource.valuePercent
        : 0,
    ),
  );
  const status = resource.status ?? 'HEALTHY';

  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-content dark:text-content-inverse">
          {resource.resource ?? 'Resource'}
        </h3>
        <StatusBadge
          status={status}
          variant={getGaugeVariant(status)}
        />
      </div>

      <div className="mt-4 flex items-center justify-center">
        <div className="relative h-36 w-36">
          <svg
            className="-rotate-90"
            viewBox="0 0 42 42"
            role="img"
            aria-label={`${resource.resource ?? 'Resource'} usage ${value} percent`}
          >
            <circle
              className="fill-none stroke-slate-200 dark:stroke-slate-700"
              cx="21"
              cy="21"
              r="15.9155"
              strokeWidth="4"
            />
            <circle
              className={`fill-none ${getGaugeStrokeClass(status)}`}
              cx="21"
              cy="21"
              r="15.9155"
              strokeDasharray="100 100"
              strokeDashoffset={String(100 - value)}
              strokeLinecap="round"
              strokeWidth="4"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
              {value}%
            </span>
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-center text-xs">
        <div className="rounded-lg bg-surface-muted p-2 dark:bg-surface-dark">
          <dt className="text-content-subtle dark:text-content-inverse-muted">
            Warning
          </dt>
          <dd className="mt-1 font-semibold text-content dark:text-content-inverse">
            {resource.warningThresholdPercent ?? '—'}%
          </dd>
        </div>
        <div className="rounded-lg bg-surface-muted p-2 dark:bg-surface-dark">
          <dt className="text-content-subtle dark:text-content-inverse-muted">
            Critical
          </dt>
          <dd className="mt-1 font-semibold text-content dark:text-content-inverse">
            {resource.criticalThresholdPercent ?? '—'}%
          </dd>
        </div>
      </dl>
    </article>
  );
}

ResourceGauge.propTypes = {
  resource: PropTypes.shape({
    resource: PropTypes.string,
    valuePercent: PropTypes.number,
    warningThresholdPercent: PropTypes.number,
    criticalThresholdPercent: PropTypes.number,
    status: PropTypes.string,
  }).isRequired,
};

/**
 * Simulated role-scoped monitoring route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   monitoringFacade?: object,
 *   monitoringService?: object,
 *   initialDashboard?: Record<string, unknown>,
 *   initialDarkMode?: boolean
 * }} props Component props.
 * @returns {JSX.Element} Monitoring dashboard page.
 */
export function MonitoringPage({
  session = null,
  context = null,
  monitoringFacade = null,
  monitoringService = null,
  initialDashboard = MONITORING_DASHBOARD_FIXTURE,
  initialDarkMode,
}) {
  const headingId = useId();
  const searchId = useId();
  const severityId = useId();
  const categoryId = useId();
  const acknowledgedId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service =
    monitoringFacade ?? monitoringService;
  const dashboardReader = useMemo(
    () => resolveDashboardReader(service),
    [service],
  );
  const refreshMethod = useMemo(
    () => resolveRefreshMethod(service),
    [service],
  );
  const startRefresh = useMemo(
    () => resolveStartRefreshMethod(service),
    [service],
  );
  const darkModeMethod = useMemo(
    () => resolveDarkModeMethod(service),
    [service],
  );
  const [dashboard, setDashboard] = useState(
    initialDashboard,
  );
  const [loading, setLoading] = useState(
    dashboardReader !== null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [darkModePending, setDarkModePending] =
    useState(false);
  const [darkMode, setDarkMode] = useState(
    initialDarkMode ??
      initialDashboard?.monitoringDarkMode === true,
  );
  const [loadError, setLoadError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [showAcknowledged, setShowAcknowledged] =
    useState(true);

  useEffect(() => {
    let active = true;
    let stopRefresh = null;

    const load = async () => {
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
        const nextDashboard =
          normalizeDashboardResult(result);

        if (active) {
          setDashboard(nextDashboard);

          if (
            typeof nextDashboard.monitoringDarkMode ===
            'boolean'
          ) {
            setDarkMode(
              nextDashboard.monitoringDarkMode,
            );
          }
        }
      } catch (error) {
        if (active) {
          setDashboard(initialDashboard);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The simulated monitoring dashboard could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }

      if (!active || startRefresh === null) {
        return;
      }

      try {
        const cancellation = startRefresh({
          intervalMs: MONITORING_REFRESH_INTERVAL_MS,
          timerKey: 'monitoring-page-refresh',
          immediate: false,
          onTick(result) {
            if (!active) {
              return;
            }

            try {
              setDashboard(normalizeDashboardResult(result));
              setLoadError(null);
            } catch (error) {
              setOperationError(
                normalizeErrorMessage(
                  error,
                  'A simulated monitoring refresh could not be displayed.',
                ),
              );
            }
          },
        });

        if (typeof cancellation === 'function') {
          stopRefresh = cancellation;
        }
      } catch (error) {
        if (active) {
          setOperationError(
            normalizeErrorMessage(
              error,
              'Automatic local monitoring refresh could not be started.',
            ),
          );
        }
      }
    };

    load().catch((error) => {
      if (active) {
        setLoading(false);
        setDashboard(initialDashboard);
        setLoadError(
          normalizeErrorMessage(
            error,
            'The simulated monitoring dashboard could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;

      if (typeof stopRefresh === 'function') {
        try {
          stopRefresh();
        } catch {
          stopRefresh = null;
        }
      }
    };
  }, [
    accessContext,
    authenticated,
    dashboardReader,
    initialDashboard,
    role,
    startRefresh,
  ]);

  const events = Array.isArray(dashboard?.events)
    ? dashboard.events
    : EMPTY_COLLECTION;
  const alerts = Array.isArray(dashboard?.alerts)
    ? dashboard.alerts
    : EMPTY_COLLECTION;
  const syncLatency = Array.isArray(
    dashboard?.syncLatency?.points,
  )
    ? dashboard.syncLatency.points
    : EMPTY_COLLECTION;
  const throughput = Array.isArray(
    dashboard?.throughput?.bars,
  )
    ? dashboard.throughput.bars
    : EMPTY_COLLECTION;
  const resourceGauges = Array.isArray(
    dashboard?.resourceGauges,
  )
    ? dashboard.resourceGauges
    : EMPTY_COLLECTION;
  const diskTimeline = Array.isArray(
    dashboard?.diskTimeline,
  )
    ? dashboard.diskTimeline
    : EMPTY_COLLECTION;
  const kpis = isPlainObject(dashboard?.kpis)
    ? dashboard.kpis
    : MONITORING_DASHBOARD_FIXTURE.kpis;

  const categories = useMemo(
    () =>
      [...new Set(
        events
          .map((event) => event.category)
          .filter(
            (value) =>
              typeof value === 'string' &&
              value.length > 0,
          ),
      )].sort((left, right) =>
        left.localeCompare(right, 'en-US'),
      ),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const query = normalizeSearchText(search);

    return events.filter((event) => {
      if (
        severity.length > 0 &&
        event.severity !== severity
      ) {
        return false;
      }

      if (
        category.length > 0 &&
        event.category !== category
      ) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return [
        event.title,
        event.message,
        event.category,
        event.source,
        event.severity,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(query);
    });
  }, [category, events, search, severity]);

  const visibleAlerts = useMemo(
    () =>
      alerts.filter(
        (alert) =>
          showAcknowledged ||
          alert.acknowledged !== true,
      ),
    [alerts, showAcknowledged],
  );

  const handleRefresh = async () => {
    if (refreshMethod === null) {
      setOperationError(
        'Manual simulated refresh is unavailable in this application composition.',
      );
      return;
    }

    setRefreshing(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        refreshMethod(accessContext),
      );
      const nextDashboard =
        normalizeDashboardResult(result);

      setDashboard(nextDashboard);
      setOperationMessage(
        'The deterministic monitoring fixture advanced by one local interval.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The simulated monitoring interval could not be advanced.',
        ),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleDarkModeChange = async () => {
    const enabled = !darkMode;

    setDarkModePending(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      if (darkModeMethod !== null) {
        const result = await Promise.resolve(
          darkModeMethod(
            { enabled },
            accessContext,
          ),
        );

        unwrapServiceResult(
          result,
          'The monitoring appearance preference could not be updated.',
        );
      }

      setDarkMode(enabled);
      setOperationMessage(
        darkModeMethod === null
          ? 'Near-black monitoring mode was updated for this route.'
          : 'Near-black monitoring mode was retained in browser-local preferences.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The monitoring appearance preference could not be updated.',
        ),
      );
    } finally {
      setDarkModePending(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setSeverity('');
    setCategory('');
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  return (
    <div
      className={
        darkMode
          ? 'dark min-h-screen bg-slate-950'
          : 'min-h-screen'
      }
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header
          className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-slate-700 dark:bg-slate-900"
          aria-labelledby={headingId}
        >
          <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
                <Activity
                  className="h-6 w-6"
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                  Simulated IT operations
                </p>
                <h1
                  id={headingId}
                  className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-white sm:text-3xl"
                >
                  Monitoring dashboard
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-slate-300 sm:text-base">
                  Review deterministic health indicators,
                  resource gauges, alerts, event evidence, and
                  chart fixtures with a 30-second browser-local
                  refresh.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 dark:focus:ring-offset-slate-900"
                type="button"
                disabled={darkModePending}
                aria-pressed={darkMode}
                onClick={() => {
                  handleDarkModeChange().catch((error) => {
                    setDarkModePending(false);
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The monitoring appearance preference could not be updated.',
                      ),
                    );
                  });
                }}
              >
                {darkModePending ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : darkMode ? (
                  <Sun
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                ) : (
                  <Moon
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
                {darkMode
                  ? 'Use light mode'
                  : 'Use near-black mode'}
              </button>

              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
                type="button"
                disabled={refreshing || loading}
                onClick={() => {
                  handleRefresh().catch((error) => {
                    setRefreshing(false);
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The simulated monitoring interval could not be advanced.',
                      ),
                    );
                  });
                }}
              >
                {refreshing ? (
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
                {refreshing
                  ? 'Refreshing locally…'
                  : 'Refresh local fixture'}
              </button>
            </div>
          </div>
        </header>

        <aside
          className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-slate-900 dark:text-primary-100"
          role="note"
          aria-label="Monitoring simulation disclosure"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Simulated fixture — no monitoring service is
                connected
              </p>
              <p className="mt-1 leading-6">
                KPIs, charts, gauges, alerts, and events are
                deterministic browser-local fixtures. Automatic
                refresh advances local state every 30 seconds and
                does not contact monitoring, queue, database,
                infrastructure, or external integration systems.
              </p>
            </div>
          </div>
        </aside>

        {loadError !== null ? (
          <div
            className="mt-5 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
            role="alert"
          >
            {loadError} The bundled monitoring baseline is
            displayed instead.
          </div>
        ) : null}

        {operationError !== null ? (
          <div
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
            className="mt-5 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-slate-900 dark:text-success-100"
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
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
          aria-labelledby="monitoring-kpis-heading"
          aria-busy={loading}
        >
          <h2 id="monitoring-kpis-heading" className="sr-only">
            Simulated monitoring KPIs
          </h2>

          {[
            {
              label: 'CDC status',
              value:
                kpis.cdcStatusLabel ??
                formatStatus(kpis.cdcStatus),
              description: 'Local replica fixture state',
              status: kpis.cdcStatus ?? 'HEALTHY',
              Icon: Database,
            },
            {
              label: 'Uptime',
              value: `${formatNumber(kpis.uptimePercent, {
                maximumFractionDigits: 2,
              })}%`,
              description: 'Published simulated indicator',
              status: 'HEALTHY',
              Icon: Server,
            },
            {
              label: 'Active connections',
              value: formatNumber(kpis.activeConnections, {
                fallback: '0',
              }),
              description: 'Representative local count',
              status: 'HEALTHY',
              Icon: Activity,
            },
            {
              label: 'Queue depth',
              value: formatNumber(kpis.queueDepth, {
                fallback: '0',
              }),
              description: 'Fictional queued records',
              status:
                kpis.queueDepth >= 80
                  ? 'CRITICAL'
                  : kpis.queueDepth >= 50
                    ? 'WARNING'
                    : 'HEALTHY',
              Icon: Gauge,
            },
            {
              label: 'Error rate',
              value: `${formatNumber(
                kpis.errorRatePercent,
                {
                  maximumFractionDigits: 1,
                  fallback: '0',
                },
              )}%`,
              description: `Fixture time ${
                kpis.fixtureTime ?? '—'
              }`,
              status:
                kpis.errorRatePercent >= 2
                  ? 'CRITICAL'
                  : kpis.errorRatePercent >= 1
                    ? 'WARNING'
                    : 'HEALTHY',
              Icon: AlertCircle,
            },
          ].map((metric) => {
            const MetricIcon = metric.Icon;

            return (
              <article
                key={metric.label}
                className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <MetricIcon
                    className="h-5 w-5 text-primary-700 dark:text-primary-300"
                    aria-hidden="true"
                  />
                  <StatusBadge status={metric.status} />
                </div>
                <p className="mt-4 text-sm font-semibold text-content-muted dark:text-slate-300">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-white">
                  {metric.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-content-subtle dark:text-slate-400">
                  {metric.description}
                </p>
              </article>
            );
          })}
        </section>

        {loading ? (
          <div
            className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface p-5 text-sm text-content-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            role="status"
          >
            <Loader2
              className="h-5 w-5 animate-spin text-primary-600 motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading deterministic monitoring fixtures
          </div>
        ) : null}

        <section
          className="mt-8"
          aria-labelledby="resource-gauges-heading"
        >
          <div className="flex items-start gap-3">
            <MemoryStick
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="resource-gauges-heading"
                className="text-xl font-semibold text-content dark:text-white"
              >
                Resource gauges
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-slate-300">
                SVG gauges with deterministic warning and critical
                thresholds.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {resourceGauges.map((resource, index) => (
              <ResourceGauge
                key={getGaugeKey(resource, index)}
                resource={resource}
              />
            ))}
          </div>
        </section>

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <section
            className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-slate-700 dark:bg-slate-900 sm:p-6"
            aria-labelledby="latency-chart-heading"
          >
            <h2
              id="latency-chart-heading"
              className="text-lg font-semibold text-content dark:text-white"
            >
              Sync latency
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-slate-300">
              Representative milliseconds by fixture interval.
            </p>
            <div
              className="mt-5 h-72 w-full"
              role="img"
              aria-label="Line chart of simulated synchronization latency"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={syncLatency}
                  margin={{
                    top: 8,
                    right: 12,
                    bottom: 8,
                    left: -8,
                  }}
                >
                  <CartesianGrid
                    stroke="#475569"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="time"
                    stroke="#94a3b8"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fontSize: 12 }}
                    unit="ms"
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="milliseconds"
                    name="Latency"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section
            className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-slate-700 dark:bg-slate-900 sm:p-6"
            aria-labelledby="throughput-chart-heading"
          >
            <h2
              id="throughput-chart-heading"
              className="text-lg font-semibold text-content dark:text-white"
            >
              Throughput
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-slate-300">
              Representative records per minute.
            </p>
            <div
              className="mt-5 h-72 w-full"
              role="img"
              aria-label="Bar chart of simulated processing throughput"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={throughput}
                  margin={{
                    top: 8,
                    right: 12,
                    bottom: 8,
                    left: -8,
                  }}
                >
                  <CartesianGrid
                    stroke="#475569"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="interval"
                    stroke="#94a3b8"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="records"
                    name="Records per minute"
                    fill="#2563eb"
                    radius={[5, 5, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section
          className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-slate-700 dark:bg-slate-900 sm:p-6"
          aria-labelledby="disk-timeline-heading"
        >
          <div className="flex items-start gap-3">
            <HardDrive
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="disk-timeline-heading"
                className="text-lg font-semibold text-content dark:text-white"
              >
                Disk utilization timeline
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-slate-300">
                Published and refreshed browser-local usage points.
              </p>
            </div>
          </div>

          <div
            className="mt-5 h-72 w-full"
            role="img"
            aria-label="Timeline chart of simulated disk utilization"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={diskTimeline}
                margin={{
                  top: 8,
                  right: 12,
                  bottom: 8,
                  left: -8,
                }}
              >
                <CartesianGrid
                  stroke="#475569"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="time"
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  unit="%"
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="usedPercent"
                  name="Disk used"
                  stroke="#d97706"
                  strokeWidth={3}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section
          className="mt-8"
          aria-labelledby="monitoring-alerts-heading"
        >
          <div className="flex items-start gap-3">
            <BellRing
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <h2
                id="monitoring-alerts-heading"
                className="text-xl font-semibold text-content dark:text-white"
              >
                Simulated alerts
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-slate-300">
                Threshold and workflow alerts generated from local
                fixtures.
              </p>
            </div>
          </div>

          <label
            className="mt-4 inline-flex min-h-10 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-content dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            htmlFor={acknowledgedId}
          >
            <input
              id={acknowledgedId}
              className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              type="checkbox"
              checked={showAcknowledged}
              onChange={(event) =>
                setShowAcknowledged(event.target.checked)
              }
            />
            Show acknowledged alerts
          </label>

          {visibleAlerts.length === 0 ? (
            <div
              className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-slate-700 dark:bg-slate-900"
              role="status"
            >
              <CheckCircle2
                className="mx-auto h-8 w-8 text-success-700 dark:text-success-100"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm text-content-muted dark:text-slate-300">
                No simulated alerts match the current visibility
                setting.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {visibleAlerts.map((alert, index) => {
                const presentation = getAlertPresentation(
                  alert.severity,
                );
                const AlertIcon = presentation.Icon;

                return (
                  <article
                    key={getAlertKey(alert, index)}
                    className={`rounded-xl border p-5 shadow-card ${presentation.containerClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${presentation.iconClass}`}
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
                    <h3 className="mt-4 font-semibold text-content dark:text-white">
                      {alert.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-content-muted dark:text-slate-300">
                      {alert.message}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-content-subtle dark:text-slate-400">
                          Metric
                        </dt>
                        <dd className="mt-1 font-mono font-semibold text-content dark:text-white">
                          {alert.metric ?? 'Fixture event'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-content-subtle dark:text-slate-400">
                          Value / threshold
                        </dt>
                        <dd className="mt-1 font-semibold text-content dark:text-white">
                          {alert.value ?? '—'} /{' '}
                          {alert.threshold ?? '—'}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-4 flex items-center gap-2 text-xs text-content-subtle dark:text-slate-400">
                      <Clock3
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                      {formatDateTime(alert.createdAt)}
                      {alert.acknowledged === true
                        ? ' · Acknowledged locally'
                        : ' · Not acknowledged'}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section
          className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-slate-700 dark:bg-slate-900 sm:p-6"
          aria-labelledby="event-log-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2
                id="event-log-heading"
                className="text-xl font-semibold text-content dark:text-white"
              >
                Simulated event log
              </h2>
              <p
                className="mt-1 text-sm text-content-muted dark:text-slate-300"
                aria-live="polite"
              >
                {filteredEvents.length} of {events.length}{' '}
                browser-local events displayed.
              </p>
            </div>

            {search.length > 0 ||
            severity.length > 0 ||
            category.length > 0 ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                type="button"
                onClick={clearFilters}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Clear filters
              </button>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <label
                className="block text-sm font-medium text-content dark:text-white"
                htmlFor={searchId}
              >
                Search events
              </label>
              <div className="relative mt-2">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id={searchId}
                  className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
                  type="search"
                  value={search}
                  autoComplete="off"
                  placeholder="Title, source, category, or message"
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                />
              </div>
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-white"
                htmlFor={severityId}
              >
                Severity
              </label>
              <select
                id={severityId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value)
                }
              >
                <option value="">All severities</option>
                {SEVERITY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatStatus(value)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-white"
                htmlFor={categoryId}
              >
                Category
              </label>
              <select
                id={categoryId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value)
                }
              >
                <option value="">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {formatStatus(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div
              className="mt-5 rounded-lg bg-surface-muted p-6 text-center text-sm text-content-muted dark:bg-slate-950 dark:text-slate-300"
              role="status"
            >
              No simulated events match the current filters.
            </div>
          ) : (
            <ol className="mt-5 space-y-3">
              {filteredEvents.map((event, index) => (
                <li
                  key={getEventKey(event, index)}
                  className="flex flex-col gap-4 rounded-xl border border-border p-4 dark:border-slate-700 dark:bg-slate-950 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        status={event.severity ?? 'INFO'}
                      />
                      <StatusBadge
                        status={event.category ?? 'EVENT'}
                        variant="neutral"
                      />
                    </div>
                    <h3 className="mt-3 font-semibold text-content dark:text-white">
                      {event.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-content-muted dark:text-slate-300">
                      {event.message}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-content-subtle dark:text-slate-400">
                      Source: {event.source ?? 'LOCAL_FIXTURE'}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-content-subtle dark:text-slate-400">
                    {formatDateTime(event.occurredAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside
          className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
          role="note"
          aria-label="Monitoring disclaimer"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Fictional monitoring evidence only
              </p>
              <p className="mt-1 text-sm leading-6">
                Health states, uptime, connections, queue depth,
                error rate, resource usage, alerts, events, and
                chart points are supplied or deterministically
                advanced demonstration fixtures. They are not live
                infrastructure measurements, operational results,
                uptime commitments, security telemetry, or
                service-level claims.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

MonitoringPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  monitoringFacade: PropTypes.object,
  monitoringService: PropTypes.object,
  initialDashboard: PropTypes.object,
  initialDarkMode: PropTypes.bool,
};

export const SimulatedMonitoringPage = MonitoringPage;
export const ItsMonitoringPage = MonitoringPage;
export const LocalMonitoringPage = MonitoringPage;

export default MonitoringPage;