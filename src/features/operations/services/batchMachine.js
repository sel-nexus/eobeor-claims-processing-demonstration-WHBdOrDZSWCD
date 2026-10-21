import { browserClock } from '../../../platform/time/clock.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';
import {
  BATCH_ROW_STATUSES,
  BATCH_STATUSES,
  BATCH_STEPS,
  BATCH_STEP_VALUES,
  PIPELINE_STEP_STATUSES,
} from '../domain/domainConstants.js';

export const BATCH_MACHINE_SCHEMA_VERSION = 1;

export const BATCH_MACHINE_STATUSES = Object.freeze({
  READY: 'READY',
  RUNNING: BATCH_STATUSES.RUNNING,
  PAUSED: 'PAUSED',
  COMPLETE: BATCH_STATUSES.COMPLETE,
  COMPLETED_WITH_ERRORS: BATCH_STATUSES.COMPLETED_WITH_ERRORS,
  CANCELLED: 'CANCELLED',
});

export const BATCH_MACHINE_EVENTS = Object.freeze({
  START: 'START',
  ADVANCE: 'ADVANCE',
  PASS: 'PASS',
  FAIL_ROW: 'FAIL_ROW',
  RETURN_ROW_TO_QUEUE: 'RETURN_ROW_TO_QUEUE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  CANCEL: 'CANCEL',
});

export const BATCH_STOP_MODES = Object.freeze({
  PAUSE: 'PAUSE',
  CANCEL: 'CANCEL',
});

export const BATCH_ROW_SCENARIOS = Object.freeze({
  SUCCESS: 'SUCCESS',
  MEMBER_INVALID: 'MEMBER_INVALID',
  CLAIM_INVALID: 'CLAIM_INVALID',
  PAYMENT_MISSING: 'PAYMENT_MISSING',
  DOCUMENT_PREPARATION_FAILED: 'DOCUMENT_PREPARATION_FAILED',
  REPORT_CREATION_FAILED: 'REPORT_CREATION_FAILED',
  IXIT_HANDOFF_FAILED: 'IXIT_HANDOFF_FAILED',
});

export const BATCH_MACHINE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_STEP: 'INVALID_STEP',
  INVALID_ROW: 'INVALID_ROW',
  ROW_NOT_FOUND: 'ROW_NOT_FOUND',
  INVALID_SCENARIO: 'INVALID_SCENARIO',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CHECKPOINT_MISMATCH: 'CHECKPOINT_MISMATCH',
  RESUME_NOT_ALLOWED: 'RESUME_NOT_ALLOWED',
  TERMINAL_STATE: 'TERMINAL_STATE',
  TRANSITION_LIMIT_EXCEEDED: 'TRANSITION_LIMIT_EXCEEDED',
});

const BATCH_STEP_SET = new Set(BATCH_STEP_VALUES);
const BATCH_ROW_SCENARIO_SET = new Set(
  Object.values(BATCH_ROW_SCENARIOS),
);
const BATCH_MACHINE_STATUS_SET = new Set(
  Object.values(BATCH_MACHINE_STATUSES),
);
const BATCH_ROW_STATUS_SET = new Set(
  Object.values(BATCH_ROW_STATUSES),
);
const TERMINAL_BATCH_STATUSES = new Set([
  BATCH_MACHINE_STATUSES.COMPLETE,
  BATCH_MACHINE_STATUSES.COMPLETED_WITH_ERRORS,
  BATCH_MACHINE_STATUSES.CANCELLED,
]);
const MAXIMUM_BATCH_ROWS = 5000;
const MAXIMUM_IDENTIFIER_LENGTH = 100;

const BATCH_STEP_DEFINITIONS = Object.freeze([
  Object.freeze({
    step: BATCH_STEPS.INTAKE,
    label: 'Intake',
    activity: 'Receive and normalize queued claims',
    printedMinutes: '1',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.MEMBER_VALIDATION,
    label: 'Member validation',
    activity: 'Validate member identifiers and eligibility',
    printedMinutes: '2',
    compressedDelayMs: 300,
    checks: Object.freeze([
      Object.freeze({
        code: 'MEMBER_EXISTS',
        label: 'Member exists',
      }),
      Object.freeze({
        code: 'MEMBER_ACTIVE',
        label: 'Member is active',
      }),
    ]),
  }),
  Object.freeze({
    step: BATCH_STEPS.CLAIM_VALIDATION,
    label: 'Claim validation',
    activity: 'Validate claim ownership and outbound eligibility',
    printedMinutes: '2',
    compressedDelayMs: 300,
    checks: Object.freeze([
      Object.freeze({
        code: 'CLAIM_EXISTS',
        label: 'Claim exists',
      }),
      Object.freeze({
        code: 'MEMBER_CLAIM_MATCH',
        label: 'Member and claim match',
      }),
      Object.freeze({
        code: 'CLAIM_ELIGIBLE',
        label: 'Claim is eligible',
      }),
    ]),
  }),
  Object.freeze({
    step: BATCH_STEPS.PROVIDER_CONSOLIDATION,
    label: 'Provider consolidation',
    activity: 'Consolidate rows by fictional provider',
    printedMinutes: '2',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.MEMBER_CONSOLIDATION,
    label: 'Member consolidation',
    activity: 'Consolidate rows by fictional member',
    printedMinutes: '2',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.PAYMENT_ATTACHMENT,
    label: 'Payment attachment',
    activity: 'Attach masked payment references',
    printedMinutes: '2',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.DOCUMENT_PREPARATION,
    label: 'Document preparation',
    activity: 'Prepare representative document metadata',
    printedMinutes: '3',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.REPORT_CREATION,
    label: 'Report creation',
    activity: 'Create local report metadata',
    printedMinutes: '2',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.IXIT_HANDOFF,
    label: 'Mock IXIT handoff',
    activity: 'Create a local mock IXIT handoff record',
    printedMinutes: '1',
    compressedDelayMs: 300,
  }),
  Object.freeze({
    step: BATCH_STEPS.COMPLETION,
    label: 'Completion',
    activity: 'Finalize successful rows and retain returned rows',
    printedMinutes: '1',
    compressedDelayMs: 0,
  }),
]);

const BATCH_STEP_DEFINITIONS_BY_STEP = Object.freeze(
  Object.fromEntries(
    BATCH_STEP_DEFINITIONS.map((definition) => [
      definition.step,
      definition,
    ]),
  ),
);

export const BATCH_TRANSITION_TABLE = Object.freeze(
  Object.fromEntries(
    BATCH_STEP_VALUES.map((step, index) => [
      step,
      Object.freeze({
        passed:
          BATCH_STEP_VALUES[index + 1] ??
          BATCH_MACHINE_STATUSES.COMPLETE,
        failed: BATCH_MACHINE_STATUSES.COMPLETED_WITH_ERRORS,
        queueReturn:
          BATCH_MACHINE_STATUSES.COMPLETED_WITH_ERRORS,
        cancelled: BATCH_MACHINE_STATUSES.CANCELLED,
      }),
    ]),
  ),
);

export const BATCH_COMPRESSED_DELAYS_MS = Object.freeze(
  Object.fromEntries(
    BATCH_STEP_DEFINITIONS.map((definition) => [
      definition.step,
      definition.compressedDelayMs,
    ]),
  ),
);

export const BATCH_PRINTED_DURATIONS = Object.freeze(
  Object.fromEntries(
    BATCH_STEP_DEFINITIONS.map((definition) => [
      definition.step,
      definition.printedMinutes,
    ]),
  ),
);

export const BATCH_SCRIPTED_OUTCOMES = Object.freeze({
  [BATCH_ROW_SCENARIOS.SUCCESS]: null,
  [BATCH_ROW_SCENARIOS.MEMBER_INVALID]: Object.freeze({
    step: BATCH_STEPS.MEMBER_VALIDATION,
    outcome: 'FAILED',
    code: 'MEMBER_VALIDATION_FAILED',
    message:
      'The fictional member could not be validated for batch processing.',
  }),
  [BATCH_ROW_SCENARIOS.CLAIM_INVALID]: Object.freeze({
    step: BATCH_STEPS.CLAIM_VALIDATION,
    outcome: 'FAILED',
    code: 'CLAIM_VALIDATION_FAILED',
    message:
      'The fictional claim could not be validated for batch processing.',
  }),
  [BATCH_ROW_SCENARIOS.PAYMENT_MISSING]: Object.freeze({
    step: BATCH_STEPS.PAYMENT_ATTACHMENT,
    outcome: 'QUEUE_RETURN',
    code: 'PAYMENT_MISSING',
    message:
      'The fictional row was returned to the local queue because its masked payment reference is missing.',
  }),
  [BATCH_ROW_SCENARIOS.DOCUMENT_PREPARATION_FAILED]:
    Object.freeze({
      step: BATCH_STEPS.DOCUMENT_PREPARATION,
      outcome: 'FAILED',
      code: 'DOCUMENT_PREPARATION_FAILED',
      message:
        'Representative document metadata could not be prepared.',
    }),
  [BATCH_ROW_SCENARIOS.REPORT_CREATION_FAILED]: Object.freeze({
    step: BATCH_STEPS.REPORT_CREATION,
    outcome: 'QUEUE_RETURN',
    code: 'REPORT_CREATION_FAILED',
    message:
      'The fictional row was returned to the local queue because report creation failed.',
  }),
  [BATCH_ROW_SCENARIOS.IXIT_HANDOFF_FAILED]: Object.freeze({
    step: BATCH_STEPS.IXIT_HANDOFF,
    outcome: 'QUEUE_RETURN',
    code: 'IXIT_HANDOFF_FAILED',
    message:
      'The fictional row was returned to the local queue because the mock IXIT handoff failed.',
  }),
});

export const BATCH_MACHINE_DEFINITION = Object.freeze({
  schemaVersion: BATCH_MACHINE_SCHEMA_VERSION,
  playbackMode: 'COMPRESSED',
  maximumRows: MAXIMUM_BATCH_ROWS,
  steps: BATCH_STEP_DEFINITIONS,
  transitionTable: BATCH_TRANSITION_TABLE,
  disclosures: Object.freeze([
    'Batch processing is simulated with browser-local fixtures.',
    'Mock IXIT handoff records are not transmitted.',
  ]),
});

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

function readClockTimestamp(clock) {
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
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
      'Batch machine clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_TIMESTAMP,
      'Batch machine clock returned an invalid timestamp.',
    );
  }

  return date.toISOString();
}

function normalizeTimestamp(value, clock, name, minimum = null) {
  const timestamp =
    value === undefined || value === null
      ? readClockTimestamp(clock)
      : new Date(value).toISOString();

  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_TIMESTAMP,
      `${name} must be a valid date or timestamp.`,
    );
  }

  if (
    minimum !== null &&
    Date.parse(timestamp) < Date.parse(minimum)
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_TIMESTAMP,
      `${name} cannot be earlier than the previous batch transition.`,
      {
        minimum,
        actual: timestamp,
      },
    );
  }

  return timestamp;
}

function requireStep(value) {
  if (typeof value !== 'string' || !BATCH_STEP_SET.has(value)) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_STEP,
      'Batch step is not supported.',
      {
        step: value,
        acceptedSteps: BATCH_STEP_VALUES,
      },
    );
  }

  return value;
}

function requireScenario(value) {
  const scenario = value ?? BATCH_ROW_SCENARIOS.SUCCESS;

  if (
    typeof scenario !== 'string' ||
    !BATCH_ROW_SCENARIO_SET.has(scenario)
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_SCENARIO,
      'Batch row scenario is not supported.',
      {
        scenario,
        acceptedScenarios: [...BATCH_ROW_SCENARIO_SET],
      },
    );
  }

  return scenario;
}

function requireIdentifier(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > MAXIMUM_IDENTIFIER_LENGTH
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_ROW,
      `${name} must be a non-empty string of at most ${MAXIMUM_IDENTIFIER_LENGTH} characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function resolveInputRows(options) {
  const source =
    options.rows ??
    (Array.isArray(options.rowIds)
      ? options.rowIds.map((rowId) => ({ rowId }))
      : null);

  if (
    !Array.isArray(source) ||
    source.length === 0 ||
    source.length > MAXIMUM_BATCH_ROWS
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_ROW,
      `Batch rows must contain between 1 and ${MAXIMUM_BATCH_ROWS} entries.`,
    );
  }

  const scenarioByRow = options.scenarioByRow ?? {};

  if (
    !isPlainObject(scenarioByRow) ||
    !isJsonCompatible(scenarioByRow)
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_SCENARIO,
      'Batch scenario mapping must be a safe object.',
    );
  }

  const rows = source.map((input, index) => {
    const value =
      typeof input === 'string' ? { rowId: input } : input;

    if (!isPlainObject(value) || !isJsonCompatible(value)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_ROW,
        `Batch row ${index + 1} must be a safe object.`,
      );
    }

    const rowId = requireIdentifier(
      value.rowId,
      `Batch row ${index + 1} ID`,
    );
    const scenario = requireScenario(
      scenarioByRow[rowId] ?? value.scenario,
    );
    const attempt =
      value.attempt === undefined ? 1 : value.attempt;

    if (
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      attempt > 3
    ) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_ROW,
        'Batch row attempt must be an integer between 1 and 3.',
        { rowId, attempt },
      );
    }

    return {
      rowId,
      claimNumber:
        typeof value.claimNumber === 'string'
          ? value.claimNumber.normalize('NFC').trim()
          : null,
      memberId:
        typeof value.memberId === 'string'
          ? value.memberId.normalize('NFC').trim()
          : null,
      scenario,
      status: BATCH_ROW_STATUSES.QUEUED,
      currentStep: BATCH_STEPS.INTAKE,
      completedSteps: [],
      stepResults: [],
      attempt,
      reasonCode: null,
      reportId: null,
      message: null,
    };
  });
  const rowIds = rows.map((row) => row.rowId);

  if (new Set(rowIds).size !== rowIds.length) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_ROW,
      'Batch row identifiers must be unique.',
    );
  }

  const unknownScenarioRows = Object.keys(scenarioByRow).filter(
    (rowId) => !rowIds.includes(rowId),
  );

  if (unknownScenarioRows.length > 0) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_SCENARIO,
      'Batch scenario mapping references an unknown row.',
      { rowIds: unknownScenarioRows },
    );
  }

  return rows;
}

function requireMachineState(value) {
  if (
    !isPlainObject(value) ||
    !isJsonCompatible(value) ||
    value.schemaVersion !== BATCH_MACHINE_SCHEMA_VERSION ||
    !BATCH_MACHINE_STATUS_SET.has(value.status) ||
    !BATCH_STEP_SET.has(value.currentStep) ||
    !Array.isArray(value.completedSteps) ||
    value.completedSteps.some((step) => !BATCH_STEP_SET.has(step)) ||
    new Set(value.completedSteps).size !== value.completedSteps.length ||
    !Array.isArray(value.stepResults) ||
    !Array.isArray(value.rows) ||
    value.rows.length === 0 ||
    !isPlainObject(value.checkpoint)
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_STATE,
      'Batch machine state does not satisfy its schema.',
    );
  }

  const rowIds = new Set();

  value.rows.forEach((row) => {
    if (
      !isPlainObject(row) ||
      typeof row.rowId !== 'string' ||
      rowIds.has(row.rowId) ||
      !BATCH_ROW_STATUS_SET.has(row.status) ||
      !BATCH_STEP_SET.has(row.currentStep) ||
      !BATCH_ROW_SCENARIO_SET.has(row.scenario) ||
      !Array.isArray(row.completedSteps) ||
      !Array.isArray(row.stepResults)
    ) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_STATE,
        'Batch machine row state does not satisfy its schema.',
      );
    }

    rowIds.add(row.rowId);
  });

  return value;
}

function requireMutableStatus(state, acceptedStatuses) {
  if (TERMINAL_BATCH_STATUSES.has(state.status)) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.TERMINAL_STATE,
      'A terminal batch cannot transition again.',
      { status: state.status },
    );
  }

  if (!acceptedStatuses.includes(state.status)) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_TRANSITION,
      'Batch state cannot perform the requested transition.',
      {
        status: state.status,
        acceptedStatuses,
      },
    );
  }
}

function getNextStepValue(step) {
  const index = BATCH_STEP_VALUES.indexOf(step);

  return index < 0 || index === BATCH_STEP_VALUES.length - 1
    ? null
    : BATCH_STEP_VALUES[index + 1];
}

function appendUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

function replaceStepResult(results, result) {
  return [
    ...results.filter(
      (candidate) => candidate.step !== result.step,
    ),
    result,
  ].sort(
    (left, right) =>
      BATCH_STEP_VALUES.indexOf(left.step) -
      BATCH_STEP_VALUES.indexOf(right.step),
  );
}

function createCheckpoint(step, nextStep, resumable) {
  return {
    step,
    nextStep,
    resumable,
  };
}

function createStepResult({
  step,
  status,
  startedAt,
  endedAt,
  code,
  message,
}) {
  return {
    step,
    status,
    startedAt,
    endedAt,
    code,
    message,
  };
}

function createRowStepResult({
  row,
  step,
  status,
  startedAt,
  endedAt,
  code,
  message,
  outcome,
}) {
  return {
    rowId: row.rowId,
    step,
    status,
    outcome,
    startedAt,
    endedAt,
    code,
    message,
    simulated: true,
  };
}

function getScriptedOutcome(scenario, step) {
  const script = BATCH_SCRIPTED_OUTCOMES[scenario];

  if (script?.step === step) {
    return script;
  }

  const definition = BATCH_STEP_DEFINITIONS_BY_STEP[step];

  return {
    step,
    outcome: 'PASSED',
    code: `${step}_PASSED`,
    message: `${definition.label} completed for demonstration.`,
  };
}

function createReportId(batchId, rowId) {
  return `IXIT-${batchId}-${rowId}`.slice(
    0,
    MAXIMUM_IDENTIFIER_LENGTH,
  );
}

function transitionRow(
  row,
  step,
  nextStep,
  startedAt,
  endedAt,
  batchId,
) {
  if (row.status !== BATCH_ROW_STATUSES.PROCESSING) {
    return row;
  }

  const script = getScriptedOutcome(row.scenario, step);

  if (script.outcome === 'FAILED') {
    const result = createRowStepResult({
      row,
      step,
      status: PIPELINE_STEP_STATUSES.FAILED,
      startedAt,
      endedAt,
      code: script.code,
      message: script.message,
      outcome: script.outcome,
    });

    return {
      ...row,
      status: BATCH_ROW_STATUSES.FAILED,
      currentStep: step,
      stepResults: replaceStepResult(row.stepResults, result),
      reasonCode: script.code,
      message: script.message,
    };
  }

  if (script.outcome === 'QUEUE_RETURN') {
    const result = createRowStepResult({
      row,
      step,
      status: PIPELINE_STEP_STATUSES.FAILED,
      startedAt,
      endedAt,
      code: script.code,
      message: script.message,
      outcome: script.outcome,
    });

    return {
      ...row,
      status: BATCH_ROW_STATUSES.QUEUED,
      currentStep: step,
      stepResults: replaceStepResult(row.stepResults, result),
      reasonCode: script.code,
      message: script.message,
    };
  }

  const result = createRowStepResult({
    row,
    step,
    status: PIPELINE_STEP_STATUSES.PASSED,
    startedAt,
    endedAt,
    code: script.code,
    message: script.message,
    outcome: script.outcome,
  });
  const completedSteps = appendUnique(row.completedSteps, step);
  const reportId =
    step === BATCH_STEPS.IXIT_HANDOFF
      ? row.reportId ?? createReportId(batchId, row.rowId)
      : row.reportId;

  if (nextStep === null) {
    return {
      ...row,
      status: BATCH_ROW_STATUSES.COMPLETE,
      currentStep: step,
      completedSteps,
      stepResults: replaceStepResult(row.stepResults, result),
      reasonCode: null,
      reportId,
      message: 'Batch row completed for demonstration.',
    };
  }

  return {
    ...row,
    status: BATCH_ROW_STATUSES.PROCESSING,
    currentStep: nextStep,
    completedSteps,
    stepResults: replaceStepResult(row.stepResults, result),
    reasonCode: null,
    reportId,
    message: script.message,
  };
}

function resolveTerminalStatus(rows) {
  return rows.every(
    (row) => row.status === BATCH_ROW_STATUSES.COMPLETE,
  )
    ? BATCH_MACHINE_STATUSES.COMPLETE
    : BATCH_MACHINE_STATUSES.COMPLETED_WITH_ERRORS;
}

function summarizeRows(rows) {
  return {
    total: rows.length,
    complete: rows.filter(
      (row) => row.status === BATCH_ROW_STATUSES.COMPLETE,
    ).length,
    failed: rows.filter(
      (row) => row.status === BATCH_ROW_STATUSES.FAILED,
    ).length,
    queued: rows.filter(
      (row) => row.status === BATCH_ROW_STATUSES.QUEUED,
    ).length,
    processing: rows.filter(
      (row) => row.status === BATCH_ROW_STATUSES.PROCESSING,
    ).length,
  };
}

function createBaseState(options) {
  const currentStep =
    options.currentStep === undefined
      ? BATCH_STEPS.INTAKE
      : requireStep(options.currentStep);
  const rows = resolveInputRows(options);

  return {
    schemaVersion: BATCH_MACHINE_SCHEMA_VERSION,
    batchId:
      typeof options.batchId === 'string' &&
      options.batchId.trim().length > 0
        ? options.batchId.normalize('NFC').trim()
        : null,
    status: BATCH_MACHINE_STATUSES.READY,
    currentStep,
    completedSteps: [],
    stepResults: [],
    rows,
    checkpoint: createCheckpoint(
      currentStep,
      currentStep,
      true,
    ),
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    stepStartedAt: null,
    message: null,
    summary: summarizeRows(rows),
  };
}

/**
 * Error raised when a deterministic batch transition is invalid.
 */
export class BatchMachineError extends Error {
  /**
   * @param {string} code Stable batch-machine error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BatchMachineError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Returns the immutable ten-step batch definition.
 *
 * @returns {Readonly<Record<string, unknown>>} Batch definition.
 */
export function getBatchMachineDefinition() {
  return BATCH_MACHINE_DEFINITION;
}

/**
 * Returns one immutable batch-step definition.
 *
 * @param {string} step Batch step.
 * @returns {Readonly<Record<string, unknown>>} Step definition.
 */
export function getBatchStepDefinition(step) {
  return BATCH_STEP_DEFINITIONS_BY_STEP[requireStep(step)];
}

/**
 * Returns the next ordered batch step.
 *
 * @param {string} step Batch step.
 * @returns {string|null} Next step or null.
 */
export function getNextBatchStep(step) {
  return getNextStepValue(requireStep(step));
}

/**
 * Determines whether two batch steps are adjacent.
 *
 * @param {string} fromStep Current step.
 * @param {string} toStep Candidate next step.
 * @returns {boolean} Whether the transition is allowed.
 */
export function canTransitionBatchStep(fromStep, toStep) {
  if (
    !BATCH_STEP_SET.has(fromStep) ||
    !BATCH_STEP_SET.has(toStep)
  ) {
    return false;
  }

  return getNextStepValue(fromStep) === toStep;
}

/**
 * Returns the deterministic row outcome for a scenario and step.
 *
 * @param {string} scenario Batch row scenario.
 * @param {string} step Batch step.
 * @returns {Readonly<Record<string, unknown>>} Scripted outcome.
 */
export function getScriptedBatchRowOutcome(scenario, step) {
  return deepFreeze(
    getScriptedOutcome(
      requireScenario(scenario),
      requireStep(step),
    ),
  );
}

/**
 * Returns the configured compressed playback delay for a batch step.
 *
 * @param {string} step Batch step.
 * @param {number} [speedMultiplier] Non-negative delay multiplier.
 * @returns {number} Delay in milliseconds.
 */
export function getCompressedBatchDelay(
  step,
  speedMultiplier = 1,
) {
  const definition = getBatchStepDefinition(step);

  if (
    typeof speedMultiplier !== 'number' ||
    !Number.isFinite(speedMultiplier) ||
    speedMultiplier < 0
  ) {
    throw new BatchMachineError(
      BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
      'Batch delay multiplier must be a non-negative finite number.',
    );
  }

  return Math.round(
    definition.compressedDelayMs * speedMultiplier,
  );
}

/**
 * Determines whether a batch snapshot may be resumed.
 *
 * @param {unknown} state Batch machine state.
 * @returns {boolean} Whether resume is allowed.
 */
export function canResumeBatch(state) {
  try {
    const current = requireMachineState(state);

    return (
      current.status === BATCH_MACHINE_STATUSES.PAUSED &&
      current.checkpoint.resumable === true &&
      BATCH_STEP_SET.has(
        current.checkpoint.nextStep ??
          current.checkpoint.step,
      )
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic ten-step claims-outbound batch state machine.
 */
export class BatchMachine {
  /**
   * @param {{clock?: object|Function, delayMultiplier?: number}} [options]
   * Machine options.
   */
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch machine options must be a plain object.',
      );
    }

    this.clock = options.clock ?? browserClock;
    this.delayMultiplier =
      options.delayMultiplier === undefined
        ? 1
        : options.delayMultiplier;

    if (
      typeof this.delayMultiplier !== 'number' ||
      !Number.isFinite(this.delayMultiplier) ||
      this.delayMultiplier < 0
    ) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch delay multiplier must be a non-negative finite number.',
      );
    }
  }

  getDefinition() {
    return BATCH_MACHINE_DEFINITION;
  }

  getStepDefinition(step) {
    return getBatchStepDefinition(step);
  }

  getDelay(step) {
    return getCompressedBatchDelay(
      step,
      this.delayMultiplier,
    );
  }

  getScriptedOutcome(scenario, step) {
    return getScriptedBatchRowOutcome(scenario, step);
  }

  /**
   * Creates a ready immutable batch snapshot.
   *
   * @param {Record<string, unknown>} options Initial state options.
   * @returns {Readonly<Record<string, unknown>>} Ready snapshot.
   */
  createState(options = {}) {
    if (!isPlainObject(options)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch initial state options must be a plain object.',
      );
    }

    return deepFreeze(createBaseState(options));
  }

  /**
   * Starts a ready or paused batch.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @param {Date|string|number} [at] Transition time.
   * @returns {Readonly<Record<string, unknown>>} Running snapshot.
   */
  start(state, at = undefined) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      BATCH_MACHINE_STATUSES.READY,
      BATCH_MACHINE_STATUSES.PAUSED,
    ]);

    const timestamp = normalizeTimestamp(
      at,
      this.clock,
      'Batch start time',
      current.updatedAt,
    );
    const rows = current.rows.map((row) =>
      row.status === BATCH_ROW_STATUSES.QUEUED &&
      row.completedSteps.length === 0
        ? {
            ...row,
            status: BATCH_ROW_STATUSES.PROCESSING,
            currentStep: current.currentStep,
            message: 'Batch row processing started.',
          }
        : row,
    );

    return deepFreeze({
      ...current,
      status: BATCH_MACHINE_STATUSES.RUNNING,
      rows,
      checkpoint: createCheckpoint(
        current.currentStep,
        current.currentStep,
        true,
      ),
      startedAt: current.startedAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: timestamp,
      message: 'Batch processing started for demonstration.',
      summary: summarizeRows(rows),
    });
  }

  /**
   * Applies the current step to every active row and advances in order.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @param {{at?: Date|string|number}} [options] Transition options.
   * @returns {Readonly<Record<string, unknown>>} Next snapshot.
   */
  advance(state, options = {}) {
    if (!isPlainObject(options)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch advance options must be a plain object.',
      );
    }

    let current = requireMachineState(state);

    if (current.status === BATCH_MACHINE_STATUSES.READY) {
      current = this.start(current, options.at);
    }

    requireMutableStatus(current, [
      BATCH_MACHINE_STATUSES.RUNNING,
    ]);

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Batch transition time',
      current.updatedAt,
    );
    const step = current.currentStep;
    const nextStep = getNextStepValue(step);
    const definition = BATCH_STEP_DEFINITIONS_BY_STEP[step];
    const startedAt =
      current.stepStartedAt ??
      current.updatedAt ??
      current.startedAt ??
      timestamp;
    const rows = current.rows.map((row) =>
      transitionRow(
        row,
        step,
        nextStep,
        startedAt,
        timestamp,
        current.batchId ?? 'BATCH',
      ),
    );
    const activeRowsAtStart = current.rows.filter(
      (row) => row.status === BATCH_ROW_STATUSES.PROCESSING,
    );
    const failedAtStep = rows.filter(
      (row) =>
        activeRowsAtStart.some(
          (candidate) => candidate.rowId === row.rowId,
        ) &&
        row.stepResults.some(
          (result) =>
            result.step === step &&
            result.status === PIPELINE_STEP_STATUSES.FAILED,
        ),
    );
    const stepStatus =
      failedAtStep.length === activeRowsAtStart.length &&
      activeRowsAtStart.length > 0
        ? PIPELINE_STEP_STATUSES.FAILED
        : PIPELINE_STEP_STATUSES.PASSED;
    const stepResult = createStepResult({
      step,
      status: stepStatus,
      startedAt,
      endedAt: timestamp,
      code:
        failedAtStep.length === 0
          ? `${step}_PASSED`
          : `${step}_COMPLETED_WITH_ERRORS`,
      message:
        failedAtStep.length === 0
          ? `${definition.label} completed for demonstration.`
          : `${definition.label} completed with ${failedAtStep.length} row exception(s).`,
    });
    const completedSteps = appendUnique(
      current.completedSteps,
      step,
    );
    const stepResults = replaceStepResult(
      current.stepResults,
      stepResult,
    );

    if (nextStep === null) {
      const status = resolveTerminalStatus(rows);

      return deepFreeze({
        ...current,
        status,
        rows,
        completedSteps,
        stepResults,
        checkpoint: createCheckpoint(step, null, false),
        updatedAt: timestamp,
        completedAt: timestamp,
        stepStartedAt: null,
        message:
          status === BATCH_MACHINE_STATUSES.COMPLETE
            ? 'Batch completed for demonstration.'
            : 'Batch completed with rows returned or failed.',
        summary: summarizeRows(rows),
      });
    }

    if (!canTransitionBatchStep(step, nextStep)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_TRANSITION,
        'Batch step transition is not permitted.',
        {
          fromStep: step,
          toStep: nextStep,
        },
      );
    }

    return deepFreeze({
      ...current,
      status: BATCH_MACHINE_STATUSES.RUNNING,
      currentStep: nextStep,
      rows,
      completedSteps,
      stepResults,
      checkpoint: createCheckpoint(
        nextStep,
        nextStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: timestamp,
      message: `${definition.label} completed for demonstration.`,
      summary: summarizeRows(rows),
    });
  }

  /**
   * Fails one active row at the current step.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @param {string} rowId Row identifier.
   * @param {{code?: string, message?: string, at?: Date|string|number}} [options]
   * Failure options.
   * @returns {Readonly<Record<string, unknown>>} Updated snapshot.
   */
  failRow(state, rowId, options = {}) {
    return this.updateRowOutcome(
      state,
      rowId,
      BATCH_ROW_STATUSES.FAILED,
      options,
    );
  }

  /**
   * Returns one active row to the local queue.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @param {string} rowId Row identifier.
   * @param {{code?: string, message?: string, at?: Date|string|number}} [options]
   * Queue-return options.
   * @returns {Readonly<Record<string, unknown>>} Updated snapshot.
   */
  returnRowToQueue(state, rowId, options = {}) {
    return this.updateRowOutcome(
      state,
      rowId,
      BATCH_ROW_STATUSES.QUEUED,
      options,
    );
  }

  updateRowOutcome(state, rowId, status, options) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      BATCH_MACHINE_STATUSES.RUNNING,
    ]);

    if (!isPlainObject(options)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch row outcome options must be a plain object.',
      );
    }

    const identifier = requireIdentifier(rowId, 'Batch row ID');
    const row = current.rows.find(
      (candidate) => candidate.rowId === identifier,
    );

    if (row === undefined) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.ROW_NOT_FOUND,
        'Batch row was not found.',
        { rowId: identifier },
      );
    }

    if (row.status !== BATCH_ROW_STATUSES.PROCESSING) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_TRANSITION,
        'Only a processing batch row may fail or return to the queue.',
        {
          rowId: identifier,
          status: row.status,
        },
      );
    }

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Batch row outcome time',
      current.updatedAt,
    );
    const code =
      typeof options.code === 'string' &&
      options.code.trim().length > 0
        ? options.code.normalize('NFC').trim()
        : status === BATCH_ROW_STATUSES.QUEUED
          ? 'ROW_RETURNED_TO_QUEUE'
          : 'BATCH_ROW_FAILED';
    const message =
      typeof options.message === 'string' &&
      options.message.trim().length > 0
        ? options.message.normalize('NFC').trim()
        : status === BATCH_ROW_STATUSES.QUEUED
          ? 'The fictional row was returned to the local queue.'
          : 'The fictional batch row failed.';
    const result = createRowStepResult({
      row,
      step: current.currentStep,
      status: PIPELINE_STEP_STATUSES.FAILED,
      startedAt:
        current.stepStartedAt ??
        current.updatedAt ??
        timestamp,
      endedAt: timestamp,
      code,
      message,
      outcome:
        status === BATCH_ROW_STATUSES.QUEUED
          ? 'QUEUE_RETURN'
          : 'FAILED',
    });
    const rows = current.rows.map((candidate) =>
      candidate.rowId === identifier
        ? {
            ...candidate,
            status,
            reasonCode: code,
            message,
            stepResults: replaceStepResult(
              candidate.stepResults,
              result,
            ),
          }
        : candidate,
    );

    return deepFreeze({
      ...current,
      rows,
      updatedAt: timestamp,
      message,
      summary: summarizeRows(rows),
    });
  }

  /**
   * Pauses or cancels an active batch.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @param {{mode?: string, at?: Date|string|number, message?: string}} [options]
   * Stop options.
   * @returns {Readonly<Record<string, unknown>>} Stopped snapshot.
   */
  stop(state, options = {}) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      BATCH_MACHINE_STATUSES.READY,
      BATCH_MACHINE_STATUSES.RUNNING,
      BATCH_MACHINE_STATUSES.PAUSED,
    ]);

    if (!isPlainObject(options)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch stop options must be a plain object.',
      );
    }

    const mode = options.mode ?? BATCH_STOP_MODES.PAUSE;

    if (!Object.values(BATCH_STOP_MODES).includes(mode)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch stop mode must be PAUSE or CANCEL.',
      );
    }

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Batch stop time',
      current.updatedAt,
    );

    if (mode === BATCH_STOP_MODES.CANCEL) {
      const rows = current.rows.map((row) =>
        row.status === BATCH_ROW_STATUSES.PROCESSING
          ? {
              ...row,
              status: BATCH_ROW_STATUSES.QUEUED,
              reasonCode: 'BATCH_CANCELLED',
              message:
                'The row was returned to the local queue when batch playback was cancelled.',
            }
          : row,
      );

      return deepFreeze({
        ...current,
        status: BATCH_MACHINE_STATUSES.CANCELLED,
        rows,
        checkpoint: createCheckpoint(
          current.currentStep,
          null,
          false,
        ),
        updatedAt: timestamp,
        completedAt: timestamp,
        stepStartedAt: null,
        message:
          typeof options.message === 'string'
            ? options.message
            : 'Batch playback cancelled for demonstration.',
        summary: summarizeRows(rows),
      });
    }

    return deepFreeze({
      ...current,
      status: BATCH_MACHINE_STATUSES.PAUSED,
      checkpoint: createCheckpoint(
        current.currentStep,
        current.currentStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: null,
      message:
        typeof options.message === 'string'
          ? options.message
          : 'Batch playback paused at a resumable checkpoint.',
    });
  }

  /**
   * Resumes a paused batch checkpoint.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @param {{expectedCheckpoint?: string, at?: Date|string|number}} [options]
   * Resume options.
   * @returns {Readonly<Record<string, unknown>>} Running snapshot.
   */
  resume(state, options = {}) {
    const current = requireMachineState(state);

    if (!isPlainObject(options)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Batch resume options must be a plain object.',
      );
    }

    if (!canResumeBatch(current)) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.RESUME_NOT_ALLOWED,
        'Batch checkpoint is not resumable.',
        {
          status: current.status,
          checkpoint: current.checkpoint,
        },
      );
    }

    if (
      options.expectedCheckpoint !== undefined &&
      options.expectedCheckpoint !== current.checkpoint.step
    ) {
      throw new BatchMachineError(
        BATCH_MACHINE_ERROR_CODES.CHECKPOINT_MISMATCH,
        'Batch checkpoint does not match the expected checkpoint.',
        {
          expectedCheckpoint: options.expectedCheckpoint,
          actualCheckpoint: current.checkpoint.step,
        },
      );
    }

    const resumeStep = requireStep(
      current.checkpoint.nextStep ??
        current.checkpoint.step,
    );
    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Batch resume time',
      current.updatedAt,
    );
    const rows = current.rows.map((row) =>
      row.status === BATCH_ROW_STATUSES.PROCESSING
        ? {
            ...row,
            currentStep: resumeStep,
            message:
              'Batch row resumed from its persisted checkpoint.',
          }
        : row,
    );

    return deepFreeze({
      ...current,
      status: BATCH_MACHINE_STATUSES.RUNNING,
      currentStep: resumeStep,
      rows,
      checkpoint: createCheckpoint(
        resumeStep,
        resumeStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: timestamp,
      message: 'Batch resumed from its persisted checkpoint.',
      summary: summarizeRows(rows),
    });
  }

  /**
   * Runs every remaining deterministic step synchronously.
   *
   * @param {Record<string, unknown>} state Batch state.
   * @returns {Readonly<Record<string, unknown>>} Terminal snapshot.
   */
  runToCompletion(state) {
    let current = requireMachineState(state);
    let transitions = 0;

    while (!TERMINAL_BATCH_STATUSES.has(current.status)) {
      current = this.advance(current);
      transitions += 1;

      if (transitions > BATCH_STEP_VALUES.length) {
        throw new BatchMachineError(
          BATCH_MACHINE_ERROR_CODES.TRANSITION_LIMIT_EXCEEDED,
          'Batch exceeded its deterministic transition limit.',
        );
      }
    }

    return current;
  }

  run(state) {
    return this.runToCompletion(state);
  }

  pause(state, options = {}) {
    return this.stop(state, {
      ...options,
      mode: BATCH_STOP_MODES.PAUSE,
    });
  }

  cancel(state, options = {}) {
    return this.stop(state, {
      ...options,
      mode: BATCH_STOP_MODES.CANCEL,
    });
  }
}

/**
 * Creates a deterministic batch state machine.
 *
 * @param {ConstructorParameters<typeof BatchMachine>[0]} [options]
 * Machine options.
 * @returns {BatchMachine} Batch machine.
 */
export function createBatchMachine(options = {}) {
  return new BatchMachine(options);
}

export const BATCH_DEFINITION = BATCH_MACHINE_DEFINITION;
export const BATCH_TRANSITIONS = BATCH_TRANSITION_TABLE;
export const BATCH_STATES = BATCH_STEPS;
export const SCRIPTED_BATCH_OUTCOMES = BATCH_SCRIPTED_OUTCOMES;
export const ClaimsOutboundBatchMachine = BatchMachine;
export const DeterministicBatchMachine = BatchMachine;
export const createClaimsOutboundBatchMachine =
  createBatchMachine;
export const createDeterministicBatchMachine =
  createBatchMachine;

export default BatchMachine;