import {
  AP_REPRINT_HEADER,
  CHANGE_835_HEADER,
} from '../../../fixtures/operations.js';
import {
  CLAIMS,
  MEMBERS,
} from '../../../fixtures/membersClaims.js';
import {
  createCsvFixtureParser,
} from './csvFixtureParser.js';
import {
  INBOUND_AUDIT_ACTIONS,
  INBOUND_SERVICE_ERROR_CODES,
  createInboundService,
} from './inboundService.js';

const BOS_ACTOR = Object.freeze({
  actorId: 'usr_bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
});

const activeHarnesses = new Set();
let harnessSequence = 0;

function cloneFixture(value) {
  return JSON.parse(JSON.stringify(value));
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

function createInMemoryOperationsRepository() {
  let envelope = createEmptyOperationsEnvelope();

  return {
    getSnapshot() {
      return envelope;
    },
    transact(mutator, options = {}) {
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== envelope.revision
      ) {
        const error = new Error(
          'Operations data changed before the mutation.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      const draft = cloneFixture(envelope);
      const result = mutator(draft);
      const candidate =
        result === undefined ? draft : result;

      envelope = {
        ...candidate,
        schemaVersion: 1,
        revision: envelope.revision + 1,
        commitId:
          `80000000-0000-4000-8000-${(
            envelope.revision + 2
          )
            .toString(16)
            .padStart(12, '0')}`,
        updatedAt: '2024-01-22T12:00:00.000Z',
      };

      return envelope;
    },
  };
}

function createFixtureGateway() {
  const claims = cloneFixture(CLAIMS);
  const members = cloneFixture(MEMBERS);
  const claimsByNumber = Object.fromEntries(
    claims.map((claim) => [claim.claimNumber, claim]),
  );
  const membersById = Object.fromEntries(
    members.map((member) => [member.memberId, member]),
  );

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
    getMemberById(memberId) {
      return membersById[memberId] ?? null;
    },
    getSnapshot() {
      return {
        claims: Object.values(claimsByNumber),
        claimsByNumber,
        members,
        membersById,
      };
    },
  };
}

function createRequestService(fixtureGateway) {
  const nextRequestId = createUuidGenerator('71000000');

  return {
    createRequest: vi.fn(async (command) => {
      const claim = fixtureGateway.getClaimByNumber(
        command.claimNumber,
      );
      const member = fixtureGateway.getMemberById(
        command.memberId,
      );

      if (claim === null) {
        return {
          ok: false,
          status: 404,
          error: {
            code: 'CLAIM_NOT_FOUND',
            message: 'The fictional claim was not found.',
          },
        };
      }

      if (
        member === null ||
        claim.memberId !== command.memberId
      ) {
        return {
          ok: false,
          status: 422,
          error: {
            code: 'MEMBER_CLAIM_MISMATCH',
            message:
              'The fictional claim does not belong to the supplied member.',
          },
        };
      }

      const requestId = nextRequestId();

      return {
        ok: true,
        status: 201,
        data: {
          requestId,
          request: {
            requestId,
            claimNumber: command.claimNumber,
            memberId: command.memberId,
            requestType: command.requestType,
            priority: command.priority,
            sourceType: command.sourceType,
            sourceDetail: command.sourceDetail,
            status: 'PENDING',
          },
        },
      };
    }),
  };
}

function createHarness() {
  harnessSequence += 1;

  const repository = createInMemoryOperationsRepository();
  const fixtureGateway = createFixtureGateway();
  const requestService = createRequestService(
    fixtureGateway,
  );
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
  const parser = createCsvFixtureParser();
  const service = createInboundService(repository, {
    csvParser: parser,
    requestService,
    fixtureGateway,
    permissionGateway,
    auditService,
    clock: {
      nowIso() {
        return '2024-01-22T12:00:00.000Z';
      },
    },
    idGenerator: createUuidGenerator(
      `${(90000000 + harnessSequence)
        .toString()
        .slice(0, 8)}`,
    ),
  });
  const commandIds = createUuidGenerator('72000000');
  const harness = {
    auditService,
    commandIds,
    fixtureGateway,
    parser,
    permissionGateway,
    repository,
    requestService,
    service,
    destroy() {
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
}

function createApplyCommand(
  harness,
  scenarioId,
  overrides = {},
) {
  const fixture = harness.parser
    .listApprovedFixtures()
    .find(
      (candidate) =>
        candidate.scenarioId === scenarioId,
    );

  if (fixture === undefined) {
    throw new Error(
      `Approved fixture ${scenarioId} was not found.`,
    );
  }

  return {
    scenarioId: fixture.scenarioId,
    feedType: fixture.feedType,
    filename: fixture.filename,
    maskedApiKeyId: fixture.maskedApiKeyId,
    header: fixture.header,
    idempotencyKey: harness.commandIds(),
    ...overrides,
  };
}

function getAuditActions(auditService) {
  return auditService.append.mock.calls.map(
    ([context]) => context.action,
  );
}

function expectNoNetworkAccess() {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
  expect(globalThis.WebSocket).not.toHaveBeenCalled();
  expect(globalThis.EventSource).not.toHaveBeenCalled();
  expect(
    globalThis.navigator.sendBeacon,
  ).not.toHaveBeenCalled();
}

afterEach(() => {
  [...activeHarnesses].forEach((harness) => {
    harness.destroy();
  });
});

describe('InboundService', () => {
  it('validates the exact ordered AP and 835 headers and rejects reordered columns', () => {
    const parser = createCsvFixtureParser();
    const apResult = parser.validateHeader(
      'AP_REPRINT',
      AP_REPRINT_HEADER,
    );
    const changeResult = parser.validateHeader(
      'CHANGE_835',
      CHANGE_835_HEADER,
    );
    const reorderedResult = parser.validateHeader(
      'AP_REPRINT',
      [
        'member_id',
        'claim_number',
        'request_type',
        'priority',
        'source_reference',
      ],
    );

    expect(apResult).toEqual(
      expect.objectContaining({
        valid: true,
        code: null,
        feedType: 'AP_REPRINT',
        expectedHeader: AP_REPRINT_HEADER,
      }),
    );
    expect(changeResult).toEqual(
      expect.objectContaining({
        valid: true,
        code: null,
        feedType: 'CHANGE_835',
        expectedHeader: CHANGE_835_HEADER,
      }),
    );
    expect(reorderedResult).toEqual(
      expect.objectContaining({
        valid: false,
        code: 'BAD_HEADER',
        feedType: 'AP_REPRINT',
      }),
    );
    expectNoNetworkAccess();
  });

  it('processes an approved AP fixture with File Feed provenance and local audit evidence', async () => {
    const harness = createHarness();
    const result = await harness.service.applyInboundRows(
      createApplyCommand(harness, 'AP-VALID-SINGLE'),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data).toEqual(
      expect.objectContaining({
        feedType: 'AP_REPRINT',
        filename: 'ap-reprints-valid.csv',
        status: 'COMPLETE',
        accepted: 1,
        failed: 0,
        disclosure: 'No file leaves this browser',
        localOnly: true,
        transmitted: false,
        replayed: false,
      }),
    );
    expect(result.data.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        status: 'APPLIED',
        attempt: 1,
        errorCode: null,
        requestId: expect.stringMatching(
          /^71000000-0000-4000-8000-/,
        ),
      }),
    ]);
    expect(
      harness.requestService.createRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        claimNumber: 'CL2024002',
        memberId: '987654321',
        requestType: 'EOR',
        priority: 'HIGH',
        sourceType: 'FILE_FEED',
        sourceDetail: 'AP reprint row AP-77',
        processNow: false,
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f-]{36}$/,
        ),
      }),
      expect.objectContaining({
        role: 'BOS',
        actorId: 'usr_bos',
      }),
    );

    const storedRun =
      harness.repository.getSnapshot().inboundRuns[
        result.data.feedRunId
      ];

    expect(storedRun).toEqual(
      expect.objectContaining({
        feedType: 'AP_REPRINT',
        maskedApiKeyId: '****A19F',
        header: AP_REPRINT_HEADER,
        status: 'COMPLETE',
      }),
    );
    expect(getAuditActions(harness.auditService)).toContain(
      INBOUND_AUDIT_ACTIONS.ROW_APPLIED,
    );
    expectNoNetworkAccess();
  });

  it('rejects a bad AP header before applying any rows', async () => {
    const harness = createHarness();
    const result = await harness.service.applyInboundRows(
      createApplyCommand(harness, 'AP-BAD-HEADER'),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: INBOUND_SERVICE_ERROR_CODES.BAD_HEADER,
        message:
          'Inbound fixture header does not match the exact ordered feed schema.',
      }),
    );
    expect(
      harness.requestService.createRequest,
    ).not.toHaveBeenCalled();

    const runs = Object.values(
      harness.repository.getSnapshot().inboundRuns,
    );

    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(
      expect.objectContaining({
        feedType: 'AP_REPRINT',
        status: 'FAILED',
        rows: [],
      }),
    );
    expect(harness.auditService.append).not.toHaveBeenCalled();
    expectNoNetworkAccess();
  });

  it('retains an applied AP sibling when another row fails validation', async () => {
    const harness = createHarness();
    const result = await harness.service.applyInboundRows(
      createApplyCommand(harness, 'AP-MIXED-ROWS'),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: 'COMPLETED_WITH_ERRORS',
        accepted: 1,
        failed: 1,
      }),
    );
    expect(result.data.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        status: 'APPLIED',
        errorCode: null,
      }),
      expect.objectContaining({
        rowNumber: 3,
        status: 'FAILED',
        errorCode: 'CLAIM_NOT_FOUND',
        resultReference: null,
      }),
    ]);

    const storedRun =
      harness.repository.getSnapshot().inboundRuns[
        result.data.feedRunId
      ];

    expect(storedRun.rows[0].status).toBe('APPLIED');
    expect(storedRun.rows[1].status).toBe('FAILED');
    expect(
      harness.requestService.createRequest,
    ).toHaveBeenCalledTimes(2);
    expect(getAuditActions(harness.auditService)).toEqual(
      expect.arrayContaining([
        INBOUND_AUDIT_ACTIONS.ROW_APPLIED,
        INBOUND_AUDIT_ACTIONS.ROW_FAILED,
      ]),
    );
    expectNoNetworkAccess();
  });

  it('retries only the corrected failed AP row and preserves its successful sibling', async () => {
    const harness = createHarness();
    const initial = await harness.service.applyInboundRows(
      createApplyCommand(harness, 'AP-MIXED-ROWS'),
      BOS_ACTOR,
    );

    expect(initial.ok).toBe(true);

    const retry = await harness.service.retryInboundRow(
      {
        feedRunId: initial.data.feedRunId,
        rowNumber: 3,
        correctedValues: {
          claim_number: 'CL2024003',
          member_id: '123456789',
          request_type: 'EOB',
          priority: 'NORMAL',
          source_reference: 'AP-79-CORRECTED',
        },
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(retry.ok).toBe(true);
    expect(retry.status).toBe(200);
    expect(retry.data).toEqual(
      expect.objectContaining({
        feedRunId: initial.data.feedRunId,
        feedType: 'AP_REPRINT',
        rowNumber: 3,
        attempt: 2,
        status: 'APPLIED',
        errorCode: null,
        requestId: expect.stringMatching(
          /^71000000-0000-4000-8000-/,
        ),
        localOnly: true,
        transmitted: false,
      }),
    );

    const storedRun =
      harness.repository.getSnapshot().inboundRuns[
        initial.data.feedRunId
      ];

    expect(storedRun.status).toBe('COMPLETE');
    expect(storedRun.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        status: 'APPLIED',
        attempt: 1,
      }),
      expect.objectContaining({
        rowNumber: 3,
        status: 'APPLIED',
        attempt: 2,
        errorCode: null,
      }),
    ]);
    expect(getAuditActions(harness.auditService)).toContain(
      INBOUND_AUDIT_ACTIONS.ROW_RETRIED,
    );
    expectNoNetworkAccess();
  });

  it('applies an allowlisted 835 update and stores local CDC and audit evidence', async () => {
    const harness = createHarness();
    const result = await harness.service.applyInboundRows(
      createApplyCommand(
        harness,
        '835-ALLOWLISTED-CHANGE',
      ),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        feedType: 'CHANGE_835',
        filename: 'change-835-valid.csv',
        status: 'COMPLETE',
        accepted: 1,
        failed: 0,
        localOnly: true,
        transmitted: false,
      }),
    );
    expect(
      harness.fixtureGateway.updateClaim,
    ).toHaveBeenCalledWith(
      'CL2024002',
      {
        providerReference: 'PRV1003',
      },
      expect.objectContaining({
        updatedBy: 'usr_bos',
        reasonCode: undefined,
      }),
    );
    expect(
      harness.fixtureGateway.getClaimByNumber(
        'CL2024002',
      ).providerReference,
    ).toBe('PRV1003');

    const cdcEvents = Object.values(
      harness.repository.getSnapshot().cdcEvents,
    );

    expect(cdcEvents).toHaveLength(1);
    expect(cdcEvents[0]).toEqual(
      expect.objectContaining({
        operation: 'UPDATE',
        entityType: 'CLAIM',
        entityId: 'CL2024002',
        before: {
          field: 'provider_reference',
          value: 'PRV1003',
        },
        after: {
          field: 'provider_reference',
          value: 'PRV1003',
        },
        correlationId: expect.stringMatching(/^corr-/),
      }),
    );
    expect(getAuditActions(harness.auditService)).toEqual(
      expect.arrayContaining([
        INBOUND_AUDIT_ACTIONS.ROW_APPLIED,
        INBOUND_AUDIT_ACTIONS.CDC_EVENT_CREATED,
      ]),
    );
    expect(
      harness.requestService.createRequest,
    ).not.toHaveBeenCalled();
    expectNoNetworkAccess();
  });

  it('rejects a non-allowlisted 835 field without updating the claim or creating CDC evidence', async () => {
    const harness = createHarness();
    const result = await harness.service.applyInboundRows(
      createApplyCommand(
        harness,
        '835-BLOCKED-FIELD',
      ),
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        accepted: 0,
        failed: 1,
      }),
    );
    expect(result.data.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        status: 'FAILED',
        attempt: 1,
        errorCode:
          INBOUND_SERVICE_ERROR_CODES.FIELD_NOT_ALLOWLISTED,
        resultReference: null,
      }),
    ]);
    expect(
      harness.fixtureGateway.updateClaim,
    ).not.toHaveBeenCalled();
    expect(
      Object.values(
        harness.repository.getSnapshot().cdcEvents,
      ),
    ).toEqual([]);
    expect(getAuditActions(harness.auditService)).toContain(
      INBOUND_AUDIT_ACTIONS.ROW_FAILED,
    );
    expect(getAuditActions(harness.auditService)).not.toContain(
      INBOUND_AUDIT_ACTIONS.CDC_EVENT_CREATED,
    );
    expectNoNetworkAccess();
  });
});