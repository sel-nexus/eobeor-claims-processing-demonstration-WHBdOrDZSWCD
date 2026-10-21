import {
  ASSISTANT_SCRIPTS,
  COMPLIANCE_STATUS_FIXTURE,
  CSR_DASHBOARD_FIXTURE,
  EXECUTIVE_INSIGHTS_FIXTURE,
  INTEGRATION_CONNECTION_TYPES,
  INTEGRATION_INVENTORY,
  INTEGRATION_LAYERS,
  MONITORING_DASHBOARD_FIXTURE,
  PRODUCTIVITY_INSIGHTS_FIXTURE,
} from '../../fixtures/insights.js';
import { ACTIONS } from '../contracts/capabilities.js';
import { createTestClock } from '../time/clock.js';
import {
  ASSISTANT_AUDIT_ACTIONS,
  ASSISTANT_FACADE_ERROR_CODES,
  createAssistantFacade,
} from './assistantFacade.js';
import {
  COMPLIANCE_FACADE_ERROR_CODES,
  createComplianceFacade,
} from './complianceFacade.js';
import {
  createInsightsFacade,
} from './insightsFacade.js';
import {
  INTEGRATION_INVENTORY_DISCLOSURE,
  INTEGRATION_INVENTORY_FACADE_ERROR_CODES,
  createIntegrationInventoryFacade,
} from './integrationInventoryFacade.js';
import {
  MONITORING_DISCLOSURE,
  createMonitoringFacade,
} from './monitoringFacade.js';

const CSR_SESSION = Object.freeze({
  sessionId: 'session-csr',
  userId: 'usr_csr',
  displayName: 'Customer Service Representative',
  role: 'CSR',
  memberId: null,
  expiresAt: '2024-01-22T13:00:00.000Z',
});

const BOS_SESSION = Object.freeze({
  sessionId: 'session-bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
  expiresAt: '2024-01-22T13:00:00.000Z',
});

const ITS_SESSION = Object.freeze({
  sessionId: 'session-its',
  userId: 'usr_its',
  displayName: 'IT Support Specialist',
  role: 'ITS',
  memberId: null,
  expiresAt: '2024-01-22T13:00:00.000Z',
});

const ADMIN_SESSION = Object.freeze({
  sessionId: 'session-admin',
  userId: 'usr_admin',
  displayName: 'Administrator',
  role: 'ADMIN',
  memberId: null,
  expiresAt: '2024-01-22T13:00:00.000Z',
});

const activeMonitoringFacades = new Set();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIdGenerator(prefix) {
  let sequence = 0;

  return () => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

function createPermissionService({
  session = ADMIN_SESSION,
  deniedActions = [],
} = {}) {
  const denied = new Set(deniedActions);

  return {
    sessionProvider: {
      getSession() {
        return session;
      },
    },
    evaluate: vi.fn(async ({ action }) => ({
      allowed: !denied.has(action),
      reasonCode: denied.has(action)
        ? 'ROLE_NOT_ALLOWED'
        : 'ROLE_ALLOWED',
      role: session.role,
      userId: session.userId,
    })),
  };
}

function createAssistantRepository() {
  let stateRevision = 0;
  const responses = {};
  const inquiries = {
    inq_1001: {
      inquiryId: 'inq_1001',
      displayId: 'INQ-1001',
      title: 'Fictional claim explanation',
      revision: 2,
      updatedAt: '2024-01-22T11:00:00.000Z',
      assistantAttachmentIds: [],
    },
  };
  const attachments = {};

  const repository = {
    getAssistantScript: vi.fn(
      (topic) => ASSISTANT_SCRIPTS[topic] ?? null,
    ),
    getStateRevision: vi.fn(() => stateRevision),
    saveAssistantResponse: vi.fn(
      (response, options) => {
        if (options.expectedRevision !== stateRevision) {
          const error = new Error(
            'Assistant state changed before the response was stored.',
          );

          error.code = 'REVISION_CONFLICT';
          throw error;
        }

        responses[response.responseId] = cloneValue(response);
        stateRevision += 1;
        return cloneValue(response);
      },
    ),
    attachAssistantResponse: vi.fn(
      (inquiryId, attachment, options) => {
        const inquiry = inquiries[inquiryId];

        if (inquiry === undefined) {
          const error = new Error('Inquiry was not found.');

          error.code = 'INQUIRY_NOT_FOUND';
          throw error;
        }

        if (options.expectedRevision !== stateRevision) {
          const error = new Error(
            'Assistant state changed before attachment.',
          );

          error.code = 'REVISION_CONFLICT';
          throw error;
        }

        if (
          options.expectedInquiryRevision !== inquiry.revision
        ) {
          const error = new Error(
            'Inquiry changed before attachment.',
          );

          error.code = 'REVISION_CONFLICT';
          throw error;
        }

        attachments[attachment.attachmentId] =
          cloneValue(attachment);
        inquiry.assistantAttachmentIds.push(
          attachment.attachmentId,
        );
        inquiry.revision += 1;
        stateRevision += 1;

        return {
          attachment: cloneValue(attachment),
          inquiryRevision: inquiry.revision,
        };
      },
    ),
    getInquiry(inquiryId) {
      return cloneValue(inquiries[inquiryId] ?? null);
    },
    getAttachment(attachmentId) {
      return cloneValue(attachments[attachmentId] ?? null);
    },
  };

  return repository;
}

function createIntegrationRepository() {
  return {
    listIntegrations: vi.fn((input = {}) => {
      const query =
        typeof input.query === 'string'
          ? input.query.toLocaleLowerCase('en-US')
          : '';
      const items = INTEGRATION_INVENTORY.filter(
        (integration) => {
          if (
            input.layer !== undefined &&
            integration.layer !== input.layer
          ) {
            return false;
          }

          if (
            input.connectionType !== undefined &&
            !integration.connectionTypes.includes(
              input.connectionType,
            )
          ) {
            return false;
          }

          if (query.length === 0) {
            return true;
          }

          return [
            integration.name,
            ...integration.aliases,
            integration.description,
          ]
            .join(' ')
            .toLocaleLowerCase('en-US')
            .includes(query);
        },
      );
      const page = input.page ?? 1;
      const limit = input.limit ?? 25;
      const start = (page - 1) * limit;

      return {
        items: items.slice(start, start + limit),
        page,
        limit,
        total: items.length,
        totalPages:
          items.length === 0
            ? 0
            : Math.ceil(items.length / limit),
        revision: 1,
        layers: INTEGRATION_LAYERS,
        connectionTypes: INTEGRATION_CONNECTION_TYPES,
        disclosure: INTEGRATION_INVENTORY_DISCLOSURE,
        simulated: true,
      };
    }),
  };
}

function createMonitoringRepository() {
  let stateRevision = 0;
  let dashboard = cloneValue(
    MONITORING_DASHBOARD_FIXTURE,
  );

  dashboard.kpis.queueDepth = 60;

  return {
    getMonitoringDashboard: vi.fn(() =>
      cloneValue(dashboard),
    ),
    getStateRevision: vi.fn(() => stateRevision),
    updateMonitoring: vi.fn(
      (nextDashboard, options) => {
        if (options.expectedRevision !== stateRevision) {
          const error = new Error(
            'Monitoring state changed before update.',
          );

          error.code = 'REVISION_CONFLICT';
          throw error;
        }

        dashboard = cloneValue(nextDashboard);
        stateRevision += 1;
        return cloneValue(dashboard);
      },
    ),
    getCurrentDashboard() {
      return cloneValue(dashboard);
    },
  };
}

function createPreferenceRepository() {
  let preferences = {
    theme: 'system',
    monitoringDarkMode: false,
    revision: 0,
    updatedAt: null,
  };

  return {
    get: vi.fn(() => cloneValue(preferences)),
    setMonitoringDarkMode: vi.fn((enabled, options) => {
      if (options.expectedRevision !== preferences.revision) {
        const error = new Error(
          'UI preferences changed before update.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      preferences = {
        ...preferences,
        monitoringDarkMode: enabled,
        revision: preferences.revision + 1,
        updatedAt: '2024-01-22T12:00:00.000Z',
      };

      return cloneValue(preferences);
    }),
    getCurrentPreferences() {
      return cloneValue(preferences);
    },
  };
}

afterEach(() => {
  [...activeMonitoringFacades].forEach((facade) => {
    facade.destroy();
    activeMonitoringFacades.delete(facade);
  });
});

describe('AssistantFacade support insights', () => {
  it('returns the exact code 45 script and attaches its immutable answer to a local inquiry', async () => {
    const repository = createAssistantRepository();
    const permissionService = createPermissionService({
      session: CSR_SESSION,
    });
    const auditService = {
      append: vi.fn(async (_context, event) => event),
    };
    const facade = createAssistantFacade(repository, {
      inquiryRepository: repository,
      permissionService,
      auditService,
      sessionProvider: permissionService.sessionProvider,
      clock: createTestClock(
        '2024-01-22T12:00:00.000Z',
      ),
      idGenerator: createIdGenerator('assistant'),
    });
    const response = await facade.respond({
      topic: 'CODE_45',
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.data).toEqual(
      expect.objectContaining({
        topic: 'CODE_45',
        answer: ASSISTANT_SCRIPTS.CODE_45.answer,
        scriptVersion:
          ASSISTANT_SCRIPTS.CODE_45.scriptVersion,
        disclosure: 'Scripted demo — no model call',
        createdAt: '2024-01-22T12:00:00.000Z',
      }),
    );
    expect(response.data.scriptHash).toMatch(
      /^[a-f0-9]{64}$/,
    );

    const attached = await facade.attachResponse(
      'inq_1001',
      {
        responseId: response.data.responseId,
        note: 'Shared <locally> during the demo.',
        expectedInquiryRevision: 2,
      },
    );

    expect(attached.ok).toBe(true);
    expect(attached.status).toBe(201);
    expect(attached.data.inquiryRevision).toBe(3);
    expect(attached.data.attachment).toEqual(
      expect.objectContaining({
        inquiryId: 'inq_1001',
        responseId: response.data.responseId,
        topic: 'CODE_45',
        answerSnapshot: ASSISTANT_SCRIPTS.CODE_45.answer,
        note: 'Shared &lt;locally&gt; during the demo.',
        attachedBy: CSR_SESSION.userId,
        attachedAt: '2024-01-22T12:00:00.000Z',
        disclosure: 'Scripted demo — no model call',
      }),
    );
    expect(
      repository.getAttachment(
        attached.data.attachment.attachmentId,
      ),
    ).toEqual(attached.data.attachment);
    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action:
          ASSISTANT_AUDIT_ACTIONS.RESPONSE_ATTACHED,
        entity: {
          type: 'INQUIRY',
          id: 'inq_1001',
        },
      }),
      expect.objectContaining({
        action:
          ASSISTANT_AUDIT_ACTIONS.RESPONSE_ATTACHED,
        after: expect.objectContaining({
          topic: 'CODE_45',
          status: 'ATTACHED',
        }),
        outcome: 'SUCCESS',
      }),
    );
    expect(
      auditService.append.mock.calls[0][1].after,
    ).not.toHaveProperty('answer');
  });

  it('rejects an unsupported scripted topic without storing a response', async () => {
    const repository = createAssistantRepository();
    const permissionService = createPermissionService({
      session: CSR_SESSION,
    });
    const facade = createAssistantFacade(repository, {
      inquiryRepository: repository,
      permissionService,
      auditService: {
        append: vi.fn(),
      },
      sessionProvider: permissionService.sessionProvider,
      clock: createTestClock(
        '2024-01-22T12:00:00.000Z',
      ),
      idGenerator: createIdGenerator('assistant-error'),
    });
    const result = await facade.respond({
      topic: 'FREE_FORM_PROMPT',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error.code).toBe(
      ASSISTANT_FACADE_ERROR_CODES.RESPONSE_FAILED,
    );
    expect(repository.saveAssistantResponse).not.toHaveBeenCalled();
    expect(
      repository.attachAssistantResponse,
    ).not.toHaveBeenCalled();
  });
});

describe('IntegrationInventoryFacade support insights', () => {
  it('returns exact architecture layers, connection labels, and simulated status phrases', async () => {
    const repository = createIntegrationRepository();
    const facade = createIntegrationInventoryFacade(
      repository,
      {
        permissionService: createPermissionService({
          session: ITS_SESSION,
        }),
        idGenerator: createIdGenerator('integration'),
      },
    );
    const result = await facade.list({
      layer: 'integration',
      connectionType: 'async',
      query: 'queue',
      page: 1,
      limit: 20,
    });

    expect(result.ok).toBe(true);
    expect(result.data.layers).toEqual([
      'DATA',
      'AI_AGENT',
      'APPLICATION',
      'INTEGRATION',
      'EXTERNAL',
    ]);
    expect(result.data.connectionTypes).toEqual([
      'SYNC',
      'ASYNC',
      'BATCH',
      'REAL_TIME',
    ]);
    expect(result.data.disclosure).toBe(
      'No live connectivity is configured.',
    );
    expect(result.data.items).toEqual([
      expect.objectContaining({
        integrationId: 'int_queue',
        name: 'Kafka / RabbitMQ / message queue',
        layer: 'INTEGRATION',
        connectionTypes: ['ASYNC'],
        status:
          'Status: Simulated — UI hints + mock API [Pipeline-aligned]',
        networkEnabled: false,
      }),
    ]);
    expect(repository.listIntegrations).toHaveBeenCalledWith({
      layer: 'INTEGRATION',
      connectionType: 'ASYNC',
      query: 'queue',
      page: 1,
      limit: 20,
    });
  });

  it('rejects live connection attempts and unsupported query fields', async () => {
    const repository = createIntegrationRepository();
    const facade = createIntegrationInventoryFacade(
      repository,
      {
        permissionService: createPermissionService({
          session: ADMIN_SESSION,
        }),
        idGenerator: createIdGenerator(
          'integration-error',
        ),
      },
    );

    expect(() => facade.connect()).toThrow(
      'Live integration operations are not available in this static demonstration.',
    );

    try {
      facade.connect();
    } catch (error) {
      expect(error.code).toBe(
        INTEGRATION_INVENTORY_FACADE_ERROR_CODES.UNSUPPORTED_LIVE_INTEGRATION,
      );
    }

    const result = await facade.list({
      connect: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error.code).toBe(
      INTEGRATION_INVENTORY_FACADE_ERROR_CODES.VALIDATION_ERROR,
    );
    expect(repository.listIntegrations).not.toHaveBeenCalled();
  });
});

describe('ComplianceFacade support insights', () => {
  it('keeps implemented demo behavior separate from production-only controls and claims no certifications', async () => {
    const repository = {
      getComplianceStatus: vi.fn(
        () => COMPLIANCE_STATUS_FIXTURE,
      ),
    };
    const facade = createComplianceFacade(repository, {
      permissionService: createPermissionService({
        session: ITS_SESSION,
      }),
      idGenerator: createIdGenerator('compliance'),
    });
    const result = await facade.getStatus();

    expect(result.ok).toBe(true);
    expect(result.data.implementedDemoBehavior).toEqual(
      expect.arrayContaining([
        'Client-side role states',
        'Browser-local masked audits',
        'PHI redaction',
        'Fictional fixtures',
      ]),
    );
    expect(result.data.productionOnlyNotProvided).toEqual(
      expect.arrayContaining([
        'HIPAA compliance',
        'SOC 2 Type II',
        'PCI DSS',
        'Federated identity',
      ]),
    );
    expect(
      result.data.implementedDemoBehavior,
    ).not.toEqual(
      expect.arrayContaining(['HIPAA compliance']),
    );
    expect(result.data.identityContext).toEqual([
      'SAML 2.0 — production context only',
      'OAuth 2.0 — production context only',
    ]);
    expect(result.data.certificationsClaimed).toEqual([]);
    expect(result.data.disclosure).toBe(
      'This static demonstration does not provide production authorization, certification, secure server storage, or disaster recovery.',
    );
  });

  it('rejects a compliance fixture that claims a certification', async () => {
    const invalidStatus = {
      ...cloneValue(COMPLIANCE_STATUS_FIXTURE),
      certificationsClaimed: ['HIPAA'],
    };
    const facade = createComplianceFacade(
      {
        getComplianceStatus() {
          return invalidStatus;
        },
      },
      {
        permissionService: createPermissionService({
          session: ADMIN_SESSION,
        }),
        idGenerator: createIdGenerator(
          'compliance-error',
        ),
      },
    );
    const result = await facade.getStatus();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error.code).toBe(
      COMPLIANCE_FACADE_ERROR_CODES.CERTIFICATION_CLAIMED,
    );
  });
});

describe('InsightsFacade published support fixtures', () => {
  function createRepository() {
    return {
      getCsrDashboard: vi.fn(
        () => CSR_DASHBOARD_FIXTURE,
      ),
      getExecutiveInsights: vi.fn(
        () => EXECUTIVE_INSIGHTS_FIXTURE,
      ),
      getProductivityInsights: vi.fn(
        () => PRODUCTIVITY_INSIGHTS_FIXTURE,
      ),
    };
  }

  it('returns the exact representative CSR dashboard values', async () => {
    const repository = createRepository();
    const facade = createInsightsFacade(repository, {
      permissionService: createPermissionService({
        session: ADMIN_SESSION,
      }),
      idGenerator: createIdGenerator('csr-dashboard'),
    });
    const result = await facade.getCsrDashboard();

    expect(result.ok).toBe(true);
    expect(result.data.simulated).toBe(true);
    expect(result.data.kpis).toEqual(
      expect.objectContaining({
        openRequests: 3,
        urgentRequests: 2,
        completedToday: 1,
        failedRequests: 1,
        averageProcessingMinutes: 15.5,
        targetProcessingMinutes: 22,
        representativeDownloads: 2,
      }),
    );
    expect(result.data.recentRequests).toHaveLength(5);
    expect(result.data.alerts).toHaveLength(3);
    expect(result.data.requestChart.points).toHaveLength(7);
    expect(result.data.disclosure).toBe(
      'Representative local fixtures; no live claims or monitoring service is connected.',
    );
  });

  it('preserves published Case A and Case B as separate unreconciled fixtures', async () => {
    const repository = createRepository();
    const facade = createInsightsFacade(repository, {
      permissionService: createPermissionService({
        session: BOS_SESSION,
      }),
      idGenerator: createIdGenerator('executive'),
    });
    const result = await facade.getExecutive();

    expect(result.ok).toBe(true);
    expect(result.data.caseA).toEqual(
      expect.objectContaining({
        caseId: 'PUBLISHED_CASE_A',
        label: 'Published Case A',
        leadTimeRange: '2–3 days',
        leadTimePoint: '2.5 days',
        target: '15 minutes',
        calculatedFromClaims: false,
      }),
    );
    expect(result.data.caseB).toEqual(
      expect.objectContaining({
        caseId: 'PUBLISHED_CASE_B',
        label: 'Published Case B',
        roiPercent: 1333,
        paybackMonths: 0.8,
        annualSavingsUsd: 10700000,
        speedMultiplier: 15.5,
        minutesBefore: 240,
        minutesAfter: 15.5,
        staffBefore: 25,
        staffAfter: 5,
        calculatedFromClaims: false,
      }),
    );
    expect(result.data.caseB.errorComparisons).toHaveLength(2);
    expect(result.data.monthlyTrend.legends).toEqual([
      'Volume (k)',
      'Savings ($M)',
    ]);
    expect(result.data.monthlyTrend.points).toHaveLength(12);
    expect(result.data.disclosure).toContain(
      'Conflicting figures are intentionally not reconciled.',
    );
  });

  it('returns exact before-and-after productivity fixture values without deriving operational results', async () => {
    const repository = createRepository();
    const facade = createInsightsFacade(repository, {
      permissionService: createPermissionService({
        session: BOS_SESSION,
      }),
      idGenerator: createIdGenerator('productivity'),
    });
    const result = await facade.getProductivity();

    expect(result.ok).toBe(true);
    expect(result.data.before).toEqual(
      expect.objectContaining({
        label: 'Representative manual process',
        totalMinutes: 240,
        staffCount: 25,
      }),
    );
    expect(result.data.before.steps).toHaveLength(7);
    expect(result.data.after).toEqual(
      expect.objectContaining({
        label: 'Representative target process',
        totalMinutes: 15.5,
        staffCount: 5,
      }),
    );
    expect(result.data.after.steps).toHaveLength(9);
    expect(result.data.printedMinuteTotal).toBe(15.5);
    expect(result.data.footer).toEqual({
      annualSavingsUsd: 10700000,
      roiPercent: 1333,
      paybackMonths: 0.8,
      speedMultiplier: 15.5,
    });
    expect(result.data.errorPoints).toHaveLength(2);
    expect(result.data.comparisonCallouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          calloutId: 'TIME',
          before: '240 minutes',
          after: '15.5 minutes',
          change: '15.5x faster',
        }),
        expect.objectContaining({
          calloutId: 'ROI',
          after: '1333%',
          change: '0.8-month payback',
        }),
      ]),
    );
    expect(result.data.disclosure).toContain(
      'not calculated from local claim records',
    );
  });

  it('denies executive fixtures when the permission service rejects the action', async () => {
    const repository = createRepository();
    const permissionService = createPermissionService({
      session: CSR_SESSION,
      deniedActions: [ACTIONS.EXECUTIVE_INSIGHTS_VIEW],
    });
    const facade = createInsightsFacade(repository, {
      permissionService,
      idGenerator: createIdGenerator('insights-denied'),
    });
    const result = await facade.getExecutive();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error.code).toBe('ACTION_FORBIDDEN');
    expect(
      repository.getExecutiveInsights,
    ).not.toHaveBeenCalled();
  });
});

describe('MonitoringFacade support insights', () => {
  it('returns exact baseline metrics and advances deterministic ticks with local threshold alerts', async () => {
    const repository = createMonitoringRepository();
    const preferenceRepository =
      createPreferenceRepository();
    const permissionService = createPermissionService({
      session: ITS_SESSION,
    });
    const facade = createMonitoringFacade(repository, {
      permissionService,
      uiPreferenceRepository: preferenceRepository,
      clock: createTestClock(
        '2024-01-22T14:32:45.000Z',
      ),
      idGenerator: createIdGenerator('monitoring'),
      minimumRefreshIntervalMs: 0,
    });

    activeMonitoringFacades.add(facade);

    const initial = await facade.getDashboard();

    expect(initial.ok).toBe(true);
    expect(initial.data).toEqual(
      expect.objectContaining({
        simulated: true,
        tick: 0,
        disclosure: MONITORING_DISCLOSURE,
        monitoringDarkMode: false,
      }),
    );
    expect(initial.data.kpis).toEqual(
      expect.objectContaining({
        cdcStatus: 'HEALTHY',
        cdcStatusLabel: 'CDC Healthy',
        uptimePercent: 99.9,
        activeConnections: 1247,
        queueDepth: 60,
        errorRatePercent: 0.3,
      }),
    );
    expect(initial.data.syncLatency.points).toHaveLength(6);
    expect(initial.data.throughput.bars).toHaveLength(6);
    expect(initial.data.resourceGauges).toHaveLength(3);
    expect(initial.data.diskTimeline).toHaveLength(7);
    expect(initial.data.events).toHaveLength(5);
    expect(initial.data.alerts).toHaveLength(2);

    const refreshed = await facade.refreshOnce();

    expect(refreshed.ok).toBe(true);
    expect(refreshed.data.tick).toBe(1);
    expect(refreshed.data.dashboard.tick).toBe(1);
    expect(refreshed.data.dashboard.revision).toBe(2);
    expect(refreshed.data.dashboard.events).toHaveLength(6);
    expect(refreshed.data.appendedEvent).toEqual(
      expect.objectContaining({
        eventId: 'MON-PLAYBACK-000001',
        category: 'MONITORING',
        severity: 'INFO',
        simulated: true,
      }),
    );
    expect(refreshed.data.newAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alertId: 'MON-PLAYBACK-QUEUE-000001',
          severity: 'WARNING',
          metric: 'queueDepth',
          threshold: 50,
          acknowledged: false,
          simulated: true,
        }),
      ]),
    );
    expect(
      repository.getCurrentDashboard().alerts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alertId: 'MON-PLAYBACK-QUEUE-000001',
        }),
      ]),
    );
    expect(repository.updateMonitoring).toHaveBeenCalledWith(
      expect.objectContaining({
        tick: 1,
        simulated: true,
        disclosure: MONITORING_DISCLOSURE,
      }),
      {
        expectedRevision: 0,
        updatedBy: ITS_SESSION.userId,
      },
    );
  });

  it('persists monitoring dark mode and rejects invalid preference input', async () => {
    const repository = createMonitoringRepository();
    const preferenceRepository =
      createPreferenceRepository();
    const facade = createMonitoringFacade(repository, {
      permissionService: createPermissionService({
        session: ITS_SESSION,
      }),
      uiPreferenceRepository: preferenceRepository,
      clock: createTestClock(
        '2024-01-22T14:32:45.000Z',
      ),
      idGenerator: createIdGenerator(
        'monitoring-preference',
      ),
      minimumRefreshIntervalMs: 0,
    });

    activeMonitoringFacades.add(facade);

    const updated = await facade.setDarkModePreference({
      enabled: true,
      expectedRevision: 0,
    });

    expect(updated.ok).toBe(true);
    expect(updated.data.monitoringDarkMode).toBe(true);
    expect(
      preferenceRepository.getCurrentPreferences(),
    ).toEqual(
      expect.objectContaining({
        monitoringDarkMode: true,
        revision: 1,
      }),
    );

    const dashboard = await facade.getDashboard();

    expect(dashboard.ok).toBe(true);
    expect(dashboard.data.monitoringDarkMode).toBe(true);

    const invalid = await facade.setDarkModePreference({
      enabled: 'yes',
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe(422);
    expect(invalid.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.error.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'enabled',
        code: 'INVALID_BOOLEAN',
      }),
    ]);
    expect(
      preferenceRepository.setMonitoringDarkMode,
    ).toHaveBeenCalledTimes(1);
  });

  it('denies monitoring access without mutating local dashboard state', async () => {
    const repository = createMonitoringRepository();
    const permissionService = createPermissionService({
      session: CSR_SESSION,
      deniedActions: [ACTIONS.MONITORING_VIEW],
    });
    const facade = createMonitoringFacade(repository, {
      permissionService,
      clock: createTestClock(
        '2024-01-22T14:32:45.000Z',
      ),
      idGenerator: createIdGenerator(
        'monitoring-denied',
      ),
      minimumRefreshIntervalMs: 0,
    });

    activeMonitoringFacades.add(facade);

    const result = await facade.refreshOnce();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error.code).toBe('ACTION_FORBIDDEN');
    expect(repository.updateMonitoring).not.toHaveBeenCalled();
    expect(repository.getCurrentDashboard().tick).toBe(0);
  });
});