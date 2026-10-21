import {
  CLAIMS,
  COVERAGES,
  MEMBERS,
  PROVIDERS,
  REASON_CODES,
  RESTRICTIONS,
  SERVICE_LINES,
} from '../../../fixtures/membersClaims.js';
import {
  INITIAL_OPERATIONS_ENVELOPE,
} from '../../../fixtures/operations.js';
import {
  createStorageGateway,
} from '../../../platform/persistence/storageGateway.js';
import {
  createTestClock,
} from '../../../platform/time/clock.js';
import {
  createOperationsRepository,
} from '../repositories/operationsRepository.js';
import {
  BATCH_MACHINE_DEFINITION,
  BATCH_ROW_SCENARIOS,
} from './batchMachine.js';
import {
  BATCH_AUDIT_ACTIONS,
  BATCH_EXECUTION_MODES,
  BATCH_SERVICE_ERROR_CODES,
  createBatchService,
} from './batchService.js';
import {
  createDocumentVersionService,
} from './documentVersionService.js';
import {
  createOutboundService,
} from './outboundService.js';
import {
  createPipelineOrchestrator,
} from './pipelineOrchestrator.js';
import {
  createRequestService,
} from './requestService.js';
import {
  createValidationEngine,
} from './validationEngine.js';

const BOS_ACTOR = Object.freeze({
  actorId: 'usr_bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
});

const EXPECTED_BATCH_STEPS = Object.freeze([
  'INTAKE',
  'MEMBER_VALIDATION',
  'CLAIM_VALIDATION',
  'PROVIDER_CONSOLIDATION',
  'MEMBER_CONSOLIDATION',
  'PAYMENT_ATTACHMENT',
  'DOCUMENT_PREPARATION',
  'REPORT_CREATION',
  'IXIT_HANDOFF',
  'COMPLETION',
]);

const EXPECTED_BATCH_MINUTES = Object.freeze([
  '1',
  '2',
  '2',
  '2',
  '2',
  '2',
  '3',
  '2',
  '1',
  '1',
]);

const QUEUE_ROWS = Object.freeze([
  Object.freeze({
    rowId: 'BROW-UNIT-001',
    claimNumber: 'CL2024001',
    memberId: '123456789',
    requestType: 'BOTH',
    priority: 'NORMAL',
    source: 'NIGHTLY_BATCH',
    status: 'QUEUED',
    reasonCode: null,
  }),
  Object.freeze({
    rowId: 'BROW-UNIT-002',
    claimNumber: 'CL2024002',
    memberId: '987654321',
    requestType: 'EOR',
    priority: 'HIGH',
    source: 'NIGHTLY_BATCH',
    status: 'QUEUED',
    reasonCode: null,
  }),
]);

const activeHarnesses = new Set();
let namespaceSequence = 0;

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(String(key))
        ? values.get(String(key))
        : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
  };
}

function createUuidGenerator(namespace = '90000000') {
  let sequence = 0;

  return () => {
    sequence += 1;

    return `${namespace}-0000-4000-8000-${sequence
      .toString(16)
      .padStart(12, '0')}`;
  };
}

function createEmptyOperationsEnvelope() {
  return {
    schemaVersion: 1,
    revision: 0,
    commitId: '80000000-0000-4000-8000-000000000001',
    updatedAt: '2024-01-22T12:00:00.000Z',
    requests: {},
    pipelineRuns: {},
    documents: {},
    inboundRuns: {},
    batchRuns: {},
    reviews: {},
    errorReports: {},
    outboundRecords: {},
    idempotencyResults: {},
    cdcEvents: {},
  };
}

function createFixtureGateway() {
  const membersById = Object.fromEntries(
    MEMBERS.map((member) => [member.memberId, member]),
  );
  const claimsByNumber = Object.fromEntries(
    CLAIMS.map((claim) => [claim.claimNumber, claim]),
  );
  const providersById = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider.providerId,
      provider,
    ]),
  );
  const coveragesById = Object.fromEntries(
    COVERAGES.map((coverage) => [
      coverage.coverageId,
      coverage,
    ]),
  );
  const serviceLinesByClaim = Object.fromEntries(
    CLAIMS.map((claim) => [
      claim.claimNumber,
      SERVICE_LINES.filter(
        (line) => line.claimNumber === claim.claimNumber,
      ),
    ]),
  );

  return {
    getSnapshot() {
      return {
        members: MEMBERS,
        membersById,
        claims: CLAIMS,
        claimsByNumber,
        providers: PROVIDERS,
        providersById,
        coverages: COVERAGES,
        coveragesById,
        serviceLines: SERVICE_LINES,
        serviceLinesByClaim,
        reasonCodes: REASON_CODES,
        restrictions: RESTRICTIONS,
        requests: [],
        settings: {
          retentionYears: 7,
          autoApproveAmount: 500,
        },
      };
    },
    getClaimByNumber(claimNumber) {
      return claimsByNumber[claimNumber] ?? null;
    },
    findClaimByNumber(claimNumber) {
      return claimsByNumber[claimNumber] ?? null;
    },
    getMemberById(memberId) {
      return membersById[memberId] ?? null;
    },
    findMemberById(memberId) {
      return membersById[memberId] ?? null;
    },
    getProviderById(providerId) {
      return providersById[providerId] ?? null;
    },
    getCoverageById(coverageId) {
      return coveragesById[coverageId] ?? null;
    },
    getServiceLinesByClaim(claimNumber) {
      return serviceLinesByClaim[claimNumber] ?? [];
    },
  };
}

function createHarness({
  initialEnvelope = createEmptyOperationsEnvelope(),
} = {}) {
  namespaceSequence += 1;

  const clock = createTestClock(
    '2024-01-22T12:00:00.000Z',
  );
  const gateway = createStorageGateway({
    namespace:
      `batch-service-test-${namespaceSequence}.v1`,
    storage: createMemoryStorage(),
    broadcastChannelFactory: null,
  });
  const repository = createOperationsRepository(gateway, {
    initialEnvelope,
    clock,
    idGenerator: createUuidGenerator('81000000'),
  });
  const fixtureGateway = createFixtureGateway();
  const permissionGateway = {
    evaluate: vi.fn(async () => ({
      allowed: true,
      role: BOS_ACTOR.role,
      userId: BOS_ACTOR.userId,
    })),
  };
  const auditService = {
    append: vi.fn(async (_context, event) => event),
  };
  const documentVersionService =
    createDocumentVersionService(repository, {
      fixtureGateway,
      permissionGateway,
      auditService,
      clock,
      idGenerator: createUuidGenerator('82000000'),
    });
  const outboundService = createOutboundService(repository, {
    permissionGateway,
    auditService,
    clock,
    idGenerator: createUuidGenerator('83000000'),
  });
  const pipelineOrchestrator =
    createPipelineOrchestrator(repository, {
      validationEngine: createValidationEngine({
        referenceDate: '2024-01-22',
      }),
      fixtureGateway,
      documentVersionService,
      outboundService,
      permissionGateway,
      auditService,
      clock,
      idGenerator: createUuidGenerator('84000000'),
    });
  const requestService = createRequestService(repository, {
    fixtureGateway,
    permissionGateway,
    auditService,
    clock,
    idGenerator: createUuidGenerator('85000000'),
    correlationIdGenerator:
      createUuidGenerator('86000000'),
  });
  const batchService = createBatchService(repository, {
    requestService,
    pipelineOrchestrator,
    fixtureGateway,
    permissionGateway,
    auditService,
    queueRows: QUEUE_ROWS,
    clock,
    idGenerator: createUuidGenerator('87000000'),
  });
  const commandIds = createUuidGenerator('88000000');
  const harness = {
    auditService,
    batchService,
    clock,
    commandIds,
    documentVersionService,
    fixtureGateway,
    gateway,
    outboundService,
    permissionGateway,
    pipelineOrchestrator,
    repository,
    requestService,
    destroy() {
      pipelineOrchestrator.destroy();
      gateway.destroy();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
}

function createBatchCommand(
  harness,
  overrides = {},
) {
  return {
    batchId: 'BATCH-UNIT-001',
    rowIds: QUEUE_ROWS.map((row) => row.rowId),
    scenarioByRow: {},
    idempotencyKey: harness.commandIds(),
    ...overrides,
  };
}

function getAuditActions(auditService) {
  return auditService.append.mock.calls.map(
    ([context]) => context.action,
  );
}

afterEach(() => {
  [...activeHarnesses].forEach((harness) => {
    harness.destroy();
  });
});

describe('BatchService', () => {
  it('defines the required ten-step claims-outbound batch flow', () => {
    expect(BATCH_MACHINE_DEFINITION.steps).toHaveLength(10);
    expect(
      BATCH_MACHINE_DEFINITION.steps.map(
        (step) => step.step,
      ),
    ).toEqual(EXPECTED_BATCH_STEPS);
    expect(
      BATCH_MACHINE_DEFINITION.steps.map(
        (step) => step.printedMinutes,
      ),
    ).toEqual(EXPECTED_BATCH_MINUTES);
    expect(
      BATCH_MACHINE_DEFINITION.steps.map(
        (step) => step.label,
      ),
    ).toEqual([
      'Intake',
      'Member validation',
      'Claim validation',
      'Provider consolidation',
      'Member consolidation',
      'Payment attachment',
      'Document preparation',
      'Report creation',
      'Mock IXIT handoff',
      'Completion',
    ]);
    expect(
      BATCH_MACHINE_DEFINITION.disclosures,
    ).toContain(
      'Mock IXIT handoff records are not transmitted.',
    );
  });

  it('processes rows independently and returns only the failed payment row to the local queue', async () => {
    const harness = createHarness();
    const result = await harness.batchService.runBatch(
      createBatchCommand(harness, {
        batchId: 'BATCH-UNIT-MIXED',
        scenarioByRow: {
          'BROW-UNIT-001':
            BATCH_ROW_SCENARIOS.SUCCESS,
          'BROW-UNIT-002':
            BATCH_ROW_SCENARIOS.PAYMENT_MISSING,
        },
      }),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data).toEqual(
      expect.objectContaining({
        batchId: 'BATCH-UNIT-MIXED',
        status: 'COMPLETED_WITH_ERRORS',
        processed: 2,
        succeeded: 1,
        failed: 1,
        replayed: false,
        transmitted: false,
      }),
    );
    expect(result.data.rows).toEqual([
      expect.objectContaining({
        rowId: 'BROW-UNIT-001',
        status: 'COMPLETE',
        attempt: 1,
        reasonCode: null,
        reportId: expect.stringMatching(
          /^IXIT-BATCH-UNIT-MIXED-BROW-UNIT-001$/,
        ),
      }),
      expect.objectContaining({
        rowId: 'BROW-UNIT-002',
        status: 'QUEUED',
        attempt: 1,
        reasonCode: 'PAYMENT_MISSING',
        reportId: null,
      }),
    ]);

    const storedRun =
      harness.repository.getSnapshot().batchRuns[
        'BATCH-UNIT-MIXED'
      ];

    expect(storedRun.steps).toHaveLength(10);
    expect(
      storedRun.steps.map((step) => step.step),
    ).toEqual(EXPECTED_BATCH_STEPS);
    expect(
      storedRun.steps.every(
        (step) =>
          typeof step.code === 'string' &&
          typeof step.message === 'string' &&
          step.startedAt !== null &&
          step.endedAt !== null,
      ),
    ).toBe(true);
    expect(
      Object.keys(
        harness.repository.getSnapshot().outboundRecords,
      ),
    ).toHaveLength(0);
    expect(getAuditActions(harness.auditService)).toEqual(
      expect.arrayContaining([
        BATCH_AUDIT_ACTIONS.ROW_PROCESSED,
        BATCH_AUDIT_ACTIONS.COMPLETED,
      ]),
    );
  });

  it('retains successful row evidence when a sibling row fails member validation', async () => {
    const harness = createHarness();
    const result = await harness.batchService.runBatch(
      createBatchCommand(harness, {
        batchId: 'BATCH-UNIT-FAILURE',
        scenarioByRow: {
          'BROW-UNIT-001':
            BATCH_ROW_SCENARIOS.SUCCESS,
          'BROW-UNIT-002':
            BATCH_ROW_SCENARIOS.MEMBER_INVALID,
        },
      }),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe(
      'COMPLETED_WITH_ERRORS',
    );
    expect(result.data.rows).toEqual([
      expect.objectContaining({
        rowId: 'BROW-UNIT-001',
        status: 'COMPLETE',
        reasonCode: null,
        reportId: expect.stringMatching(/^IXIT-/),
      }),
      expect.objectContaining({
        rowId: 'BROW-UNIT-002',
        status: 'FAILED',
        reasonCode: 'MEMBER_VALIDATION_FAILED',
        reportId: null,
      }),
    ]);

    const storedRun =
      harness.repository.getSnapshot().batchRuns[
        'BATCH-UNIT-FAILURE'
      ];

    expect(storedRun.steps).toHaveLength(10);
    expect(storedRun.rows[0].status).toBe('COMPLETE');
    expect(storedRun.rows[1].status).toBe('FAILED');
    expect(
      storedRun.steps.find(
        (step) => step.step === 'MEMBER_VALIDATION',
      ),
    ).toEqual(
      expect.objectContaining({
        code: 'MEMBER_VALIDATION_COMPLETED_WITH_ERRORS',
      }),
    );
  });

  it('retries one returned row without changing its completed sibling', async () => {
    const harness = createHarness();
    const initial = await harness.batchService.runBatch(
      createBatchCommand(harness, {
        batchId: 'BATCH-UNIT-RETRY',
        scenarioByRow: {
          'BROW-UNIT-001':
            BATCH_ROW_SCENARIOS.SUCCESS,
          'BROW-UNIT-002':
            BATCH_ROW_SCENARIOS.PAYMENT_MISSING,
        },
      }),
      BOS_ACTOR,
    );

    expect(initial.ok).toBe(true);

    const beforeRetry =
      harness.repository.getSnapshot().batchRuns[
        'BATCH-UNIT-RETRY'
      ];
    const completedSibling = beforeRetry.rows.find(
      (row) => row.rowId === 'BROW-UNIT-001',
    );
    const retry = await harness.batchService.retryBatchRow(
      {
        batchId: 'BATCH-UNIT-RETRY',
        rowId: 'BROW-UNIT-002',
        resolution: {
          paymentReference: '****0192',
        },
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(retry.ok).toBe(true);
    expect(retry.status).toBe(200);
    expect(retry.data).toEqual(
      expect.objectContaining({
        batchId: 'BATCH-UNIT-RETRY',
        rowId: 'BROW-UNIT-002',
        attempt: 2,
        status: 'COMPLETE',
        reasonCode: null,
        reportId: expect.stringMatching(/^IXIT-/),
        paymentReferenceMasked: '****0192',
        replayed: false,
        transmitted: false,
      }),
    );

    const storedRun =
      harness.repository.getSnapshot().batchRuns[
        'BATCH-UNIT-RETRY'
      ];
    const storedSibling = storedRun.rows.find(
      (row) => row.rowId === 'BROW-UNIT-001',
    );
    const retriedRow = storedRun.rows.find(
      (row) => row.rowId === 'BROW-UNIT-002',
    );

    expect(storedRun.status).toBe('COMPLETE');
    expect(storedSibling).toEqual(completedSibling);
    expect(retriedRow).toEqual(
      expect.objectContaining({
        status: 'COMPLETE',
        attempt: 2,
        reasonCode: null,
        reportId: retry.data.reportId,
      }),
    );
    expect(getAuditActions(harness.auditService)).toContain(
      BATCH_AUDIT_ACTIONS.ROW_RETRIED,
    );
  });

  it('rejects retry for a completed row and preserves the stored batch', async () => {
    const harness = createHarness();
    const initial = await harness.batchService.runBatch(
      createBatchCommand(harness, {
        batchId: 'BATCH-UNIT-NOT-RETRYABLE',
        rowIds: ['BROW-UNIT-001'],
        scenarioByRow: {
          'BROW-UNIT-001':
            BATCH_ROW_SCENARIOS.SUCCESS,
        },
      }),
      BOS_ACTOR,
    );

    expect(initial.ok).toBe(true);

    const beforeRetry =
      harness.repository.getSnapshot().batchRuns[
        'BATCH-UNIT-NOT-RETRYABLE'
      ];
    const retry = await harness.batchService.retryBatchRow(
      {
        batchId: 'BATCH-UNIT-NOT-RETRYABLE',
        rowId: 'BROW-UNIT-001',
        resolution: {
          paymentReference: '****0192',
        },
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(retry.ok).toBe(false);
    expect(retry.status).toBe(409);
    expect(retry.error).toEqual(
      expect.objectContaining({
        code:
          BATCH_SERVICE_ERROR_CODES.ROW_NOT_RETRYABLE,
        retryable: false,
      }),
    );
    expect(
      harness.repository.getSnapshot().batchRuns[
        'BATCH-UNIT-NOT-RETRYABLE'
      ],
    ).toEqual(beforeRetry);
  });

  it('creates one immediate BOTH rework request, two new immutable versions, and local IXIT projections', async () => {
    const harness = createHarness({
      initialEnvelope: INITIAL_OPERATIONS_ENVELOPE,
    });
    const before = harness.repository.getSnapshot();
    const beforeRequestCount = Object.keys(
      before.requests,
    ).length;
    const beforeDocumentCount = Object.keys(
      before.documents,
    ).length;
    const priorEob =
      before.documents['DOC-EOB-CL2024001-V1'];
    const priorEor =
      before.documents['DOC-EOR-CL2024001-V1'];
    const command = {
      claimNumber: 'CL2024001',
      execution: BATCH_EXECUTION_MODES.IMMEDIATE,
      reasonCode: 'CORRECTED_CLAIM',
      notes: 'Corrected fictional service-line fixture.',
      idempotencyKey: harness.commandIds(),
    };
    const result = await harness.batchService.reworkClaim(
      command,
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data).toEqual(
      expect.objectContaining({
        requestId: expect.stringMatching(
          /^85000000-0000-4000-8000-/,
        ),
        requestType: 'BOTH',
        execution: 'IMMEDIATE',
        status: 'COMPLETE',
        documentIds: [
          'DOC-EOB-CL2024001-V2',
          'DOC-EOR-CL2024001-V2',
        ],
        replayed: false,
        transmitted: false,
      }),
    );

    const snapshot = harness.repository.getSnapshot();
    const reworkRequest =
      snapshot.requests[result.data.requestId];

    expect(Object.keys(snapshot.requests)).toHaveLength(
      beforeRequestCount + 1,
    );
    expect(reworkRequest).toEqual(
      expect.objectContaining({
        claimNumber: 'CL2024001',
        memberId: '123456789',
        requestType: 'BOTH',
        sourceType: 'REWORK',
        status: 'COMPLETE',
        documentReferences: result.data.documentIds,
      }),
    );
    expect(Object.keys(snapshot.documents)).toHaveLength(
      beforeDocumentCount + 2,
    );
    expect(
      snapshot.documents['DOC-EOB-CL2024001-V1'],
    ).toEqual(priorEob);
    expect(
      snapshot.documents['DOC-EOR-CL2024001-V1'],
    ).toEqual(priorEor);
    expect(
      snapshot.documents['DOC-EOB-CL2024001-V2'],
    ).toEqual(
      expect.objectContaining({
        documentType: 'EOB',
        version: 2,
        requestId: result.data.requestId,
      }),
    );
    expect(
      snapshot.documents['DOC-EOR-CL2024001-V2'],
    ).toEqual(
      expect.objectContaining({
        documentType: 'EOR',
        version: 2,
        requestId: result.data.requestId,
      }),
    );

    result.data.documentIds.forEach((documentId) => {
      const records = Object.values(
        snapshot.outboundRecords,
      ).filter(
        (record) => record.documentId === documentId,
      );

      expect(records).toHaveLength(5);
      expect(
        records.map((record) => record.kind).sort(),
      ).toEqual([
        'CRM',
        'EMAIL',
        'IXIT',
        'REPORTING',
        'REPRINT_REFERENCE',
      ]);
      expect(
        records.every(
          (record) =>
            record.payloadMasked.transmitted === false,
        ),
      ).toBe(true);
    });

    expect(getAuditActions(harness.auditService)).toContain(
      BATCH_AUDIT_ACTIONS.CLAIM_REWORKED,
    );
  });

  it('replays immediate rework idempotently without creating another request or document version', async () => {
    const harness = createHarness();
    const command = {
      claimNumber: 'CL2024001',
      execution: BATCH_EXECUTION_MODES.IMMEDIATE,
      reasonCode: 'CORRECTED_CLAIM',
      notes: 'Idempotent fictional rework.',
      idempotencyKey: harness.commandIds(),
    };
    const first = await harness.batchService.reworkClaim(
      command,
      BOS_ACTOR,
    );
    const replay = await harness.batchService.reworkClaim(
      command,
      BOS_ACTOR,
    );
    const snapshot = harness.repository.getSnapshot();

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(replay.status).toBe(200);
    expect(replay.data).toEqual(
      expect.objectContaining({
        requestId: first.data.requestId,
        requestType: 'BOTH',
        status: 'COMPLETE',
        documentIds: first.data.documentIds,
        replayed: true,
        transmitted: false,
      }),
    );
    expect(Object.keys(snapshot.requests)).toHaveLength(1);
    expect(Object.keys(snapshot.documents)).toHaveLength(2);
    expect(
      Object.values(snapshot.documents).map(
        (document) => document.version,
      ),
    ).toEqual([1, 1]);
    expect(
      Object.values(snapshot.outboundRecords),
    ).toHaveLength(10);
  });

  it('creates exactly one request and one queued row for nightly claim rework', async () => {
    const harness = createHarness();
    const result = await harness.batchService.reworkClaim(
      {
        claimNumber: 'CL2024001',
        execution: BATCH_EXECUTION_MODES.NIGHTLY_BATCH,
        reasonCode: 'PROVIDER_CORRECTION',
        notes: 'Queue fictional correction for nightly processing.',
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data).toEqual(
      expect.objectContaining({
        requestId: expect.any(String),
        requestType: 'BOTH',
        execution: 'NIGHTLY_BATCH',
        status: 'PENDING',
        batchId: 'BATCH-REWORK-CL2024001',
        batchRowId: expect.stringMatching(
          /^BROW-REWORK-/,
        ),
        transmitted: false,
      }),
    );

    const snapshot = harness.repository.getSnapshot();
    const request =
      snapshot.requests[result.data.requestId];
    const batch =
      snapshot.batchRuns[result.data.batchId];

    expect(Object.keys(snapshot.requests)).toHaveLength(1);
    expect(request).toEqual(
      expect.objectContaining({
        requestType: 'BOTH',
        sourceType: 'REWORK',
        status: 'PENDING',
        documentReferences: [],
      }),
    );
    expect(batch).toEqual(
      expect.objectContaining({
        status: 'QUEUED',
        rows: [
          expect.objectContaining({
            rowId: result.data.batchRowId,
            claimNumber: 'CL2024001',
            memberId: '123456789',
            status: 'QUEUED',
            attempt: 1,
            reasonCode: 'PROVIDER_CORRECTION',
            reportId: null,
          }),
        ],
      }),
    );
    expect(Object.keys(snapshot.documents)).toHaveLength(0);
    expect(
      Object.keys(snapshot.outboundRecords),
    ).toHaveLength(0);
    expect(getAuditActions(harness.auditService)).toContain(
      BATCH_AUDIT_ACTIONS.CLAIM_REWORK_QUEUED,
    );
  });
});