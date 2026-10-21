import {
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import PropTypes from 'prop-types';
import {
  AlertTriangle,
  Database,
  ShieldCheck,
} from 'lucide-react';
import ApplicationRouter from './router.jsx';
import ErrorBoundary from './platform/components/ErrorBoundary.jsx';
import AppShell from './platform/components/AppShell.jsx';
import { SEEDED_ACCOUNTS } from './fixtures/accounts.js';
import {
  APP_VERSION,
  FIXTURE_VERSION,
} from './platform/config/constants.js';
import { assertFixtureIntegrity } from './platform/validation/fixtureValidator.js';
import {
  createStorageGateway,
} from './platform/persistence/storageGateway.js';
import { createPlatformStore } from './platform/stores/platformStore.js';
import { createAuditRepository } from './platform/repositories/auditRepository.js';
import { createFixtureRepository } from './platform/repositories/fixtureRepository.js';
import { createInsightsRepository } from './platform/repositories/insightsRepository.js';
import { createSettingsRepository } from './platform/repositories/settingsRepository.js';
import { createUiPreferenceRepository } from './platform/repositories/uiPreferenceRepository.js';
import { createUserRepository } from './platform/repositories/userRepository.js';
import { createAuditService } from './platform/services/auditService.js';
import { createAdminFacade } from './platform/services/adminFacade.js';
import { createAssistantFacade } from './platform/services/assistantFacade.js';
import { createAuditFacade } from './platform/services/auditFacade.js';
import { createAuthFacade } from './platform/services/authFacade.js';
import { createComplianceFacade } from './platform/services/complianceFacade.js';
import { createDiscoveryService } from './platform/services/discoveryService.js';
import { createInsightsFacade } from './platform/services/insightsFacade.js';
import { createIntegrationInventoryFacade } from './platform/services/integrationInventoryFacade.js';
import { createMonitoringFacade } from './platform/services/monitoringFacade.js';
import { createPermissionService } from './platform/services/permissionService.js';
import { createSessionManager } from './platform/services/sessionManager.js';
import {
  SNAPSHOT_CONFIRMATIONS,
  createSnapshotFacade,
} from './platform/services/snapshotFacade.js';
import { useSession } from './platform/hooks/useSession.js';
import { createOperationsRepository } from './features/operations/repositories/operationsRepository.js';
import { createOperationsStore } from './features/operations/stores/operationsStore.js';
import { createBatchService } from './features/operations/services/batchService.js';
import { createBulkOperationService } from './features/operations/services/bulkOperationService.js';
import { createCsvFixtureParser } from './features/operations/services/csvFixtureParser.js';
import { createDocumentVersionService } from './features/operations/services/documentVersionService.js';
import { createErrorReportService } from './features/operations/services/errorReportService.js';
import { createInboundService } from './features/operations/services/inboundService.js';
import { createOutboundService } from './features/operations/services/outboundService.js';
import { createPipelineOrchestrator } from './features/operations/services/pipelineOrchestrator.js';
import { createRequestService } from './features/operations/services/requestService.js';
import { createReviewService } from './features/operations/services/reviewService.js';
import { createValidationEngine } from './features/operations/services/validationEngine.js';
import { createCompletedReportProvider } from './features/operations/contracts/completedReportProvider.js';
import { createProcessingSummaryProvider } from './features/operations/contracts/processingSummaryProvider.js';
import './features/operations/services/operationsResetParticipant.js';

const EMPTY_OBJECT = Object.freeze({});
const NOOP_UNSUBSCRIBE = () => {};

const NAVIGATION_ITEMS = Object.freeze([
  Object.freeze({
    id: 'home',
    label: 'Home',
    href: '/',
    end: true,
  }),
  Object.freeze({
    id: 'claims',
    label: 'Claims',
    href: '/claims',
    roles: ['MEMBER', 'CSR', 'BOS', 'ADMIN'],
  }),
  Object.freeze({
    id: 'documents',
    label: 'Documents',
    href: '/documents',
    roles: ['MEMBER'],
  }),
  Object.freeze({
    id: 'csr',
    label: 'Support',
    href: '/csr',
    roles: ['CSR', 'ADMIN'],
  }),
  Object.freeze({
    id: 'operations',
    label: 'Operations',
    href: '/operations/queue',
    roles: ['BOS', 'ADMIN'],
  }),
  Object.freeze({
    id: 'monitoring',
    label: 'Monitoring',
    href: '/monitoring',
    roles: ['ITS', 'ADMIN'],
  }),
  Object.freeze({
    id: 'audit',
    label: 'Audit',
    href: '/audit',
    roles: ['ITS', 'ADMIN'],
  }),
  Object.freeze({
    id: 'administration',
    label: 'Administration',
    href: '/admin/users',
    roles: ['ADMIN'],
  }),
]);

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createStorageComposition() {
  const persistentGateway = createStorageGateway();
  const readResult = persistentGateway.safeRead();

  if (readResult.ok) {
    return {
      gateway: persistentGateway,
      storageFallback: false,
      storageError: null,
    };
  }

  persistentGateway.destroy();

  return {
    gateway: createStorageGateway({
      storage: createMemoryStorage(),
      broadcastChannelFactory: null,
    }),
    storageFallback: true,
    storageError: readResult.error,
  };
}

function enrichSession(session) {
  if (
    session === null ||
    typeof session !== 'object'
  ) {
    return null;
  }

  const account = SEEDED_ACCOUNTS.find(
    (candidate) => candidate.userId === session.userId,
  );

  return Object.freeze({
    ...session,
    memberId:
      account?.memberId ??
      session.memberId ??
      null,
  });
}

function enrichSessionEvent(event) {
  if (
    event === null ||
    typeof event !== 'object'
  ) {
    return event;
  }

  return Object.freeze({
    ...event,
    session: enrichSession(event.session),
  });
}

function createEnrichedAuthFacade(authFacade) {
  return Object.freeze({
    async signIn(command) {
      const result = await authFacade.signIn(command);

      if (result?.ok !== true) {
        return result;
      }

      return Object.freeze({
        ...result,
        data: Object.freeze({
          ...result.data,
          session: enrichSession(result.data?.session),
        }),
      });
    },
    signOut(reason) {
      return authFacade.signOut(reason);
    },
    getSession() {
      return enrichSession(authFacade.getSession());
    },
    subscribeSession(listener) {
      return authFacade.subscribeSession((event) => {
        listener(enrichSessionEvent(event));
      });
    },
    subscribe(listener) {
      return this.subscribeSession(listener);
    },
  });
}

function createRelationshipProvider(
  fixtureRepository,
  operationsRepository,
) {
  const resolveOwner = (resource) => {
    if (
      resource === null ||
      typeof resource !== 'object'
    ) {
      return null;
    }

    const directOwner =
      resource.ownerMemberId ?? resource.memberId;

    if (
      typeof directOwner === 'string' &&
      directOwner.length > 0
    ) {
      return directOwner;
    }

    const claimNumber =
      resource.claimNumber ??
      (resource.type === 'CLAIM' ? resource.id : null);

    if (typeof claimNumber === 'string') {
      return fixtureRepository.getClaimByNumber(
        claimNumber,
      )?.memberId ?? null;
    }

    const documentId =
      resource.documentId ??
      (resource.type === 'DOCUMENT' ? resource.id : null);

    if (typeof documentId === 'string') {
      return operationsRepository.getDocumentById(
        documentId,
      )?.memberId ?? null;
    }

    return null;
  };

  return Object.freeze({
    isClaimOwnedByMember(memberId, resource) {
      return resolveOwner(resource) === memberId;
    },
    isDocumentOwnedByMember(memberId, resource) {
      return resolveOwner(resource) === memberId;
    },
    isResourceOwnedByMember(memberId, resource) {
      return resolveOwner(resource) === memberId;
    },
  });
}

function createApplicationComposition() {
  assertFixtureIntegrity();

  const storage = createStorageComposition();
  const { gateway } = storage;
  const platformStore = createPlatformStore(gateway);
  const fixtureRepository = createFixtureRepository(gateway);
  const operationsRepository =
    createOperationsRepository(gateway);
  const operationsStore = createOperationsStore(
    operationsRepository,
  );
  const auditRepository = createAuditRepository(gateway);
  const settingsRepository =
    createSettingsRepository(gateway);
  const userRepository = createUserRepository(gateway);
  const uiPreferenceRepository =
    createUiPreferenceRepository(gateway);
  const insightsRepository =
    createInsightsRepository(gateway);
  const sessionManager = createSessionManager(gateway);
  const auditService = createAuditService(auditRepository);
  const baseAuthFacade = createAuthFacade(sessionManager, {
    auditService,
  });
  const authFacade = createEnrichedAuthFacade(baseAuthFacade);
  const relationshipProvider = createRelationshipProvider(
    fixtureRepository,
    operationsRepository,
  );
  const permissionService = createPermissionService({
    sessionProvider: authFacade,
    relationshipProvider,
  });
  const validationEngine = createValidationEngine();
  const documentVersionService =
    createDocumentVersionService(operationsRepository, {
      fixtureGateway: fixtureRepository,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    });
  const outboundService = createOutboundService(
    operationsRepository,
    {
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    },
  );
  const pipelineOrchestrator =
    createPipelineOrchestrator(operationsRepository, {
      validationEngine,
      fixtureGateway: fixtureRepository,
      documentVersionService,
      outboundService,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    });
  const requestService = createRequestService(
    operationsRepository,
    {
      fixtureGateway: fixtureRepository,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
      processRequest: (command, context) =>
        pipelineOrchestrator.processRequest(command, context),
    },
  );
  const csvParser = createCsvFixtureParser();
  const inboundService = createInboundService(
    operationsRepository,
    {
      csvParser,
      requestService,
      fixtureGateway: fixtureRepository,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    },
  );
  const batchService = createBatchService(
    operationsRepository,
    {
      requestService,
      pipelineOrchestrator,
      fixtureGateway: fixtureRepository,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    },
  );
  const reviewService = createReviewService(
    operationsRepository,
    {
      fixtureGateway: fixtureRepository,
      pipelineOrchestrator,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    },
  );
  const bulkOperationService =
    createBulkOperationService(operationsRepository, {
      pipelineOrchestrator,
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    });
  const errorReportService =
    createErrorReportService(operationsRepository, {
      permissionGateway: permissionService,
      auditService,
      sessionProvider: authFacade,
    });
  const completedReportProvider =
    createCompletedReportProvider(operationsRepository, {
      contextProvider: authFacade,
    });
  const processingSummaryProvider =
    createProcessingSummaryProvider(operationsRepository);
  const discoveryService = createDiscoveryService(
    fixtureRepository,
    {
      contextProvider: authFacade,
    },
  );
  const adminFacade = createAdminFacade(userRepository, {
    settingsRepository,
    permissionService,
    auditService,
    sessionProvider: authFacade,
    defaultSettings: platformStore.getSnapshot().settings,
  });
  const auditFacade = createAuditFacade(auditRepository, {
    permissionService,
    auditService,
    sessionProvider: authFacade,
  });
  const insightsFacade = createInsightsFacade(
    insightsRepository,
    {
      permissionService,
    },
  );
  const monitoringFacade = createMonitoringFacade(
    insightsRepository,
    {
      permissionService,
      uiPreferenceRepository,
    },
  );
  const integrationInventoryFacade =
    createIntegrationInventoryFacade(insightsRepository, {
      permissionService,
    });
  const assistantFacade = createAssistantFacade(
    insightsRepository,
    {
      inquiryRepository: insightsRepository,
      permissionService,
      auditService,
      sessionProvider: authFacade,
    },
  );
  const complianceFacade = createComplianceFacade(
    insightsRepository,
    {
      permissionService,
    },
  );
  const snapshotFacade = createSnapshotFacade(
    platformStore,
    {
      permissionService,
      auditService,
      sessionProvider: authFacade,
    },
  );

  const services = Object.freeze({
    adminFacade,
    adminService: adminFacade,
    assistantFacade,
    assistantService: assistantFacade,
    auditFacade,
    auditService: auditFacade,
    authFacade,
    batchService,
    bulkOperationService,
    completedReportProvider,
    complianceFacade,
    complianceService: complianceFacade,
    csvParser,
    discoveryService,
    documentService: documentVersionService,
    documentVersionService,
    errorReportService,
    fixtureGateway: fixtureRepository,
    fixtureRepository,
    inboundService,
    insightsFacade,
    insightsRepository,
    insightsService: insightsFacade,
    integrationInventoryFacade,
    integrationFacade: integrationInventoryFacade,
    monitoringFacade,
    monitoringService: monitoringFacade,
    operationsRepository,
    operationsStore,
    outboundService,
    permissionService,
    pipelineOrchestrator,
    pipelineService: pipelineOrchestrator,
    processingSummaryProvider,
    queueService: bulkOperationService,
    reportProvider: completedReportProvider,
    requestService,
    reviewService,
    settingsService: adminFacade,
    snapshotFacade,
    snapshotService: snapshotFacade,
  });

  return Object.freeze({
    ...storage,
    gateway,
    platformStore,
    operationsStore,
    sessionManager,
    authFacade,
    permissionService,
    snapshotFacade,
    services,
    destroy() {
      monitoringFacade.destroy();
      pipelineOrchestrator.destroy();
      discoveryService.destroy();
      operationsStore.destroy();
      sessionManager.destroy();
      platformStore.destroy();
      gateway.destroy();
    },
  });
}

function subscribeToPlatformStore(platformStore, listener) {
  if (typeof platformStore.subscribe !== 'function') {
    return NOOP_UNSUBSCRIBE;
  }

  return platformStore.subscribe(listener);
}

function StorageNotices({
  platformSnapshot,
  storageFallback,
  storageError,
}) {
  const recovery = platformSnapshot.storageRecovery;
  const volatile =
    recovery?.mode === 'VOLATILE';
  const readOnly =
    recovery?.mode === 'READ_ONLY';

  if (!storageFallback && !volatile && !readOnly) {
    return null;
  }

  return (
    <div
      className="border-b border-warning-200 bg-warning-50 px-4 py-3 text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:px-6"
      role="alert"
    >
      <div className="mx-auto flex w-full max-w-7xl items-start gap-3">
        {readOnly ? (
          <Database
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
        )}
        <div>
          <p className="text-sm font-semibold">
            {readOnly
              ? 'Browser-local data is read-only'
              : 'Browser-local persistence is limited'}
          </p>
          <p className="mt-1 text-xs leading-5">
            {storageFallback
              ? 'Browser storage was unavailable, so this session is using temporary in-memory fictional data. Changes will be lost when the page closes.'
              : readOnly
                ? 'Stored data could not be validated safely. Protected mutations are disabled until the canonical sample is restored.'
                : 'A storage or quota operation failed. Recent fictional changes may exist only in memory; export an authorized snapshot before clearing browser data.'}
          </p>
          {storageError?.code ? (
            <p className="mt-1 font-mono text-xs">
              Local storage status: {storageError.code}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

StorageNotices.propTypes = {
  platformSnapshot: PropTypes.object.isRequired,
  storageFallback: PropTypes.bool.isRequired,
  storageError: PropTypes.object,
};

function ApplicationComposition() {
  const composition = useMemo(
    () => createApplicationComposition(),
    [],
  );
  const sessionState = useSession(composition.authFacade);
  const platformSnapshot = useSyncExternalStore(
    (listener) =>
      subscribeToPlatformStore(
        composition.platformStore,
        listener,
      ),
    () => composition.platformStore.getSnapshot(),
    () => composition.platformStore.getSnapshot(),
  );
  const session = sessionState.session;

  useEffect(() => {
    composition.sessionManager.start();

    return () => {
      composition.destroy();
    };
  }, [composition]);

  useEffect(() => {
    if (
      sessionState.authenticated ||
      globalThis.location?.pathname === '/signin'
    ) {
      return;
    }

    globalThis.history?.replaceState?.(
      {},
      '',
      '/signin',
    );
    globalThis.dispatchEvent?.(
      new globalThis.Event('popstate'),
    );
  }, [sessionState.authenticated]);

  const footerContent = (
    <span className="font-mono">
      App {APP_VERSION} · Fixtures {FIXTURE_VERSION}
    </span>
  );

  const handleSignOut = async () => {
    const result = await composition.authFacade.signOut();

    if (result?.ok !== true) {
      throw new Error(
        result?.error?.message ??
          'The browser-local session could not be cleared.',
      );
    }

    globalThis.history?.pushState?.({}, '', '/signin');
    globalThis.dispatchEvent?.(
      new globalThis.Event('popstate'),
    );
  };

  const handleRestore = async () =>
    composition.snapshotFacade.restoreSample({
      confirmation:
        SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE,
    });

  const router = (
    <>
      <StorageNotices
        platformSnapshot={platformSnapshot}
        storageFallback={composition.storageFallback}
        storageError={composition.storageError}
      />
      <ApplicationRouter
        permissionService={composition.permissionService}
        sessionProvider={composition.authFacade}
        session={session}
        context={session}
        services={composition.services}
        pageProps={EMPTY_OBJECT}
      />
    </>
  );

  return (
    <ErrorBoundary
      resetKeys={[
        platformSnapshot.rootRevision,
        session?.sessionId ?? 'signed-out',
      ]}
      onRestore={handleRestore}
    >
      {sessionState.authenticated ? (
        <AppShell
          session={session}
          navigation={NAVIGATION_ITEMS}
          currentPath={
            globalThis.location?.pathname ?? '/'
          }
          onSignOut={handleSignOut}
          signingOut={sessionState.operationPending}
          sessionStatus={sessionState.status}
          sessionWarningOpen={sessionState.isWarning}
          sessionRemainingMs={sessionState.remainingMs}
          sessionExpiresAt={session?.expiresAt}
          onContinueSession={sessionState.recordActivity}
          onSessionExpire={() =>
            handleSignOut('EXPIRED')
          }
          footerContent={footerContent}
        >
          {router}
        </AppShell>
      ) : (
        router
      )}
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ApplicationComposition />
    </ErrorBoundary>
  );
}

export default App;