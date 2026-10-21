import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  BarChart3,
  BriefcaseBusiness,
  CalendarRange,
  CircleDollarSign,
  Clock3,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EXECUTIVE_INSIGHTS_FIXTURE,
} from '../../../fixtures/insights.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatCurrency,
  formatNumber,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['BOS', 'ADMIN']);
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

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.error?.message ?? fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeInsightsResult(result) {
  const value = unwrapServiceResult(
    result,
    'Published executive insights could not be loaded.',
  );
  const insights = isPlainObject(value?.executive)
    ? value.executive
    : value;

  if (
    !isPlainObject(insights) ||
    !isPlainObject(insights.caseA) ||
    !isPlainObject(insights.caseB) ||
    !isPlainObject(insights.monthlyTrend) ||
    !Array.isArray(insights.monthlyTrend.points) ||
    !Array.isArray(insights.monthlyTrend.legends)
  ) {
    throw new TypeError(
      'The local insights service returned invalid executive fixture data.',
    );
  }

  return insights;
}

function resolveInsightsReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getExecutive === 'function') {
    return service.getExecutive.bind(service);
  }

  if (typeof service.getExecutiveInsights === 'function') {
    return service.getExecutiveInsights.bind(service);
  }

  if (typeof service.getPublishedCases === 'function') {
    return service.getPublishedCases.bind(service);
  }

  return null;
}

function formatWholeCurrency(value) {
  return formatCurrency(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function getErrorPointKey(point, index) {
  return (
    point.comparisonId ??
    point.label ??
    `executive-error-comparison-${index}`
  );
}

/**
 * Published executive fixture dashboard for authorized BOS and Admin roles.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   insightsFacade?: object,
 *   insightsService?: object,
 *   insightsRepository?: object,
 *   initialInsights?: Record<string, unknown>
 * }} props Component props.
 * @returns {JSX.Element} Executive insights page.
 */
export function ExecutivePage({
  session = null,
  context = null,
  insightsFacade = null,
  insightsService = null,
  insightsRepository = null,
  initialInsights = EXECUTIVE_INSIGHTS_FIXTURE,
}) {
  const headingId = useId();
  const caseAHeadingId = useId();
  const caseBHeadingId = useId();
  const trendHeadingId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service =
    insightsFacade ??
    insightsService ??
    insightsRepository;
  const insightsReader = useMemo(
    () => resolveInsightsReader(service),
    [service],
  );
  const [insights, setInsights] = useState(initialInsights);
  const [loading, setLoading] = useState(
    insightsReader !== null,
  );
  const [loadError, setLoadError] = useState(null);
  const [reloadSequence, setReloadSequence] = useState(0);

  useEffect(() => {
    let active = true;

    const loadInsights = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (insightsReader === null) {
        setInsights(initialInsights);
        setLoadError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const result = await Promise.resolve(
          insightsReader(accessContext),
        );
        const nextInsights = normalizeInsightsResult(result);

        if (active) {
          setInsights(nextInsights);
        }
      } catch (error) {
        if (active) {
          setInsights(initialInsights);
          setLoadError(
            normalizeErrorMessage(
              error,
              'Published executive insights could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadInsights().catch((error) => {
      if (active) {
        setLoading(false);
        setInsights(initialInsights);
        setLoadError(
          normalizeErrorMessage(
            error,
            'Published executive insights could not be loaded.',
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
    initialInsights,
    insightsReader,
    reloadSequence,
    role,
  ]);

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  const caseA = isPlainObject(insights?.caseA)
    ? insights.caseA
    : EXECUTIVE_INSIGHTS_FIXTURE.caseA;
  const caseB = isPlainObject(insights?.caseB)
    ? insights.caseB
    : EXECUTIVE_INSIGHTS_FIXTURE.caseB;
  const monthlyTrend = isPlainObject(
    insights?.monthlyTrend,
  )
    ? insights.monthlyTrend
    : EXECUTIVE_INSIGHTS_FIXTURE.monthlyTrend;
  const trendPoints = Array.isArray(monthlyTrend.points)
    ? monthlyTrend.points
    : EMPTY_COLLECTION;
  const trendLegends = Array.isArray(monthlyTrend.legends)
    ? monthlyTrend.legends
    : EMPTY_COLLECTION;
  const errorComparisons = Array.isArray(
    caseB.errorComparisons,
  )
    ? caseB.errorComparisons
    : EMPTY_COLLECTION;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <TrendingUp
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Published executive fixtures
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Executive insights
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Review separately labeled Case A and Case B
                presentation figures, along with a supplied
                monthly volume and savings trend.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <StatusBadge
              status="PUBLISHED_FIXTURE"
              variant="neutral"
              label="Published display fixtures"
            />
            {insightsReader !== null ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-primary-950"
                type="button"
                disabled={loading}
                onClick={() =>
                  setReloadSequence((current) => current + 1)
                }
              >
                {loading ? (
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
                {loading
                  ? 'Loading fixtures…'
                  : 'Refresh fixtures'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Executive insights fixture disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Published display fixtures
            </p>
            <p className="mt-1 leading-6">
              These values are supplied presentation fixtures and
              are not calculated from local claim, member,
              request, pipeline, payment, staffing, or financial
              records. Case A and Case B remain separate, and
              conflicting figures are intentionally not
              reconciled.
            </p>
          </div>
        </div>
      </aside>

      {loadError !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            {loadError} The exact bundled executive fixture is
            displayed instead.
          </span>
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface p-5 text-sm text-content-muted shadow-card dark:border-border-dark dark:bg-surface-dark-muted dark:text-content-inverse-muted"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="h-5 w-5 animate-spin text-primary-600 motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading immutable published insight fixtures
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          aria-labelledby={caseAHeadingId}
        >
          <div className="border-b border-border bg-surface-muted p-5 dark:border-border-dark dark:bg-surface-dark sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                  <CalendarRange
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                    Separate published case
                  </p>
                  <h2
                    id={caseAHeadingId}
                    className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
                  >
                    {caseA.label ?? 'Published Case A'}
                  </h2>
                </div>
              </div>
              <StatusBadge
                status="FIXTURE"
                variant="neutral"
                label="Fixture"
              />
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <div className="rounded-xl border border-primary-200 bg-primary-50 p-5 dark:border-primary-800 dark:bg-primary-950">
              <p className="text-sm font-semibold text-primary-900 dark:text-primary-100">
                Published market context
              </p>
              <p className="mt-2 text-sm leading-6 text-primary-900 dark:text-primary-100">
                This panel preserves the supplied lead-time range,
                point estimate, and target exactly as published.
                It is presentation context, not a measured payer,
                provider, or industry benchmark.
              </p>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  <Clock3
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Lead-time range
                </dt>
                <dd className="mt-3 text-2xl font-semibold text-content dark:text-content-inverse">
                  {caseA.leadTimeRange ?? '2–3 days'}
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  <Gauge
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Lead-time point
                </dt>
                <dd className="mt-3 text-2xl font-semibold text-content dark:text-content-inverse">
                  {caseA.leadTimePoint ?? '2.5 days'}
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  <TrendingUp
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Published target
                </dt>
                <dd className="mt-3 text-2xl font-semibold text-content dark:text-content-inverse">
                  {caseA.target ?? '15 minutes'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 rounded-lg bg-surface-muted p-4 text-xs leading-5 text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted">
              Source classification:{' '}
              <span className="font-mono font-semibold text-content dark:text-content-inverse">
                {caseA.sourceType ??
                  'PUBLISHED_DISPLAY_FIXTURE'}
              </span>
              {' · '}
              Calculated from claims:{' '}
              <span className="font-semibold text-content dark:text-content-inverse">
                {caseA.calculatedFromClaims === true
                  ? 'Yes'
                  : 'No'}
              </span>
            </div>
          </div>
        </section>

        <section
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          aria-labelledby={caseBHeadingId}
        >
          <div className="border-b border-border bg-surface-muted p-5 dark:border-border-dark dark:bg-surface-dark sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                  <BriefcaseBusiness
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                    Separate published case
                  </p>
                  <h2
                    id={caseBHeadingId}
                    className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
                  >
                    {caseB.label ?? 'Published Case B'}
                  </h2>
                </div>
              </div>
              <StatusBadge
                status="FIXTURE"
                variant="neutral"
                label="Fixture"
              />
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  ROI
                </dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {formatNumber(caseB.roiPercent, {
                    fallback: '1333',
                  })}
                  %
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Payback
                </dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {formatNumber(caseB.paybackMonths, {
                    maximumFractionDigits: 1,
                    fallback: '0.8',
                  })}{' '}
                  <span className="text-sm font-medium">
                    months
                  </span>
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  <CircleDollarSign
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Annual savings
                </dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {formatWholeCurrency(
                    caseB.annualSavingsUsd,
                  )}
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Published speed
                </dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {formatNumber(caseB.speedMultiplier, {
                    maximumFractionDigits: 1,
                    fallback: '15.5',
                  })}
                  x
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  <Clock3
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Processing time
                </dt>
                <dd className="mt-2 text-xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {formatNumber(caseB.minutesBefore, {
                    fallback: '240',
                  })}{' '}
                  →{' '}
                  {formatNumber(caseB.minutesAfter, {
                    maximumFractionDigits: 1,
                    fallback: '15.5',
                  })}{' '}
                  min
                </dd>
              </div>

              <div className="rounded-xl border border-border p-4 dark:border-border-dark">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  <UsersRound
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Staff
                </dt>
                <dd className="mt-2 text-xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {formatNumber(caseB.staffBefore, {
                    fallback: '25',
                  })}{' '}
                  →{' '}
                  {formatNumber(caseB.staffAfter, {
                    fallback: '5',
                  })}
                </dd>
              </div>
            </dl>

            <div className="mt-5">
              <h3 className="text-sm font-semibold text-content dark:text-content-inverse">
                Published error comparisons
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {errorComparisons.map((point, index) => (
                  <article
                    key={getErrorPointKey(point, index)}
                    className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
                  >
                    <p className="text-sm font-semibold text-content dark:text-content-inverse">
                      {point.label ??
                        'Published error comparison'}
                    </p>
                    <p className="mt-3 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                      {formatNumber(point.beforePercent, {
                        maximumFractionDigits: 1,
                      })}
                      %{' '}
                      <span
                        className="text-content-subtle dark:text-content-inverse-muted"
                        aria-hidden="true"
                      >
                        →
                      </span>{' '}
                      {formatNumber(point.afterPercent, {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </p>
                    <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                      Before and after presentation values
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-lg bg-surface-muted p-4 text-xs leading-5 text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted">
              Source classification:{' '}
              <span className="font-mono font-semibold text-content dark:text-content-inverse">
                {caseB.sourceType ??
                  'PUBLISHED_DISPLAY_FIXTURE'}
              </span>
              {' · '}
              Calculated from claims:{' '}
              <span className="font-semibold text-content dark:text-content-inverse">
                {caseB.calculatedFromClaims === true
                  ? 'Yes'
                  : 'No'}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby={trendHeadingId}
      >
        <div className="flex items-start gap-3">
          <BarChart3
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id={trendHeadingId}
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Monthly volume and savings
            </h2>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Twelve supplied presentation points with legends{' '}
              <span className="font-semibold">
                {trendLegends[0] ?? 'Volume (k)'}
              </span>{' '}
              and{' '}
              <span className="font-semibold">
                {trendLegends[1] ?? 'Savings ($M)'}
              </span>
              .
            </p>
          </div>
        </div>

        {trendPoints.length === 0 ? (
          <div
            className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface-muted p-6 text-center dark:border-border-dark-strong dark:bg-surface-dark"
            role="status"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              Published monthly trend points are unavailable.
            </p>
          </div>
        ) : (
          <div
            className="mt-5 h-80 w-full"
            role="img"
            aria-label="Combined chart of published monthly volume in thousands and savings in millions"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={trendPoints}
                margin={{
                  top: 8,
                  right: 8,
                  bottom: 8,
                  left: -12,
                }}
              >
                <CartesianGrid
                  stroke="#cbd5e1"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="month"
                  stroke="#64748b"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  yAxisId="volume"
                  stroke="#2563eb"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  yAxisId="savings"
                  orientation="right"
                  stroke="#059669"
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value, name) => [
                    name ===
                    (trendLegends[1] ?? 'Savings ($M)')
                      ? `$${formatNumber(value, {
                          maximumFractionDigits: 1,
                        })}M`
                      : `${formatNumber(value, {
                          maximumFractionDigits: 1,
                        })}k`,
                    name,
                  ]}
                />
                <Legend />
                <Bar
                  yAxisId="volume"
                  dataKey="volume"
                  name={trendLegends[0] ?? 'Volume (k)'}
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="savings"
                  type="monotone"
                  dataKey="savings"
                  name={trendLegends[1] ?? 'Savings ($M)'}
                  stroke="#059669"
                  strokeWidth={3}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              First fixture point
            </p>
            <p className="mt-2 text-sm font-semibold text-content dark:text-content-inverse">
              {trendPoints[0]?.month ?? 'M01'} ·{' '}
              {formatNumber(trendPoints[0]?.volume, {
                maximumFractionDigits: 1,
              })}
              k volume · $
              {formatNumber(trendPoints[0]?.savings, {
                maximumFractionDigits: 1,
              })}
              M savings
            </p>
          </div>

          <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Last fixture point
            </p>
            <p className="mt-2 text-sm font-semibold text-content dark:text-content-inverse">
              {trendPoints.at(-1)?.month ?? 'M12'} ·{' '}
              {formatNumber(trendPoints.at(-1)?.volume, {
                maximumFractionDigits: 1,
              })}
              k volume · $
              {formatNumber(trendPoints.at(-1)?.savings, {
                maximumFractionDigits: 1,
              })}
              M savings
            </p>
          </div>

          <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Series provenance
            </p>
            <p className="mt-2 font-mono text-sm font-semibold text-content dark:text-content-inverse">
              {monthlyTrend.sourceType ??
                'PRESENTATION_FIXTURE'}
            </p>
          </div>
        </div>
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Executive fixture provenance notice"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fixture provenance and limitations
            </p>
            <p className="mt-1 text-sm leading-6">
              Fixture version{' '}
              <span className="font-mono font-semibold">
                {insights?.fixtureVersion ?? 'Bundled fixture'}
              </span>
              .{' '}
              {insights?.disclosure ??
                'Published display fixtures; not calculated from local claim records. Conflicting figures are intentionally not reconciled.'}
            </p>
            <p className="mt-2 text-sm leading-6">
              ROI, savings, speed, error, staffing, lead-time,
              volume, and trend values are not forecasts,
              guarantees, market research, operational results, or
              financial advice. No payer, provider, healthcare,
              payment, reporting, monitoring, staffing, or
              external analytics system was contacted.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

ExecutivePage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  insightsFacade: PropTypes.object,
  insightsService: PropTypes.object,
  insightsRepository: PropTypes.object,
  initialInsights: PropTypes.object,
};

export const ExecutiveInsightsPage = ExecutivePage;
export const PublishedExecutivePage = ExecutivePage;
export const LocalExecutivePage = ExecutivePage;

export default ExecutivePage;