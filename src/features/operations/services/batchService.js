import { NIGHTLY_QUEUE_ROWS } from '../../../fixtures/operations.js';
import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  BATCH_ROW_STATUSES,
  BATCH_STATUSES,
} from '../domain/domainConstants.js';
import { isOperationsUuid } from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';
import {
  BATCH_MACHINE_STATUSES,
  BATCH_ROW_SCENARIOS,
  createBatchMachine,
} from './batchMachine.js';

export const BATCH_SERVICE_SCHEMA_VERSION = 1;

export const BATCH_EXECUTION_MODES = Object.freeze({
  IMMEDIATE: 'IMMEDIATE',
  NIGHTLY_BATCH: 'NIGHTLY_BATCH',
});

export const BATCH_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  CLAIM_NOT_ELIGIBLE: 'CLAIM_NOT_ELIGIBLE',
  REASON_REQUIRED: 'REASON_REQUIRED',
  BATCH_NOT_FOUND: 'BATCH_NOT_FOUND',
  ROW_NOT_FOUND: 'ROW_NOT_FOUND',
  ROW_NOT_RETRYABLE: 'ROW_NOT_RETRYABLE',
  INVALID_RESOLUTION: 'INVALID_RESOLUTION',
  RUN_ALREADY_ACTIVE: 'RUN_ALREADY_ACTIVE',
  DUPLICATE_OPEN_REQUEST: 'DUPLICATE_OPEN_REQUEST',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  VERSION_COUNT_MISMATCH: 'VERSION_COUNT_MISMATCH',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  REQUEST_CREATION_FAILED: 'REQUEST_CREATION_FAILED',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const BATCH_AUDIT_ACTIONS = Object.freeze({
  STARTED: 'BATCH_STARTED',
  ROW_PROCESSED: 'BATCH_ROW_PROCESSED',
  COMPLETED: 'BATCH_COMPLETED',
  ROW_RETRIED: 'BATCH_ROW_RETRIED',
  CLAIM_REWORKED: 'CLAIM_REWORKED',
  CLAIM_REWORK_QUEUED: 'CLAIM_REWORK_QUEUED',
});

export const BATCH_SERVICE_LIMITS = Object.freeze({
  MAXIMUM_ROWS: 5000,
  MAXIMUM_RETRY_ATTEMPTS: 3,
  MAXIMUM_IDENTIFIER_LENGTH: 100,
  MAXIMUM_REASON_LENGTH: 100,
  MAXIMUM_NOTES_LENGTH: 500,
});

const EXECUTION_MODE_VALUES = new Set(
  Object.values(BATCH_EXECUTION_MODES),
);
const ROW_SCENARIO_VALUES = new Set(
  Object.values(BATCH_ROW_SCENARIOS),
);
const INTERNAL_ROLES = new Set(['BOS', 'ADMIN']);
const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const MASKED_PAYMENT_PATTERN =
  /^(?:\*{4,}[A-Za-z0-9]{1,16}|\[REDACTED(?::[A-Z]+)?\])$/;
const REWORK_BATCH_PREFIX = 'BATCH-REWORK-';
const REWORK_ROW_PREFIX = 'BROW-REWORK-';

function deepFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreeze(item)));
  }

  if (isPlainObject(value)) {
    const clone = {};

    Object.entries(value).forEach(([key, item]) => {
      clone[key] = deepFreeze(item);
    });

    return Object.freeze(clone);
  }

  return value;
}

function cloneMutable(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneMutable(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneMutable(item),
      ]),
    );
  }

  return value;
}

function requireRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getSnapshot !== 'function' ||
    typeof value.transact !== 'function'
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service requires an operations repository with getSnapshot() and transact().',
    );
  }

  return value;
}

function normalizeRequestService(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.createRequest !== 'function' &&
      typeof value.create !== 'function')
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service request service must provide createRequest() or create().',
    );
  }

  return value;
}

function normalizePipelineOrchestrator(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.processRequest !== 'function' &&
      typeof value.process !== 'function' &&
      typeof value.run !== 'function')
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service pipeline orchestrator must provide processRequest(), process(), or run().',
    );
  }

  return value;
}

function normalizeFixtureGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.getClaimByNumber !== 'function' &&
      typeof value.findClaimByNumber !== 'function' &&
      typeof value.getSnapshot !== 'function')
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service fixture gateway must support claim lookup.',
    );
  }

  return value;
}

function normalizePermissionGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service permission gateway must provide evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.append !== 'function'
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service audit gateway must provide append().',
    );
  }

  return value;
}

function normalizeSessionProvider(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === 'function' ||
    (typeof value === 'object' &&
      (typeof value.getSession === 'function' ||
        typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function'))
  ) {
    return value;
  }

  throw new BatchServiceError(
    BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Batch service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function normalizeBatchMachine(value, clock) {
  const machine =
    value ??
    createBatchMachine({
      clock,
      delayMultiplier: 0,
    });

  if (
    machine === null ||
    typeof machine !== 'object' ||
    typeof machine.createState !== 'function' ||
    typeof machine.runToCompletion !== 'function'
  ) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Batch service requires a compatible deterministic batch machine.',
    );
  }

  return machine;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.operationsRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.operationsRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function readSession(provider) {
  if (provider === null) {
    return null;
  }

  if (typeof provider === 'function') {
    return provider();
  }

  if (typeof provider.getSession === 'function') {
    return provider.getSession();
  }

  const snapshot =
    typeof provider.getSnapshot === 'function'
      ? provider.getSnapshot()
      : provider.getState();

  return snapshot?.session ?? snapshot?.actor ?? null;
}

function normalizeContext(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? {
        ...value.session,
        correlationId:
          value.correlationId ?? value.session.correlationId,
      }
    : isPlainObject(value.actor)
      ? {
          ...value.actor,
          correlationId:
            value.correlationId ?? value.actor.correlationId,
        }
      : value;
  const actorId =
    source.actorId ?? source.userId ?? source.requestedBy;
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;

  if (
    typeof actorId !== 'string' ||
    actorId.trim().length === 0 ||
    actorId.trim().length > 80 ||
    !isPlatformRole(role)
  ) {
    return null;
  }

  return deepFreeze({
    actorId: actorId.normalize('NFC').trim(),
    userId: actorId.normalize('NFC').trim(),
    displayName:
      typeof source.displayName === 'string' &&
      source.displayName.trim().length > 0
        ? source.displayName.normalize('NFC').trim()
        : actorId.normalize('NFC').trim(),
    role,
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim().toUpperCase()
        : null,
    correlationId:
      typeof source.correlationId === 'string' &&
      source.correlationId.trim().length > 0
        ? source.correlationId.normalize('NFC').trim()
        : null,
  });
}

function getCurrentTimestamp(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Batch service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Batch service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedValue(
  idGenerator,
  prefix,
  maximumLength = BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH,
) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Batch service ID generator must return a non-empty string.',
    );
  }

  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-');
  const identifier = normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;

  if (identifier.length > maximumLength) {
    throw new TypeError(
      `Batch service generated an identifier longer than ${maximumLength} characters.`,
    );
  }

  return identifier;
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return createGeneratedValue(idGenerator, 'corr-', 200);
}

function createSuccess(
  status,
  data,
  correlationId,
  revision,
  warnings = [],
) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      revision,
      schemaVersion: BATCH_SERVICE_SCHEMA_VERSION,
      warnings,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  revision,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
    },
    meta: {
      correlationId,
      revision,
      schemaVersion: BATCH_SERVICE_SCHEMA_VERSION,
    },
  });
}

function createFieldError(field, code, message) {
  return {
    field,
    code,
    message,
  };
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.normalize('NFC').trim().toUpperCase();

  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function normalizeEntityId(value, field, errors) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length >
      BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH
  ) {
    errors.push(
      createFieldError(
        field,
        'INVALID_IDENTIFIER',
        `${field} must be a non-empty string of at most ${BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH} characters.`,
      ),
    );
    return null;
  }

  return value.normalize('NFC').trim();
}

function normalizeIdempotencyKey(value, errors) {
  if (!isOperationsUuid(value)) {
    errors.push(
      createFieldError(
        'idempotencyKey',
        'INVALID_UUID',
        'Idempotency key must be an RFC 4122 UUID.',
      ),
    );
    return null;
  }

  return value.toLowerCase();
}

function normalizeRunCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Batch run request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const batchId = normalizeEntityId(
    value.batchId,
    'batchId',
    errors,
  );
  const idempotencyKey = normalizeIdempotencyKey(
    value.idempotencyKey,
    errors,
  );

  if (
    !Array.isArray(value.rowIds) ||
    value.rowIds.length === 0 ||
    value.rowIds.length > BATCH_SERVICE_LIMITS.MAXIMUM_ROWS
  ) {
    errors.push(
      createFieldError(
        'rowIds',
        'INVALID_ROWS',
        `Batch row IDs must contain between 1 and ${BATCH_SERVICE_LIMITS.MAXIMUM_ROWS} entries.`,
      ),
    );
  }

  const rowIds = Array.isArray(value.rowIds)
    ? value.rowIds
        .map((rowId, index) =>
          normalizeEntityId(
            rowId,
            `rowIds[${index}]`,
            errors,
          ),
        )
        .filter(Boolean)
    : [];

  if (new Set(rowIds).size !== rowIds.length) {
    errors.push(
      createFieldError(
        'rowIds',
        'DUPLICATE_IDENTIFIER',
        'Batch row IDs must be unique.',
      ),
    );
  }

  const scenarioByRow = value.scenarioByRow ?? {};

  if (
    !isPlainObject(scenarioByRow) ||
    !isJsonCompatible(scenarioByRow)
  ) {
    errors.push(
      createFieldError(
        'scenarioByRow',
        'INVALID_SCENARIOS',
        'Batch row scenarios must be a safe object.',
      ),
    );
  } else {
    Object.entries(scenarioByRow).forEach(
      ([rowId, scenario]) => {
        if (!rowIds.includes(rowId)) {
          errors.push(
            createFieldError(
              `scenarioByRow.${rowId}`,
              'ROW_NOT_FOUND',
              'Batch scenario references a row outside the request.',
            ),
          );
        }

        if (
          typeof scenario !== 'string' ||
          !ROW_SCENARIO_VALUES.has(
            scenario.trim().toUpperCase(),
          )
        ) {
          errors.push(
            createFieldError(
              `scenarioByRow.${rowId}`,
              'INVALID_SCENARIO',
              'Batch row scenario is not supported.',
            ),
          );
        }
      },
    );
  }

  return {
    value: {
      batchId,
      rowIds,
      scenarioByRow: isPlainObject(scenarioByRow)
        ? Object.fromEntries(
            Object.entries(scenarioByRow).map(
              ([rowId, scenario]) => [
                rowId,
                typeof scenario === 'string'
                  ? scenario.trim().toUpperCase()
                  : scenario,
              ],
            ),
          )
        : {},
      idempotencyKey,
    },
    errors,
  };
}

function normalizeRetryCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Batch row retry request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const batchId = normalizeEntityId(
    value.batchId,
    'batchId',
    errors,
  );
  const rowId = normalizeEntityId(
    value.rowId,
    'rowId',
    errors,
  );
  const idempotencyKey = normalizeIdempotencyKey(
    value.idempotencyKey,
    errors,
  );
  const resolution = value.resolution;

  if (
    !isPlainObject(resolution) ||
    !isJsonCompatible(resolution)
  ) {
    errors.push(
      createFieldError(
        'resolution',
        'INVALID_RESOLUTION',
        'Batch row resolution must be a safe object.',
      ),
    );
  }

  const paymentReference = resolution?.paymentReference;

  if (
    typeof paymentReference !== 'string' ||
    !MASKED_PAYMENT_PATTERN.test(paymentReference.trim())
  ) {
    errors.push(
      createFieldError(
        'resolution.paymentReference',
        'INVALID_MASKED_VALUE',
        'Batch payment reference must be a masked value.',
      ),
    );
  }

  return {
    value: {
      batchId,
      rowId,
      resolution:
        typeof paymentReference === 'string'
          ? {
              paymentReference:
                paymentReference.normalize('NFC').trim(),
            }
          : null,
      idempotencyKey,
    },
    errors,
  };
}

function normalizeReworkCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Claim rework request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const claimNumber = normalizeIdentifier(value.claimNumber);
  const execution =
    typeof value.execution === 'string'
      ? value.execution.trim().toUpperCase()
      : value.execution;
  const reasonCode =
    typeof value.reasonCode === 'string'
      ? value.reasonCode.normalize('NFC').trim().toUpperCase()
      : null;
  const notes =
    value.notes === undefined || value.notes === null
      ? ''
      : typeof value.notes === 'string'
        ? value.notes.normalize('NFC').trim()
        : null;
  const idempotencyKey = normalizeIdempotencyKey(
    value.idempotencyKey,
    errors,
  );

  if (claimNumber === null) {
    errors.push(
      createFieldError(
        'claimNumber',
        'INVALID_IDENTIFIER',
        'Claim number must contain 1–40 letters, numbers, underscores, or hyphens.',
      ),
    );
  }

  if (!EXECUTION_MODE_VALUES.has(execution)) {
    errors.push(
      createFieldError(
        'execution',
        'INVALID_EXECUTION',
        'Claim rework execution must be IMMEDIATE or NIGHTLY_BATCH.',
      ),
    );
  }

  if (
    reasonCode === null ||
    reasonCode.length === 0 ||
    reasonCode.length > BATCH_SERVICE_LIMITS.MAXIMUM_REASON_LENGTH
  ) {
    errors.push(
      createFieldError(
        'reasonCode',
        'REASON_REQUIRED',
        `Claim rework reason code is required and must not exceed ${BATCH_SERVICE_LIMITS.MAXIMUM_REASON_LENGTH} characters.`,
      ),
    );
  }

  if (
    notes === null ||
    notes.length > BATCH_SERVICE_LIMITS.MAXIMUM_NOTES_LENGTH
  ) {
    errors.push(
      createFieldError(
        'notes',
        'INVALID_LENGTH',
        `Claim rework notes must not exceed ${BATCH_SERVICE_LIMITS.MAXIMUM_NOTES_LENGTH} characters.`,
      ),
    );
  }

  return {
    value: {
      claimNumber,
      execution,
      reasonCode,
      notes: notes ?? '',
      idempotencyKey,
    },
    errors,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(value[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashCommand(commandName, value) {
  const source = `${commandName}|${canonicalize(value)}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function readClaim(gateway, claimNumber, actor) {
  if (gateway === null) {
    return null;
  }

  if (typeof gateway.getClaimByNumber === 'function') {
    return gateway.getClaimByNumber(
      claimNumber,
      actor,
      ACTIONS.REPRINT_REQUEST,
    );
  }

  if (typeof gateway.findClaimByNumber === 'function') {
    return gateway.findClaimByNumber(claimNumber, actor);
  }

  const snapshot = gateway.getSnapshot();

  return (
    snapshot?.claimsByNumber?.[claimNumber] ??
    snapshot?.claims?.find(
      (claim) => claim.claimNumber === claimNumber,
    ) ??
    null
  );
}

function getRequestCreationMethod(service) {
  if (service === null) {
    return null;
  }

  return typeof service.createRequest === 'function'
    ? service.createRequest.bind(service)
    : service.create.bind(service);
}

function getPipelineProcessingMethod(orchestrator) {
  if (orchestrator === null) {
    return null;
  }

  if (typeof orchestrator.processRequest === 'function') {
    return orchestrator.processRequest.bind(orchestrator);
  }

  if (typeof orchestrator.process === 'function') {
    return orchestrator.process.bind(orchestrator);
  }

  return orchestrator.run.bind(orchestrator);
}

function resolveQueueRows(queueRows, rowIds) {
  const rowsById = new Map(
    queueRows.map((row) => [row.rowId, row]),
  );
  const missing = rowIds.filter(
    (rowId) => !rowsById.has(rowId),
  );

  if (missing.length > 0) {
    throw new BatchServiceError(
      BATCH_SERVICE_ERROR_CODES.ROW_NOT_FOUND,
      'One or more selected batch rows do not exist.',
      { rowIds: missing },
    );
  }

  return rowIds.map((rowId) => {
    const row = rowsById.get(rowId);
    const claimNumber = normalizeIdentifier(row.claimNumber);
    const memberId = normalizeIdentifier(row.memberId);

    if (claimNumber === null || memberId === null) {
      throw new BatchServiceError(
        BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Selected batch row contains an invalid claim number or member ID.',
        { rowId },
      );
    }

    return {
      rowId,
      claimNumber,
      memberId,
      attempt:
        Number.isInteger(row.attempt) &&
        row.attempt >= 1 &&
        row.attempt <=
          BATCH_SERVICE_LIMITS.MAXIMUM_RETRY_ATTEMPTS
          ? row.attempt
          : 1,
    };
  });
}

function createStoredBatchRun(machineState) {
  return {
    batchId: machineState.batchId,
    status:
      machineState.status === BATCH_MACHINE_STATUSES.COMPLETE
        ? BATCH_STATUSES.COMPLETE
        : BATCH_STATUSES.COMPLETED_WITH_ERRORS,
    steps: machineState.stepResults.map((result) => ({
      step: result.step,
      status: result.status,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      code: result.code,
      message: result.message,
    })),
    rows: machineState.rows.map((row) => ({
      rowId: row.rowId,
      claimNumber: row.claimNumber,
      memberId: row.memberId,
      status: row.status,
      attempt: row.attempt,
      reasonCode: row.reasonCode,
      reportId: row.reportId,
    })),
    startedAt: machineState.startedAt,
    completedAt: machineState.completedAt,
  };
}

function summarizeBatch(run) {
  const succeeded = run.rows.filter(
    (row) => row.status === BATCH_ROW_STATUSES.COMPLETE,
  ).length;
  const failed = run.rows.length - succeeded;

  return {
    batchId: run.batchId,
    status: run.status,
    processed: run.rows.length,
    succeeded,
    failed,
    rows: run.rows.map((row) => ({
      rowId: row.rowId,
      status: row.status,
      attempt: row.attempt,
      reasonCode: row.reasonCode,
      reportId: row.reportId,
    })),
  };
}

function resolveBatchStatus(rows) {
  return rows.every(
    (row) => row.status === BATCH_ROW_STATUSES.COMPLETE,
  )
    ? BATCH_STATUSES.COMPLETE
    : BATCH_STATUSES.COMPLETED_WITH_ERRORS;
}

function createRetryReportId(batchId, rowId, attempt) {
  return `IXIT-${batchId}-${rowId}-A${attempt}`.slice(
    0,
    BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH,
  );
}

function createReworkBatchId(claimNumber) {
  return `${REWORK_BATCH_PREFIX}${claimNumber}`.slice(
    0,
    BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH,
  );
}

function createReworkRowId(requestId) {
  return `${REWORK_ROW_PREFIX}${requestId}`.slice(
    0,
    BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH,
  );
}

function createQueuedReworkBatch({
  batchId,
  rowId,
  claimNumber,
  memberId,
}) {
  return {
    batchId,
    status: BATCH_STATUSES.QUEUED,
    steps: [],
    rows: [
      {
        rowId,
        claimNumber,
        memberId,
        status: BATCH_ROW_STATUSES.QUEUED,
        attempt: 1,
        reasonCode: 'CLAIM_REWORK',
        reportId: null,
      },
    ],
    startedAt: null,
    completedAt: null,
  };
}

function normalizeRepositoryFailure(
  error,
  correlationId,
  revision,
) {
  const code = getErrorCode(error);

  if (
    code === OPERATIONS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT ||
    code === 'REVISION_CONFLICT'
  ) {
    return createFailure(
      409,
      BATCH_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before the batch operation completed.',
      correlationId,
      revision,
      { retryable: true },
    );
  }

  if (
    code === 'STORAGE_QUOTA_EXCEEDED' ||
    code === 'LOCAL_STORAGE_QUOTA'
  ) {
    return createFailure(
      507,
      BATCH_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof BatchServiceError) {
    const status =
      error.code === BATCH_SERVICE_ERROR_CODES.BATCH_NOT_FOUND ||
      error.code === BATCH_SERVICE_ERROR_CODES.ROW_NOT_FOUND ||
      error.code === BATCH_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND
        ? 404
        : error.code ===
              BATCH_SERVICE_ERROR_CODES.RUN_ALREADY_ACTIVE ||
            error.code ===
              BATCH_SERVICE_ERROR_CODES.ROW_NOT_RETRYABLE ||
            error.code ===
              BATCH_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT ||
            error.code ===
              BATCH_SERVICE_ERROR_CODES.DUPLICATE_OPEN_REQUEST
          ? 409
          : 422;

    return createFailure(
      status,
      error.code,
      error.message,
      correlationId,
      revision,
      {
        details: error.details,
        retryable:
          error.code ===
          BATCH_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      },
    );
  }

  return createFailure(
    500,
    BATCH_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The local batch operation could not be stored.',
    correlationId,
    revision,
    {
      details: {
        dependencyCode: code,
      },
    },
  );
}

/**
 * Error raised when batch-service input, dependencies, or state are invalid.
 */
export class BatchServiceError extends Error {
  /**
   * @param {string} code Stable batch-service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BatchServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Coordinates deterministic local batch execution, row retry, and claim
 * rework without contacting external systems.
 */
export class BatchService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options.
   * @param {{
   *   batchMachine?: object,
   *   requestService?: object,
   *   pipelineOrchestrator?: object,
   *   fixtureGateway?: object,
   *   fixtureRepository?: object,
   *   permissionGateway?: object,
   *   permissionService?: object,
   *   auditGateway?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   queueRows?: readonly Record<string, unknown>[],
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.repository = requireRepository(resolved.repository);
    this.clock = normalizedOptions.clock ?? browserClock;
    this.machine = normalizeBatchMachine(
      normalizedOptions.batchMachine,
      this.clock,
    );
    this.requestService = normalizeRequestService(
      normalizedOptions.requestService,
    );
    this.pipelineOrchestrator = normalizePipelineOrchestrator(
      normalizedOptions.pipelineOrchestrator ??
        normalizedOptions.pipelineService,
    );
    this.fixtureGateway = normalizeFixtureGateway(
      normalizedOptions.fixtureGateway ??
        normalizedOptions.fixtureRepository ??
        normalizedOptions.fixtures,
    );
    this.permissionGateway = normalizePermissionGateway(
      normalizedOptions.permissionGateway ??
        normalizedOptions.permissionService,
    );
    this.auditGateway = normalizeAuditGateway(
      normalizedOptions.auditGateway ??
        normalizedOptions.auditService,
    );
    this.sessionProvider = normalizeSessionProvider(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade ??
        this.permissionGateway?.sessionProvider,
    );
    this.queueRows = Array.isArray(normalizedOptions.queueRows)
      ? deepFreeze(normalizedOptions.queueRows)
      : NIGHTLY_QUEUE_ROWS;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;
    this.activeBatchIds = new Set();

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Batch service ID generator must be a function.',
      );
    }
  }

  getRevision() {
    return this.repository.getSnapshot().revision;
  }

  resolveContext(context) {
    const supplied = normalizeContext(context);

    if (supplied !== null) {
      return supplied;
    }

    try {
      return normalizeContext(readSession(this.sessionProvider));
    } catch {
      return null;
    }
  }

  async authorize(actor, correlationId) {
    if (actor !== null && !INTERNAL_ROLES.has(actor.role)) {
      return {
        allowed: false,
        failure: createFailure(
          403,
          BATCH_SERVICE_ERROR_CODES.FORBIDDEN,
          'Batch and claim-rework operations are available only to BOS and Admin demo roles.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    if (this.permissionGateway === null) {
      return {
        allowed: true,
        actor,
      };
    }

    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          BATCH_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
          'An active demo session is required.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action: ACTIONS.OPERATIONAL_SUMMARY_VIEW,
          resource: {
            type: 'CLAIMS_OUTBOUND_BATCH',
            id: 'local',
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Batch permission evaluation could not be completed.',
          correlationId,
          this.getRevision(),
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        ),
      };
    }

    if (
      decision?.allowed === true &&
      INTERNAL_ROLES.has(actor.role)
    ) {
      return {
        allowed: true,
        actor,
        decision,
      };
    }

    const unauthenticated =
      decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
      decision?.reasonCode === 'SESSION_EXPIRED';

    return {
      allowed: false,
      failure: createFailure(
        unauthenticated ? 401 : 403,
        unauthenticated
          ? BATCH_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : BATCH_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'Batch and claim-rework operations are available only to BOS and Admin demo roles.',
        correlationId,
        this.getRevision(),
        {
          details: {
            reasonCode: decision?.reasonCode ?? null,
          },
        },
      ),
    };
  }

  async appendAudit({
    correlationId,
    actor,
    action,
    entityType,
    entityId,
    after,
  }) {
    if (this.auditGateway === null || actor === null) {
      return null;
    }

    try {
      await this.auditGateway.append(
        {
          correlationId,
          actor: {
            userId: actor.actorId,
            displayName: actor.displayName,
            role: actor.role,
          },
          action,
          entity: {
            type: entityType,
            id: entityId,
          },
        },
        {
          action,
          entity: {
            type: entityType,
            id: entityId,
          },
          before: null,
          after,
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: BATCH_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The batch operation completed, but a local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Runs selected local queue rows through the deterministic ten-step batch.
   *
   * @param {Record<string, unknown>} command Batch command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async runBatch(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeRunCommand(command);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Batch run request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const input = normalized.value;
    const requestHash = hashCommand('runBatch', {
      batchId: input.batchId,
      rowIds: input.rowIds,
      scenarioByRow: input.scenarioByRow,
    });
    const existingIdempotency =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existingIdempotency !== undefined) {
      if (
        existingIdempotency.commandName !== 'runBatch' ||
        existingIdempotency.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          BATCH_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another batch operation.',
          correlationId,
          snapshot.revision,
        );
      }

      const run =
        snapshot.batchRuns[
          existingIdempotency.result.batchId
        ] ?? null;

      return createSuccess(
        200,
        {
          ...(run === null
            ? existingIdempotency.result
            : summarizeBatch(run)),
          replayed: true,
          transmitted: false,
        },
        correlationId,
        snapshot.revision,
      );
    }

    if (this.activeBatchIds.has(input.batchId)) {
      return createFailure(
        409,
        BATCH_SERVICE_ERROR_CODES.RUN_ALREADY_ACTIVE,
        'A batch run is already active for this identifier.',
        correlationId,
        snapshot.revision,
      );
    }

    if (snapshot.batchRuns[input.batchId] !== undefined) {
      return createFailure(
        409,
        BATCH_SERVICE_ERROR_CODES.RUN_ALREADY_ACTIVE,
        'A batch run already exists for this identifier.',
        correlationId,
        snapshot.revision,
      );
    }

    let rows;

    try {
      rows = resolveQueueRows(this.queueRows, input.rowIds).map(
        (row) => ({
          ...row,
          scenario:
            input.scenarioByRow[row.rowId] ??
            BATCH_ROW_SCENARIOS.SUCCESS,
        }),
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    this.activeBatchIds.add(input.batchId);

    try {
      let machineState = this.machine.createState({
        batchId: input.batchId,
        rows,
      });

      machineState =
        this.machine.runToCompletion(machineState);

      const run = createStoredBatchRun(machineState);
      const result = summarizeBatch(run);
      const createdAt = getCurrentTimestamp(this.clock);
      let storedEnvelope;

      try {
        storedEnvelope = this.repository.transact(
          (draft) => {
            if (draft.batchRuns[input.batchId] !== undefined) {
              throw new BatchServiceError(
                BATCH_SERVICE_ERROR_CODES.RUN_ALREADY_ACTIVE,
                'A batch run already exists for this identifier.',
              );
            }

            const committed =
              draft.idempotencyResults[input.idempotencyKey];

            if (committed !== undefined) {
              if (
                committed.commandName !== 'runBatch' ||
                committed.requestHash !== requestHash
              ) {
                throw new BatchServiceError(
                  BATCH_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                  'The idempotency key was already used for another batch operation.',
                );
              }

              return;
            }

            draft.batchRuns[input.batchId] =
              cloneMutable(run);
            draft.idempotencyResults[input.idempotencyKey] = {
              idempotencyKey: input.idempotencyKey,
              commandName: 'runBatch',
              requestHash,
              result: cloneMutable(result),
              createdAt,
            };
          },
          {
            expectedRevision: snapshot.revision,
          },
        );
      } catch (error) {
        return normalizeRepositoryFailure(
          error,
          correlationId,
          snapshot.revision,
        );
      }

      const warnings = [];
      const storedRun =
        storedEnvelope.batchRuns[input.batchId];

      for (const row of storedRun.rows) {
        const warning = await this.appendAudit({
          correlationId,
          actor,
          action: BATCH_AUDIT_ACTIONS.ROW_PROCESSED,
          entityType: 'BATCH_ROW',
          entityId: `${storedRun.batchId}:${row.rowId}`,
          after: {
            batchId: storedRun.batchId,
            rowId: row.rowId,
            claimNumber: row.claimNumber,
            memberId: row.memberId,
            status: row.status,
            attempt: row.attempt,
            reasonCode: row.reasonCode,
            reportId: row.reportId,
            transmitted: false,
            simulated: true,
          },
        });

        if (warning !== null) {
          warnings.push(warning);
        }
      }

      const completionWarning = await this.appendAudit({
        correlationId,
        actor,
        action: BATCH_AUDIT_ACTIONS.COMPLETED,
        entityType: 'BATCH',
        entityId: storedRun.batchId,
        after: {
          ...summarizeBatch(storedRun),
          transmitted: false,
          simulated: true,
        },
      });

      if (completionWarning !== null) {
        warnings.push(completionWarning);
      }

      return createSuccess(
        201,
        {
          ...summarizeBatch(storedRun),
          replayed: false,
          transmitted: false,
        },
        correlationId,
        storedEnvelope.revision,
        warnings,
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        this.getRevision(),
      );
    } finally {
      this.activeBatchIds.delete(input.batchId);
    }
  }

  /**
   * Retries one returned or failed batch row with a masked payment reference.
   *
   * @param {Record<string, unknown>} command Retry command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async retryBatchRow(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeRetryCommand(command);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Batch row retry request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const input = normalized.value;
    const requestHash = hashCommand('retryBatchRow', {
      batchId: input.batchId,
      rowId: input.rowId,
      resolution: input.resolution,
    });
    const existingIdempotency =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existingIdempotency !== undefined) {
      if (
        existingIdempotency.commandName !== 'retryBatchRow' ||
        existingIdempotency.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          BATCH_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another batch retry.',
          correlationId,
          snapshot.revision,
        );
      }

      return createSuccess(
        200,
        {
          ...existingIdempotency.result,
          replayed: true,
          transmitted: false,
        },
        correlationId,
        snapshot.revision,
      );
    }

    const run = snapshot.batchRuns[input.batchId];

    if (run === undefined) {
      return createFailure(
        404,
        BATCH_SERVICE_ERROR_CODES.BATCH_NOT_FOUND,
        'The batch run does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const row = run.rows.find(
      (candidate) => candidate.rowId === input.rowId,
    );

    if (row === undefined) {
      return createFailure(
        404,
        BATCH_SERVICE_ERROR_CODES.ROW_NOT_FOUND,
        'The batch row does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (
      ![
        BATCH_ROW_STATUSES.QUEUED,
        BATCH_ROW_STATUSES.FAILED,
      ].includes(row.status) ||
      row.attempt >=
        BATCH_SERVICE_LIMITS.MAXIMUM_RETRY_ATTEMPTS
    ) {
      return createFailure(
        409,
        BATCH_SERVICE_ERROR_CODES.ROW_NOT_RETRYABLE,
        'Only a returned or failed batch row below the retry limit may be retried.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: row.status,
            attempt: row.attempt,
            maximumAttempts:
              BATCH_SERVICE_LIMITS.MAXIMUM_RETRY_ATTEMPTS,
          },
        },
      );
    }

    const attempt = row.attempt + 1;
    const reportId = createRetryReportId(
      run.batchId,
      row.rowId,
      attempt,
    );
    const result = {
      batchId: run.batchId,
      rowId: row.rowId,
      attempt,
      status: BATCH_ROW_STATUSES.COMPLETE,
      reasonCode: null,
      reportId,
      paymentReferenceMasked:
        input.resolution.paymentReference,
    };
    const createdAt = getCurrentTimestamp(this.clock);
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const currentRun = draft.batchRuns[input.batchId];
          const committed =
            draft.idempotencyResults[input.idempotencyKey];

          if (committed !== undefined) {
            if (
              committed.commandName !== 'retryBatchRow' ||
              committed.requestHash !== requestHash
            ) {
              throw new BatchServiceError(
                BATCH_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another batch retry.',
              );
            }

            return;
          }

          if (currentRun === undefined) {
            throw new BatchServiceError(
              BATCH_SERVICE_ERROR_CODES.BATCH_NOT_FOUND,
              'The batch run no longer exists.',
            );
          }

          const rowIndex = currentRun.rows.findIndex(
            (candidate) => candidate.rowId === input.rowId,
          );

          if (rowIndex < 0) {
            throw new BatchServiceError(
              BATCH_SERVICE_ERROR_CODES.ROW_NOT_FOUND,
              'The batch row no longer exists.',
            );
          }

          const currentRow = currentRun.rows[rowIndex];

          if (
            ![
              BATCH_ROW_STATUSES.QUEUED,
              BATCH_ROW_STATUSES.FAILED,
            ].includes(currentRow.status) ||
            currentRow.attempt !== row.attempt ||
            currentRow.attempt >=
              BATCH_SERVICE_LIMITS.MAXIMUM_RETRY_ATTEMPTS
          ) {
            throw new BatchServiceError(
              BATCH_SERVICE_ERROR_CODES.ROW_NOT_RETRYABLE,
              'The batch row changed before it could be retried.',
            );
          }

          currentRun.rows[rowIndex] = {
            ...currentRow,
            status: BATCH_ROW_STATUSES.COMPLETE,
            attempt,
            reasonCode: null,
            reportId,
          };
          currentRun.status = resolveBatchStatus(
            currentRun.rows,
          );

          if (
            currentRun.rows.every(
              (candidate) =>
                candidate.status ===
                BATCH_ROW_STATUSES.COMPLETE,
            )
          ) {
            currentRun.completedAt =
              currentRun.completedAt ?? createdAt;
          }

          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'retryBatchRow',
            requestHash,
            result: cloneMutable(result),
            createdAt,
          };
        },
        {
          expectedRevision: snapshot.revision,
        },
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: BATCH_AUDIT_ACTIONS.ROW_RETRIED,
      entityType: 'BATCH_ROW',
      entityId: `${run.batchId}:${row.rowId}`,
      after: {
        ...result,
        transmitted: false,
        simulated: true,
      },
    });

    return createSuccess(
      200,
      {
        ...result,
        replayed: false,
        transmitted: false,
      },
      correlationId,
      storedEnvelope.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  /**
   * Creates exactly one BOTH reprint request for a corrected fictional claim.
   *
   * Immediate execution delegates to the pipeline and requires exactly one EOB
   * and one EOR version. Nightly execution queues exactly one local batch row.
   *
   * @param {Record<string, unknown>} command Claim-rework command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async reworkClaim(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeReworkCommand(command);
    const initialSnapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      const hasMissingReason = normalized.errors.some(
        (error) => error.code === 'REASON_REQUIRED',
      );

      return createFailure(
        422,
        hasMissingReason
          ? BATCH_SERVICE_ERROR_CODES.REASON_REQUIRED
          : BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        hasMissingReason
          ? 'Claim rework requires a reason code.'
          : 'Claim rework request validation failed.',
        correlationId,
        initialSnapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const input = normalized.value;

    if (
      this.requestService === null ||
      (input.execution ===
        BATCH_EXECUTION_MODES.IMMEDIATE &&
        this.pipelineOrchestrator === null)
    ) {
      return createFailure(
        500,
        BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Claim rework dependencies are unavailable.',
        correlationId,
        initialSnapshot.revision,
      );
    }

    let claim;

    try {
      claim = await readClaim(
        this.fixtureGateway,
        input.claimNumber,
        actor,
      );
    } catch (error) {
      return createFailure(
        500,
        BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'The fictional claim fixture could not be read.',
        correlationId,
        initialSnapshot.revision,
        {
          details: {
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    if (this.fixtureGateway !== null && claim === null) {
      return createFailure(
        404,
        BATCH_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
        'The fictional claim was not found or is not accessible.',
        correlationId,
        initialSnapshot.revision,
      );
    }

    if (
      claim !== null &&
      claim !== undefined &&
      claim.eligibleForReprint !== true
    ) {
      return createFailure(
        422,
        BATCH_SERVICE_ERROR_CODES.CLAIM_NOT_ELIGIBLE,
        'The fictional claim is not eligible for rework.',
        correlationId,
        initialSnapshot.revision,
      );
    }

    const memberId =
      normalizeIdentifier(claim?.memberId) ??
      normalizeIdentifier(command.memberId);

    if (memberId === null) {
      return createFailure(
        422,
        BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Claim rework requires a valid member ID.',
        correlationId,
        initialSnapshot.revision,
        {
          fieldErrors: [
            createFieldError(
              'memberId',
              'INVALID_IDENTIFIER',
              'Member ID could not be resolved for the fictional claim.',
            ),
          ],
        },
      );
    }

    const createRequest = getRequestCreationMethod(
      this.requestService,
    );
    let requestResult;

    try {
      requestResult = await createRequest(
        {
          claimNumber: input.claimNumber,
          memberId,
          requestType: 'BOTH',
          priority: 'NORMAL',
          sourceType: 'REWORK',
          sourceDetail: [
            input.reasonCode,
            input.notes,
          ]
            .filter(Boolean)
            .join(': ')
            .slice(0, 200),
          processNow: false,
          idempotencyKey: input.idempotencyKey,
        },
        actor ?? undefined,
      );
    } catch (error) {
      return createFailure(
        500,
        BATCH_SERVICE_ERROR_CODES.REQUEST_CREATION_FAILED,
        'The claim-rework request could not be created.',
        correlationId,
        this.getRevision(),
        {
          details: {
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    if (requestResult?.ok !== true) {
      const dependencyCode =
        requestResult?.error?.code ?? null;
      const duplicate =
        dependencyCode ===
        BATCH_SERVICE_ERROR_CODES.DUPLICATE_OPEN_REQUEST;

      return createFailure(
        duplicate ? 409 : requestResult?.status ?? 422,
        duplicate
          ? BATCH_SERVICE_ERROR_CODES.DUPLICATE_OPEN_REQUEST
          : BATCH_SERVICE_ERROR_CODES.REQUEST_CREATION_FAILED,
        requestResult?.error?.message ??
          'The claim-rework request could not be created.',
        correlationId,
        requestResult?.meta?.revision ?? this.getRevision(),
        {
          details: {
            dependencyCode,
          },
        },
      );
    }

    const request =
      requestResult.data?.request ??
      requestResult.data;
    const requestId =
      request?.requestId ??
      requestResult.data?.requestId;

    if (
      typeof requestId !== 'string' ||
      !isOperationsUuid(requestId)
    ) {
      return createFailure(
        500,
        BATCH_SERVICE_ERROR_CODES.REQUEST_CREATION_FAILED,
        'The created claim-rework request has an invalid identifier.',
        correlationId,
        this.getRevision(),
      );
    }

    if (
      request?.requestType !== undefined &&
      request.requestType !== 'BOTH'
    ) {
      return createFailure(
        500,
        BATCH_SERVICE_ERROR_CODES.REQUEST_CREATION_FAILED,
        'Claim rework did not create the required BOTH request.',
        correlationId,
        this.getRevision(),
      );
    }

    if (
      input.execution ===
      BATCH_EXECUTION_MODES.NIGHTLY_BATCH
    ) {
      const batchId = createReworkBatchId(
        input.claimNumber,
      );
      const rowId = createReworkRowId(requestId);
      const snapshot = this.repository.getSnapshot();
      let storedEnvelope;

      try {
        storedEnvelope = this.repository.transact(
          (draft) => {
            const existingBatch = draft.batchRuns[batchId];

            if (existingBatch !== undefined) {
              const existingRow = existingBatch.rows.find(
                (candidate) => candidate.rowId === rowId,
              );

              if (existingRow !== undefined) {
                return;
              }

              existingBatch.rows.push({
                rowId,
                claimNumber: input.claimNumber,
                memberId,
                status: BATCH_ROW_STATUSES.QUEUED,
                attempt: 1,
                reasonCode: input.reasonCode,
                reportId: null,
              });
              existingBatch.status = BATCH_STATUSES.QUEUED;
              existingBatch.completedAt = null;
              return;
            }

            draft.batchRuns[batchId] =
              createQueuedReworkBatch({
                batchId,
                rowId,
                claimNumber: input.claimNumber,
                memberId,
              });
            draft.batchRuns[batchId].rows[0].reasonCode =
              input.reasonCode;
          },
          {
            expectedRevision: snapshot.revision,
          },
        );
      } catch (error) {
        return normalizeRepositoryFailure(
          error,
          correlationId,
          snapshot.revision,
        );
      }

      const auditWarning = await this.appendAudit({
        correlationId,
        actor,
        action: BATCH_AUDIT_ACTIONS.CLAIM_REWORK_QUEUED,
        entityType: 'REPRINT_REQUEST',
        entityId: requestId,
        after: {
          requestId,
          claimNumber: input.claimNumber,
          memberId,
          requestType: 'BOTH',
          execution: input.execution,
          status: 'PENDING',
          batchId,
          batchRowId: rowId,
          reasonCode: input.reasonCode,
          transmitted: false,
          simulated: true,
        },
      });

      return createSuccess(
        requestResult.status === 200 ? 200 : 201,
        {
          requestId,
          requestType: 'BOTH',
          execution: input.execution,
          status: 'PENDING',
          batchId,
          batchRowId: rowId,
          replayed: requestResult.status === 200,
          transmitted: false,
        },
        correlationId,
        storedEnvelope.revision,
        auditWarning === null ? [] : [auditWarning],
      );
    }

    const currentRequest =
      this.repository.getSnapshot().requests[requestId];
    let documentIds =
      currentRequest?.documentReferences ?? [];
    let processingResult = null;

    if (
      currentRequest?.status !== 'COMPLETE' ||
      documentIds.length !== 2
    ) {
      const processRequest = getPipelineProcessingMethod(
        this.pipelineOrchestrator,
      );
      const processingIdempotencyKey = createGeneratedValue(
        this.idGenerator,
        '',
        100,
      );

      if (!isOperationsUuid(processingIdempotencyKey)) {
        return createFailure(
          500,
          BATCH_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Claim-rework processing requires an RFC 4122 UUID generator.',
          correlationId,
          this.getRevision(),
        );
      }

      try {
        processingResult = await processRequest(
          {
            requestId,
            mode: 'IMMEDIATE',
            scenario: 'SUCCESS',
            idempotencyKey:
              processingIdempotencyKey.toLowerCase(),
          },
          actor ?? undefined,
        );
      } catch (error) {
        return createFailure(
          500,
          BATCH_SERVICE_ERROR_CODES.PROCESSING_FAILED,
          'The immediate claim-rework pipeline could not be completed.',
          correlationId,
          this.getRevision(),
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        );
      }

      if (processingResult?.ok !== true) {
        return createFailure(
          processingResult?.status ?? 500,
          BATCH_SERVICE_ERROR_CODES.PROCESSING_FAILED,
          processingResult?.error?.message ??
            'The immediate claim-rework pipeline could not be completed.',
          correlationId,
          processingResult?.meta?.revision ??
            this.getRevision(),
          {
            details: {
              dependencyCode:
                processingResult?.error?.code ?? null,
            },
          },
        );
      }

      documentIds = Array.isArray(
        processingResult.data?.documentIds,
      )
        ? processingResult.data.documentIds
        : this.repository.getSnapshot().requests[requestId]
            ?.documentReferences ?? [];
    }

    const uniqueDocumentIds = [...new Set(documentIds)];
    const documents = uniqueDocumentIds
      .map(
        (documentId) =>
          this.repository.getSnapshot().documents[documentId],
      )
      .filter(Boolean);
    const documentTypes = new Set(
      documents.map((document) => document.documentType),
    );
    const hasTwoVersions =
      uniqueDocumentIds.length === 2 &&
      (documents.length === 0 ||
        (documents.length === 2 &&
          documentTypes.has('EOB') &&
          documentTypes.has('EOR')));

    if (!hasTwoVersions) {
      return createFailure(
        409,
        BATCH_SERVICE_ERROR_CODES.VERSION_COUNT_MISMATCH,
        'Immediate claim rework must create exactly one EOB and one EOR version.',
        correlationId,
        processingResult?.meta?.revision ?? this.getRevision(),
        {
          details: {
            documentIds: uniqueDocumentIds,
            documentTypes: [...documentTypes],
          },
        },
      );
    }

    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: BATCH_AUDIT_ACTIONS.CLAIM_REWORKED,
      entityType: 'REPRINT_REQUEST',
      entityId: requestId,
      after: {
        requestId,
        claimNumber: input.claimNumber,
        memberId,
        requestType: 'BOTH',
        execution: input.execution,
        status: 'COMPLETE',
        documentIds: uniqueDocumentIds,
        reasonCode: input.reasonCode,
        transmitted: false,
        simulated: true,
      },
    });

    return createSuccess(
      requestResult.status === 200 ? 200 : 201,
      {
        requestId,
        requestType: 'BOTH',
        execution: input.execution,
        status: 'COMPLETE',
        documentIds: uniqueDocumentIds,
        replayed:
          requestResult.status === 200 &&
          processingResult === null,
        transmitted: false,
      },
      correlationId,
      processingResult?.meta?.revision ?? this.getRevision(),
      auditWarning === null ? [] : [auditWarning],
    );
  }

  getBatchRunById(batchId) {
    if (
      typeof batchId !== 'string' ||
      batchId.trim().length === 0 ||
      batchId.trim().length >
        BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new BatchServiceError(
        BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Batch ID must be a non-empty string of at most 100 characters.',
      );
    }

    return (
      this.repository.getSnapshot().batchRuns[
        batchId.normalize('NFC').trim()
      ] ?? null
    );
  }

  getBatchRow(batchId, rowId) {
    const run = this.getBatchRunById(batchId);

    if (run === null) {
      return null;
    }

    if (
      typeof rowId !== 'string' ||
      rowId.trim().length === 0 ||
      rowId.trim().length >
        BATCH_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new BatchServiceError(
        BATCH_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Batch row ID must be a non-empty string of at most 100 characters.',
      );
    }

    const identifier = rowId.normalize('NFC').trim();

    return (
      run.rows.find((row) => row.rowId === identifier) ??
      null
    );
  }

  isBatchActive(batchId) {
    return (
      typeof batchId === 'string' &&
      this.activeBatchIds.has(batchId.trim())
    );
  }

  run(command, context = undefined) {
    return this.runBatch(command, context);
  }

  retry(command, context = undefined) {
    return this.retryBatchRow(command, context);
  }

  rework(command, context = undefined) {
    return this.reworkClaim(command, context);
  }

  processClaimRework(command, context = undefined) {
    return this.reworkClaim(command, context);
  }

  findBatchRunById(batchId) {
    return this.getBatchRunById(batchId);
  }
}

/**
 * Creates a browser-local batch service.
 *
 * @param {ConstructorParameters<typeof BatchService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof BatchService>[1]} [options]
 * Service options.
 * @returns {BatchService} Batch service.
 */
export function createBatchService(
  repositoryOrOptions,
  options = {},
) {
  return new BatchService(repositoryOrOptions, options);
}

export const LocalBatchService = BatchService;
export const OperationsBatchService = BatchService;
export const ClaimsOutboundBatchService = BatchService;
export const createLocalBatchService = createBatchService;
export const createOperationsBatchService =
  createBatchService;
export const createClaimsOutboundBatchService =
  createBatchService;

export default BatchService;