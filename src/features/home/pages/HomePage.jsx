import PropTypes from 'prop-types';
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  ClipboardList,
  FileSearch,
  FileText,
  Headphones,
  HeartHandshake,
  LayoutDashboard,
  MonitorCog,
  Settings,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { isPlatformRole } from '../../../platform/validation/schemas.js';

const ROLE_CONTENT = Object.freeze({
  MEMBER: Object.freeze({
    label: 'Member',
    heading: 'Your claims and documents',
    description:
      'Review fictional claims and create browser-local document reprint requests.',
    Icon: HeartHandshake,
  }),
  CSR: Object.freeze({
    label: 'Customer Service Representative',
    heading: 'Member support workspace',
    description:
      'Use representative claim tools and scripted support resources for fictional member inquiries.',
    Icon: Headphones,
  }),
  BOS: Object.freeze({
    label: 'Business Operations Specialist',
    heading: 'Operations workspace',
    description:
      'Manage deterministic request queues, reviews, inbound fixtures, and batch demonstrations.',
    Icon: BriefcaseBusiness,
  }),
  ITS: Object.freeze({
    label: 'IT Support Specialist',
    heading: 'Platform support workspace',
    description:
      'Explore simulated monitoring, integration inventory, audit history, and platform settings.',
    Icon: MonitorCog,
  }),
  ADMIN: Object.freeze({
    label: 'Administrator',
    heading: 'Administration workspace',
    description:
      'Manage fictional users, local settings, snapshots, and audit history.',
    Icon: ShieldCheck,
  }),
});

const JOURNEYS = Object.freeze([
  Object.freeze({
    id: 'member-claims',
    roles: Object.freeze(['MEMBER']),
    title: 'View my claims',
    description:
      'Find fictional claims associated with the current demo member.',
    href: '/claims',
    actionLabel: 'Open claims',
    Icon: FileSearch,
  }),
  Object.freeze({
    id: 'member-reprint',
    roles: Object.freeze(['MEMBER']),
    title: 'Request an EOB or EOR',
    description:
      'Create a browser-local reprint request for an eligible fictional claim.',
    href: '/operations/requests/new',
    actionLabel: 'Create request',
    Icon: FileText,
  }),
  Object.freeze({
    id: 'member-documents',
    roles: Object.freeze(['MEMBER']),
    title: 'Review documents',
    description:
      'Open representative document versions from completed local requests.',
    href: '/claims',
    actionLabel: 'Find documents',
    Icon: ClipboardList,
  }),
  Object.freeze({
    id: 'csr-dashboard',
    roles: Object.freeze(['CSR']),
    title: 'Support dashboard',
    description:
      'Review representative request activity, alerts, and support metrics.',
    href: '/csr',
    actionLabel: 'Open dashboard',
    Icon: LayoutDashboard,
  }),
  Object.freeze({
    id: 'csr-claims',
    roles: Object.freeze(['CSR']),
    title: 'Find a member claim',
    description:
      'Search accessible fictional members and claims for support workflows.',
    href: '/claims',
    actionLabel: 'Search claims',
    Icon: FileSearch,
  }),
  Object.freeze({
    id: 'csr-assistant',
    roles: Object.freeze(['CSR']),
    title: 'Scripted assistant',
    description:
      'Use prewritten EOB and EOR explanations without a model or network call.',
    href: '/assistant',
    actionLabel: 'Open assistant',
    Icon: Headphones,
  }),
  Object.freeze({
    id: 'bos-queue',
    roles: Object.freeze(['BOS']),
    title: 'Operations queue',
    description:
      'Filter, process, and export representative browser-local request rows.',
    href: '/operations/queue',
    actionLabel: 'Open queue',
    Icon: ClipboardList,
  }),
  Object.freeze({
    id: 'bos-reviews',
    roles: Object.freeze(['BOS']),
    title: 'Manual reviews',
    description:
      'Decide deterministic review scenarios and apply allowlisted fixture adjustments.',
    href: '/operations/reviews',
    actionLabel: 'Open reviews',
    Icon: FileSearch,
  }),
  Object.freeze({
    id: 'bos-batch',
    roles: Object.freeze(['BOS']),
    title: 'Claims outbound batch',
    description:
      'Run the ten-step local batch and retry eligible fictional rows.',
    href: '/operations/batch',
    actionLabel: 'Open batch',
    Icon: Activity,
  }),
  Object.freeze({
    id: 'bos-inbound',
    roles: Object.freeze(['BOS']),
    title: 'Inbound fixtures',
    description:
      'Apply approved AP reprint and 835 scenarios without uploading real data.',
    href: '/operations/inbound',
    actionLabel: 'Open inbound',
    Icon: Upload,
  }),
  Object.freeze({
    id: 'its-monitoring',
    roles: Object.freeze(['ITS']),
    title: 'Simulated monitoring',
    description:
      'View deterministic health metrics, events, alerts, and playback.',
    href: '/monitoring',
    actionLabel: 'Open monitoring',
    Icon: Activity,
  }),
  Object.freeze({
    id: 'its-integrations',
    roles: Object.freeze(['ITS']),
    title: 'Integration inventory',
    description:
      'Review exact simulated architecture layers and disconnected integrations.',
    href: '/integrations',
    actionLabel: 'View inventory',
    Icon: MonitorCog,
  }),
  Object.freeze({
    id: 'its-audit',
    roles: Object.freeze(['ITS']),
    title: 'Audit history',
    description:
      'Query and export role-scoped, defensively masked local audit events.',
    href: '/audit',
    actionLabel: 'Open audit history',
    Icon: ClipboardList,
  }),
  Object.freeze({
    id: 'its-settings',
    roles: Object.freeze(['ITS']),
    title: 'Platform settings',
    description:
      'Review and update permitted browser-local demonstration settings.',
    href: '/admin/settings',
    actionLabel: 'Open settings',
    Icon: Settings,
  }),
  Object.freeze({
    id: 'admin-users',
    roles: Object.freeze(['ADMIN']),
    title: 'Fictional users',
    description:
      'Create and manage non-seeded browser-local demonstration users.',
    href: '/admin/users',
    actionLabel: 'Manage users',
    Icon: Users,
  }),
  Object.freeze({
    id: 'admin-settings',
    roles: Object.freeze(['ADMIN']),
    title: 'Application settings',
    description:
      'Update or restore revision-safe demonstration settings.',
    href: '/admin/settings',
    actionLabel: 'Manage settings',
    Icon: Settings,
  }),
  Object.freeze({
    id: 'admin-snapshots',
    roles: Object.freeze(['ADMIN']),
    title: 'Snapshot management',
    description:
      'Validate, apply, export, or restore browser-local fictional data.',
    href: '/admin/snapshots',
    actionLabel: 'Manage snapshots',
    Icon: Upload,
  }),
  Object.freeze({
    id: 'admin-audit',
    roles: Object.freeze(['ADMIN']),
    title: 'Audit history',
    description:
      'Review masked local events for demonstration administration actions.',
    href: '/audit',
    actionLabel: 'Open audit history',
    Icon: ClipboardList,
  }),
]);

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function resolveActor(session, role, persona, displayName) {
  const source =
    session !== null && typeof session === 'object'
      ? session
      : {};
  const resolvedRole =
    normalizeRole(role) ?? normalizeRole(source.role);

  return Object.freeze({
    role: resolvedRole,
    displayName:
      typeof displayName === 'string' &&
      displayName.trim().length > 0
        ? displayName.normalize('NFC').trim()
        : typeof source.displayName === 'string' &&
            source.displayName.trim().length > 0
          ? source.displayName.normalize('NFC').trim()
          : typeof persona === 'string' &&
              persona.trim().length > 0
            ? persona.normalize('NFC').trim()
            : 'Demo user',
  });
}

/**
 * Role-aware launch page for the browser-local claims demonstration.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   role?: string,
 *   persona?: string,
 *   displayName?: string,
 *   onNavigate?: Function
 * }} props Component props.
 * @returns {JSX.Element} Persona home page.
 */
export function HomePage({
  session = null,
  role,
  persona,
  displayName,
  onNavigate,
}) {
  const actor = resolveActor(
    session,
    role,
    persona,
    displayName,
  );
  const roleContent =
    actor.role === null ? null : ROLE_CONTENT[actor.role];
  const journeys =
    actor.role === null
      ? []
      : JOURNEYS.filter((journey) =>
          journey.roles.includes(actor.role),
        );
  const RoleIcon = roleContent?.Icon ?? ShieldCheck;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
      <section
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby="home-heading"
      >
        <div className="grid gap-6 px-5 py-7 sm:px-8 sm:py-9 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
                <RoleIcon
                  className="h-6 w-6"
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                  {roleContent?.label ?? 'Demo persona'}
                </p>
                <p className="truncate text-sm text-primary-900 dark:text-primary-100">
                  Signed in as {actor.displayName}
                </p>
              </div>
            </div>

            <h1
              id="home-heading"
              className="mt-5 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              {roleContent?.heading ?? 'Welcome'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              {roleContent?.description ??
                'Select an authorized demo persona to view available browser-local journeys.'}
            </p>
          </div>

          {actor.role !== null ? (
            <div className="rounded-xl border border-primary-200 bg-surface/80 px-4 py-3 dark:border-primary-800 dark:bg-surface-dark-muted">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                Current demo role
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-primary-700 dark:text-primary-300">
                {actor.role}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className="mt-8"
        aria-labelledby="journeys-heading"
      >
        <div>
          <h2
            id="journeys-heading"
            className="text-xl font-semibold text-content dark:text-content-inverse"
          >
            Available journeys
          </h2>
          <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
            Only launch points permitted for the current demo role
            are shown.
          </p>
        </div>

        {journeys.length > 0 ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {journeys.map((journey) => {
              const JourneyIcon = journey.Icon;

              return (
                <a
                  key={journey.id}
                  className="group flex min-h-52 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 motion-reduce:transform-none dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                  href={journey.href}
                  onClick={(event) => {
                    if (typeof onNavigate === 'function') {
                      onNavigate(journey, event);
                    }
                  }}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                    <JourneyIcon
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-content dark:text-content-inverse">
                    {journey.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                    {journey.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300 dark:group-hover:text-primary-100">
                    {journey.actionLabel}
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                      aria-hidden="true"
                    />
                  </span>
                </a>
              );
            })}
          </div>
        ) : (
          <div
            className="mt-5 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <ShieldCheck
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No persona journeys available
            </h3>
            <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
              Sign in with a supported seeded persona to view
              authorized launch points.
            </p>
          </div>
        )}
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="simulation-scope-heading"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
            <ShieldCheck
              className="h-5 w-5"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <h2
              id="simulation-scope-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Simulation scope
            </h2>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              This application uses prepackaged fictional fixtures
              and deterministic browser-local workflows. Demo role
              checks are client-side and are not production
              authentication or authorization.
            </p>

            <ul className="mt-4 grid gap-3 text-sm text-content-muted dark:text-content-inverse-muted sm:grid-cols-3">
              <li className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                <span className="block font-semibold text-content dark:text-content-inverse">
                  Fictional records
                </span>
                No real member, claim, provider, or payment data is
                included.
              </li>
              <li className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                <span className="block font-semibold text-content dark:text-content-inverse">
                  No external transmission
                </span>
                No payer, healthcare, monitoring, or integration
                system is contacted.
              </li>
              <li className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                <span className="block font-semibold text-content dark:text-content-inverse">
                  Representative documents
                </span>
                Documents are static samples and are not
                authoritative claim records.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

HomePage.propTypes = {
  session: PropTypes.shape({
    displayName: PropTypes.string,
    role: PropTypes.string,
  }),
  role: PropTypes.string,
  persona: PropTypes.string,
  displayName: PropTypes.string,
  onNavigate: PropTypes.func,
};

export const PersonaHomePage = HomePage;
export const RoleAwareHomePage = HomePage;

export default HomePage;