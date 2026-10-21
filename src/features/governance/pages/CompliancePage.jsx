import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  COMPLIANCE_STATUS_FIXTURE,
} from '../../../fixtures/insights.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set([
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);
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

function normalizeComplianceResult(result) {
  const value = unwrapServiceResult(
    result,
    'Compliance status could not be loaded.',
  );
  const status = isPlainObject(value?.compliance)
    ? value.compliance
    : isPlainObject(value?.status)
      ? value.status
      : value;

  if (
    !isPlainObject(status) ||
    !Array.isArray(status.implementedDemoBehavior) ||
    !status.implementedDemoBehavior.every(
      (item) =>
        typeof item === 'string' &&
        item.trim().length > 0,
    ) ||
    !Array.isArray(status.productionOnlyNotProvided) ||
    !status.productionOnlyNotProvided.every(
      (item) =>
        typeof item === 'string' &&
        item.trim().length > 0,
    ) ||
    !Array.isArray(status.identityContext) ||
    !status.identityContext.every(
      (item) =>
        typeof item === 'string' &&
        item.trim().length > 0,
    ) ||
    !Array.isArray(status.certificationsClaimed) ||
    status.certificationsClaimed.length !== 0 ||
    typeof status.disclosure !== 'string' ||
    status.disclosure.trim().length === 0
  ) {
    throw new TypeError(
      'The local compliance service returned invalid disclosure data.',
    );
  }

  return status;
}

function resolveStatusReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getStatus === 'function') {
    return service.getStatus.bind(service);
  }

  if (typeof service.getComplianceStatus === 'function') {
    return service.getComplianceStatus.bind(service);
  }

  if (typeof service.getCompliance === 'function') {
    return service.getCompliance.bind(service);
  }

  if (typeof service.read === 'function') {
    return service.read.bind(service);
  }

  return null;
}

/**
 * Honest compliance-status route for authorized internal demo roles.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   complianceFacade?: object,
 *   complianceService?: object,
 *   initialStatus?: Record<string, unknown>
 * }} props Component props.
 * @returns {JSX.Element} Compliance status page.
 */
export function CompliancePage({
  session = null,
  context = null,
  complianceFacade = null,
  complianceService = null,
  initialStatus = COMPLIANCE_STATUS_FIXTURE,
}) {
  const headingId = useId();
  const implementedHeadingId = useId();
  const productionHeadingId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service = complianceFacade ?? complianceService;
  const statusReader = useMemo(
    () => resolveStatusReader(service),
    [service],
  );
  const [complianceStatus, setComplianceStatus] =
    useState(initialStatus);
  const [loading, setLoading] = useState(
    statusReader !== null,
  );
  const [loadError, setLoadError] = useState(null);
  const [reloadSequence, setReloadSequence] = useState(0);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (statusReader === null) {
        setComplianceStatus(initialStatus);
        setLoadError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const result = await Promise.resolve(
          statusReader(accessContext),
        );
        const nextStatus = normalizeComplianceResult(result);

        if (active) {
          setComplianceStatus(nextStatus);
        }
      } catch (error) {
        if (active) {
          setComplianceStatus(initialStatus);
          setLoadError(
            normalizeErrorMessage(
              error,
              'Compliance status could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadStatus().catch((error) => {
      if (active) {
        setLoading(false);
        setComplianceStatus(initialStatus);
        setLoadError(
          normalizeErrorMessage(
            error,
            'Compliance status could not be loaded.',
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
    initialStatus,
    reloadSequence,
    role,
    statusReader,
  ]);

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  const implementedDemoBehavior = Array.isArray(
    complianceStatus?.implementedDemoBehavior,
  )
    ? complianceStatus.implementedDemoBehavior
    : EMPTY_COLLECTION;
  const productionOnlyNotProvided = Array.isArray(
    complianceStatus?.productionOnlyNotProvided,
  )
    ? complianceStatus.productionOnlyNotProvided
    : EMPTY_COLLECTION;
  const identityContext = Array.isArray(
    complianceStatus?.identityContext,
  )
    ? complianceStatus.identityContext
    : EMPTY_COLLECTION;
  const certificationsClaimed = Array.isArray(
    complianceStatus?.certificationsClaimed,
  )
    ? complianceStatus.certificationsClaimed
    : EMPTY_COLLECTION;
  const disclosure =
    typeof complianceStatus?.disclosure === 'string' &&
    complianceStatus.disclosure.trim().length > 0
      ? complianceStatus.disclosure
      : COMPLIANCE_STATUS_FIXTURE.disclosure;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <ShieldCheck
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Honest demonstration disclosure
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Compliance status
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Review what this browser-local frontend
                demonstration implements and which production
                security, identity, compliance, and operational
                controls it does not provide.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <StatusBadge
              status="DEMO_ONLY"
              variant="neutral"
              label="Demonstration only"
            />
            {statusReader !== null ? (
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
                  ? 'Loading status…'
                  : 'Refresh status'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
        role="note"
        aria-label="Compliance status disclosure"
      >
        <div className="flex items-start gap-3">
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              No certification or production-compliance claim
            </p>
            <p className="mt-1 leading-6">{disclosure}</p>
            <p className="mt-1 leading-6">
              Client-side controls and fictional fixtures must not
              be interpreted as HIPAA, SOC 2 Type II, PCI DSS, or
              other regulatory or security certification.
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
            {loadError} The bundled compliance disclosure is
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
          Loading browser-local compliance disclosures
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section
          className="overflow-hidden rounded-xl border border-success-200 bg-surface shadow-card dark:border-success-700 dark:bg-surface-dark-muted"
          aria-labelledby={implementedHeadingId}
        >
          <header className="border-b border-success-200 bg-success-50 p-5 dark:border-success-700 dark:bg-surface-dark sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-100 text-success-700 dark:bg-success-700 dark:text-white">
                <CheckCircle2
                  className="h-5 w-5"
                  aria-hidden="true"
                />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-success-700 dark:text-success-100">
                  Present in this frontend
                </p>
                <h2
                  id={implementedHeadingId}
                  className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
                >
                  Implemented demo behavior
                </h2>
                <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                  These behaviors support the fictional,
                  browser-local demonstration. They are not
                  production security or compliance controls.
                </p>
              </div>
            </div>
          </header>

          <ul className="space-y-3 p-5 sm:p-6">
            {implementedDemoBehavior.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-4 dark:border-border-dark dark:bg-surface-dark"
              >
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-success-700 dark:text-success-100"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium leading-6 text-content dark:text-content-inverse">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="overflow-hidden rounded-xl border border-danger-200 bg-surface shadow-card dark:border-danger-700 dark:bg-surface-dark-muted"
          aria-labelledby={productionHeadingId}
        >
          <header className="border-b border-danger-200 bg-danger-50 p-5 dark:border-danger-700 dark:bg-danger-950 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-700 dark:text-white">
                <XCircle
                  className="h-5 w-5"
                  aria-hidden="true"
                />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-danger-700 dark:text-danger-100">
                  Explicitly not provided
                </p>
                <h2
                  id={productionHeadingId}
                  className="mt-1 text-xl font-semibold text-content dark:text-content-inverse"
                >
                  Production-only controls
                </h2>
                <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                  These named controls, certifications, and
                  operational capabilities are outside this static
                  frontend demonstration.
                </p>
              </div>
            </div>
          </header>

          <div className="p-5 sm:p-6">
            <ul className="space-y-3">
              {productionOnlyNotProvided.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-4 dark:border-border-dark dark:bg-surface-dark"
                >
                  <XCircle
                    className="mt-0.5 h-5 w-5 shrink-0 text-danger-700 dark:text-danger-100"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium leading-6 text-content dark:text-content-inverse">
                    {item}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-6 border-t border-border pt-6 dark:border-border-dark">
              <div className="flex items-start gap-3">
                <KeyRound
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="font-semibold text-content dark:text-content-inverse">
                    Federated identity context
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                    Identity protocol names are shown only as
                    production context. This demo uses seeded local
                    personas and does not connect to an identity
                    provider.
                  </p>
                </div>
              </div>

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {identityContext.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm font-semibold text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>

      <aside
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        role="note"
        aria-label="Certification claim status"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-content dark:text-content-inverse">
              Certifications claimed: none
            </p>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              The compliance fixture contains{' '}
              <span className="font-semibold">
                {certificationsClaimed.length}
              </span>{' '}
              certification claims. All displayed controls,
              records, audits, monitoring values, and identity
              states are fictional browser-local demonstrations
              and can be modified through browser developer tools.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

CompliancePage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  complianceFacade: PropTypes.object,
  complianceService: PropTypes.object,
  initialStatus: PropTypes.object,
};

export const ComplianceStatusPage = CompliancePage;
export const HonestCompliancePage = CompliancePage;
export const LocalCompliancePage = CompliancePage;
export const GovernanceCompliancePage = CompliancePage;

export default CompliancePage;