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
  createStorageGateway,
} from '../../../platform/persistence/storageGateway.js';
import { createTestClock } from '../../../platform/time/clock.js';
import {
  createOperationsRepository,
} from '../repositories/operationsRepository.js';
import {
  createDocumentVersionService,
} from './documentVersionService.js';
import {
  createOutboundService,
} from './outboundService.js';
import {
  PIPELINE_MACHINE_DEFINITION,
  createPipelineMachine,
} from './pipelineMachine.js';
import {
  createPipelineOrchestrator,
} from './pipelineOrchestrator.js';
import { createRequestService } from './requestService.js';
import { createValidationEngine } from './validationEngine.js';

const ACTOR = Object.freeze({
  actorId: 'usr_bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
});

const EXPECTED_PIPELINE_STEPS = Object.freeze([
  'REQUEST',
  'VALIDATION',
  'DATA_RETRIEVAL',
  'BUSINESS_RULES',
  'DOCUMENT_GENERATION',
  'QUALITY_CHECK',
  'PDF_CREATION',
  'STORAGE',
  'STORED',
]);

const EXPECTED_PIPELINE_AGENTS = Object.freeze([
  'INTAKE',
  'VALIDATION',
  'DATA_RETRIEVAL',
  'BUSINESS_RULES',
  'DOCUMENT_GENERATION',
  'QUALITY_ASSURANCE',
  'PDF_CREATION',
  'STORAGE',
  'OUTBOUND',
]);

const EXPECTED_PRINTED_MINUTES = Object.freeze([
  '0',
  '7',
  '1',
  '0.5',
  '5',
  '2',
  '0',
  '0',
  '0',
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

function createHarness() {
  namespaceSequence += 1;

  const clock = createTestClock(
    '2024-01-22T12:00:00.000Z',
  );
  const gateway = createStorageGateway({
    namespace: `request-pipeline-test-${namespaceSequence}.v1`,
    storage: createMemoryStorage(),
    broadcastChannelFactory: null,
  });
  const repository = createOperationsRepository(gateway, {
    initialEnvelope: createEmptyOperationsEnvelope(),
    clock,
    idGenerator: createUuidGenerator('81000000'),
  });
  const fixtureGateway = createFixtureGateway();
  const permissionGateway = {
    evaluate: vi.fn(async () => ({
      allowed: true,
      role: ACTOR.role,
      userId: ACTOR.userId,
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
  const commandIds = createUuidGenerator('87000000');
  const harness = {
    auditService,
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

function createRequestCommand(
  harness,
  overrides = {},
) {
  return {
    claimNumber: 'CL2024001',
    memberId: '123456789',
    requestType: 'EOB',
    priority: 'NORMAL',
    sourceType: 'WEB',
    sourceDetail: 'Request pipeline unit test',
    processNow: false,
    idempotencyKey: harness.commandIds(),
    ...overrides,
  };
}

async function createRequest(
  harness,
  overrides = {},
) {
  const result = await harness.requestService.createRequest(
    createRequestCommand(harness, overrides),
    ACTOR,
  );

  expect(result.ok).toBe(true);
  return result.data;
}

async function processRequest(
  harness,
  request,
  scenario = 'SUCCESS',
) {
  return harness.pipelineOrchestrator.processRequest(
    {
      requestId: request.requestId,
      mode: 'IMMEDIATE',
      scenario,
      idempotencyKey: harness.commandIds(),
    },
    ACTOR,
  );
}

afterEach(() => {
  [...activeHarnesses].forEach((harness) => {
    harness.destroy();
  });
});

describe('RequestService request creation', () => {
  it('normalizes request fields and lists requests in priority queue order', async () => {
    const harness = createHarness();
    const normal = await createRequest(harness, {
      claimNumber: 'cl2024001',
      memberId: '123456789',
      requestType: 'eob',
      priority: 'normal',
      sourceDetail: ' Normal request ',
    });
    const high = await createRequest(harness, {
      claimNumber: 'cl2024002',
      memberId: '987654321',
      requestType: 'eor',
      priority: 'high',
      sourceDetail: ' High request ',
    });
    const urgent = await createRequest(harness, {
      claimNumber: 'cl2024003',
      memberId: '123456789',
      requestType: 'eob',
      priority: 'urgent',
      sourceDetail: ' Urgent request ',
    });

    expect(normal).toEqual(
      expect.objectContaining({
        displayId: 'REQ-000001',
        claimNumber: 'CL2024001',
        memberId: '123456789',
        requestType: 'EOB',
        priority: 'NORMAL',
        sourceType: 'WEB',
        sourceDetail: 'Normal request',
        status: 'PENDING',
        currentStep: 'REQUEST',
        documentReferences: [],
        requestedBy: ACTOR.actorId,
        version: 1,
      }),
    );
    expect(high.displayId).toBe('REQ-000002');
    expect(urgent.displayId).toBe('REQ-000003');

    const listed = await harness.requestService.listRequests(
      {
        page: 1,
        limit: 10,
        sortBy: 'QUEUE',
        sortDirection: 'ASC',
      },
      ACTOR,
    );

    expect(listed.ok).toBe(true);
    expect(
      listed.data.items.map((request) => request.priority),
    ).toEqual(['URGENT', 'HIGH', 'NORMAL']);
  });

  it('rejects missing fields and duplicate open requests without committing another row', async () => {
    const harness = createHarness();
    const invalid =
      await harness.requestService.createRequest(
        {
          claimNumber: '',
          memberId: '',
          requestType: 'PDF',
          priority: 'LOW',
          sourceType: 'WEB',
          sourceDetail: '',
          processNow: false,
          idempotencyKey: harness.commandIds(),
        },
        ACTOR,
      );

    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe(422);
    expect(invalid.error.code).toBe('VALIDATION_ERROR');
    expect(
      invalid.error.fieldErrors.map((error) => error.field),
    ).toEqual(
      expect.arrayContaining([
        'claimNumber',
        'memberId',
        'requestType',
        'priority',
      ]),
    );

    const first = await createRequest(harness);
    const duplicate =
      await harness.requestService.createRequest(
        createRequestCommand(harness),
        ACTOR,
      );

    expect(first.status).toBe('PENDING');
    expect(duplicate.ok).toBe(false);
    expect(duplicate.status).toBe(409);
    expect(duplicate.error.code).toBe(
      'DUPLICATE_OPEN_REQUEST',
    );
    expect(
      Object.keys(
        harness.repository.getSnapshot().requests,
      ),
    ).toHaveLength(1);
  });

  it('replays the same idempotency key without creating another request', async () => {
    const harness = createHarness();
    const command = createRequestCommand(harness);
    const first = await harness.requestService.createRequest(
      command,
      ACTOR,
    );
    const replay = await harness.requestService.createRequest(
      command,
      ACTOR,
    );

    expect(first.ok).toBe(true);
    expect(first.status).toBe(201);
    expect(replay.ok).toBe(true);
    expect(replay.status).toBe(200);
    expect(replay.data.requestId).toBe(
      first.data.requestId,
    );
    expect(
      Object.keys(
        harness.repository.getSnapshot().requests,
      ),
    ).toHaveLength(1);
  });
});

describe('PipelineMachine definition and transitions', () => {
  it('defines all nine required stages, agents, durations, SLA, and target labels', () => {
    expect(PIPELINE_MACHINE_DEFINITION.slaMinutes).toBe(22);
    expect(PIPELINE_MACHINE_DEFINITION.targetMinutes).toBe(
      15.5,
    );
    expect(
      PIPELINE_MACHINE_DEFINITION.steps.map(
        (step) => step.step,
      ),
    ).toEqual(EXPECTED_PIPELINE_STEPS);
    expect(
      PIPELINE_MACHINE_DEFINITION.steps.map(
        (step) => step.agent,
      ),
    ).toEqual(EXPECTED_PIPELINE_AGENTS);
    expect(
      PIPELINE_MACHINE_DEFINITION.steps.map(
        (step) => step.printedMinutes,
      ),
    ).toEqual(EXPECTED_PRINTED_MINUTES);
    expect(
      PIPELINE_MACHINE_DEFINITION.steps[1].subchecks.map(
        (check) => check.printedMinutes,
      ),
    ).toEqual(['2', '3', '2']);
  });

  it('runs the success scenario through all nine ordered stages', () => {
    const clock = createTestClock(
      '2024-01-22T12:00:00.000Z',
    );
    const machine = createPipelineMachine({
      clock,
      delayMultiplier: 0,
    });
    let state = machine.createState({
      requestId: '10000000-0000-4000-8000-000000000001',
      runId: '20000000-0000-4000-8000-000000000001',
      scenario: 'SUCCESS',
    });

    while (state.status !== 'COMPLETE') {
      clock.advance(1000);
      state = machine.advance(state);
    }

    expect(state.currentStep).toBe('STORED');
    expect(state.completedSteps).toEqual(
      EXPECTED_PIPELINE_STEPS,
    );
    expect(
      state.stepResults.map((result) => result.status),
    ).toEqual(Array(9).fill('PASSED'));
    expect(
      state.agentOutcomes.map((result) => result.agent),
    ).toEqual(EXPECTED_PIPELINE_AGENTS);
    expect(state.checkpoint).toEqual({
      step: 'STORED',
      nextStep: null,
      resumable: false,
    });
  });

  it('pauses and resumes from a checkpoint without repeating completed stages', () => {
    const clock = createTestClock(
      '2024-01-22T12:00:00.000Z',
    );
    const machine = createPipelineMachine({
      clock,
      delayMultiplier: 0,
    });
    let state = machine.createState({
      requestId: '10000000-0000-4000-8000-000000000002',
      runId: '20000000-0000-4000-8000-000000000002',
      scenario: 'SUCCESS',
    });

    state = machine.advance(state);
    state = machine.advance(state);

    expect(state.completedSteps).toEqual([
      'REQUEST',
      'VALIDATION',
    ]);
    expect(state.currentStep).toBe('DATA_RETRIEVAL');

    const paused = machine.pause(state);

    expect(paused.status).toBe('PAUSED');
    expect(paused.checkpoint).toEqual({
      step: 'DATA_RETRIEVAL',
      nextStep: 'DATA_RETRIEVAL',
      resumable: true,
    });

    state = machine.resume(paused, {
      expectedCheckpoint: 'DATA_RETRIEVAL',
    });

    while (state.status !== 'COMPLETE') {
      state = machine.advance(state);
    }

    expect(state.completedSteps).toEqual(
      EXPECTED_PIPELINE_STEPS,
    );
    expect(
      state.completedSteps.filter(
        (step) => step === 'REQUEST',
      ),
    ).toHaveLength(1);
    expect(
      state.completedSteps.filter(
        (step) => step === 'VALIDATION',
      ),
    ).toHaveLength(1);
  });

  it('rejects resume when the expected checkpoint does not match', () => {
    const machine = createPipelineMachine({
      clock: createTestClock(
        '2024-01-22T12:00:00.000Z',
      ),
      delayMultiplier: 0,
    });
    const running = machine.advance(
      machine.createState({
        requestId:
          '10000000-0000-4000-8000-000000000003',
        runId: '20000000-0000-4000-8000-000000000003',
        scenario: 'SUCCESS',
      }),
    );
    const paused = machine.pause(running);

    expect(() =>
      machine.resume(paused, {
        expectedCheckpoint: 'QUALITY_CHECK',
      }),
    ).toThrow(
      'Pipeline checkpoint does not match the expected checkpoint.',
    );
  });
});

describe('PipelineOrchestrator request outcomes', () => {
  it('stops an invalid-request scenario during validation before data retrieval', async () => {
    const harness = createHarness();
    const request = await createRequest(harness);
    const result = await processRequest(
      harness,
      request,
      'INVALID_REQUEST',
    );
    const snapshot = harness.repository.getSnapshot();
    const storedRequest = snapshot.requests[request.requestId];
    const run = Object.values(snapshot.pipelineRuns)[0];

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        currentStep: 'VALIDATION',
        errorCode: 'REQUEST_VALIDATION_FAILED',
      }),
    );
    expect(storedRequest.status).toBe('FAILED');
    expect(run.completedSteps).toEqual(['REQUEST']);
    expect(run.currentStep).toBe('VALIDATION');
    expect(Object.keys(snapshot.documents)).toHaveLength(0);
    expect(Object.keys(snapshot.outboundRecords)).toHaveLength(
      0,
    );
  });

  it('routes the rule-failure scenario to manual review with a resumable document-generation checkpoint', async () => {
    const harness = createHarness();
    const request = await createRequest(harness);
    const result = await processRequest(
      harness,
      request,
      'RULE_FAILURE',
    );
    const snapshot = harness.repository.getSnapshot();
    const storedRequest = snapshot.requests[request.requestId];
    const review = Object.values(snapshot.reviews)[0];
    const run = Object.values(snapshot.pipelineRuns)[0];

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('MANUAL_REVIEW');
    expect(storedRequest.status).toBe('MANUAL_REVIEW');
    expect(review).toEqual(
      expect.objectContaining({
        requestId: request.requestId,
        triggerCode: 'MEMBER_RESPONSIBILITY_THRESHOLD',
        thresholdCents: 50000,
        status: 'OPEN',
      }),
    );
    expect(run.checkpoint).toEqual(
      expect.objectContaining({
        step: 'BUSINESS_RULES',
        nextStep: 'DOCUMENT_GENERATION',
        resumable: true,
      }),
    );
    expect(Object.keys(snapshot.documents)).toHaveLength(0);
  });

  it('retains quality-failure evidence without creating documents or outbounds', async () => {
    const harness = createHarness();
    const request = await createRequest(harness);
    const result = await processRequest(
      harness,
      request,
      'QUALITY_FAILURE',
    );
    const snapshot = harness.repository.getSnapshot();
    const storedRequest = snapshot.requests[request.requestId];
    const errorReport =
      snapshot.errorReports[storedRequest.errorReportId];

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        currentStep: 'QUALITY_CHECK',
        errorCode: 'DOCUMENT_QUALITY_FAILED',
      }),
    );
    expect(errorReport).toEqual(
      expect.objectContaining({
        requestId: request.requestId,
        claimNumber: request.claimNumber,
        severity: 'ERROR',
        status: 'OPEN',
        summary: 'Document quality check failed',
      }),
    );
    expect(Object.keys(snapshot.documents)).toHaveLength(0);
    expect(Object.keys(snapshot.outboundRecords)).toHaveLength(
      0,
    );
  });

  it('completes all stages, creates immutable EOB and EOR versions, and projects local outbounds', async () => {
    const harness = createHarness();
    const firstRequest = await createRequest(harness, {
      requestType: 'BOTH',
    });
    const firstCommand = {
      requestId: firstRequest.requestId,
      mode: 'IMMEDIATE',
      scenario: 'SUCCESS',
      idempotencyKey: harness.commandIds(),
    };
    const first =
      await harness.pipelineOrchestrator.processRequest(
        firstCommand,
        ACTOR,
      );

    expect(first.ok).toBe(true);
    expect(first.data.status).toBe('COMPLETE');
    expect(first.data.currentStep).toBe('STORED');
    expect(first.data.completedSteps).toEqual(
      EXPECTED_PIPELINE_STEPS,
    );
    expect(first.data.documentIds).toHaveLength(2);

    const replay =
      await harness.pipelineOrchestrator.processRequest(
        firstCommand,
        ACTOR,
      );

    expect(replay.ok).toBe(true);
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.documentIds).toEqual(
      first.data.documentIds,
    );

    const secondRequest = await createRequest(harness, {
      requestType: 'BOTH',
    });
    const second = await processRequest(
      harness,
      secondRequest,
    );
    const snapshot = harness.repository.getSnapshot();
    const documents = Object.values(snapshot.documents);
    const eobVersions = documents
      .filter((document) => document.documentType === 'EOB')
      .map((document) => document.version)
      .sort();
    const eorVersions = documents
      .filter((document) => document.documentType === 'EOR')
      .map((document) => document.version)
      .sort();

    expect(second.ok).toBe(true);
    expect(documents).toHaveLength(4);
    expect(eobVersions).toEqual([1, 2]);
    expect(eorVersions).toEqual([1, 2]);
    expect(new Set(documents.map(
      (document) => document.documentId,
    )).size).toBe(4);

    const outboundRecords = Object.values(
      snapshot.outboundRecords,
    );

    expect(outboundRecords).toHaveLength(20);

    documents.forEach((document) => {
      const records = outboundRecords.filter(
        (record) =>
          record.documentId === document.documentId,
      );

      expect(records.map((record) => record.kind).sort()).toEqual(
        [
          'CRM',
          'EMAIL',
          'IXIT',
          'REPORTING',
          'REPRINT_REFERENCE',
        ],
      );
      expect(
        records.every(
          (record) =>
            record.payloadMasked.transmitted === false,
        ),
      ).toBe(true);
    });

    expect(
      Object.values(snapshot.pipelineRuns).every(
        (run) =>
          run.status === 'COMPLETE' &&
          run.completedSteps.length === 9,
      ),
    ).toBe(true);
  });
});