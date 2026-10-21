import { browserClock } from '../../../platform/time/clock.js';
import { isPlainObject } from '../../../platform/validation/schemas.js';
import {
  AGENTS,
  PIPELINE_STEP_STATUSES,
  PIPELINE_STEPS,
  PIPELINE_STEP_VALUES,
  PROCESSING_SCENARIOS,
} from '../domain/domainConstants.js';

export const PIPELINE_MACHINE_SCHEMA_VERSION = 1;

export const PIPELINE_MACHINE_STATUSES = Object.freeze({
  READY: 'READY',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const PIPELINE_MACHINE_EVENTS = Object.freeze({
  START: 'START',
  PASS: 'PASS',
  FAIL: 'FAIL',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  CANCEL: 'CANCEL',
});

export const PIPELINE_STOP_MODES = Object.freeze({
  PAUSE: 'PAUSE',
  CANCEL: 'CANCEL',
});

export const PIPELINE_MACHINE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_STEP: 'INVALID_STEP',
  INVALID_SCENARIO: 'INVALID_SCENARIO',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CHECKPOINT_MISMATCH: 'CHECKPOINT_MISMATCH',
  RESUME_NOT_ALLOWED: 'RESUME_NOT_ALLOWED',
  REVIEW_DECISION_REQUIRED: 'REVIEW_DECISION_REQUIRED',
  TERMINAL_STATE: 'TERMINAL_STATE',
});

const STEP_SET = new Set(PIPELINE_STEP_VALUES);
const SCENARIO_SET = new Set(Object.values(PROCESSING_SCENARIOS));
const MACHINE_STATUS_SET = new Set(
  Object.values(PIPELINE_MACHINE_STATUSES),
);

const STEP_DEFINITIONS = Object.freeze([
  Object.freeze({
    step: PIPELINE_STEPS.REQUEST,
    label: 'Request',
    agent: AGENTS.INTAKE,
    printedMinutes: '0',
    compressedDelayMs: 0,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.VALIDATION,
    label: 'Validation',
    agent: AGENTS.VALIDATION,
    printedMinutes: '7',
    compressedDelayMs: 400,
    subchecks: Object.freeze([
      Object.freeze({
        ruleId: 'REQUEST_FIELDS_VALID',
        label: 'Request fields',
        printedMinutes: '2',
      }),
      Object.freeze({
        ruleId: 'MEMBER_CLAIM_MATCH',
        label: 'Member and claim match',
        printedMinutes: '3',
      }),
      Object.freeze({
        ruleId: 'CLAIM_ELIGIBLE',
        label: 'Claim eligibility',
        printedMinutes: '2',
      }),
    ]),
  }),
  Object.freeze({
    step: PIPELINE_STEPS.DATA_RETRIEVAL,
    label: 'Data retrieval',
    agent: AGENTS.DATA_RETRIEVAL,
    printedMinutes: '1',
    compressedDelayMs: 400,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.BUSINESS_RULES,
    label: 'Business rules',
    agent: AGENTS.BUSINESS_RULES,
    printedMinutes: '0.5',
    compressedDelayMs: 400,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.DOCUMENT_GENERATION,
    label: 'Document generation',
    agent: AGENTS.DOCUMENT_GENERATION,
    printedMinutes: '5',
    compressedDelayMs: 400,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.QUALITY_CHECK,
    label: 'Quality check',
    agent: AGENTS.QUALITY_ASSURANCE,
    printedMinutes: '2',
    compressedDelayMs: 400,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.PDF_CREATION,
    label: 'PDF creation',
    agent: AGENTS.PDF_CREATION,
    printedMinutes: '0',
    compressedDelayMs: 400,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.STORAGE,
    label: 'Storage',
    agent: AGENTS.STORAGE,
    printedMinutes: '0',
    compressedDelayMs: 400,
  }),
  Object.freeze({
    step: PIPELINE_STEPS.STORED,
    label: 'Stored',
    agent: AGENTS.OUTBOUND,
    printedMinutes: '0',
    compressedDelayMs: 0,
  }),
]);

const STEP_DEFINITIONS_BY_STEP = Object.freeze(
  Object.fromEntries(
    STEP_DEFINITIONS.map((definition) => [
      definition.step,
      definition,
    ]),
  ),
);

export const PIPELINE_TRANSITION_TABLE = Object.freeze({
  schemaVersion: PIPELINE_MACHINE_SCHEMA_VERSION,
  [PIPELINE_STEPS.REQUEST]: Object.freeze({
    passed: PIPELINE_STEPS.VALIDATION,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.VALIDATION]: Object.freeze({
    passed: PIPELINE_STEPS.DATA_RETRIEVAL,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.DATA_RETRIEVAL]: Object.freeze({
    passed: PIPELINE_STEPS.BUSINESS_RULES,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.BUSINESS_RULES]: Object.freeze({
    passed: PIPELINE_STEPS.DOCUMENT_GENERATION,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    manualReview: PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.DOCUMENT_GENERATION]: Object.freeze({
    passed: PIPELINE_STEPS.QUALITY_CHECK,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.QUALITY_CHECK]: Object.freeze({
    passed: PIPELINE_STEPS.PDF_CREATION,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.PDF_CREATION]: Object.freeze({
    passed: PIPELINE_STEPS.STORAGE,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.STORAGE]: Object.freeze({
    passed: PIPELINE_STEPS.STORED,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
  [PIPELINE_STEPS.STORED]: Object.freeze({
    passed: PIPELINE_MACHINE_STATUSES.COMPLETE,
    failed: PIPELINE_MACHINE_STATUSES.FAILED,
    cancelled: PIPELINE_MACHINE_STATUSES.CANCELLED,
  }),
});

export const PIPELINE_PRINTED_DURATIONS = Object.freeze(
  Object.fromEntries(
    STEP_DEFINITIONS.map((definition) => [
      definition.step,
      definition.printedMinutes,
    ]),
  ),
);

export const PIPELINE_COMPRESSED_DELAYS_MS = Object.freeze(
  Object.fromEntries(
    STEP_DEFINITIONS.map((definition) => [
      definition.step,
      definition.compressedDelayMs,
    ]),
  ),
);

export const PIPELINE_SCRIPTED_FAILURES = Object.freeze({
  [PROCESSING_SCENARIOS.SUCCESS]: null,
  [PROCESSING_SCENARIOS.INVALID_REQUEST]: Object.freeze({
    step: PIPELINE_STEPS.VALIDATION,
    outcome: 'FAILED',
    code: 'REQUEST_VALIDATION_FAILED',
    message:
      'The deterministic invalid-request scenario stopped before data retrieval.',
  }),
  [PROCESSING_SCENARIOS.RULE_FAILURE]: Object.freeze({
    step: PIPELINE_STEPS.BUSINESS_RULES,
    outcome: 'MANUAL_REVIEW',
    code: 'MANUAL_REVIEW_REQUIRED',
    message:
      'Member responsibility exceeds the fictional demo review threshold.',
    resumeStep: PIPELINE_STEPS.DOCUMENT_GENERATION,
  }),
  [PROCESSING_SCENARIOS.QUALITY_FAILURE]: Object.freeze({
    step: PIPELINE_STEPS.QUALITY_CHECK,
    outcome: 'FAILED',
    code: 'DOCUMENT_QUALITY_FAILED',
    message:
      'The deterministic quality-failure scenario stopped document creation.',
  }),
});

export const PIPELINE_MACHINE_DEFINITION = Object.freeze({
  schemaVersion: PIPELINE_MACHINE_SCHEMA_VERSION,
  slaMinutes: 22,
  targetMinutes: 15.5,
  playbackMode: 'COMPRESSED',
  steps: STEP_DEFINITIONS,
  transitionTable: PIPELINE_TRANSITION_TABLE,
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
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
      'Pipeline machine clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_TIMESTAMP,
      'Pipeline machine clock returned an invalid timestamp.',
    );
  }

  return date.toISOString();
}

function normalizeTimestamp(value, clock, name) {
  if (value === undefined || value === null) {
    return readClockTimestamp(clock);
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_TIMESTAMP,
      `${name} must be a valid date or timestamp.`,
    );
  }

  return date.toISOString();
}

function requireStep(value) {
  if (typeof value !== 'string' || !STEP_SET.has(value)) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_STEP,
      'Pipeline step is not supported.',
      {
        step: value,
        acceptedSteps: PIPELINE_STEP_VALUES,
      },
    );
  }

  return value;
}

function requireScenario(value) {
  const scenario = value ?? PROCESSING_SCENARIOS.SUCCESS;

  if (typeof scenario !== 'string' || !SCENARIO_SET.has(scenario)) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_SCENARIO,
      'Pipeline processing scenario is not supported.',
      {
        scenario,
        acceptedScenarios: [...SCENARIO_SET],
      },
    );
  }

  return scenario;
}

function requireMachineState(value) {
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== PIPELINE_MACHINE_SCHEMA_VERSION ||
    !MACHINE_STATUS_SET.has(value.status) ||
    !STEP_SET.has(value.currentStep) ||
    !SCENARIO_SET.has(value.scenario) ||
    !Array.isArray(value.completedSteps) ||
    value.completedSteps.some((step) => !STEP_SET.has(step)) ||
    new Set(value.completedSteps).size !==
      value.completedSteps.length ||
    !Array.isArray(value.stepResults) ||
    !Array.isArray(value.agentOutcomes) ||
    !isPlainObject(value.checkpoint)
  ) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_STATE,
      'Pipeline machine state does not satisfy its schema.',
    );
  }

  return value;
}

function requireMutableStatus(state, acceptedStatuses) {
  if (
    state.status === PIPELINE_MACHINE_STATUSES.COMPLETE ||
    state.status === PIPELINE_MACHINE_STATUSES.CANCELLED
  ) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.TERMINAL_STATE,
      'A terminal pipeline cannot transition again.',
      {
        status: state.status,
      },
    );
  }

  if (!acceptedStatuses.includes(state.status)) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_TRANSITION,
      'Pipeline state cannot perform the requested transition.',
      {
        status: state.status,
        acceptedStatuses,
      },
    );
  }
}

function getNextStepValue(step) {
  const index = PIPELINE_STEP_VALUES.indexOf(step);

  return index < 0 || index === PIPELINE_STEP_VALUES.length - 1
    ? null
    : PIPELINE_STEP_VALUES[index + 1];
}

function createCheckpoint(step, nextStep, resumable) {
  return {
    step,
    nextStep,
    resumable,
  };
}

function createPassedScript(step) {
  const definition = STEP_DEFINITIONS_BY_STEP[step];

  return deepFreeze({
    step,
    agent: definition.agent,
    outcome: 'PASSED',
    code: `${step}_PASSED`,
    message: `${definition.label} completed for demonstration.`,
    resumeStep: null,
    simulated: true,
  });
}

function createScriptedOutcome(scenario, step) {
  const scriptedFailure = PIPELINE_SCRIPTED_FAILURES[scenario];

  if (scriptedFailure?.step !== step) {
    return createPassedScript(step);
  }

  return deepFreeze({
    step,
    agent: STEP_DEFINITIONS_BY_STEP[step].agent,
    outcome: scriptedFailure.outcome,
    code: scriptedFailure.code,
    message: scriptedFailure.message,
    resumeStep: scriptedFailure.resumeStep ?? null,
    simulated: true,
  });
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
    printedMinutes:
      STEP_DEFINITIONS_BY_STEP[step].printedMinutes,
    startedAt,
    endedAt,
    code,
    message,
  };
}

function appendUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

function createAgentOutcome(script, outcome = script.outcome) {
  return {
    agent: script.agent,
    step: script.step,
    outcome,
    code: script.code,
    message: script.message,
    simulated: true,
  };
}

function replaceStepResult(results, result) {
  return [
    ...results.filter(
      (candidate) => candidate.step !== result.step,
    ),
    result,
  ].sort(
    (left, right) =>
      PIPELINE_STEP_VALUES.indexOf(left.step) -
      PIPELINE_STEP_VALUES.indexOf(right.step),
  );
}

function replaceAgentOutcome(outcomes, outcome) {
  return [
    ...outcomes.filter(
      (candidate) => candidate.step !== outcome.step,
    ),
    outcome,
  ].sort(
    (left, right) =>
      PIPELINE_STEP_VALUES.indexOf(left.step) -
      PIPELINE_STEP_VALUES.indexOf(right.step),
  );
}

function createBaseState(options) {
  const scenario = requireScenario(options.scenario);
  const initialStep =
    options.currentStep === undefined
      ? PIPELINE_STEPS.REQUEST
      : requireStep(options.currentStep);

  return {
    schemaVersion: PIPELINE_MACHINE_SCHEMA_VERSION,
    requestId:
      typeof options.requestId === 'string'
        ? options.requestId
        : null,
    runId:
      typeof options.runId === 'string' ? options.runId : null,
    scenario,
    status: PIPELINE_MACHINE_STATUSES.READY,
    currentStep: initialStep,
    completedSteps: [],
    stepResults: [],
    agentOutcomes: [],
    checkpoint: createCheckpoint(
      initialStep,
      initialStep,
      true,
    ),
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    stepStartedAt: null,
    errorCode: null,
    message: null,
  };
}

/**
 * Error raised when a deterministic pipeline transition is invalid.
 */
export class PipelineMachineError extends Error {
  /**
   * @param {string} code Stable state-machine error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PipelineMachineError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Returns the immutable nine-step pipeline definition.
 *
 * @returns {Readonly<Record<string, unknown>>} Pipeline definition.
 */
export function getPipelineMachineDefinition() {
  return PIPELINE_MACHINE_DEFINITION;
}

/**
 * Returns one immutable step definition.
 *
 * @param {string} step Pipeline step.
 * @returns {Readonly<Record<string, unknown>>} Step definition.
 */
export function getPipelineStepDefinition(step) {
  return STEP_DEFINITIONS_BY_STEP[requireStep(step)];
}

/**
 * Returns the next ordered pipeline step.
 *
 * @param {string} step Pipeline step.
 * @returns {string|null} Next step or null.
 */
export function getNextPipelineStep(step) {
  return getNextStepValue(requireStep(step));
}

/**
 * Determines whether two pipeline steps are adjacent.
 *
 * @param {string} fromStep Current step.
 * @param {string} toStep Candidate next step.
 * @returns {boolean} Whether the transition is allowed.
 */
export function canTransitionPipelineStep(fromStep, toStep) {
  if (!STEP_SET.has(fromStep) || !STEP_SET.has(toStep)) {
    return false;
  }

  return getNextStepValue(fromStep) === toStep;
}

/**
 * Returns the deterministic scripted agent outcome for a scenario and step.
 *
 * @param {string} scenario Processing scenario.
 * @param {string} step Pipeline step.
 * @returns {Readonly<Record<string, unknown>>} Scripted outcome.
 */
export function getScriptedAgentOutcome(scenario, step) {
  return createScriptedOutcome(
    requireScenario(scenario),
    requireStep(step),
  );
}

/**
 * Returns the configured compressed playback delay for a step.
 *
 * @param {string} step Pipeline step.
 * @param {number} [speedMultiplier] Optional positive delay multiplier.
 * @returns {number} Delay in milliseconds.
 */
export function getCompressedPipelineDelay(
  step,
  speedMultiplier = 1,
) {
  const definition = getPipelineStepDefinition(step);

  if (
    typeof speedMultiplier !== 'number' ||
    !Number.isFinite(speedMultiplier) ||
    speedMultiplier < 0
  ) {
    throw new PipelineMachineError(
      PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
      'Pipeline delay multiplier must be a non-negative finite number.',
    );
  }

  return Math.round(
    definition.compressedDelayMs * speedMultiplier,
  );
}

/**
 * Determines whether a pipeline snapshot may be resumed.
 *
 * @param {unknown} state Pipeline machine state.
 * @returns {boolean} Whether resume is allowed.
 */
export function canResumePipeline(state) {
  try {
    const current = requireMachineState(state);

    return (
      current.checkpoint.resumable === true &&
      [
        PIPELINE_MACHINE_STATUSES.PAUSED,
        PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW,
        PIPELINE_MACHINE_STATUSES.FAILED,
      ].includes(current.status)
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic nine-step reprint pipeline state machine.
 */
export class PipelineMachine {
  /**
   * @param {{clock?: object|Function, delayMultiplier?: number}} [options]
   * Machine options.
   */
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Pipeline machine options must be a plain object.',
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
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Pipeline delay multiplier must be a non-negative finite number.',
      );
    }
  }

  getDefinition() {
    return PIPELINE_MACHINE_DEFINITION;
  }

  getStepDefinition(step) {
    return getPipelineStepDefinition(step);
  }

  getDelay(step) {
    return getCompressedPipelineDelay(
      step,
      this.delayMultiplier,
    );
  }

  getScriptedOutcome(scenario, step) {
    return getScriptedAgentOutcome(scenario, step);
  }

  /**
   * Creates a ready immutable machine snapshot.
   *
   * @param {Record<string, unknown>} [options] Initial state options.
   * @returns {Readonly<Record<string, unknown>>} Ready snapshot.
   */
  createState(options = {}) {
    if (!isPlainObject(options)) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Pipeline initial state options must be a plain object.',
      );
    }

    return deepFreeze(createBaseState(options));
  }

  /**
   * Starts a ready or paused pipeline.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {Date|string|number} [at] Transition time.
   * @returns {Readonly<Record<string, unknown>>} Running snapshot.
   */
  start(state, at = undefined) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      PIPELINE_MACHINE_STATUSES.READY,
      PIPELINE_MACHINE_STATUSES.PAUSED,
    ]);

    const timestamp = normalizeTimestamp(
      at,
      this.clock,
      'Pipeline start time',
    );

    return deepFreeze({
      ...current,
      status: PIPELINE_MACHINE_STATUSES.RUNNING,
      startedAt: current.startedAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: timestamp,
      checkpoint: createCheckpoint(
        current.currentStep,
        current.currentStep,
        true,
      ),
      errorCode: null,
      message: null,
    });
  }

  /**
   * Applies the current step's scripted outcome.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {{at?: Date|string|number}} [options] Transition options.
   * @returns {Readonly<Record<string, unknown>>} Next snapshot.
   */
  advance(state, options = {}) {
    if (!isPlainObject(options)) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Pipeline advance options must be a plain object.',
      );
    }

    let current = requireMachineState(state);

    if (current.status === PIPELINE_MACHINE_STATUSES.READY) {
      current = this.start(current, options.at);
    }

    requireMutableStatus(current, [
      PIPELINE_MACHINE_STATUSES.RUNNING,
    ]);

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Pipeline transition time',
    );
    const script = createScriptedOutcome(
      current.scenario,
      current.currentStep,
    );

    if (script.outcome === 'MANUAL_REVIEW') {
      return this.requireReview(current, {
        at: timestamp,
        code: script.code,
        message: script.message,
        resumeStep: script.resumeStep,
      });
    }

    if (script.outcome === 'FAILED') {
      return this.fail(current, {
        at: timestamp,
        code: script.code,
        message: script.message,
      });
    }

    return this.pass(current, {
      at: timestamp,
      code: script.code,
      message: script.message,
    });
  }

  /**
   * Marks the current step passed and advances in order.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {Record<string, unknown>} [options] Result options.
   * @returns {Readonly<Record<string, unknown>>} Next snapshot.
   */
  pass(state, options = {}) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      PIPELINE_MACHINE_STATUSES.RUNNING,
    ]);

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Pipeline pass time',
    );
    const step = current.currentStep;
    const nextStep = getNextStepValue(step);
    const definition = STEP_DEFINITIONS_BY_STEP[step];
    const code =
      typeof options.code === 'string'
        ? options.code
        : `${step}_PASSED`;
    const message =
      typeof options.message === 'string'
        ? options.message
        : `${definition.label} completed for demonstration.`;
    const result = createStepResult({
      step,
      status: PIPELINE_STEP_STATUSES.PASSED,
      startedAt:
        current.stepStartedAt ??
        current.updatedAt ??
        current.startedAt ??
        timestamp,
      endedAt: timestamp,
      code,
      message,
    });
    const agentOutcome = createAgentOutcome({
      step,
      agent: definition.agent,
      outcome: 'PASSED',
      code,
      message,
    });

    if (nextStep === null) {
      return deepFreeze({
        ...current,
        status: PIPELINE_MACHINE_STATUSES.COMPLETE,
        completedSteps: appendUnique(
          current.completedSteps,
          step,
        ),
        stepResults: replaceStepResult(
          current.stepResults,
          result,
        ),
        agentOutcomes: replaceAgentOutcome(
          current.agentOutcomes,
          agentOutcome,
        ),
        checkpoint: createCheckpoint(step, null, false),
        updatedAt: timestamp,
        completedAt: timestamp,
        stepStartedAt: null,
        errorCode: null,
        message,
      });
    }

    if (!canTransitionPipelineStep(step, nextStep)) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_TRANSITION,
        'Pipeline step transition is not permitted.',
        {
          fromStep: step,
          toStep: nextStep,
        },
      );
    }

    return deepFreeze({
      ...current,
      status: PIPELINE_MACHINE_STATUSES.RUNNING,
      currentStep: nextStep,
      completedSteps: appendUnique(
        current.completedSteps,
        step,
      ),
      stepResults: replaceStepResult(
        current.stepResults,
        result,
      ),
      agentOutcomes: replaceAgentOutcome(
        current.agentOutcomes,
        agentOutcome,
      ),
      checkpoint: createCheckpoint(
        nextStep,
        nextStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: timestamp,
      errorCode: null,
      message,
    });
  }

  /**
   * Stops the current step with a deterministic failure.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {{code?: string, message?: string, at?: Date|string|number, resumable?: boolean, resumeStep?: string}} [options]
   * Failure options.
   * @returns {Readonly<Record<string, unknown>>} Failed snapshot.
   */
  fail(state, options = {}) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      PIPELINE_MACHINE_STATUSES.RUNNING,
    ]);

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Pipeline failure time',
    );
    const step = current.currentStep;
    const definition = STEP_DEFINITIONS_BY_STEP[step];
    const code =
      typeof options.code === 'string' &&
      options.code.trim().length > 0
        ? options.code.trim()
        : `${step}_FAILED`;
    const message =
      typeof options.message === 'string'
        ? options.message
        : `${definition.label} failed for demonstration.`;
    const resumable = options.resumable === true;
    const resumeStep =
      options.resumeStep === undefined
        ? step
        : requireStep(options.resumeStep);
    const result = createStepResult({
      step,
      status: PIPELINE_STEP_STATUSES.FAILED,
      startedAt:
        current.stepStartedAt ??
        current.updatedAt ??
        current.startedAt ??
        timestamp,
      endedAt: timestamp,
      code,
      message,
    });

    return deepFreeze({
      ...current,
      status: PIPELINE_MACHINE_STATUSES.FAILED,
      stepResults: replaceStepResult(
        current.stepResults,
        result,
      ),
      agentOutcomes: replaceAgentOutcome(
        current.agentOutcomes,
        createAgentOutcome({
          step,
          agent: definition.agent,
          outcome: 'FAILED',
          code,
          message,
        }),
      ),
      checkpoint: createCheckpoint(
        step,
        resumable ? resumeStep : null,
        resumable,
      ),
      updatedAt: timestamp,
      completedAt: timestamp,
      stepStartedAt: null,
      errorCode: code,
      message,
    });
  }

  /**
   * Routes the current business-rules step to manual review.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {Record<string, unknown>} [options] Review options.
   * @returns {Readonly<Record<string, unknown>>} Review snapshot.
   */
  requireReview(state, options = {}) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      PIPELINE_MACHINE_STATUSES.RUNNING,
    ]);

    if (current.currentStep !== PIPELINE_STEPS.BUSINESS_RULES) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_TRANSITION,
        'Manual review may be entered only from business rules.',
        {
          currentStep: current.currentStep,
        },
      );
    }

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Manual review time',
    );
    const code =
      typeof options.code === 'string'
        ? options.code
        : 'MANUAL_REVIEW_REQUIRED';
    const message =
      typeof options.message === 'string'
        ? options.message
        : 'The request requires authorized manual review.';
    const resumeStep =
      options.resumeStep === undefined
        ? PIPELINE_STEPS.DOCUMENT_GENERATION
        : requireStep(options.resumeStep);
    const step = current.currentStep;
    const result = createStepResult({
      step,
      status: PIPELINE_STEP_STATUSES.FAILED,
      startedAt:
        current.stepStartedAt ??
        current.updatedAt ??
        current.startedAt ??
        timestamp,
      endedAt: timestamp,
      code,
      message,
    });

    return deepFreeze({
      ...current,
      status: PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW,
      stepResults: replaceStepResult(
        current.stepResults,
        result,
      ),
      agentOutcomes: replaceAgentOutcome(
        current.agentOutcomes,
        createAgentOutcome({
          step,
          agent: AGENTS.BUSINESS_RULES,
          outcome: 'MANUAL_REVIEW',
          code,
          message,
        }),
      ),
      checkpoint: createCheckpoint(
        step,
        resumeStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: null,
      errorCode: code,
      message,
    });
  }

  /**
   * Pauses or cancels an active pipeline.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {{mode?: string, at?: Date|string|number, message?: string}} [options]
   * Stop options.
   * @returns {Readonly<Record<string, unknown>>} Stopped snapshot.
   */
  stop(state, options = {}) {
    const current = requireMachineState(state);

    requireMutableStatus(current, [
      PIPELINE_MACHINE_STATUSES.READY,
      PIPELINE_MACHINE_STATUSES.RUNNING,
      PIPELINE_MACHINE_STATUSES.PAUSED,
      PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW,
      PIPELINE_MACHINE_STATUSES.FAILED,
    ]);

    const mode = options.mode ?? PIPELINE_STOP_MODES.PAUSE;

    if (!Object.values(PIPELINE_STOP_MODES).includes(mode)) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.INVALID_OPTIONS,
        'Pipeline stop mode must be PAUSE or CANCEL.',
      );
    }

    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Pipeline stop time',
    );

    if (mode === PIPELINE_STOP_MODES.CANCEL) {
      return deepFreeze({
        ...current,
        status: PIPELINE_MACHINE_STATUSES.CANCELLED,
        checkpoint: createCheckpoint(
          current.currentStep,
          null,
          false,
        ),
        updatedAt: timestamp,
        completedAt: timestamp,
        stepStartedAt: null,
        errorCode: 'PIPELINE_CANCELLED',
        message:
          typeof options.message === 'string'
            ? options.message
            : 'Pipeline cancelled for demonstration.',
      });
    }

    return deepFreeze({
      ...current,
      status: PIPELINE_MACHINE_STATUSES.PAUSED,
      checkpoint: createCheckpoint(
        current.currentStep,
        current.currentStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: null,
      errorCode: null,
      message:
        typeof options.message === 'string'
          ? options.message
          : 'Pipeline paused at a resumable checkpoint.',
    });
  }

  /**
   * Resumes a paused, review-approved, or explicitly resumable failed run.
   *
   * @param {Record<string, unknown>} state Machine state.
   * @param {{expectedCheckpoint?: string, reviewApproved?: boolean, at?: Date|string|number}} [options]
   * Resume options.
   * @returns {Readonly<Record<string, unknown>>} Running snapshot.
   */
  resume(state, options = {}) {
    const current = requireMachineState(state);

    if (!canResumePipeline(current)) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.RESUME_NOT_ALLOWED,
        'Pipeline checkpoint is not resumable.',
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
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.CHECKPOINT_MISMATCH,
        'Pipeline checkpoint does not match the expected checkpoint.',
        {
          expectedCheckpoint: options.expectedCheckpoint,
          actualCheckpoint: current.checkpoint.step,
        },
      );
    }

    if (
      current.status ===
        PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW &&
      options.reviewApproved !== true
    ) {
      throw new PipelineMachineError(
        PIPELINE_MACHINE_ERROR_CODES.REVIEW_DECISION_REQUIRED,
        'Manual review approval is required before pipeline resume.',
      );
    }

    const resumeStep = requireStep(
      current.checkpoint.nextStep ??
        current.checkpoint.step,
    );
    const timestamp = normalizeTimestamp(
      options.at,
      this.clock,
      'Pipeline resume time',
    );

    return deepFreeze({
      ...current,
      status: PIPELINE_MACHINE_STATUSES.RUNNING,
      currentStep: resumeStep,
      checkpoint: createCheckpoint(
        resumeStep,
        resumeStep,
        true,
      ),
      updatedAt: timestamp,
      completedAt: null,
      stepStartedAt: timestamp,
      errorCode: null,
      message: 'Pipeline resumed from its persisted checkpoint.',
    });
  }
}

/**
 * Creates a deterministic pipeline state machine.
 *
 * @param {ConstructorParameters<typeof PipelineMachine>[0]} [options]
 * Machine options.
 * @returns {PipelineMachine} Pipeline machine.
 */
export function createPipelineMachine(options = {}) {
  return new PipelineMachine(options);
}

export const PIPELINE_DEFINITION = PIPELINE_MACHINE_DEFINITION;
export const PIPELINE_TRANSITIONS = PIPELINE_TRANSITION_TABLE;
export const PIPELINE_STATES = PIPELINE_STEPS;
export const SCRIPTED_AGENT_OUTCOMES =
  PIPELINE_SCRIPTED_FAILURES;
export const ReprintPipelineMachine = PipelineMachine;
export const DeterministicPipelineMachine = PipelineMachine;
export const createReprintPipelineMachine =
  createPipelineMachine;
export const createDeterministicPipelineMachine =
  createPipelineMachine;

export default PipelineMachine;