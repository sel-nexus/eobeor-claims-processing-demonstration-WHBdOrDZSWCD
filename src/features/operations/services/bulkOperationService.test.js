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
  BULK_OPERATION_AUDIT_ACTIONS,
  BULK_OPERATION_EXPORT_NOTICE,
  BULK_OPERATION_SERVICE_ERROR_CODES,
  createBulkOperationService,
} from './bulkOperationService.js';

const BOS_ACTOR = Object.freeze({
  actorId: 'usr_bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
});

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

function createUuidGenerator(namespace = '95000000') {
  let sequence = 0;

  return () => {
    sequence += 1;

    return `${namespace}-0000-4000-8000-${sequence
      .toString(16)
      .padStart(12, '0')}`;
  };
}

function createHarness({
  permissionDecision = {
    allowed: true,
    role: BOS_ACTOR.role,
    userId: BOS_ACTOR.userId,
  },
  processRequest,
} = {}) {
  namespaceSequence += 1;

  const clock = createTestClock(
    '2024-01-22T12:00:00.000Z',
  );
  const gateway = createStorageGateway({
    namespace:
      `bulk-operation-service-test-${namespaceSequence}.v1`,
    storage: createMemoryStorage(),
    broadcastChannelFactory: null,
  });
  const repository = createOperationsRepository(gateway, {
    initialEnvelope: INITIAL_OPERATIONS_ENVELOPE,
    clock,
    idGenerator: createUuidGenerator('95100000'),
  });
  const processor = {
    processRequest:
      processRequest ??
      vi.fn(async (command) => ({
        ok: true,
        status: 200,
        data: {
          requestId: command.requestId,
          status: 'COMPLETE',
          documentIds: [],
        },
      })),
  };
  const permissionGateway = {
    evaluate: vi.fn(async () => permissionDecision),
  };
  const auditService = {
    append: vi.fn(async (_context, event) => event),
  };
  const service = createBulkOperationService(repository, {
    pipelineOrchestrator: processor,
    permissionGateway,
    auditService,
    clock,
    idGenerator: createUuidGenerator('95200000'),
  });
  const commandIds = createUuidGenerator('95300000');
  const harness = {
    auditService,
    commandIds,
    gateway,
    permissionGateway,
    processor,
    repository,
    service,
    destroy() {
      gateway.destroy();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
}

async function readBlobText(blob) {
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();

    reader.onerror = () => {
      reject(
        reader.error ??
          new Error('The exported Blob could not be read.'),
      );
    };
    reader.onload = () => {
      resolve(String(reader.result ?? ''));
    };
    reader.readAsText(blob);
  });
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

describe('BulkOperationService', () => {
  it('filters and sorts browser-local requests using deterministic queue queries', async () => {
    const harness = createHarness();
    const filtered = await harness.service.listRequests(
      {
        statuses: ['PENDING', 'FAILED'],
        page: 1,
        limit: 20,
        sortBy: 'PRIORITY',
        sortDirection: 'ASC',
      },
      BOS_ACTOR,
    );

    expect(filtered.ok).toBe(true);
    expect(filtered.status).toBe(200);
    expect(
      filtered.data.items.map((request) => ({
        displayId: request.displayId,
        priority: request.priority,
        status: request.status,
      })),
    ).toEqual([
      {
        displayId: 'REQ-000002',
        priority: 'HIGH',
        status: 'PENDING',
      },
      {
        displayId: 'REQ-000004',
        priority: 'NORMAL',
        status: 'FAILED',
      },
    ]);
    expect(filtered.data.total).toBe(2);

    const searched = await harness.service.listRequests(
      {
        search: 'quality-failure',
        page: 1,
        limit: 20,
        sortBy: 'DISPLAY_ID',
        sortDirection: 'ASC',
      },
      BOS_ACTOR,
    );

    expect(searched.ok).toBe(true);
    expect(searched.data.items).toHaveLength(1);
    expect(searched.data.items[0]).toEqual(
      expect.objectContaining({
        requestId:
          OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
        displayId: 'REQ-000004',
        status: 'FAILED',
      }),
    );
    expect(
      harness.permissionGateway.evaluate,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: {
          type: 'OPERATIONS_QUEUE',
          id: 'local',
        },
        session: expect.objectContaining({
          actorId: BOS_ACTOR.actorId,
          role: 'BOS',
        }),
      }),
    );
  });

  it('denies queue access when the permission gateway rejects the operation', async () => {
    const harness = createHarness({
      permissionDecision: {
        allowed: false,
        reasonCode: 'ROLE_NOT_ALLOWED',
      },
    });
    const result = await harness.service.listRequests(
      {
        page: 1,
        limit: 20,
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toEqual(
      expect.objectContaining({
        code:
          BULK_OPERATION_SERVICE_ERROR_CODES.FORBIDDEN,
        message:
          'Bulk queue operations are available only to BOS and Admin demo roles.',
        retryable: false,
      }),
    );
    expect(result).not.toHaveProperty('data');
    expect(harness.processor.processRequest).not.toHaveBeenCalled();
    expect(harness.auditService.append).not.toHaveBeenCalled();
  });

  it('returns validation errors for duplicate request identifiers without processing rows', async () => {
    const harness = createHarness();
    const requestId =
      OPERATIONS_FIXTURE_IDS.requests.PENDING;
    const result = await harness.service.bulkProcess(
      {
        requestIds: [requestId, requestId],
        action: 'PROCESS',
        scenario: 'SUCCESS',
        mode: 'IMMEDIATE',
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toEqual(
      expect.objectContaining({
        code:
          BULK_OPERATION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        retryable: false,
      }),
    );
    expect(result.error.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'requestIds',
          code: 'DUPLICATE_IDENTIFIER',
        }),
      ]),
    );
    expect(harness.processor.processRequest).not.toHaveBeenCalled();
    expect(
      harness.permissionGateway.evaluate,
    ).not.toHaveBeenCalled();
    expect(harness.auditService.append).not.toHaveBeenCalled();
  });

  it('settles processable rows independently and audits every selected result', async () => {
    const pendingRequestId =
      OPERATIONS_FIXTURE_IDS.requests.PENDING;
    const failedRequestId =
      OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED;
    const completedRequestId =
      OPERATIONS_FIXTURE_IDS.requests.COMPLETE;
    const processRequest = vi.fn(async (command) => {
      if (command.requestId === failedRequestId) {
        throw Object.assign(
          new Error('Scripted row processing failure.'),
          {
            code: 'SCRIPTED_ROW_FAILURE',
          },
        );
      }

      return {
        ok: true,
        status: 200,
        data: {
          requestId: command.requestId,
          status: 'COMPLETE',
          documentIds: ['DOC-EOR-DEMO-V2'],
        },
      };
    });
    const harness = createHarness({ processRequest });
    const result = await harness.service.bulkProcess(
      {
        requestIds: [
          pendingRequestId,
          failedRequestId,
          completedRequestId,
        ],
        action: 'PROCESS',
        scenario: 'SUCCESS',
        mode: 'IMMEDIATE',
        idempotencyKey: harness.commandIds(),
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(
      expect.objectContaining({
        operationId: expect.stringMatching(/^BULK-/),
        action: 'PROCESS',
        processed: 3,
        completed: 1,
        failed: 2,
        eligibilityRevision: 1,
        localOnly: true,
        transmitted: false,
        replayed: false,
      }),
    );
    expect(result.data.results).toEqual([
      {
        requestId: pendingRequestId,
        status: 'COMPLETE',
        errorCode: null,
        documentIds: ['DOC-EOR-DEMO-V2'],
      },
      {
        requestId: failedRequestId,
        status: 'FAILED',
        errorCode: 'SCRIPTED_ROW_FAILURE',
      },
      {
        requestId: completedRequestId,
        status: 'FAILED',
        errorCode:
          BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_STATE,
        sourceStatus: 'COMPLETE',
      },
    ]);
    expect(processRequest).toHaveBeenCalledTimes(2);
    expect(
      processRequest.mock.calls.map(
        ([command]) => command.requestId,
      ),
    ).toEqual([pendingRequestId, failedRequestId]);
    expect(
      processRequest.mock.calls.every(
        ([command]) =>
          command.mode === 'IMMEDIATE' &&
          command.scenario === 'SUCCESS' &&
          /^[0-9a-f-]{36}$/.test(
            command.idempotencyKey,
          ),
      ),
    ).toBe(true);

    expect(harness.auditService.append).toHaveBeenCalledTimes(3);
    expect(getAuditActions(harness.auditService)).toEqual([
      BULK_OPERATION_AUDIT_ACTIONS.ROW_PROCESSED,
      BULK_OPERATION_AUDIT_ACTIONS.ROW_PROCESSED,
      BULK_OPERATION_AUDIT_ACTIONS.ROW_PROCESSED,
    ]);
    expect(
      harness.auditService.append.mock.calls.map(
        ([context, event]) => ({
          entityId: context.entity.id,
          status: event.after.status,
          errorCode: event.after.errorCode,
          transmitted: event.after.transmitted,
        }),
      ),
    ).toEqual([
      {
        entityId: pendingRequestId,
        status: 'COMPLETE',
        errorCode: null,
        transmitted: false,
      },
      {
        entityId: failedRequestId,
        status: 'FAILED',
        errorCode: 'SCRIPTED_ROW_FAILURE',
        transmitted: false,
      },
      {
        entityId: completedRequestId,
        status: 'FAILED',
        errorCode:
          BULK_OPERATION_SERVICE_ERROR_CODES.INVALID_STATE,
        transmitted: false,
      },
    ]);

    const storedIdempotency =
      harness.repository.getSnapshot().idempotencyResults[
        result.meta.correlationId
      ];

    expect(storedIdempotency).toBeUndefined();
    expect(
      Object.values(
        harness.repository.getSnapshot().idempotencyResults,
      ).some(
        (record) =>
          record.commandName === 'bulkProcess' &&
          record.result.operationId ===
            result.data.operationId,
      ),
    ).toBe(true);
  });

  it('exports only represented queue columns to a local formula-safe fictional CSV', async () => {
    const harness = createHarness();
    const result = await harness.service.exportRows(
      {
        filters: {
          statuses: ['COMPLETE'],
          sortBy: 'DISPLAY_ID',
          sortDirection: 'ASC',
        },
        filename: 'represented-queue.csv',
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(
      expect.objectContaining({
        filename: 'represented-queue.csv',
        mediaType: 'text/csv;charset=utf-8',
        mimeType: 'text/csv',
        rowCount: 1,
        truncated: false,
        notice: BULK_OPERATION_EXPORT_NOTICE,
        localOnly: true,
        transmitted: false,
        downloadToken: 'blob:browser-local',
        blob: expect.any(globalThis.Blob),
      }),
    );

    const csv = await readBlobText(result.data.blob);

    expect(csv).toContain(
      'display_id,claim_number,request_type,priority,status,created_at',
    );
    expect(csv).toContain(
      'REQ-000001,CL2024001,BOTH,URGENT,COMPLETE,2024-01-22T09:55:00.000Z',
    );
    expect(csv).not.toContain('member_id');
    expect(csv).not.toContain('123456789');
    expect(csv).not.toContain('source_detail');
    expect(csv).not.toContain('documentReferences');
    expect(harness.auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action:
          BULK_OPERATION_AUDIT_ACTIONS.EXPORTED,
        entity: expect.objectContaining({
          type: 'OPERATIONS_QUEUE',
        }),
      }),
      expect.objectContaining({
        action:
          BULK_OPERATION_AUDIT_ACTIONS.EXPORTED,
        after: expect.objectContaining({
          filename: 'represented-queue.csv',
          rowCount: 1,
          notice: BULK_OPERATION_EXPORT_NOTICE,
          localOnly: true,
          transmitted: false,
        }),
        outcome: 'SUCCESS',
      }),
    );
  });
});