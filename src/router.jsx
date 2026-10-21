import PropTypes from 'prop-types';
import {
  Suspense,
  lazy,
  useEffect,
} from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  FileQuestion,
  Loader2,
} from 'lucide-react';
import ErrorBoundary from './platform/components/ErrorBoundary.jsx';
import RouteGuard from './platform/components/RouteGuard.jsx';
import {
  ACTIONS,
  ROUTE_CAPABILITIES,
} from './platform/contracts/capabilities.js';

const SignInPage = lazy(
  () => import('./features/auth/pages/SignInPage.jsx'),
);
const ClaimPage = lazy(
  () => import('./features/discovery/pages/ClaimPage.jsx'),
);
const MemberPage = lazy(
  () => import('./features/discovery/pages/MemberPage.jsx'),
);
const SearchPage = lazy(
  () => import('./features/discovery/pages/SearchPage.jsx'),
);
const AdminPage = lazy(
  () => import('./features/governance/pages/AdminPage.jsx'),
);
const AuditPage = lazy(
  () => import('./features/governance/pages/AuditPage.jsx'),
);
const CompliancePage = lazy(
  () => import('./features/governance/pages/CompliancePage.jsx'),
);
const DataAdminPage = lazy(
  () => import('./features/governance/pages/DataAdminPage.jsx'),
);
const SnapshotsPage = lazy(
  () => import('./features/governance/pages/SnapshotsPage.jsx'),
);
const HomePage = lazy(
  () => import('./features/home/pages/HomePage.jsx'),
);
const NotFoundPage = lazy(
  () => import('./features/home/pages/NotFoundPage.jsx'),
);
const AssistantPage = lazy(
  () => import('./features/insights/pages/AssistantPage.jsx'),
);
const CsrDashboardPage = lazy(
  () => import('./features/insights/pages/CsrDashboardPage.jsx'),
);
const ExecutivePage = lazy(
  () => import('./features/insights/pages/ExecutivePage.jsx'),
);
const IntegrationsPage = lazy(
  () => import('./features/insights/pages/IntegrationsPage.jsx'),
);
const MonitoringPage = lazy(
  () => import('./features/insights/pages/MonitoringPage.jsx'),
);
const ProductivityPage = lazy(
  () => import('./features/insights/pages/ProductivityPage.jsx'),
);
const BatchPage = lazy(
  () => import('./features/operations/pages/BatchPage.jsx'),
);
const DocumentPage = lazy(
  () => import('./features/operations/pages/DocumentPage.jsx'),
);
const ErrorReportPage = lazy(
  () => import('./features/operations/pages/ErrorReportPage.jsx'),
);
const InboundPage = lazy(
  () => import('./features/operations/pages/InboundPage.jsx'),
);
const MemberDocumentsPage = lazy(
  () =>
    import(
      './features/operations/pages/MemberDocumentsPage.jsx'
    ),
);
const OperationsQueuePage = lazy(
  () =>
    import(
      './features/operations/pages/OperationsQueuePage.jsx'
    ),
);
const ReportsPage = lazy(
  () => import('./features/operations/pages/ReportsPage.jsx'),
);
const RequestNewPage = lazy(
  () => import('./features/operations/pages/RequestNewPage.jsx'),
);
const RequestProcessPage = lazy(
  () =>
    import(
      './features/operations/pages/RequestProcessPage.jsx'
    ),
);
const RequestResultPage = lazy(
  () =>
    import(
      './features/operations/pages/RequestResultPage.jsx'
    ),
);
const ReviewPage = lazy(
  () => import('./features/operations/pages/ReviewPage.jsx'),
);
const ReworkPage = lazy(
  () => import('./features/operations/pages/ReworkPage.jsx'),
);

const EMPTY_OBJECT = Object.freeze({});

export const ROUTE_PATHS = Object.freeze({
  SIGN_IN: '/signin',
  HOME: '/',
  CLAIMS: '/claims',
  CLAIM: '/claims/:claimNumber',
  MEMBER: '/members/:memberId',
  MEMBER_DOCUMENTS: '/documents',
  DOCUMENT: '/documents/:id',
  CSR_DASHBOARD: '/csr',
  ASSISTANT: '/assistant',
  MONITORING: '/monitoring',
  INTEGRATIONS: '/integrations',
  EXECUTIVE: '/executive',
  PRODUCTIVITY: '/productivity',
  COMPLIANCE: '/compliance',
  AUDIT: '/audit',
  ADMIN_USERS: '/admin/users',
  ADMIN_SETTINGS: '/admin/settings',
  ADMIN_SNAPSHOTS: '/admin/snapshots',
  ADMIN_DATA: '/admin/data',
  REQUEST_NEW: '/operations/requests/new',
  REQUEST_PROCESS: '/operations/requests/:id',
  REQUEST_RESULT: '/operations/requests/:id/result',
  INBOUND: '/operations/inbound',
  BATCH: '/operations/batch',
  REVIEWS: '/operations/reviews',
  REWORK: '/operations/rework',
  ERROR_REPORT: '/operations/errors/:id',
  OPERATIONS_QUEUE: '/operations/queue',
  REPORTS: '/operations/reports',
  HELP: '/help',
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

function getPageProps(pageProps, pageName) {
  const value = pageProps?.[pageName];

  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? value
    : EMPTY_OBJECT;
}

function RouteLoading() {
  return (
    <main
      className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6"
      aria-busy="true"
    >
      <section
        className="w-full rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="mt-3 font-medium text-content dark:text-content-inverse">
          Loading
        </p>
      </section>
    </main>
  );
}

function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 p-6 shadow-card dark:border-primary-800 dark:bg-primary-950 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white">
            <FileQuestion
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl">
              Help
            </h1>
            <p className="mt-3 text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Short explanations of an EOB, an EOR, and reason
              code 45. Customer service can continue in the
              scripted assistant.
            </p>
          </div>
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6">
        <h2 className="text-lg font-semibold text-content dark:text-content-inverse">
          EOB, EOR, and reason code 45
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
          <li className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            An EOB, Explanation of Benefits, shows what was billed,
            allowed, paid, and left as patient responsibility.
          </li>
          <li className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            An EOR, Explanation of Remittance, is the provider
            remittance advice with payment, adjustments, and
            CARC/RARC codes.
          </li>
          <li className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            Reason code 45 means deductible applied. On the sample
            EOB for CL2024001, that code is printed with the
            coverage summary.
          </li>
        </ul>
        <p className="mt-4 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
          Customer service and administrator sessions can open the
          scripted assistant to ask about code 45 and attach the
          answer to an inquiry.
        </p>
        <a
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          href="/assistant"
        >
          Open scripted assistant
        </a>
      </section>
    </main>
  );
}

function RoutedPage({
  Component,
  pageName,
  services,
  pageProps,
  session,
  context,
}) {
  const navigate = useNavigate();
  const suppliedProps = getPageProps(pageProps, pageName);
  const suppliedOnNavigate = suppliedProps.onNavigate;
  const suppliedOnSignedIn =
    suppliedProps.onSignedIn ?? suppliedProps.onSuccess;

  const handleNavigate = async (destination, event) => {
    if (typeof suppliedOnNavigate === 'function') {
      await Promise.resolve(
        suppliedOnNavigate(destination, event),
      );
      return;
    }

    const href =
      typeof destination === 'string'
        ? destination
        : destination?.href;

    if (typeof href !== 'string' || href.length === 0) {
      throw new Error(
        'The selected browser-local route does not have a destination.',
      );
    }

    event?.preventDefault?.();
    navigate(href);
  };

  const handleSignedIn = async (...argumentsList) => {
    if (typeof suppliedOnSignedIn === 'function') {
      await Promise.resolve(
        suppliedOnSignedIn(...argumentsList),
      );
    }

    const session = argumentsList[0];
    const role =
      session !== null &&
      typeof session === 'object' &&
      typeof session.role === 'string'
        ? session.role
        : '';

    const destinationByRole = {
      MEMBER: '/claims',
      CSR: '/csr',
      BOS: '/operations/queue',
      ITS: '/monitoring',
      ADMIN: '/admin/users',
    };

    navigate(destinationByRole[role] ?? '/');
  };

  return (
    <Component
      {...services}
      {...suppliedProps}
      session={session}
      context={context ?? session}
      onNavigate={handleNavigate}
      {...(pageName === 'signIn'
        ? { onSignedIn: handleSignedIn }
        : {})}
    />
  );
}

RoutedPage.propTypes = {
  Component: PropTypes.elementType.isRequired,
  pageName: PropTypes.string.isRequired,
  services: PropTypes.object.isRequired,
  pageProps: PropTypes.object.isRequired,
  session: PropTypes.object,
  context: PropTypes.object,
};

function GuardedPage({
  Component,
  pageName,
  permissionService,
  sessionProvider,
  session,
  context,
  services,
  pageProps,
  capability = ROUTE_CAPABILITIES.AUTHENTICATED,
  roles,
  action,
  resourceFactory,
}) {
  const params = useParams();
  const resource =
    typeof resourceFactory === 'function'
      ? resourceFactory(params, context ?? session)
      : null;

  return (
    <RouteGuard
      permissionService={permissionService}
      sessionProvider={sessionProvider}
      capability={capability}
      roles={roles}
      action={action}
      resource={resource}
    >
      <RoutedPage
        Component={Component}
        pageName={pageName}
        services={services}
        pageProps={pageProps}
        session={session}
        context={context}
      />
    </RouteGuard>
  );
}

GuardedPage.propTypes = {
  Component: PropTypes.elementType.isRequired,
  pageName: PropTypes.string.isRequired,
  permissionService: PropTypes.shape({
    evaluate: PropTypes.func.isRequired,
  }).isRequired,
  sessionProvider: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.object,
  ]),
  session: PropTypes.object,
  context: PropTypes.object,
  services: PropTypes.object.isRequired,
  pageProps: PropTypes.object.isRequired,
  capability: PropTypes.string,
  roles: PropTypes.arrayOf(PropTypes.string),
  action: PropTypes.string,
  resourceFactory: PropTypes.func,
};

function RouteTree({
  permissionService,
  sessionProvider,
  session,
  context,
  services,
  pageProps,
}) {
  const location = useLocation();
  const commonProps = {
    permissionService,
    sessionProvider,
    session,
    context,
    services,
    pageProps,
  };

  return (
    <ErrorBoundary resetKeys={[location.pathname]}>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route
            path={ROUTE_PATHS.SIGN_IN}
            element={
              <RoutedPage
                Component={SignInPage}
                pageName="signIn"
                services={services}
                pageProps={pageProps}
                session={session}
                context={context}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.HOME}
            element={
              <GuardedPage
                {...commonProps}
                Component={HomePage}
                pageName="home"
              />
            }
          />

          <Route
            path={ROUTE_PATHS.CLAIMS}
            element={
              <GuardedPage
                {...commonProps}
                Component={SearchPage}
                pageName="search"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.CLAIM}
            element={
              <GuardedPage
                {...commonProps}
                Component={ClaimPage}
                pageName="claim"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
                action={ACTIONS.CLAIM_VIEW}
                resourceFactory={(params) => ({
                  type: 'CLAIM',
                  id: params.claimNumber,
                  claimNumber: params.claimNumber,
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.MEMBER}
            element={
              <GuardedPage
                {...commonProps}
                Component={MemberPage}
                pageName="member"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
                action={ACTIONS.CLAIM_VIEW}
                resourceFactory={(params) => ({
                  type: 'CLAIM_COLLECTION',
                  id: params.memberId,
                  memberId: params.memberId,
                  ownerMemberId: params.memberId,
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.MEMBER_DOCUMENTS}
            element={
              <GuardedPage
                {...commonProps}
                Component={MemberDocumentsPage}
                pageName="memberDocuments"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER']}
                action={ACTIONS.DOCUMENT_VIEW}
                resourceFactory={(_params, actor) => ({
                  type: 'DOCUMENT_COLLECTION',
                  id: actor?.memberId ?? 'member-documents',
                  memberId: actor?.memberId,
                  ownerMemberId: actor?.memberId,
                  owned: actor?.memberId !== null,
                })}
              />
            }
          />

          <Route
            path="/my-documents"
            element={
              <Navigate
                to={ROUTE_PATHS.MEMBER_DOCUMENTS}
                replace
              />
            }
          />

          <Route
            path={ROUTE_PATHS.DOCUMENT}
            element={
              <GuardedPage
                {...commonProps}
                Component={DocumentPage}
                pageName="document"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
                action={ACTIONS.DOCUMENT_VIEW}
                resourceFactory={(params) => ({
                  type: 'DOCUMENT',
                  id: params.id,
                  documentId: params.id,
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.REQUEST_NEW}
            element={
              <GuardedPage
                {...commonProps}
                Component={RequestNewPage}
                pageName="requestNew"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.REQUEST_RESULT}
            element={
              <GuardedPage
                {...commonProps}
                Component={RequestResultPage}
                pageName="requestResult"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.REQUEST_PROCESS}
            element={
              <GuardedPage
                {...commonProps}
                Component={RequestProcessPage}
                pageName="requestProcess"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.INBOUND}
            element={
              <GuardedPage
                {...commonProps}
                Component={InboundPage}
                pageName="inbound"
                capability={ROUTE_CAPABILITIES.BOS_OPERATIONS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.OPERATIONAL_SUMMARY_VIEW}
                resourceFactory={() => ({
                  type: 'INBOUND_FIXTURE',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.BATCH}
            element={
              <GuardedPage
                {...commonProps}
                Component={BatchPage}
                pageName="batch"
                capability={ROUTE_CAPABILITIES.BOS_OPERATIONS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.OPERATIONAL_SUMMARY_VIEW}
                resourceFactory={() => ({
                  type: 'CLAIMS_OUTBOUND_BATCH',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.REVIEWS}
            element={
              <GuardedPage
                {...commonProps}
                Component={ReviewPage}
                pageName="reviews"
                capability={ROUTE_CAPABILITIES.BOS_OPERATIONS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.REPRINT_APPROVE}
                resourceFactory={() => ({
                  type: 'MANUAL_REVIEW_COLLECTION',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.REWORK}
            element={
              <GuardedPage
                {...commonProps}
                Component={ReworkPage}
                pageName="rework"
                capability={ROUTE_CAPABILITIES.BOS_OPERATIONS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.REPRINT_APPROVE}
                resourceFactory={() => ({
                  type: 'CLAIM_REWORK',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.ERROR_REPORT}
            element={
              <GuardedPage
                {...commonProps}
                Component={ErrorReportPage}
                pageName="errorReport"
                roles={['BOS', 'ITS', 'ADMIN']}
                action={ACTIONS.OPERATIONAL_SUMMARY_VIEW}
                resourceFactory={(params) => ({
                  type: 'ERROR_REPORT',
                  id: params.id,
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.OPERATIONS_QUEUE}
            element={
              <GuardedPage
                {...commonProps}
                Component={OperationsQueuePage}
                pageName="operationsQueue"
                capability={ROUTE_CAPABILITIES.BOS_OPERATIONS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.OPERATIONAL_SUMMARY_VIEW}
                resourceFactory={() => ({
                  type: 'OPERATIONS_QUEUE',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.REPORTS}
            element={
              <GuardedPage
                {...commonProps}
                Component={ReportsPage}
                pageName="reports"
                capability={ROUTE_CAPABILITIES.MEMBER_CLAIMS}
                roles={['MEMBER', 'CSR', 'BOS', 'ADMIN']}
              />
            }
          />

          <Route
            path="/reports"
            element={
              <Navigate
                to={ROUTE_PATHS.REPORTS}
                replace
              />
            }
          />

          <Route
            path={ROUTE_PATHS.CSR_DASHBOARD}
            element={
              <GuardedPage
                {...commonProps}
                Component={CsrDashboardPage}
                pageName="csrDashboard"
                capability={ROUTE_CAPABILITIES.CSR_OPERATIONS}
                roles={['CSR', 'ADMIN']}
                action={ACTIONS.OPERATIONAL_SUMMARY_VIEW}
                resourceFactory={() => ({
                  type: 'CSR_DASHBOARD',
                  id: 'representative',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.ASSISTANT}
            element={
              <GuardedPage
                {...commonProps}
                Component={AssistantPage}
                pageName="assistant"
                capability={ROUTE_CAPABILITIES.CSR_ASSISTANT}
                roles={['CSR', 'ADMIN']}
                action={ACTIONS.ASSISTANT_RESPOND}
                resourceFactory={() => ({
                  type: 'SCRIPTED_ASSISTANT',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.MONITORING}
            element={
              <GuardedPage
                {...commonProps}
                Component={MonitoringPage}
                pageName="monitoring"
                capability={ROUTE_CAPABILITIES.MONITORING_DASHBOARD}
                roles={['ITS', 'ADMIN']}
                action={ACTIONS.MONITORING_VIEW}
                resourceFactory={() => ({
                  type: 'MONITORING_DASHBOARD',
                  id: 'simulated',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.INTEGRATIONS}
            element={
              <GuardedPage
                {...commonProps}
                Component={IntegrationsPage}
                pageName="integrations"
                capability={ROUTE_CAPABILITIES.INTEGRATION_INVENTORY}
                roles={['ITS', 'ADMIN']}
                action={ACTIONS.INTEGRATION_INVENTORY_VIEW}
                resourceFactory={() => ({
                  type: 'INTEGRATION_INVENTORY',
                  id: 'simulated',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.EXECUTIVE}
            element={
              <GuardedPage
                {...commonProps}
                Component={ExecutivePage}
                pageName="executive"
                capability={ROUTE_CAPABILITIES.EXECUTIVE_INSIGHTS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.EXECUTIVE_INSIGHTS_VIEW}
                resourceFactory={() => ({
                  type: 'EXECUTIVE_INSIGHTS',
                  id: 'published',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.PRODUCTIVITY}
            element={
              <GuardedPage
                {...commonProps}
                Component={ProductivityPage}
                pageName="productivity"
                capability={ROUTE_CAPABILITIES.PRODUCTIVITY_INSIGHTS}
                roles={['BOS', 'ADMIN']}
                action={ACTIONS.PRODUCTIVITY_INSIGHTS_VIEW}
                resourceFactory={() => ({
                  type: 'PRODUCTIVITY_INSIGHTS',
                  id: 'published',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.COMPLIANCE}
            element={
              <GuardedPage
                {...commonProps}
                Component={CompliancePage}
                pageName="compliance"
                capability={ROUTE_CAPABILITIES.COMPLIANCE_STATUS}
                roles={['CSR', 'BOS', 'ITS', 'ADMIN']}
                action={ACTIONS.COMPLIANCE_STATUS_VIEW}
                resourceFactory={() => ({
                  type: 'COMPLIANCE_STATUS',
                  id: 'demo',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.AUDIT}
            element={
              <GuardedPage
                {...commonProps}
                Component={AuditPage}
                pageName="audit"
                capability={ROUTE_CAPABILITIES.AUDIT_HISTORY}
                roles={['ITS', 'ADMIN']}
                action={ACTIONS.AUDIT_VIEW}
                resourceFactory={() => ({
                  type: 'AUDIT',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path="/admin"
            element={
              <Navigate
                to={ROUTE_PATHS.ADMIN_USERS}
                replace
              />
            }
          />

          <Route
            path={ROUTE_PATHS.ADMIN_USERS}
            element={
              <GuardedPage
                {...commonProps}
                Component={AdminPage}
                pageName="adminUsers"
                capability={ROUTE_CAPABILITIES.USER_ADMINISTRATION}
                roles={['ADMIN']}
                action={ACTIONS.USER_LIST}
                resourceFactory={() => ({
                  type: 'USER_COLLECTION',
                  id: 'users',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.ADMIN_SETTINGS}
            element={
              <GuardedPage
                {...commonProps}
                Component={AdminPage}
                pageName="adminSettings"
                capability={
                  ROUTE_CAPABILITIES.SETTINGS_ADMINISTRATION
                }
                roles={['ITS', 'ADMIN']}
                action={ACTIONS.SETTINGS_VIEW}
                resourceFactory={() => ({
                  type: 'SETTINGS',
                  id: 'global',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.ADMIN_SNAPSHOTS}
            element={
              <GuardedPage
                {...commonProps}
                Component={SnapshotsPage}
                pageName="snapshots"
                roles={['ITS', 'ADMIN']}
                action={ACTIONS.SNAPSHOT_EXPORT}
                resourceFactory={() => ({
                  type: 'SNAPSHOT',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.ADMIN_DATA}
            element={
              <GuardedPage
                {...commonProps}
                Component={DataAdminPage}
                pageName="dataAdmin"
                roles={['CSR', 'BOS', 'ITS', 'ADMIN']}
                action={ACTIONS.OPERATIONAL_SUMMARY_VIEW}
                resourceFactory={() => ({
                  type: 'LOCAL_DATA_ADMINISTRATION',
                  id: 'local',
                })}
              />
            }
          />

          <Route
            path={ROUTE_PATHS.HELP}
            element={<HelpPage />}
          />

          <Route
            path="*"
            element={
              <RoutedPage
                Component={NotFoundPage}
                pageName="notFound"
                services={services}
                pageProps={pageProps}
                session={session}
                context={context}
              />
            }
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

RouteTree.propTypes = {
  permissionService: PropTypes.shape({
    evaluate: PropTypes.func.isRequired,
  }).isRequired,
  sessionProvider: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.object,
  ]),
  session: PropTypes.object,
  context: PropTypes.object,
  services: PropTypes.object.isRequired,
  pageProps: PropTypes.object.isRequired,
};

/**
 * Browser route composition for the claims explanation simulator.
 *
 * @param {{
 *   permissionService: object,
 *   sessionProvider?: object|Function,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   services?: Record<string, unknown>,
 *   pageProps?: Record<string, Record<string, unknown>>,
 *   basename?: string
 * }} props Router props.
 * @returns {JSX.Element} Browser router.
 */
function RoutePathReporter({ onPathChange }) {
  const location = useLocation();

  useEffect(() => {
    if (typeof onPathChange === 'function') {
      onPathChange(location.pathname);
    }
  }, [location.pathname, onPathChange]);

  return null;
}

RoutePathReporter.propTypes = {
  onPathChange: PropTypes.func,
};

export function ApplicationRouter({
  permissionService,
  sessionProvider,
  session = null,
  context = null,
  services = EMPTY_OBJECT,
  pageProps = EMPTY_OBJECT,
  basename,
  onPathChange,
  frame,
}) {
  const resolvedSessionProvider =
    sessionProvider ??
    services.authFacade ??
    services.sessionManager ??
    undefined;
  const routes = (
    <>
      <RoutePathReporter onPathChange={onPathChange} />
      <RouteTree
        permissionService={permissionService}
        sessionProvider={resolvedSessionProvider}
        session={session}
        context={context}
        services={services}
        pageProps={pageProps}
      />
    </>
  );

  return (
    <BrowserRouter basename={basename}>
      {typeof frame === 'function' ? frame(routes) : routes}
    </BrowserRouter>
  );
}

ApplicationRouter.propTypes = {
  permissionService: PropTypes.shape({
    evaluate: PropTypes.func.isRequired,
  }).isRequired,
  sessionProvider: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.object,
  ]),
  session: PropTypes.object,
  context: PropTypes.object,
  services: PropTypes.object,
  pageProps: PropTypes.object,
  basename: PropTypes.string,
  onPathChange: PropTypes.func,
  frame: PropTypes.func,
};

export function ApplicationRoutes(props) {
  return <RouteTree {...props} />;
}

ApplicationRoutes.propTypes = RouteTree.propTypes;

export const AppRouter = ApplicationRouter;
export const BrowserAppRouter = ApplicationRouter;
export const Router = ApplicationRouter;
export const RouterLoading = RouteLoading;
export const normalizeRouterErrorMessage =
  normalizeErrorMessage;

export default ApplicationRouter;