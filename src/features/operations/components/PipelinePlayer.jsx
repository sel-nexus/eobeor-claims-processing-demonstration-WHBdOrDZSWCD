import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { formatStatus } from '../../../platform/utils/formatters.js';
import {
  PIPELINE_MACHINE_DEFINITION,
  PIPELINE_MACHINE_STATUSES,
} from '../services/pipelineMachine.js';

const EMPTY_COLLECTION = Object.freeze([]);
const RESUMABLE_STATUSES = new Set([
  PIPELINE_MACHINE_STATUSES.PAUSED,
  PIPELINE_MACHINE_STATUSES.MANUAL_REVIEW,
  PIPELINE_MACHINE_STATUSES.FAILED,
]);

function normalizeStatus(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFC')
        .trim()
        .replace(/[\s-]+/g, '_')
        .toUpperCase()
    : '';
}

function normalizeErrorMessage(error, fallback) {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function unwrapOperationResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.error?.message ?? fallback);
  }

  return result;
}

function resolvePlayerState({
  value,
  state,
  pipeline,
  run,
  status,
  currentStep,
  completedSteps,
  stepResults,
  validationChecks,
}) {
  const source = pipeline ?? run ?? state ?? value ?? {};

  return {
    ...source,
    status: status ?? source.status ?? 'READY',
    currentStep:
      currentStep ?? source.currentStep ?? 'REQUEST',
    completedSteps:
      completedSteps ??
      source.completedSteps ??
      EMPTY_COLLECTION,
    stepResults:
      stepResults ??
      source.stepResults ??
      EMPTY_COLLECTION,
    validationChecks:
      validationChecks ??
      source.validationChecks ??
      source.validationResults ??
      EMPTY_COLLECTION,
  };
}

function resolveStepStatus(step, player, completedStepSet) {
  const explicitResult = player.stepResults.find(
    (result) => result?.step === step,
  );
  const explicitStatus = normalizeStatus(
    explicitResult?.status ?? explicitResult?.outcome,
  );

  if (explicitStatus.length > 0) {
    return explicitStatus;
  }

  if (completedStepSet.has(step)) {
    return 'PASSED';
  }

  if (player.currentStep !== step) {
    return 'PENDING';
  }

  const pipelineStatus = normalizeStatus(player.status);

  if (pipelineStatus === 'MANUAL_REVIEW') {
    return 'MANUAL_REVIEW';
  }

  if (pipelineStatus === 'FAILED') {
    return 'FAILED';
  }

  if (pipelineStatus === 'PAUSED') {
    return 'PAUSED';
  }

  if (pipelineStatus === 'CANCELLED') {
    return 'CANCELLED';
  }

  if (
    pipelineStatus === 'RUNNING' ||
    pipelineStatus === 'PROCESSING'
  ) {
    return 'RUNNING';
  }

  if (
    pipelineStatus === 'COMPLETE' ||
    pipelineStatus === 'COMPLETED'
  ) {
    return 'PASSED';
  }

  return 'PENDING';
}

function resolveValidationCheckStatus(
  check,
  parentStatus,
  validationChecks,
) {
  const explicitResult = validationChecks.find(
    (result) =>
      result?.ruleId === check.ruleId ||
      result?.code === check.ruleId,
  );
  const explicitStatus = normalizeStatus(
    explicitResult?.status ??
      explicitResult?.outcome ??
      (explicitResult?.passed === true
        ? 'PASSED'
        : explicitResult?.passed === false
          ? 'FAILED'
          : ''),
  );

  if (explicitStatus.length > 0) {
    return explicitStatus;
  }

  if (parentStatus === 'PASSED') {
    return 'PASSED';
  }

  if (parentStatus === 'RUNNING') {
    return 'RUNNING';
  }

  if (
    parentStatus === 'FAILED' ||
    parentStatus === 'MANUAL_REVIEW'
  ) {
    return 'FAILED';
  }

  return 'PENDING';
}

function getStepResult(step, stepResults) {
  return (
    stepResults.find((result) => result?.step === step) ??
    null
  );
}

function formatPrintedMinutes(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return '—';
  }

  return `${value} min`;
}

function calculatePrintedTotal(steps) {
  return steps.reduce((total, step) => {
    const value = Number(step.printedMinutes);

    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

function getCompletedCount(steps, player, completedStepSet) {
  return steps.filter((step) => {
    const status = resolveStepStatus(
      step.step,
      player,
      completedStepSet,
    );

    return status === 'PASSED' || status === 'SKIPPED';
  }).length;
}

/**
 * Responsive visual player for the deterministic nine-stage pipeline.
 *
 * @param {{
 *   value?: Record<string, unknown>,
 *   state?: Record<string, unknown>,
 *   pipeline?: Record<string, unknown>,
 *   run?: Record<string, unknown>,
 *   definition?: Record<string, unknown>,
 *   status?: string,
 *   currentStep?: string,
 *   completedSteps?: readonly string[],
 *   stepResults?: readonly Record<string, unknown>[],
 *   validationChecks?: readonly Record<string, unknown>[],
 *   requestId?: string,
 *   loading?: boolean,
 *   disabled?: boolean,
 *   showControls?: boolean,
 *   className?: string,
 *   onPause?: Function,
 *   onResume?: Function
 * }} props Component props.
 * @returns {JSX.Element} Pipeline status player.
 */
export function PipelinePlayer({
  value,
  state,
  pipeline,
  run,
  definition = PIPELINE_MACHINE_DEFINITION,
  status,
  currentStep,
  completedSteps,
  stepResults,
  validationChecks,
  requestId,
  loading = false,
  disabled = false,
  showControls = true,
  className = '',
  onPause,
  onResume,
}) {
  const headingId = useId();
  const summaryId = useId();
  const feedbackId = useId();
  const [pendingAction, setPendingAction] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const player = resolvePlayerState({
    value,
    state,
    pipeline,
    run,
    status,
    currentStep,
    completedSteps,
    stepResults,
    validationChecks,
  });
  const steps = Array.isArray(definition?.steps)
    ? definition.steps
    : EMPTY_COLLECTION;
  const completedStepSet = useMemo(
    () =>
      new Set(
        Array.isArray(player.completedSteps)
          ? player.completedSteps
          : EMPTY_COLLECTION,
      ),
    [player.completedSteps],
  );
  const completedCount = getCompletedCount(
    steps,
    player,
    completedStepSet,
  );
  const progress =
    steps.length === 0
      ? 0
      : Math.round((completedCount / steps.length) * 100);
  const normalizedPipelineStatus = normalizeStatus(
    player.status,
  );
  const running =
    normalizedPipelineStatus === 'RUNNING' ||
    normalizedPipelineStatus === 'PROCESSING';
  const resumable =
    RESUMABLE_STATUSES.has(normalizedPipelineStatus) &&
    player.checkpoint?.resumable !== false;
  const pending = loading || pendingAction !== null;
  const resolvedRequestId =
    requestId ?? player.requestId ?? null;
  const printedTotal = calculatePrintedTotal(steps);
  const slaMinutes =
    definition?.slaMinutes ?? 22;
  const targetMinutes =
    definition?.targetMinutes ?? printedTotal;
  const currentDefinition = steps.find(
    (step) => step.step === player.currentStep,
  );
  const statusSummary =
    normalizedPipelineStatus === 'COMPLETE'
      ? `Pipeline complete. All ${steps.length} stages finished.`
      : `${formatStatus(player.status)}. ${completedCount} of ${
          steps.length
        } stages complete${
          currentDefinition?.label
            ? `. Current stage: ${currentDefinition.label}.`
            : '.'
        }`;

  const runAction = async (action, handler, event) => {
    if (typeof handler !== 'function' || pending || disabled) {
      return;
    }

    setPendingAction(action);
    setOperationError(null);

    const command =
      action === 'PAUSE'
        ? {
            requestId: resolvedRequestId,
            currentStep: player.currentStep,
          }
        : {
            requestId: resolvedRequestId,
            expectedCheckpoint:
              player.checkpoint?.step ??
              player.currentStep,
            ...(normalizedPipelineStatus === 'MANUAL_REVIEW'
              ? { reviewApproved: true }
              : {}),
          };

    try {
      const result = await Promise.resolve(
        handler(command, player, event),
      );

      unwrapOperationResult(
        result,
        action === 'PAUSE'
          ? 'Pipeline playback could not be paused.'
          : 'Pipeline playback could not be resumed.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          action === 'PAUSE'
            ? 'Pipeline playback could not be paused.'
            : 'Pipeline playback could not be resumed.',
        ),
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className={`overflow-hidden rounded-xl border border-border bg-surface shadow-card dark:border-border-dark dark:bg-surface-dark-muted ${className}`.trim()}
      aria-labelledby={headingId}
      aria-describedby={summaryId}
      aria-busy={pending}
    >
      <header className="border-b border-border p-5 dark:border-border-dark sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
              <Gauge
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Deterministic local playback
              </p>
              <h2
                id={headingId}
                className="mt-1 text-lg font-semibold text-content dark:text-content-inverse sm:text-xl"
              >
                Nine-stage document pipeline
              </h2>
              <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                Printed durations describe the representative
                workflow. Compressed playback does not contact an
                external claims or document system.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StatusBadge
              status={player.status ?? 'READY'}
            />
            {showControls && running && typeof onPause === 'function' ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark"
                type="button"
                disabled={pending || disabled}
                onClick={(event) => {
                  runAction(
                    'PAUSE',
                    onPause,
                    event,
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'Pipeline playback could not be paused.',
                      ),
                    );
                  });
                }}
              >
                {pendingAction === 'PAUSE' ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Pause
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
                {pendingAction === 'PAUSE'
                  ? 'Pausing…'
                  : 'Pause playback'}
              </button>
            ) : null}

            {showControls &&
            resumable &&
            typeof onResume === 'function' ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark-muted"
                type="button"
                disabled={pending || disabled}
                onClick={(event) => {
                  runAction(
                    'RESUME',
                    onResume,
                    event,
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'Pipeline playback could not be resumed.',
                      ),
                    );
                  });
                }}
              >
                {pendingAction === 'RESUME' ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : normalizedPipelineStatus === 'FAILED' ? (
                  <RotateCcw
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                ) : (
                  <Play
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
                {pendingAction === 'RESUME'
                  ? 'Resuming…'
                  : normalizedPipelineStatus === 'FAILED'
                    ? 'Retry from checkpoint'
                    : 'Resume playback'}
              </button>
            ) : null}
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-surface-dark">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              <Clock3
                className="h-4 w-4"
                aria-hidden="true"
              />
              SLA
            </dt>
            <dd className="mt-1 text-lg font-semibold text-content dark:text-content-inverse">
              {slaMinutes} min
            </dd>
          </div>
          <div className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-surface-dark">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              <CheckCircle2
                className="h-4 w-4"
                aria-hidden="true"
              />
              Productivity target
            </dt>
            <dd className="mt-1 text-lg font-semibold text-content dark:text-content-inverse">
              {targetMinutes} min
            </dd>
          </div>
          <div className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-surface-dark">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              <Gauge
                className="h-4 w-4"
                aria-hidden="true"
              />
              Printed stage total
            </dt>
            <dd className="mt-1 text-lg font-semibold text-content dark:text-content-inverse">
              {printedTotal} min
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-content dark:text-content-inverse">
              Pipeline progress
            </span>
            <span className="tabular-nums text-content-muted dark:text-content-inverse-muted">
              {completedCount} of {steps.length} stages
            </span>
          </div>
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark"
            role="progressbar"
            aria-label="Pipeline completion"
            aria-valuemin="0"
            aria-valuemax={steps.length}
            aria-valuenow={completedCount}
            aria-valuetext={`${progress}% complete`}
          >
            <div
              className={`h-full rounded-full transition-all duration-300 motion-reduce:transition-none ${
                progress === 100
                  ? 'bg-success-600'
                  : 'bg-primary-600'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p
            id={summaryId}
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {statusSummary}
          </p>
        </div>

        {operationError !== null ? (
          <div
            id={feedbackId}
            className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
            role="alert"
          >
            {operationError}
          </div>
        ) : null}
      </header>

      <div className="p-4 sm:p-6">
        {steps.length === 0 ? (
          <div
            className="rounded-lg bg-surface-muted p-5 text-center text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            Pipeline stage definitions are unavailable.
          </div>
        ) : (
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {steps.map((step, index) => {
              const stepStatus = resolveStepStatus(
                step.step,
                player,
                completedStepSet,
              );
              const result = getStepResult(
                step.step,
                player.stepResults,
              );
              const active =
                player.currentStep === step.step &&
                !['PASSED', 'SKIPPED'].includes(stepStatus);
              const checks = Array.isArray(step.subchecks)
                ? step.subchecks
                : EMPTY_COLLECTION;

              return (
                <li
                  key={step.step}
                  className={`relative rounded-xl border p-4 transition ${
                    active
                      ? 'border-primary-400 bg-primary-50 shadow-card dark:border-primary-700 dark:bg-primary-950'
                      : 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          stepStatus === 'PASSED'
                            ? 'bg-success-100 text-success-700 dark:bg-success-700 dark:text-white'
                            : active
                              ? 'bg-primary-600 text-white'
                              : 'bg-surface-muted text-content-muted dark:bg-surface-dark-raised dark:text-content-inverse-muted'
                        }`}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-content dark:text-content-inverse">
                          {step.label ??
                            formatStatus(step.step)}
                        </h3>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-content-subtle dark:text-content-inverse-muted">
                          <Clock3
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Printed{' '}
                          {formatPrintedMinutes(
                            step.printedMinutes,
                          )}
                        </p>
                      </div>
                    </div>
                    <StatusBadge
                      className="shrink-0"
                      status={stepStatus}
                    />
                  </div>

                  {typeof step.activity === 'string' ? (
                    <p className="mt-3 text-sm leading-5 text-content-muted dark:text-content-inverse-muted">
                      {step.activity}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-content-muted dark:bg-surface-dark-muted dark:text-content-inverse-muted">
                    <Bot
                      className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300"
                      aria-hidden="true"
                    />
                    <span>
                      Agent:{' '}
                      <span className="font-semibold text-content dark:text-content-inverse">
                        {formatStatus(
                          step.agent ?? 'LOCAL_AGENT',
                        )}
                      </span>
                    </span>
                  </div>

                  {checks.length > 0 ? (
                    <div className="mt-4 border-t border-border pt-3 dark:border-border-dark">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Validation checks
                      </p>
                      <ul className="mt-2 space-y-2">
                        {checks.map((check) => {
                          const checkStatus =
                            resolveValidationCheckStatus(
                              check,
                              stepStatus,
                              player.validationChecks,
                            );

                          return (
                            <li
                              key={check.ruleId}
                              className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-content dark:text-content-inverse">
                                  {check.label}
                                </p>
                                <p className="mt-0.5 text-xs text-content-subtle dark:text-content-inverse-muted">
                                  Printed{' '}
                                  {formatPrintedMinutes(
                                    check.printedMinutes,
                                  )}
                                </p>
                              </div>
                              <StatusBadge
                                className="shrink-0"
                                status={checkStatus}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {result?.message ? (
                    <p className="mt-3 text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                      {result.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="border-t border-border bg-surface-muted px-5 py-4 dark:border-border-dark dark:bg-surface-dark sm:px-6">
        <div className="flex items-start gap-3 text-sm text-content-muted dark:text-content-inverse-muted">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <p className="leading-6">
            Stage outcomes and timing are deterministic browser-local
            demonstrations. Printed minute labels are representative
            productivity values, not live processing measurements.
          </p>
        </div>
      </footer>
    </section>
  );
}

PipelinePlayer.propTypes = {
  value: PropTypes.object,
  state: PropTypes.object,
  pipeline: PropTypes.object,
  run: PropTypes.object,
  definition: PropTypes.shape({
    slaMinutes: PropTypes.number,
    targetMinutes: PropTypes.number,
    steps: PropTypes.arrayOf(
      PropTypes.shape({
        step: PropTypes.string.isRequired,
        label: PropTypes.string,
        agent: PropTypes.string,
        activity: PropTypes.string,
        printedMinutes: PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
        subchecks: PropTypes.arrayOf(
          PropTypes.shape({
            ruleId: PropTypes.string.isRequired,
            label: PropTypes.string.isRequired,
            printedMinutes: PropTypes.oneOfType([
              PropTypes.string,
              PropTypes.number,
            ]),
          }),
        ),
      }),
    ),
  }),
  status: PropTypes.string,
  currentStep: PropTypes.string,
  completedSteps: PropTypes.arrayOf(PropTypes.string),
  stepResults: PropTypes.arrayOf(PropTypes.object),
  validationChecks: PropTypes.arrayOf(PropTypes.object),
  requestId: PropTypes.string,
  loading: PropTypes.bool,
  disabled: PropTypes.bool,
  showControls: PropTypes.bool,
  className: PropTypes.string,
  onPause: PropTypes.func,
  onResume: PropTypes.func,
};

export const PipelineStatusPlayer = PipelinePlayer;
export const ReprintPipelinePlayer = PipelinePlayer;
export const DeterministicPipelinePlayer = PipelinePlayer;

export default PipelinePlayer;