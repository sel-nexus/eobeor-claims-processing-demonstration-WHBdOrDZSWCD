import {
  CLAIMS,
} from '../../../fixtures/membersClaims.js';
import {
  INITIAL_OPERATIONS_ENVELOPE,
  OPERATIONS_FIXTURE_IDS,
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
  createErrorReportService,
} from './errorReportService.js';
import {
  REVIEW_AUDIT_ACTIONS,
  REVIEW_DECISIONS,
  REVIEW_SERVICE_ERROR_CODES,
  createReviewService,
} from './reviewService.js';
import {
  VALIDATION_ERROR_CODES,
  VALIDATION_OUTCOMES,
  createValidationEngine,
} from './validationEngine.js';

const BOS_ACTOR = Object.freeze({
  actorId: 'usr_bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
});

const ADMIN_ACTOR = Object.freeze({
  actorId: 'usr_admin',
  userId: 'usr_admin',
  displayName: 'Administrator',
  role: 'ADMIN',
  memberId: null,
});

const ITS_ACTOR = Object.freeze({
  actorId: 'usr_its',
  userId: 'usr_its',
  displayName: 'IT Support Specialist',
  role: 'ITS',
  memberId: null,
});

const CSR_ACTOR = Object.freeze({
  actorId: 'usr_csr',
  userId: 'usr_csr',
  displayName: 'Customer Service Representative',
  role: 'CSR',
  memberId: null,
});

const REVIEW_ID =
  OPERATIONS_FIXTURE_IDS.reviews.HIGH_VALUE;
const REVIEW_REQUEST_ID =
  OPERATIONS_FIXTURE_IDS.requests.MANUAL_REVIEW;
const QUALITY_ERROR_ID =
  OPERATIONS_FIXTURE_IDS.errors.QUALITY_FAILED;
const HIGH_VALUE_CLAIM_NUMBER = 'CL2024BIG';

const activeHarnesses = new Set();
let namespaceSequence = 0;

function cloneFixture(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function createReviewEnvelope() {
  const envelope = cloneFixture(
    INITIAL_OPERATIONS_ENVELOPE,
  );

  envelope.requests[REVIEW_REQUEST_ID].claimNumber =
    HIGH_VALUE_CLAIM_NUMBER;

  return envelope;
}

function createFixtureGateway() {
  const seededClaim = CLAIMS.find(
    (claim) => claim.claimNumber === 'CL2024004',
  );
  const claimsByNumber = {
    [HIGH_VALUE_CLAIM_NUMBER]: {
      ...cloneFixture(seededClaim),
      claimNumber: HIGH_VALUE_CLAIM_NUMBER,
      patientResponsibilityCents: 360000,
      memberResponsibilityCents: 360000,
    },
  };
  const updateClaim = vi.fn(
    (claimNumber, changes) => {
      const current = claimsByNumber[claimNumber];

      if (current === undefined) {
        const error = new Error(
          'The fictional claim was not found.',
        );

        error.code = 'CLAIM_NOT_FOUND';
        throw error;
      }

      const updated = {
        ...current,
        ...changes,
      };

      claimsByNumber[claimNumber] = updated;
      return updated;
    },
  );

  return {
    updateClaim,
    getClaimByNumber(claimNumber) {
      return claimsByNumber[claimNumber] ?? null;
    },
    findClaimByNumber(claimNumber) {
      return claimsByNumber[claimNumber] ?? null;
    },
    getSnapshot() {
      return {
        claims: Object.values(claimsByNumber),
        claimsByNumber,
        overlayRevision: 0,
        revision: 0,
      };
    },
    getOverlayRevision() {
      return 0;
    },
    getRevision() {
      return 0;
    },
  };
}

function createHarness() {
  namespaceSequence += 1;

  const clock = createTestClock(
    '2024-01-22T12:00:00.000Z',
  );
  const gateway = createStorageGateway({
    namespace:
      `review-error-test-${namespaceSequence}.v1`,
    storage: createMemoryStorage(),
    broadcastChannelFactory: null,
  });
  const repository = createOperationsRepository(gateway, {
    initialEnvelope: createReviewEnvelope(),
    clock,
    idGenerator: createUuidGenerator('91000000'),
  });
  const fixtureGateway = createFixtureGateway();
  const permissionGateway = {
    evaluate: vi.fn(async () => ({
      allowed: true,
    })),
  };
  const auditService = {
    append: vi.fn(async (_context, event) => event),
  };
  const resumeRequest = vi.fn(async (command) => ({
    ok: true,
    status: 200,
    data: {
      requestId: command.requestId,
      status: 'COMPLETE',
      currentStep: 'STORED',
      documentIds: [
        'DOC-EOB-CL2024BIG-V1',
        'DOC-EOR-CL2024BIG-V1',
      ],
      replayed: false,
    },
    meta: {
      revision: repository.getSnapshot().revision,
      warnings: [],
    },
  }));
  const pipelineOrchestrator = {
    resumeRequest,
  };
  const reviewService = createReviewService(repository, {
    fixtureGateway,
    pipelineOrchestrator,
    permissionGateway,
    auditService,
    clock,
    idGenerator: createUuidGenerator('92000000'),
  });
  const errorReportService = createErrorReportService(
    repository,
    {
      permissionGateway,
      auditService,
      clock,
      idGenerator: createUuidGenerator('93000000'),
    },
  );
  const commandIds = createUuidGenerator('94000000');
  const harness = {
    auditService,
    clock,
    commandIds,
    errorReportService,
    fixtureGateway,
    gateway,
    permissionGateway,
    pipelineOrchestrator,
    repository,
    reviewService,
    destroy() {
      gateway.destroy();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
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

describe('Review and error workflows', () => {
  it('routes CL2024BIG to manual review when responsibility exceeds the demo threshold', () => {
    const engine = createValidationEngine({
      referenceDate: '2024-01-22',
      autoApprovalThresholdCents: 50000,
    });
    const result = engine.validateAutoApproval({
      claimNumber: HIGH_VALUE_CLAIM_NUMBER,
      patientResponsibilityCents: 360000,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ruleId: 'MANUAL_REVIEW_THRESHOLD',
        outcome: VALIDATION_OUTCOMES.MANUAL_REVIEW,
        passed: false,
        code:
          VALIDATION_ERROR_CODES.MANUAL_REVIEW_REQUIRED,
        evidence: {
          responsibilityCents: 360000,
          thresholdCents: 50000,
        },
        metadata: expect.objectContaining({
          source: 'Configured setting',
          thresholdCents: 50000,
          unit: 'cents',
        }),
      }),
    );
  });

  it('approves the CL2024BIG review and resumes processing from document generation', async () => {
    const harness = createHarness();
    const idempotencyKey = harness.commandIds();
    const result = await harness.reviewService.decideReview(
      {
        reviewId: REVIEW_ID,
        decision: REVIEW_DECISIONS.APPROVE,
        reasonCode: 'VERIFIED_HIGH_RESPONSIBILITY',
        comment: 'Fictional high-value review verified.',
        idempotencyKey,
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(
      expect.objectContaining({
        reviewId: REVIEW_ID,
        requestId: REVIEW_REQUEST_ID,
        decision: REVIEW_DECISIONS.APPROVE,
        reviewStatus: 'APPROVED',
        requestStatus: 'COMPLETE',
        currentStep: 'STORED',
        documentIds: [
          'DOC-EOB-CL2024BIG-V1',
          'DOC-EOR-CL2024BIG-V1',
        ],
        transmitted: false,
      }),
    );
    expect(
      harness.pipelineOrchestrator.resumeRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: REVIEW_REQUEST_ID,
        mode: 'IMMEDIATE',
        scenario: 'SUCCESS',
        expectedCheckpoint: 'DOCUMENT_GENERATION',
        reviewApproved: true,
        idempotencyKey: expect.any(String),
      }),
      expect.objectContaining({
        actorId: BOS_ACTOR.actorId,
        role: 'BOS',
      }),
    );

    const storedReview =
      harness.repository.getSnapshot().reviews[REVIEW_ID];

    expect(storedReview).toEqual(
      expect.objectContaining({
        status: 'APPROVED',
        decisionBy: BOS_ACTOR.actorId,
        decidedAt: '2024-01-22T12:00:00.000Z',
      }),
    );
    expect(getAuditActions(harness.auditService)).toContain(
      REVIEW_AUDIT_ACTIONS.DECIDED,
    );
  });

  it('rejects a review idempotently and creates only one local error report', async () => {
    const harness = createHarness();
    const command = {
      reviewId: REVIEW_ID,
      decision: REVIEW_DECISIONS.REJECT,
      reasonCode: 'REVIEW_REJECTED',
      comment: 'Fictional review evidence was rejected.',
      idempotencyKey: harness.commandIds(),
    };
    const first = await harness.reviewService.decideReview(
      command,
      ADMIN_ACTOR,
    );
    const replay = await harness.reviewService.decideReview(
      command,
      ADMIN_ACTOR,
    );

    expect(first.ok).toBe(true);
    expect(first.data).toEqual(
      expect.objectContaining({
        decision: 'REJECT',
        reviewStatus: 'REJECTED',
        requestStatus: 'FAILED',
        errorReportId: expect.stringMatching(
          /^ERROR-REVIEW-/,
        ),
        replayed: false,
        transmitted: false,
      }),
    );
    expect(replay.ok).toBe(true);
    expect(replay.data).toEqual(
      expect.objectContaining({
        errorReportId: first.data.errorReportId,
        replayed: true,
        transmitted: false,
      }),
    );

    const snapshot = harness.repository.getSnapshot();
    const createdReports = Object.values(
      snapshot.errorReports,
    ).filter(
      (report) =>
        report.requestId === REVIEW_REQUEST_ID &&
        report.summary === 'Manual review rejected',
    );

    expect(createdReports).toHaveLength(1);
    expect(
      snapshot.requests[REVIEW_REQUEST_ID],
    ).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        errorReportId: first.data.errorReportId,
      }),
    );
    expect(snapshot.reviews[REVIEW_ID].status).toBe(
      'REJECTED',
    );
    expect(
      harness.pipelineOrchestrator.resumeRequest,
    ).not.toHaveBeenCalled();
    expect(
      getAuditActions(harness.auditService).filter(
        (action) => action === REVIEW_AUDIT_ACTIONS.DECIDED,
      ),
    ).toHaveLength(1);
  });

  it('requires a reason code before applying a claim responsibility adjustment', async () => {
    const harness = createHarness();
    const result = await harness.reviewService.adjustClaim(
      {
        claimNumber: HIGH_VALUE_CLAIM_NUMBER,
        field: 'patientResponsibilityCents',
        newValue: 48000,
        reasonCode: '',
        comment: 'Missing reason demonstration.',
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: REVIEW_SERVICE_ERROR_CODES.REASON_REQUIRED,
        retryable: false,
      }),
    );
    expect(result.error.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'reasonCode',
          code: 'REASON_REQUIRED',
        }),
      ]),
    );
    expect(
      harness.fixtureGateway.updateClaim,
    ).not.toHaveBeenCalled();
  });

  it('applies a reason-coded adjustment as BOS and records before and after values', async () => {
    const harness = createHarness();
    const result = await harness.reviewService.adjustClaim(
      {
        claimNumber: HIGH_VALUE_CLAIM_NUMBER,
        field: 'patientResponsibilityCents',
        newValue: 48000,
        reasonCode: 'COORDINATION_OF_BENEFITS',
        comment: 'Adjusted fictional responsibility.',
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        claimNumber: HIGH_VALUE_CLAIM_NUMBER,
        field: 'patientResponsibilityCents',
        beforeValue: 360000,
        newValue: 48000,
        reasonCode: 'COORDINATION_OF_BENEFITS',
        adjustedBy: BOS_ACTOR.actorId,
        localOnly: true,
        transmitted: false,
        replayed: false,
      }),
    );
    expect(
      harness.fixtureGateway.updateClaim,
    ).toHaveBeenCalledWith(
      HIGH_VALUE_CLAIM_NUMBER,
      {
        patientResponsibilityCents: 48000,
      },
      expect.objectContaining({
        expectedRevision: 0,
        expectedRootRevision: 0,
        updatedBy: BOS_ACTOR.actorId,
        reasonCode: 'COORDINATION_OF_BENEFITS',
      }),
    );
    expect(getAuditActions(harness.auditService)).toContain(
      REVIEW_AUDIT_ACTIONS.CLAIM_ADJUSTED,
    );
  });

  it('denies CSR review decisions without changing review or request state', async () => {
    const harness = createHarness();
    const before = harness.repository.getSnapshot();
    const result = await harness.reviewService.decideReview(
      {
        reviewId: REVIEW_ID,
        decision: REVIEW_DECISIONS.APPROVE,
        reasonCode: 'CSR_NOT_ALLOWED',
        comment: '',
        idempotencyKey: harness.commandIds(),
      },
      CSR_ACTOR,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: REVIEW_SERVICE_ERROR_CODES.FORBIDDEN,
        retryable: false,
      }),
    );
    expect(
      harness.repository.getSnapshot().reviews[REVIEW_ID],
    ).toEqual(before.reviews[REVIEW_ID]);
    expect(
      harness.repository.getSnapshot().requests[
        REVIEW_REQUEST_ID
      ],
    ).toEqual(before.requests[REVIEW_REQUEST_ID]);
    expect(
      harness.pipelineOrchestrator.resumeRequest,
    ).not.toHaveBeenCalled();
  });

  it('allows ITS to view and export a sanitized fictional error report', async () => {
    const harness = createHarness();
    const viewed =
      await harness.errorReportService.getErrorReport(
        {
          errorReportId: QUALITY_ERROR_ID,
        },
        ITS_ACTOR,
      );
    const exported =
      await harness.errorReportService.actOnErrorReport(
        {
          errorReportId: QUALITY_ERROR_ID,
          action: 'EXPORT',
          idempotencyKey: harness.commandIds(),
        },
        ITS_ACTOR,
      );

    expect(viewed.ok).toBe(true);
    expect(viewed.data).toEqual(
      expect.objectContaining({
        errorReportId: QUALITY_ERROR_ID,
        severity: 'ERROR',
        status: 'OPEN',
        summary: 'Document quality check failed',
        footer: 'Fictional demo data',
      }),
    );
    expect(exported.ok).toBe(true);
    expect(exported.data).toEqual(
      expect.objectContaining({
        errorReportId: QUALITY_ERROR_ID,
        action: 'EXPORT',
        status: 'OPEN',
        filename: `error-report-${QUALITY_ERROR_ID}.json`,
        mediaType: 'application/json',
        notice: 'Fictional demo data',
        localOnly: true,
        transmitted: false,
        replayed: false,
        blob: expect.any(globalThis.Blob),
      }),
    );
    expect(
      harness.repository.getSnapshot().errorReports[
        QUALITY_ERROR_ID
      ].status,
    ).toBe('OPEN');
  });

  it('queues and closes an error report locally without external transmission', async () => {
    const harness = createHarness();
    const queued =
      await harness.errorReportService.actOnErrorReport(
        {
          errorReportId: QUALITY_ERROR_ID,
          action: 'QUEUE',
          idempotencyKey: harness.commandIds(),
        },
        BOS_ACTOR,
      );

    expect(queued.ok).toBe(true);
    expect(queued.data).toEqual(
      expect.objectContaining({
        errorReportId: QUALITY_ERROR_ID,
        action: 'QUEUE',
        status: 'QUEUED',
        exceptionQueueId: expect.stringMatching(/^EXQ-/),
        localOnly: true,
        transmitted: false,
        replayed: false,
      }),
    );

    const closed =
      await harness.errorReportService.actOnErrorReport(
        {
          errorReportId: QUALITY_ERROR_ID,
          action: 'CLOSE',
          idempotencyKey: harness.commandIds(),
        },
        ADMIN_ACTOR,
      );

    expect(closed.ok).toBe(true);
    expect(closed.data).toEqual(
      expect.objectContaining({
        errorReportId: QUALITY_ERROR_ID,
        action: 'CLOSE',
        status: 'CLOSED',
        localOnly: true,
        transmitted: false,
        replayed: false,
      }),
    );

    const stored =
      harness.repository.getSnapshot().errorReports[
        QUALITY_ERROR_ID
      ];

    expect(stored.status).toBe('CLOSED');
    expect(stored.auditTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'QUEUED',
          actor: BOS_ACTOR.actorId,
        }),
        expect.objectContaining({
          action: 'CLOSED',
          actor: ADMIN_ACTOR.actorId,
        }),
      ]),
    );
  });

  it('rejects closing an already closed error report and denies CSR error access', async () => {
    const harness = createHarness();

    await harness.errorReportService.actOnErrorReport(
      {
        errorReportId: QUALITY_ERROR_ID,
        action: 'CLOSE',
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    const alreadyClosed =
      await harness.errorReportService.actOnErrorReport(
        {
          errorReportId: QUALITY_ERROR_ID,
          action: 'CLOSE',
          idempotencyKey: harness.commandIds(),
        },
        BOS_ACTOR,
      );
    const csrView =
      await harness.errorReportService.getErrorReport(
        {
          errorReportId: QUALITY_ERROR_ID,
        },
        CSR_ACTOR,
      );

    expect(alreadyClosed.ok).toBe(false);
    expect(alreadyClosed.status).toBe(409);
    expect(alreadyClosed.error).toEqual(
      expect.objectContaining({
        code: 'INVALID_STATE',
        retryable: false,
      }),
    );
    expect(csrView.ok).toBe(false);
    expect(csrView.status).toBe(403);
    expect(csrView.error).toEqual(
      expect.objectContaining({
        code: 'FORBIDDEN',
        retryable: false,
      }),
    );
  });
});