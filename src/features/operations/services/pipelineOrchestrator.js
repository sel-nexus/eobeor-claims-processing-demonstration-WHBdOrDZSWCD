import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  PIPELINE_STATUSES,
  PIPELINE_STEPS,
  PROCESSING_SCENARIOS,
  REQUEST_STATUSES,
} from '../domain/domainConstants.js';
import { isOperationsUuid } from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';
import {
  createPipelineMachine,
  PIPELINE_MACHINE_ERROR_CODES,
  PIPELINE_MACHINE_STATUSES,
  PIPELINE_STOP_MODES,
} from './pipelineMachine.js';

export const PIPELINE_ORCHESTRATOR_SCHEMA_VERSION = 1;

export const PIPELINE_ORCHESTRATOR_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  PIPELINE_RUN_NOT_FOUND: 'PIPELINE_RUN_NOT_FOUND',
  INVALID_STATE: 'INVALID_STATE',
  CHECKPOINT_MISMATCH: 'CHECKPOINT_MISMATCH',
  RUN_ALREADY_ACTIVE: 'RUN_ALREADY_ACTIVE',
  REVIEW_DECISION_REQUIRED: 'REVIEW_DECISION_REQUIRED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
  DOCUMENT_CREATION_FAILED: 'DOCUMENT_CREATION_FAILED',
  OUTBOUND_CREATION_FAILED: 'OUTBOUND_CREATION_FAILED',
  ABORTED: 'ABORTED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS = Object.freeze({
  STARTED: 'PIPELINE_STARTED',
  STAGE_COMPLETED: 'STAGE_COMPLETED',
  PAUSED: 'PIPELINE_PAUSED',
  MANUAL_REVIEW: 'PIPELINE_MANUAL_REVIEW',
  FAILED: 'PIPELINE_FAILED',
  COMPLETED: 'PIPELINE_COMPLETED',
});

export const PIPELINE_PROCESSING_MODES = Object.freeze({
  COMPRESSED: 'COMPRESSED',
  IMMEDIATE: 'IMMEDIATE',
});

const PROCESSING_MODE_VALUES = new Set(
  Object.values(PIPELINE_PROCESSING_MODES),
);
const PROCESSING_SCENARIO_VALUES = new Set(
  Object.values(PROCESSING_SCENARIOS),
);
const PROCESSABLE_REQUEST_STATUSES = new Set([
  REQUEST_STATUSES.PENDING,
  REQUEST_STATUSES.FAILED,
]);
const RESUMABLE_REQUEST_STATUSES = new Set([
  REQUEST_STATUSES.PAUSED,
  REQUEST_STATUSES.MANUAL_REVIEW,
  REQUEST_STATUSES.FAILED,
]);
const TERMINAL_MACHINE_STATUSES = new Set([
  PIPELINE_MACHINE_STATUSES.COMPLETE,
  PIPELINE_MACHINE_STATUSES.FAILED,
  PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW,
  PIPELINE_MACHINE_STATUSES.CANCELLED,
]);
const DEFAULT_MANUAL_REVIEW_THRESHOLD_CENTS = 50000;

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

function requireRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getSnapshot !== 'function' ||
    typeof value.transact !== 'function'
  ) {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator requires an operations repository with getSnapshot() and transact().',
    );
  }

  return value;
}

function normalizeValidationEngine(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.validateRequest !== 'function' &&
      typeof value.validate !== 'function')
  ) {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator validation engine must provide validateRequest() or validate().',
    );
  }

  return value;
}

function normalizeDocumentService(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.createVersions !== 'function' &&
      typeof value.create !== 'function')
  ) {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator document service must provide createVersions() or create().',
    );
  }

  return value;
}

function normalizeOutboundService(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.createOutboundRecords !== 'function' &&
      typeof value.createRecords !== 'function')
  ) {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator outbound service must provide createOutboundRecords() or createRecords().',
    );
  }

  return value;
}

function normalizePermissionGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.evaluate !== 'function') {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator permission gateway must provide evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.append !== 'function') {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator audit gateway must provide append().',
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

  throw new PipelineOrchestratorError(
    PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
    'Pipeline orchestrator session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function normalizeScheduler(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'function' &&
    (typeof value !== 'object' ||
      (typeof value.wait !== 'function' &&
        typeof value.delay !== 'function'))
  ) {
    throw new PipelineOrchestratorError(
      PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
      'Pipeline orchestrator scheduler must be a function or expose wait() or delay().',
    );
  }

  return value;
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
      'Pipeline orchestrator clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Pipeline orchestrator clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedUuid(idGenerator, name) {
  const value = idGenerator();

  if (!isOperationsUuid(value)) {
    throw new TypeError(
      `${name} generator must return an RFC 4122 UUID.`,
    );
  }

  return value.toLowerCase();
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return `corr-${createGeneratedUuid(
    idGenerator,
    'Pipeline orchestrator ID',
  )}`;
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
      schemaVersion: PIPELINE_ORCHESTRATOR_SCHEMA_VERSION,
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
      schemaVersion: PIPELINE_ORCHESTRATOR_SCHEMA_VERSION,
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
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;
  const actorId =
    source.actorId ?? source.userId ?? source.requestedBy;

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
        ? source.memberId.normalize('NFC').trim()
        : null,
    correlationId:
      typeof source.correlationId === 'string'
        ? source.correlationId
        : null,
  });
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function normalizeCommand(value, operation) {
  if (typeof value === 'string') {
    value = { requestId: value };
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Pipeline command must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const requestId =
    typeof value.requestId === 'string'
      ? value.requestId.trim().toLowerCase()
      : null;
  const mode =
    value.mode === undefined
      ? PIPELINE_PROCESSING_MODES.COMPRESSED
      : typeof value.mode === 'string'
        ? value.mode.trim().toUpperCase()
        : value.mode;
  const scenario =
    value.scenario === undefined
      ? PROCESSING_SCENARIOS.SUCCESS
      : typeof value.scenario === 'string'
        ? value.scenario.trim().toUpperCase()
        : value.scenario;
  const idempotencyKey =
    typeof value.idempotencyKey === 'string'
      ? value.idempotencyKey.trim().toLowerCase()
      : null;

  if (!isOperationsUuid(requestId)) {
    errors.push(
      createFieldError(
        'requestId',
        'INVALID_UUID',
        'Request ID must be an RFC 4122 UUID.',
      ),
    );
  }

  if (!PROCESSING_MODE_VALUES.has(mode)) {
    errors.push(
      createFieldError(
        'mode',
        'INVALID_MODE',
        'Pipeline mode must be COMPRESSED or IMMEDIATE.',
      ),
    );
  }

  if (!PROCESSING_SCENARIO_VALUES.has(scenario)) {
    errors.push(
      createFieldError(
        'scenario',
        'INVALID_SCENARIO',
        'Pipeline processing scenario is not supported.',
      ),
    );
  }

  if (!isOperationsUuid(idempotencyKey)) {
    errors.push(
      createFieldError(
        'idempotencyKey',
        'INVALID_UUID',
        'Idempotency key must be an RFC 4122 UUID.',
      ),
    );
  }

  if (
    value.expectedCheckpoint !== undefined &&
    (typeof value.expectedCheckpoint !== 'string' ||
      value.expectedCheckpoint.trim().length === 0)
  ) {
    errors.push(
      createFieldError(
        'expectedCheckpoint',
        'INVALID_CHECKPOINT',
        'Expected checkpoint must be a non-empty pipeline step.',
      ),
    );
  }

  if (
    value.reviewApproved !== undefined &&
    typeof value.reviewApproved !== 'boolean'
  ) {
    errors.push(
      createFieldError(
        'reviewApproved',
        'INVALID_BOOLEAN',
        'Review approval must be a boolean.',
      ),
    );
  }

  return {
    value: {
      operation,
      requestId,
      mode,
      scenario,
      idempotencyKey,
      expectedCheckpoint:
        typeof value.expectedCheckpoint === 'string'
          ? value.expectedCheckpoint.trim().toUpperCase()
          : undefined,
      reviewApproved: value.reviewApproved === true,
    },
    errors,
  };
}

function hashCommand(command) {
  const source = [
    command.operation,
    command.requestId,
    command.mode,
    command.scenario,
    command.expectedCheckpoint ?? '',
    command.reviewApproved ? '1' : '0',
  ].join('|');
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function getProcessingTimeMs(request, completedAt) {
  const startedAt = request.startedAt ?? request.createdAt;
  const duration = Date.parse(completedAt) - Date.parse(startedAt);

  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function machineStatusToPipelineStatus(status) {
  switch (status) {
    case PIPELINE_MACHINE_STATUSES.PAUSED:
      return PIPELINE_STATUSES.PAUSED;
    case PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW:
      return PIPELINE_STATUSES.MANUAL_REVIEW;
    case PIPELINE_MACHINE_STATUSES.COMPLETE:
      return PIPELINE_STATUSES.COMPLETE;
    case PIPELINE_MACHINE_STATUSES.FAILED:
      return PIPELINE_STATUSES.FAILED;
    case PIPELINE_MACHINE_STATUSES.CANCELLED:
      return PIPELINE_STATUSES.CANCELLED;
    case PIPELINE_MACHINE_STATUSES.READY:
    case PIPELINE_MACHINE_STATUSES.RUNNING:
    default:
      return PIPELINE_STATUSES.RUNNING;
  }
}

function createPersistedRun(machineState) {
  return {
    runId: machineState.runId,
    requestId: machineState.requestId,
    scenario: machineState.scenario,
    status: machineStatusToPipelineStatus(machineState.status),
    currentStep: machineState.currentStep,
    completedSteps: machineState.completedSteps,
    checkpoint: machineState.checkpoint,
    agentOutcomes: machineState.agentOutcomes,
    stepResults: machineState.stepResults,
    startedAt:
      machineState.startedAt ??
      machineState.updatedAt,
    updatedAt:
      machineState.updatedAt ??
      machineState.startedAt,
  };
}

function createMachineStateFromRun(run) {
  return deepFreeze({
    schemaVersion: 1,
    requestId: run.requestId,
    runId: run.runId,
    scenario: run.scenario,
    status: run.status,
    currentStep: run.currentStep,
    completedSteps: run.completedSteps,
    stepResults: Array.isArray(run.stepResults)
      ? run.stepResults
      : [],
    agentOutcomes: run.agentOutcomes,
    checkpoint: run.checkpoint,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt:
      [
        PIPELINE_STATUSES.COMPLETE,
        PIPELINE_STATUSES.FAILED,
        PIPELINE_STATUSES.CANCELLED,
      ].includes(run.status)
        ? run.updatedAt
        : null,
    stepStartedAt:
      run.status === PIPELINE_STATUSES.RUNNING
        ? run.updatedAt
        : null,
    errorCode:
      run.status === PIPELINE_STATUSES.FAILED
        ? run.checkpoint?.errorCode ?? 'PIPELINE_FAILED'
        : null,
    message: null,
  });
}

function findRunByRequestId(snapshot, requestId) {
  return (
    Object.values(snapshot.pipelineRuns).find(
      (run) => run.requestId === requestId,
    ) ?? null
  );
}

function createManualReviewId(requestId) {
  return `REVIEW-${requestId}`;
}

function createErrorReportId(requestId) {
  return `ERROR-${requestId}`;
}

function createManualReview(requestId) {
  return {
    reviewId: createManualReviewId(requestId),
    requestId,
    triggerCode: 'MEMBER_RESPONSIBILITY_THRESHOLD',
    thresholdCents: DEFAULT_MANUAL_REVIEW_THRESHOLD_CENTS,
    status: 'OPEN',
    decisionBy: null,
    decidedAt: null,
  };
}

function createErrorReport(request, machineState, createdAt) {
  const summary =
    machineState.currentStep === PIPELINE_STEPS.QUALITY_CHECK
      ? 'Document quality check failed'
      : 'Request processing failed';

  return {
    errorReportId: createErrorReportId(request.requestId),
    requestId: request.requestId,
    claimNumber: request.claimNumber,
    severity: 'ERROR',
    status: 'OPEN',
    summary,
    details:
      machineState.message ??
      'The deterministic pipeline stopped before completion.',
    context: {
      stage: machineState.currentStep,
      code: machineState.errorCode ?? 'PIPELINE_FAILED',
      simulated: true,
    },
    resolution: {
      recommendation:
        'Correct the fictional fixture data and explicitly retry the request.',
      retryFrom: machineState.currentStep,
    },
    createdAt,
    relatedEntities: {
      requestId: request.requestId,
      claimNumber: request.claimNumber,
      runId: machineState.runId,
    },
    auditTrail: [
      {
        at: createdAt,
        action: 'CREATED',
        actor: 'system',
      },
    ],
    stackTrace:
      machineState.currentStep === PIPELINE_STEPS.QUALITY_CHECK
        ? 'ValidationError: fixture rule DOCUMENT_QUALITY failed'
        : 'PipelineError: deterministic fixture processing failed',
    footer: 'Fictional demo data',
  };
}

function createAbortError() {
  return new PipelineOrchestratorError(
    PIPELINE_ORCHESTRATOR_ERROR_CODES.ABORTED,
    'Pipeline playback was paused.',
  );
}

function waitWithTimers(delayMs, signal) {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  if (delayMs === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handle = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);

    function handleAbort() {
      globalThis.clearTimeout(handle);
      signal.removeEventListener('abort', handleAbort);
      reject(createAbortError());
    }

    signal.addEventListener('abort', handleAbort, {
      once: true,
    });
  });
}

async function waitForPlayback(scheduler, delayMs, signal, metadata) {
  if (signal.aborted) {
    throw createAbortError();
  }

  if (scheduler === null) {
    await waitWithTimers(delayMs, signal);
    return;
  }

  let result;

  if (typeof scheduler === 'function') {
    result = scheduler(delayMs, signal, metadata);
  } else if (typeof scheduler.wait === 'function') {
    result = scheduler.wait(delayMs, signal, metadata);
  } else {
    result = scheduler.delay(delayMs, signal, metadata);
  }

  await Promise.resolve(result);

  if (signal.aborted) {
    throw createAbortError();
  }
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
      PIPELINE_ORCHESTRATOR_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before pipeline processing completed.',
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
      PIPELINE_ORCHESTRATOR_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof PipelineOrchestratorError) {
    const status =
      error.code ===
        PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND ||
      error.code ===
        PIPELINE_ORCHESTRATOR_ERROR_CODES.PIPELINE_RUN_NOT_FOUND
        ? 404
        : error.code ===
              PIPELINE_ORCHESTRATOR_ERROR_CODES.RUN_ALREADY_ACTIVE ||
            error.code ===
              PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_STATE ||
            error.code ===
              PIPELINE_ORCHESTRATOR_ERROR_CODES.CHECKPOINT_MISMATCH ||
            error.code ===
              PIPELINE_ORCHESTRATOR_ERROR_CODES.REVIEW_DECISION_REQUIRED
          ? 409
          : error.code ===
              PIPELINE_ORCHESTRATOR_ERROR_CODES.ABORTED
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
          PIPELINE_ORCHESTRATOR_ERROR_CODES.REVISION_CONFLICT,
      },
    );
  }

  if (
    code === PIPELINE_MACHINE_ERROR_CODES.CHECKPOINT_MISMATCH
  ) {
    return createFailure(
      409,
      PIPELINE_ORCHESTRATOR_ERROR_CODES.CHECKPOINT_MISMATCH,
      'Pipeline checkpoint does not match the expected checkpoint.',
      correlationId,
      revision,
    );
  }

  if (
    code === PIPELINE_MACHINE_ERROR_CODES.REVIEW_DECISION_REQUIRED
  ) {
    return createFailure(
      409,
      PIPELINE_ORCHESTRATOR_ERROR_CODES.REVIEW_DECISION_REQUIRED,
      'Manual review approval is required before pipeline resume.',
      correlationId,
      revision,
    );
  }

  return createFailure(
    500,
    PIPELINE_ORCHESTRATOR_ERROR_CODES.PERSISTENCE_FAILED,
    'The local pipeline operation could not be completed.',
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
 * Error raised when pipeline orchestration input or state is invalid.
 */
export class PipelineOrchestratorError extends Error {
  /**
   * @param {string} code Stable orchestrator error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PipelineOrchestratorError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Coordinates cancellable deterministic request processing.
 */
export class PipelineOrchestrator {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or orchestrator options.
   * @param {{
   *   pipelineMachine?: object,
   *   validationEngine?: object,
   *   fixtureGateway?: object,
   *   documentService?: object,
   *   documentVersionService?: object,
   *   outboundService?: object,
   *   permissionGateway?: object,
   *   permissionService?: object,
   *   auditGateway?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   scheduler?: object|Function,
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Orchestrator options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.repository = requireRepository(resolved.repository);
    this.machine =
      normalizedOptions.pipelineMachine ??
      createPipelineMachine({
        clock: normalizedOptions.clock ?? browserClock,
      });
    this.validationEngine = normalizeValidationEngine(
      normalizedOptions.validationEngine,
    );
    this.fixtureGateway =
      normalizedOptions.fixtureGateway ??
      normalizedOptions.fixtureRepository ??
      normalizedOptions.fixtures ??
      null;
    this.documentService = normalizeDocumentService(
      normalizedOptions.documentService ??
        normalizedOptions.documentVersionService,
    );
    this.outboundService = normalizeOutboundService(
      normalizedOptions.outboundService,
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
    this.scheduler = normalizeScheduler(
      normalizedOptions.scheduler,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;
    this.activeRuns = new Map();

    if (
      this.machine === null ||
      typeof this.machine.createState !== 'function' ||
      typeof this.machine.start !== 'function' ||
      typeof this.machine.advance !== 'function' ||
      typeof this.machine.resume !== 'function' ||
      typeof this.machine.stop !== 'function' ||
      typeof this.machine.getDelay !== 'function'
    ) {
      throw new PipelineOrchestratorError(
        PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
        'Pipeline orchestrator requires a compatible pipeline state machine.',
      );
    }

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Pipeline orchestrator ID generator must be a function.',
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

  async authorize(request, actor, correlationId) {
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
          PIPELINE_ORCHESTRATOR_ERROR_CODES.AUTHENTICATION_REQUIRED,
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
          action: ACTIONS.REPRINT_REQUEST,
          resource: {
            type: 'CLAIM',
            id: request.claimNumber,
            claimNumber: request.claimNumber,
            memberId: request.memberId,
            ownerMemberId: request.memberId,
            owned:
              actor.role !== 'MEMBER' ||
              actor.memberId === request.memberId,
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_DEPENDENCY,
          'Pipeline permission evaluation could not be completed.',
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

    if (decision?.allowed === true) {
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
          ? PIPELINE_ORCHESTRATOR_ERROR_CODES.AUTHENTICATION_REQUIRED
          : PIPELINE_ORCHESTRATOR_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'This demo role cannot process the reprint request.',
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
    request,
    machineState,
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
            type: 'REPRINT_REQUEST',
            id: request.requestId,
          },
        },
        {
          action,
          entity: {
            type: 'REPRINT_REQUEST',
            id: request.requestId,
          },
          before: null,
          after: {
            requestId: request.requestId,
            displayId: request.displayId,
            status: request.status,
            currentStep: machineState.currentStep,
            pipelineStatus: machineState.status,
            completedSteps: machineState.completedSteps,
            simulated: true,
          },
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: PIPELINE_ORCHESTRATOR_ERROR_CODES.AUDIT_FAILED,
        message:
          'Pipeline processing completed, but a local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  getIdempotencyResult(command, requestHash) {
    const snapshot = this.repository.getSnapshot();
    const record =
      snapshot.idempotencyResults[command.idempotencyKey];

    if (record === undefined) {
      return null;
    }

    if (
      record.commandName !== command.operation ||
      record.requestHash !== requestHash
    ) {
      throw new PipelineOrchestratorError(
        PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_STATE,
        'The idempotency key was already used for another pipeline operation.',
        {
          idempotencyKey: command.idempotencyKey,
        },
      );
    }

    return record.result;
  }

  persistMachineState(machineState, requestChanges = {}) {
    const snapshot = this.repository.getSnapshot();

    return this.repository.transact(
      (draft) => {
        const request = draft.requests[machineState.requestId];

        if (request === undefined) {
          throw new PipelineOrchestratorError(
            PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND,
            'The reprint request no longer exists.',
          );
        }

        draft.pipelineRuns[machineState.runId] =
          createPersistedRun(machineState);
        Object.assign(request, requestChanges);
      },
      {
        expectedRevision: snapshot.revision,
      },
    );
  }

  persistTerminalResult({
    command,
    requestHash,
    machineState,
    requestChanges,
    result,
    errorReport,
    manualReview,
  }) {
    const snapshot = this.repository.getSnapshot();
    const timestamp = getCurrentTimestamp(this.clock);

    return this.repository.transact(
      (draft) => {
        const request = draft.requests[command.requestId];

        if (request === undefined) {
          throw new PipelineOrchestratorError(
            PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND,
            'The reprint request no longer exists.',
          );
        }

        draft.pipelineRuns[machineState.runId] =
          createPersistedRun(machineState);
        Object.assign(request, requestChanges);

        if (errorReport !== null) {
          draft.errorReports[errorReport.errorReportId] =
            errorReport;
        }

        if (manualReview !== null) {
          draft.reviews[manualReview.reviewId] =
            draft.reviews[manualReview.reviewId] ??
            manualReview;
        }

        draft.idempotencyResults[command.idempotencyKey] = {
          idempotencyKey: command.idempotencyKey,
          commandName: command.operation,
          requestHash,
          result,
          createdAt: timestamp,
        };
      },
      {
        expectedRevision: snapshot.revision,
      },
    );
  }

  async evaluateValidation(request, actor) {
    if (this.validationEngine === null) {
      return null;
    }

    let fixtures = {};

    if (
      this.fixtureGateway !== null &&
      typeof this.fixtureGateway.getSnapshot === 'function'
    ) {
      fixtures = await this.fixtureGateway.getSnapshot();
    }

    const validate =
      typeof this.validationEngine.validateRequest === 'function'
        ? this.validationEngine.validateRequest.bind(
            this.validationEngine,
          )
        : this.validationEngine.validate.bind(
            this.validationEngine,
          );

    return validate(request, fixtures, actor ?? {});
  }

  async createDocuments(requestId, actor) {
    if (this.documentService === null) {
      return {
        ok: true,
        data: {
          documentIds: [],
          documents: [],
        },
      };
    }

    const create =
      typeof this.documentService.createVersions === 'function'
        ? this.documentService.createVersions.bind(
            this.documentService,
          )
        : this.documentService.create.bind(
            this.documentService,
          );

    return create({ requestId }, actor ?? undefined);
  }

  async createOutbound(documentIds, actor) {
    if (
      this.outboundService === null ||
      documentIds.length === 0
    ) {
      return {
        ok: true,
        data: {
          outboundIds: [],
          records: [],
          transmitted: false,
        },
      };
    }

    const create =
      typeof this.outboundService.createOutboundRecords ===
      'function'
        ? this.outboundService.createOutboundRecords.bind(
            this.outboundService,
          )
        : this.outboundService.createRecords.bind(
            this.outboundService,
          );

    return create(
      {
        documentIds,
      },
      actor ?? undefined,
    );
  }

  async pauseAfterAbort(requestId, machineState) {
    if (
      machineState === null ||
      machineState.status !==
        PIPELINE_MACHINE_STATUSES.RUNNING
    ) {
      return this.repository.getSnapshot();
    }

    const paused = this.machine.stop(machineState, {
      mode: PIPELINE_STOP_MODES.PAUSE,
      at: getCurrentTimestamp(this.clock),
      message: 'Pipeline playback was paused.',
    });

    return this.persistMachineState(paused, {
      status: REQUEST_STATUSES.PAUSED,
      currentStep: paused.currentStep,
      completedAt: null,
      processingTimeMs: null,
      result: 'Pipeline playback paused at a resumable checkpoint.',
      version:
        this.repository.getSnapshot().requests[requestId].version +
        1,
    });
  }

  async execute(command, actor, initialState, requestHash) {
    const controller = new globalThis.AbortController();
    const active = {
      controller,
      machineState: initialState,
    };

    this.activeRuns.set(command.requestId, active);

    let machineState = initialState;
    const warnings = [];

    try {
      while (!TERMINAL_MACHINE_STATUSES.has(machineState.status)) {
        if (controller.signal.aborted) {
          throw createAbortError();
        }

        const request =
          this.repository.getSnapshot().requests[command.requestId];

        if (request === undefined) {
          throw new PipelineOrchestratorError(
            PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND,
            'The reprint request no longer exists.',
          );
        }

        if (
          machineState.currentStep === PIPELINE_STEPS.VALIDATION &&
          this.validationEngine !== null
        ) {
          const validation = await this.evaluateValidation(
            request,
            actor,
          );

          if (
            validation !== null &&
            validation.valid === false &&
            validation.requiresManualReview !== true
          ) {
            machineState = this.machine.fail(machineState, {
              at: getCurrentTimestamp(this.clock),
              code:
                validation.code ??
                'REQUEST_VALIDATION_FAILED',
              message:
                validation.errors?.[0]?.message ??
                'Request validation failed.',
            });
            active.machineState = machineState;
            break;
          }
        }

        const delayMs =
          command.mode === PIPELINE_PROCESSING_MODES.IMMEDIATE
            ? 0
            : this.machine.getDelay(machineState.currentStep);

        await waitForPlayback(
          this.scheduler,
          delayMs,
          controller.signal,
          {
            requestId: command.requestId,
            runId: machineState.runId,
            step: machineState.currentStep,
          },
        );

        const previousStep = machineState.currentStep;

        machineState = this.machine.advance(machineState, {
          at: getCurrentTimestamp(this.clock),
        });
        active.machineState = machineState;

        if (
          machineState.status ===
          PIPELINE_MACHINE_STATUSES.RUNNING
        ) {
          const envelope = this.persistMachineState(
            machineState,
            {
              status: REQUEST_STATUSES.PROCESSING,
              currentStep: machineState.currentStep,
              result: `${previousStep} completed for demonstration.`,
              version: request.version + 1,
            },
          );
          const storedRequest =
            envelope.requests[command.requestId];
          const warning = await this.appendAudit({
            correlationId: actor?.correlationId ?? null,
            actor,
            action:
              PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS.STAGE_COMPLETED,
            request: storedRequest,
            machineState,
          });

          if (warning !== null) {
            warnings.push(warning);
          }
        }
      }

      const snapshot = this.repository.getSnapshot();
      const request = snapshot.requests[command.requestId];

      if (
        machineState.status ===
        PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW
      ) {
        const review = createManualReview(command.requestId);
        const result = {
          requestId: command.requestId,
          runId: machineState.runId,
          status: REQUEST_STATUSES.MANUAL_REVIEW,
          currentStep: machineState.currentStep,
          reviewId: review.reviewId,
          checkpoint: machineState.checkpoint,
          completedSteps: machineState.completedSteps,
        };
        const envelope = this.persistTerminalResult({
          command,
          requestHash,
          machineState,
          requestChanges: {
            status: REQUEST_STATUSES.MANUAL_REVIEW,
            currentStep: machineState.currentStep,
            completedAt: null,
            processingTimeMs: null,
            result: 'Waiting for authorized manual review.',
            version: request.version + 1,
          },
          result,
          errorReport: null,
          manualReview: review,
        });
        const warning = await this.appendAudit({
          correlationId: actor?.correlationId ?? null,
          actor,
          action:
            PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS.MANUAL_REVIEW,
          request: envelope.requests[command.requestId],
          machineState,
        });

        if (warning !== null) {
          warnings.push(warning);
        }

        return createSuccess(
          200,
          result,
          actor?.correlationId ?? null,
          envelope.revision,
          warnings,
        );
      }

      if (
        machineState.status ===
        PIPELINE_MACHINE_STATUSES.FAILED
      ) {
        const completedAt =
          machineState.completedAt ??
          getCurrentTimestamp(this.clock);
        const errorReport = createErrorReport(
          request,
          machineState,
          completedAt,
        );
        const result = {
          requestId: command.requestId,
          runId: machineState.runId,
          status: REQUEST_STATUSES.FAILED,
          currentStep: machineState.currentStep,
          errorCode:
            machineState.errorCode ?? 'PIPELINE_FAILED',
          errorReportId: errorReport.errorReportId,
          checkpoint: machineState.checkpoint,
          completedSteps: machineState.completedSteps,
        };
        const envelope = this.persistTerminalResult({
          command,
          requestHash,
          machineState,
          requestChanges: {
            status: REQUEST_STATUSES.FAILED,
            currentStep: machineState.currentStep,
            completedAt,
            processingTimeMs: getProcessingTimeMs(
              request,
              completedAt,
            ),
            result:
              machineState.message ??
              'Pipeline processing failed.',
            errorReportId: errorReport.errorReportId,
            version: request.version + 1,
          },
          result,
          errorReport,
          manualReview: null,
        });
        const warning = await this.appendAudit({
          correlationId: actor?.correlationId ?? null,
          actor,
          action:
            PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS.FAILED,
          request: envelope.requests[command.requestId],
          machineState,
        });

        if (warning !== null) {
          warnings.push(warning);
        }

        return createSuccess(
          200,
          result,
          actor?.correlationId ?? null,
          envelope.revision,
          warnings,
        );
      }

      if (
        machineState.status !==
        PIPELINE_MACHINE_STATUSES.COMPLETE
      ) {
        throw new PipelineOrchestratorError(
          PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_STATE,
          'Pipeline ended in an unsupported state.',
          {
            status: machineState.status,
          },
        );
      }

      const documentResult = await this.createDocuments(
        command.requestId,
        actor,
      );

      if (documentResult?.ok !== true) {
        throw new PipelineOrchestratorError(
          PIPELINE_ORCHESTRATOR_ERROR_CODES.DOCUMENT_CREATION_FAILED,
          documentResult?.error?.message ??
            'Representative document versions could not be created.',
          {
            dependencyCode:
              documentResult?.error?.code ?? null,
          },
        );
      }

      const documentIds = Array.isArray(
        documentResult.data?.documentIds,
      )
        ? documentResult.data.documentIds
        : Array.isArray(documentResult.data?.documents)
          ? documentResult.data.documents.map(
              (document) => document.documentId,
            )
          : [];
      const outboundResult = await this.createOutbound(
        documentIds,
        actor,
      );

      if (outboundResult?.ok !== true) {
        throw new PipelineOrchestratorError(
          PIPELINE_ORCHESTRATOR_ERROR_CODES.OUTBOUND_CREATION_FAILED,
          outboundResult?.error?.message ??
            'Local outbound projections could not be created.',
          {
            dependencyCode:
              outboundResult?.error?.code ?? null,
          },
        );
      }

      const outboundRecords = Array.isArray(
        outboundResult.data?.records,
      )
        ? outboundResult.data.records
        : [];
      const ixitRecord =
        outboundRecords.find(
          (record) => record.kind === 'IXIT',
        ) ?? null;
      const completedAt =
        machineState.completedAt ??
        getCurrentTimestamp(this.clock);
      const refreshedRequest =
        this.repository.getSnapshot().requests[command.requestId];
      const result = {
        requestId: command.requestId,
        runId: machineState.runId,
        status: REQUEST_STATUSES.COMPLETE,
        currentStep: PIPELINE_STEPS.STORED,
        documentIds,
        outboundIds: outboundRecords.map(
          (record) => record.outboundId,
        ),
        ixitReportId: ixitRecord?.outboundId ?? null,
        checkpoint: machineState.checkpoint,
        completedSteps: machineState.completedSteps,
        stepResults: machineState.stepResults,
      };
      const envelope = this.persistTerminalResult({
        command,
        requestHash,
        machineState,
        requestChanges: {
          status: REQUEST_STATUSES.COMPLETE,
          currentStep: PIPELINE_STEPS.STORED,
          completedAt,
          processingTimeMs: getProcessingTimeMs(
            refreshedRequest,
            completedAt,
          ),
          result:
            documentIds.length > 1
              ? 'EOB and EOR representative documents stored.'
              : 'Representative document stored.',
          errorReportId: null,
          version: refreshedRequest.version + 1,
        },
        result,
        errorReport: null,
        manualReview: null,
      });
      const warning = await this.appendAudit({
        correlationId: actor?.correlationId ?? null,
        actor,
        action:
          PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS.COMPLETED,
        request: envelope.requests[command.requestId],
        machineState,
      });

      if (warning !== null) {
        warnings.push(warning);
      }

      return createSuccess(
        200,
        result,
        actor?.correlationId ?? null,
        envelope.revision,
        warnings,
      );
    } catch (error) {
      if (
        error instanceof PipelineOrchestratorError &&
        error.code ===
          PIPELINE_ORCHESTRATOR_ERROR_CODES.ABORTED
      ) {
        try {
          const envelope = await this.pauseAfterAbort(
            command.requestId,
            active.machineState,
          );

          return createFailure(
            409,
            PIPELINE_ORCHESTRATOR_ERROR_CODES.ABORTED,
            'Pipeline playback was paused at a resumable checkpoint.',
            actor?.correlationId ?? null,
            envelope.revision,
            {
              retryable: true,
              recoveryAction: 'RESUME_REQUEST',
              details: {
                requestId: command.requestId,
                checkpoint:
                  active.machineState.currentStep,
              },
            },
          );
        } catch (pauseError) {
          return normalizeRepositoryFailure(
            pauseError,
            actor?.correlationId ?? null,
            this.getRevision(),
          );
        }
      }

      return normalizeRepositoryFailure(
        error,
        actor?.correlationId ?? null,
        this.getRevision(),
      );
    } finally {
      this.activeRuns.delete(command.requestId);
    }
  }

  /**
   * Starts deterministic processing for a pending or failed request.
   *
   * @param {string|Record<string, unknown>} command Processing command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async processRequest(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeCommand(command, 'processRequest');
    const initialRevision = this.getRevision();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.VALIDATION_ERROR,
        'Pipeline processing request validation failed.',
        correlationId,
        initialRevision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const requestHash = hashCommand(input);
    let replayed;

    try {
      replayed = this.getIdempotencyResult(
        input,
        requestHash,
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        initialRevision,
      );
    }

    if (replayed !== null) {
      return createSuccess(
        200,
        {
          ...replayed,
          replayed: true,
        },
        correlationId,
        this.getRevision(),
      );
    }

    if (this.activeRuns.has(input.requestId)) {
      return createFailure(
        409,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.RUN_ALREADY_ACTIVE,
        'A pipeline run is already active for this request.',
        correlationId,
        initialRevision,
      );
    }

    const snapshot = this.repository.getSnapshot();
    const request = snapshot.requests[input.requestId];

    if (request === undefined) {
      return createFailure(
        404,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND,
        'The reprint request does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (!PROCESSABLE_REQUEST_STATUSES.has(request.status)) {
      return createFailure(
        409,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_STATE,
        'Only pending or failed requests may start a new pipeline run.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: request.status,
          },
        },
      );
    }

    const authorization = await this.authorize(
      request,
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const runId = createGeneratedUuid(
      this.idGenerator,
      'Pipeline run ID',
    );
    let machineState = this.machine.createState({
      requestId: input.requestId,
      runId,
      scenario: input.scenario,
    });

    machineState = this.machine.start(
      machineState,
      getCurrentTimestamp(this.clock),
    );

    let envelope;

    try {
      envelope = this.repository.transact(
        (draft) => {
          const storedRequest =
            draft.requests[input.requestId];

          if (storedRequest === undefined) {
            throw new PipelineOrchestratorError(
              PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND,
              'The reprint request no longer exists.',
            );
          }

          const activeRun = Object.values(
            draft.pipelineRuns,
          ).find(
            (run) =>
              run.requestId === input.requestId &&
              run.status === PIPELINE_STATUSES.RUNNING,
          );

          if (activeRun !== undefined) {
            throw new PipelineOrchestratorError(
              PIPELINE_ORCHESTRATOR_ERROR_CODES.RUN_ALREADY_ACTIVE,
              'A pipeline run is already active for this request.',
            );
          }

          draft.pipelineRuns[runId] =
            createPersistedRun(machineState);
          storedRequest.status = REQUEST_STATUSES.PROCESSING;
          storedRequest.startedAt =
            storedRequest.startedAt ??
            machineState.startedAt;
          storedRequest.completedAt = null;
          storedRequest.processingTimeMs = null;
          storedRequest.errorReportId = null;
          storedRequest.currentStep = machineState.currentStep;
          storedRequest.result =
            'Pipeline processing started for demonstration.';
          storedRequest.version += 1;
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

    const startedRequest =
      envelope.requests[input.requestId];
    const warning = await this.appendAudit({
      correlationId,
      actor,
      action:
        PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS.STARTED,
      request: startedRequest,
      machineState,
    });
    const executionActor =
      actor === null
        ? null
        : deepFreeze({
            ...actor,
            correlationId,
          });
    const result = await this.execute(
      input,
      executionActor,
      machineState,
      requestHash,
    );

    if (
      warning !== null &&
      result.ok === true
    ) {
      return createSuccess(
        result.status,
        result.data,
        result.meta.correlationId,
        result.meta.revision,
        [warning, ...result.meta.warnings],
      );
    }

    return result;
  }

  /**
   * Resumes a paused or approved manual-review pipeline checkpoint.
   *
   * @param {string|Record<string, unknown>} command Resume command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async resumeRequest(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeCommand(command, 'resumeRequest');
    const initialRevision = this.getRevision();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.VALIDATION_ERROR,
        'Pipeline resume request validation failed.',
        correlationId,
        initialRevision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const requestHash = hashCommand(input);
    let replayed;

    try {
      replayed = this.getIdempotencyResult(
        input,
        requestHash,
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        initialRevision,
      );
    }

    if (replayed !== null) {
      return createSuccess(
        200,
        {
          ...replayed,
          replayed: true,
        },
        correlationId,
        this.getRevision(),
      );
    }

    if (this.activeRuns.has(input.requestId)) {
      return createFailure(
        409,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.RUN_ALREADY_ACTIVE,
        'A pipeline run is already active for this request.',
        correlationId,
        initialRevision,
      );
    }

    const snapshot = this.repository.getSnapshot();
    const request = snapshot.requests[input.requestId];

    if (request === undefined) {
      return createFailure(
        404,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.REQUEST_NOT_FOUND,
        'The reprint request does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (!RESUMABLE_REQUEST_STATUSES.has(request.status)) {
      return createFailure(
        409,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_STATE,
        'The reprint request is not in a resumable state.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: request.status,
          },
        },
      );
    }

    const run = findRunByRequestId(snapshot, input.requestId);

    if (run === null) {
      return createFailure(
        404,
        PIPELINE_ORCHESTRATOR_ERROR_CODES.PIPELINE_RUN_NOT_FOUND,
        'The pipeline run does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const authorization = await this.authorize(
      request,
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let machineState;

    try {
      machineState = this.machine.resume(
        createMachineStateFromRun(run),
        {
          expectedCheckpoint: input.expectedCheckpoint,
          reviewApproved: input.reviewApproved,
          at: getCurrentTimestamp(this.clock),
        },
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    let envelope;

    try {
      envelope = this.repository.transact(
        (draft) => {
          const storedRequest =
            draft.requests[input.requestId];
          const storedRun =
            draft.pipelineRuns[run.runId];

          if (
            storedRequest === undefined ||
            storedRun === undefined
          ) {
            throw new PipelineOrchestratorError(
              PIPELINE_ORCHESTRATOR_ERROR_CODES.INVALID_STATE,
              'The request or pipeline run changed before resume.',
            );
          }

          if (
            storedRun.status === PIPELINE_STATUSES.RUNNING
          ) {
            throw new PipelineOrchestratorError(
              PIPELINE_ORCHESTRATOR_ERROR_CODES.RUN_ALREADY_ACTIVE,
              'A pipeline run is already active for this request.',
            );
          }

          draft.pipelineRuns[run.runId] =
            createPersistedRun(machineState);
          storedRequest.status = REQUEST_STATUSES.PROCESSING;
          storedRequest.completedAt = null;
          storedRequest.processingTimeMs = null;
          storedRequest.currentStep = machineState.currentStep;
          storedRequest.result =
            'Pipeline resumed from its persisted checkpoint.';
          storedRequest.version += 1;
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

    const executionActor =
      actor === null
        ? null
        : deepFreeze({
            ...actor,
            correlationId,
          });
    const warning = await this.appendAudit({
      correlationId,
      actor,
      action:
        PIPELINE_ORCHESTRATOR_AUDIT_ACTIONS.STARTED,
      request: envelope.requests[input.requestId],
      machineState,
    });
    const result = await this.execute(
      input,
      executionActor,
      machineState,
      requestHash,
    );

    if (warning !== null && result.ok === true) {
      return createSuccess(
        result.status,
        {
          ...result.data,
          resumedFrom:
            input.expectedCheckpoint ??
            run.checkpoint.step,
        },
        result.meta.correlationId,
        result.meta.revision,
        [warning, ...result.meta.warnings],
      );
    }

    if (result.ok === true) {
      return createSuccess(
        result.status,
        {
          ...result.data,
          resumedFrom:
            input.expectedCheckpoint ??
            run.checkpoint.step,
        },
        result.meta.correlationId,
        result.meta.revision,
        result.meta.warnings,
      );
    }

    return result;
  }

  /**
   * Aborts active playback. Committed evidence remains and the run is paused.
   *
   * @param {string} requestId Request identifier.
   * @returns {boolean} Whether active playback was aborted.
   */
  cancel(requestId) {
    if (!isOperationsUuid(requestId)) {
      throw new PipelineOrchestratorError(
        PIPELINE_ORCHESTRATOR_ERROR_CODES.VALIDATION_ERROR,
        'Request ID must be an RFC 4122 UUID.',
      );
    }

    const active = this.activeRuns.get(requestId.toLowerCase());

    if (active === undefined) {
      return false;
    }

    active.controller.abort();
    return true;
  }

  isActive(requestId) {
    return (
      typeof requestId === 'string' &&
      this.activeRuns.has(requestId.toLowerCase())
    );
  }

  getActiveRequestIds() {
    return Object.freeze([...this.activeRuns.keys()]);
  }

  process(command, context = undefined) {
    return this.processRequest(command, context);
  }

  run(command, context = undefined) {
    return this.processRequest(command, context);
  }

  resume(command, context = undefined) {
    return this.resumeRequest(command, context);
  }

  stop(requestId) {
    return this.cancel(requestId);
  }

  destroy() {
    const count = this.activeRuns.size;

    this.activeRuns.forEach((active) => {
      active.controller.abort();
    });
    this.activeRuns.clear();

    return count;
  }
}

/**
 * Creates a deterministic pipeline orchestrator.
 *
 * @param {ConstructorParameters<typeof PipelineOrchestrator>[0]}
 * repositoryOrOptions Repository or orchestrator options.
 * @param {ConstructorParameters<typeof PipelineOrchestrator>[1]} [options]
 * Orchestrator options.
 * @returns {PipelineOrchestrator} Pipeline orchestrator.
 */
export function createPipelineOrchestrator(
  repositoryOrOptions,
  options = {},
) {
  return new PipelineOrchestrator(
    repositoryOrOptions,
    options,
  );
}

export const ReprintPipelineOrchestrator =
  PipelineOrchestrator;
export const DeterministicPipelineOrchestrator =
  PipelineOrchestrator;
export const createReprintPipelineOrchestrator =
  createPipelineOrchestrator;
export const createDeterministicPipelineOrchestrator =
  createPipelineOrchestrator;

export default PipelineOrchestrator;