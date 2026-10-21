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
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Gauge,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UsersRound,
  Zap,
} from 'lucide-react';
import {
  PRODUCTIVITY_INSIGHTS_FIXTURE,
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

const CALLOUT_ICONS = Object.freeze({
  TIME: Clock3,
  STAFF: UsersRound,
  SAVINGS: CircleDollarSign,
  ROI: TrendingUp,
});

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

function normalizeProductivityResult(result) {
  const value = unwrapServiceResult(
    result,
    'Published productivity insights could not be loaded.',
  );
  const productivity = isPlainObject(value?.productivity)
    ? value.productivity
    : value;

  if (
    !isPlainObject(productivity) ||
    !isPlainObject(productivity.before) ||
    !isPlainObject(productivity.after) ||
    !Array.isArray(productivity.before.steps) ||
    !Array.isArray(productivity.after.steps) ||
    !isPlainObject(productivity.footer) ||
    !Array.isArray(productivity.errorPoints) ||
    !Array.isArray(productivity.comparisonCallouts)
  ) {
    throw new TypeError(
      'The local insights service returned invalid productivity fixture data.',
    );
  }

  return productivity;
}

function resolveProductivityReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getProductivity === 'function') {
    return service.getProductivity.bind(service);
  }

  if (
    typeof service.getProductivityInsights === 'function'
  ) {
    return service.getProductivityInsights.bind(service);
  }

  return null;
}

function formatMinutes(value) {
  return `${formatNumber(value, {
    maximumFractionDigits: 1,
    fallback: '0',
  })} min`;
}

function formatWholeCurrency(value) {
  return formatCurrency(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function getStepKey(step, index, phase) {
  return step.step ?? `${phase}-productivity-step-${index}`;
}

function getErrorPointKey(point, index) {
  return (
    point.comparisonId ??
    point.label ??
    `productivity-error-point-${index}`
  );
}

function getCalloutKey(callout, index) {
  return (
    callout.calloutId ??
    callout.label ??
    `productivity-callout-${index}`
  );
}

/**
 * Published before-and-after productivity fixture dashboard.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   insightsFacade?: object,
 *   insightsService?: object,
 *   insightsRepository?: object,
 *   initialInsights?: Record<string, unknown>
 * }} props Component props.
 * @returns {JSX.Element} Productivity insights page.
 */
export function ProductivityPage({
  session = null,
  context = null,
  insightsFacade = null,
  insightsService = null,
  insightsRepository = null,
  initialInsights = PRODUCTIVITY_INSIGHTS_FIXTURE,
}) {
  const headingId = useId();
  const comparisonHeadingId = useId();
  const beforeHeadingId = useId();
  const afterHeadingId = useId();
  const errorHeadingId = useId();
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
  const productivityReader = useMemo(
    () => resolveProductivityReader(service),
    [service],
  );
  const [insights, setInsights] = useState(initialInsights);
  const [loading, setLoading] = useState(
    productivityReader !== null,
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

      if (productivityReader === null) {
        setInsights(initialInsights);
        setLoadError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const result = await Promise.resolve(
          productivityReader(accessContext),
        );
        const nextInsights =
          normalizeProductivityResult(result);

        if (active) {
          setInsights(nextInsights);
        }
      } catch (error) {
        if (active) {
          setInsights(initialInsights);
          setLoadError(
            normalizeErrorMessage(
              error,
              'Published productivity insights could not be loaded.',
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
            'Published productivity insights could not be loaded.',
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
    productivityReader,
    reloadSequence,
    role,
  ]);

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  const before = isPlainObject(insights?.before)
    ? insights.before
    : PRODUCTIVITY_INSIGHTS_FIXTURE.before;
  const after = isPlainObject(insights?.after)
    ? insights.after
    : PRODUCTIVITY_INSIGHTS_FIXTURE.after;
  const footer = isPlainObject(insights?.footer)
    ? insights.footer
    : PRODUCTIVITY_INSIGHTS_FIXTURE.footer;
  const beforeSteps = Array.isArray(before.steps)
    ? before.steps
    : EMPTY_COLLECTION;
  const afterSteps = Array.isArray(after.steps)
    ? after.steps
    : EMPTY_COLLECTION;
  const errorPoints = Array.isArray(insights?.errorPoints)
    ? insights.errorPoints
    : EMPTY_COLLECTION;
  const comparisonCallouts = Array.isArray(
    insights?.comparisonCallouts,
  )
    ? insights.comparisonCallouts
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
              <BarChart3
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Published productivity fixtures
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Before and after productivity
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Compare separately labeled manual-process and
                target-process fixtures, including exact steps,
                printed minute labels, error points, staffing, and
                published financial callouts.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <StatusBadge
              status="PUBLISHED_FIXTURE"
              variant="neutral"
              label="Published display fixtures"
            />
            {productivityReader !== null ? (
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
        aria-label="Productivity fixture disclosure"
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
              Before and after steps, printed minutes, staffing,
              savings, ROI, payback, speed, and error comparisons
              are supplied presentation fixtures. They are not
              calculated from local claim, member, request,
              pipeline, staffing, payment, or financial records.
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
            {loadError} The exact bundled productivity fixture is
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
          Loading immutable published productivity fixtures
        </div>
      ) : null}

      <section
        className="mt-8"
        aria-labelledby={comparisonHeadingId}
      >
        <div className="flex items-start gap-3">
          <ListChecks
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id={comparisonHeadingId}
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Published process comparison
            </h2>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Each column preserves its own supplied step sequence
              and total without deriving values from operational
              records.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          <article
            className="overflow-hidden rounded-xl border border-border bg-surface shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            aria-labelledby={beforeHeadingId}
          >
            <header className="border-b border-border bg-surface-muted p-5 dark:border-border-dark dark:bg-surface-dark sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-white">
                    <BriefcaseBusiness
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-100">
                      Published before fixture
                    </p>
                    <h3
                      id={beforeHeadingId}
                      className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
                    >
                      {before.label ??
                        'Representative manual process'}
                    </h3>
                  </div>
                </div>
                <StatusBadge
                  status="FIXTURE"
                  variant="neutral"
                  label="Published fixture"
                />
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface p-4 dark:bg-surface-dark-muted">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                    Published total
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                    {formatMinutes(before.totalMinutes)}
                  </dd>
                </div>
                <div className="rounded-lg bg-surface p-4 dark:bg-surface-dark-muted">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                    Published staff
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                    {formatNumber(before.staffCount, {
                      fallback: '0',
                    })}
                  </dd>
                </div>
              </dl>
            </header>

            <ol className="space-y-3 p-5 sm:p-6">
              {beforeSteps.map((step, index) => (
                <li
                  key={getStepKey(step, index, 'before')}
                  className="flex items-start gap-3 rounded-xl border border-border p-4 dark:border-border-dark dark:bg-surface-dark"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-100 text-xs font-semibold text-warning-700 dark:bg-warning-700 dark:text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-content dark:text-content-inverse">
                      {step.label ?? 'Published process step'}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                      {step.step ?? 'STEP'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-warning-200 bg-warning-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100">
                    {formatMinutes(step.printedMinutes)}
                  </span>
                </li>
              ))}
            </ol>

            <footer className="border-t border-border bg-surface-muted px-5 py-4 dark:border-border-dark dark:bg-surface-dark sm:px-6">
              <p className="flex items-center gap-2 text-sm font-semibold text-content dark:text-content-inverse">
                <Clock3
                  className="h-4 w-4 text-warning-700 dark:text-warning-100"
                  aria-hidden="true"
                />
                Supplied total: {formatMinutes(before.totalMinutes)}
              </p>
            </footer>
          </article>

          <article
            className="overflow-hidden rounded-xl border border-primary-200 bg-surface shadow-card dark:border-primary-800 dark:bg-surface-dark-muted"
            aria-labelledby={afterHeadingId}
          >
            <header className="border-b border-primary-200 bg-primary-50 p-5 dark:border-primary-800 dark:bg-primary-950 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
                    <Zap
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                      Published after fixture
                    </p>
                    <h3
                      id={afterHeadingId}
                      className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
                    >
                      {after.label ??
                        'Representative target process'}
                    </h3>
                  </div>
                </div>
                <StatusBadge
                  status="FIXTURE"
                  variant="neutral"
                  label="Published fixture"
                />
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface/80 p-4 dark:bg-surface-dark-muted">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                    Published total
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                    {formatMinutes(after.totalMinutes)}
                  </dd>
                </div>
                <div className="rounded-lg bg-surface/80 p-4 dark:bg-surface-dark-muted">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                    Published staff
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                    {formatNumber(after.staffCount, {
                      fallback: '0',
                    })}
                  </dd>
                </div>
              </dl>
            </header>

            <ol className="space-y-3 p-5 sm:p-6">
              {afterSteps.map((step, index) => (
                <li
                  key={getStepKey(step, index, 'after')}
                  className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/50 p-4 dark:border-primary-800 dark:bg-primary-950"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-content dark:text-content-inverse">
                      {step.label ?? 'Published target step'}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                      {step.step ?? 'STEP'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-primary-200 bg-surface px-2.5 py-1 text-xs font-semibold tabular-nums text-primary-700 dark:border-primary-700 dark:bg-surface-dark dark:text-primary-300">
                    {formatMinutes(step.printedMinutes)}
                  </span>
                </li>
              ))}
            </ol>

            <footer className="border-t border-primary-200 bg-primary-50 px-5 py-4 dark:border-primary-800 dark:bg-primary-950 sm:px-6">
              <p className="flex items-center gap-2 text-sm font-semibold text-content dark:text-content-inverse">
                <CheckCircle2
                  className="h-4 w-4 text-primary-700 dark:text-primary-300"
                  aria-hidden="true"
                />
                Supplied total: {formatMinutes(after.totalMinutes)}
              </p>
            </footer>
          </article>
        </div>
      </section>

      <section
        className="mt-8"
        aria-labelledby="productivity-callouts-heading"
      >
        <div className="flex items-start gap-3">
          <Gauge
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="productivity-callouts-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Published comparison callouts
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Exact before, after, and change labels supplied by
              the productivity fixture.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {comparisonCallouts.map((callout, index) => {
            const CalloutIcon =
              CALLOUT_ICONS[callout.calloutId] ?? TrendingUp;

            return (
              <article
                key={getCalloutKey(callout, index)}
                className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                    <CalloutIcon
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </span>
                  <StatusBadge
                    status="FIXTURE"
                    variant="neutral"
                    label="Fixture"
                  />
                </div>

                <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                  {callout.label ?? 'Published comparison'}
                </h3>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Before
                    </dt>
                    <dd className="mt-1 font-semibold text-content dark:text-content-inverse">
                      {callout.before ?? '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-primary-50 p-3 dark:bg-primary-950">
                    <dt className="text-xs text-primary-700 dark:text-primary-300">
                      After
                    </dt>
                    <dd className="mt-1 font-semibold text-content dark:text-content-inverse">
                      {callout.after ?? '—'}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 flex items-start gap-2 text-sm font-semibold text-primary-700 dark:text-primary-300">
                  <TrendingUp
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  {callout.change ?? 'Published fixture change'}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby={errorHeadingId}
      >
        <div className="flex items-start gap-3">
          <TrendingDown
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id={errorHeadingId}
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Published error points
            </h2>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Separate before-and-after presentation values. These
              percentages are not measured from local workflow
              outcomes.
            </p>
          </div>
        </div>

        {errorPoints.length === 0 ? (
          <div
            className="mt-5 rounded-lg bg-surface-muted p-5 text-center text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            Published error comparison points are unavailable.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {errorPoints.map((point, index) => (
              <article
                key={getErrorPointKey(point, index)}
                className="rounded-xl border border-border p-5 dark:border-border-dark dark:bg-surface-dark"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-content dark:text-content-inverse">
                    {point.label ??
                      'Published error comparison'}
                  </h3>
                  <StatusBadge
                    status="FIXTURE"
                    variant="neutral"
                    label="Published fixture"
                  />
                </div>

                <dl className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-center dark:border-warning-700 dark:bg-warning-950">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-100">
                      Before
                    </dt>
                    <dd className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
                      {formatNumber(point.beforePercent, {
                        maximumFractionDigits: 1,
                        fallback: '0',
                      })}
                      %
                    </dd>
                  </div>

                  <TrendingDown
                    className="h-5 w-5 text-primary-700 dark:text-primary-300"
                    aria-label="Changes to"
                  />

                  <div className="rounded-lg border border-success-200 bg-success-50 p-4 text-center dark:border-success-700 dark:bg-surface-dark-muted">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-success-700 dark:text-success-100">
                      After
                    </dt>
                    <dd className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
                      {formatNumber(point.afterPercent, {
                        maximumFractionDigits: 1,
                        fallback: '0',
                      })}
                      %
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-labelledby="published-productivity-footer-heading"
      >
        <h2
          id="published-productivity-footer-heading"
          className="sr-only"
        >
          Published productivity footer values
        </h2>

        <article className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-content-muted dark:text-content-inverse-muted">
              Annual savings
            </p>
            <CircleDollarSign
              className="h-5 w-5 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatWholeCurrency(footer.annualSavingsUsd)}
          </p>
          <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
            Published financial fixture
          </p>
        </article>

        <article className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-content-muted dark:text-content-inverse-muted">
              ROI
            </p>
            <TrendingUp
              className="h-5 w-5 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatNumber(footer.roiPercent, {
              fallback: '0',
            })}
            %
          </p>
          <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
            Published display fixture
          </p>
        </article>

        <article className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-content-muted dark:text-content-inverse-muted">
              Payback
            </p>
            <Clock3
              className="h-5 w-5 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatNumber(footer.paybackMonths, {
              maximumFractionDigits: 1,
              fallback: '0',
            })}{' '}
            <span className="text-sm font-medium">months</span>
          </p>
          <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
            Published display fixture
          </p>
        </article>

        <article className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-content-muted dark:text-content-inverse-muted">
              Speed
            </p>
            <Zap
              className="h-5 w-5 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {formatNumber(footer.speedMultiplier, {
              maximumFractionDigits: 1,
              fallback: '0',
            })}
            x
          </p>
          <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
            Published display fixture
          </p>
        </article>
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Productivity fixture provenance notice"
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
                'Published productivity fixtures; values are supplied for presentation and are not calculated from local claim records.'}
            </p>
            <p className="mt-2 text-sm leading-6">
              Time, staffing, savings, ROI, payback, speed, and
              error values are not forecasts, guarantees,
              operational measurements, workforce guidance, or
              financial advice. No payer, provider, healthcare,
              payment, staffing, reporting, monitoring, or
              external analytics system was contacted.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

ProductivityPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  insightsFacade: PropTypes.object,
  insightsService: PropTypes.object,
  insightsRepository: PropTypes.object,
  initialInsights: PropTypes.object,
};

export const ProductivityInsightsPage = ProductivityPage;
export const PublishedProductivityPage = ProductivityPage;
export const LocalProductivityPage = ProductivityPage;

export default ProductivityPage;