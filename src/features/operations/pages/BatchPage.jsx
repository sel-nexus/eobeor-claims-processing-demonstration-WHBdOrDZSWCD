import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  Gauge,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  INITIAL_BATCH_RUNS,
  NIGHTLY_QUEUE_ROWS,
} from '../../../fixtures/operations.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  BATCH_MACHINE_DEFINITION,
  BATCH_ROW_SCENARIOS,
} from '../services/batchMachine.js';

const EMPTY_COLLECTION = Object.freeze([]);
const AUTHORIZED_ROLES = new Set(['BOS', 'ADMIN']);
const RETRYABLE_ROW_STATUSES = new Set([
  'FAILED',
  'QUEUED',
]);
const MAXIMUM_RETRY_ATTEMPTS = 3;

const SCENARIO_OPTIONS = Object.freeze([
  Object.freeze({
    value: BATCH_ROW_SCENARIOS.SUCCESS,
    label: 'Illustrated success',
  }),
  Object.freeze({
    value: BATCH_ROW_SCENARIOS.MEMBER_INVALID,
    label: 'Member validation failure',
  }),
  Object.freeze({
    value: BATCH_ROW_SCENARIOS.CLAIM_INVALID,
    label: 'Claim validation failure',
  }),
  Object.freeze({
    value: BATCH_ROW_SCENARIOS.PAYMENT_MISSING,
    label: 'Payment reference missing',
  }),
  Object.freeze({
    value:
      BATCH_ROW_SCENARIOS.DOCUMENT_PREPARATION_FAILED,
    label: 'Document preparation failure',
  }),
  Object.freeze({
    value: BATCH_ROW_SCENARIOS.REPORT_CREATION_FAILED,
    label: 'Report creation failure',
  }),
  Object.freeze({
    value: BATCH_ROW_SCENARIOS.IXIT_HANDOFF_FAILED,
    label: 'Mock IXIT handoff failure',
  }),
]);

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

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function normalizeContext(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? value.session
    : isPlainObject(value.actor)
      ? value.actor
      : value;
  const role = normalizeRole(source.role);

  if (role === null) {
    return null;
  }

  return {
    ...source,
    role,
    actorId:
      typeof source.actorId === 'string' &&
      source.actorId.trim().length > 0
        ? source.actorId.normalize('NFC').trim()
        : typeof source.userId === 'string' &&
            source.userId.trim().length > 0
          ? source.userId.normalize('NFC').trim()
          : null,
  };
}

function createServiceError(result, fallback) {
  const error = new Error(
    typeof result?.error?.message === 'string' &&
    result.error.message.trim().length > 0
      ? result.error.message
      : fallback,
  );

  if (typeof result?.error?.code === 'string') {
    error.code = result.error.code;
  }

  if (Array.isArray(result?.error?.fieldErrors)) {
    error.fieldErrors = result.error.fieldErrors;
  }

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function resolveRunMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.runBatch === 'function') {
    return service.runBatch.bind(service);
  }

  if (typeof service.run === 'function') {
    return service.run.bind(service);
  }

  return null;
}

function resolveRetryMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.retryBatchRow === 'function') {
    return service.retryBatchRow.bind(service);
  }

  if (typeof service.retry === 'function') {
    return service.retry.bind(service);
  }

  return null;
}

function resolveRunReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getBatchRunById === 'function') {
    return service.getBatchRunById.bind(service);
  }

  if (typeof service.findBatchRunById === 'function') {
    return service.findBatchRunById.bind(service);
  }

  return null;
}

function normalizeRunResult(result) {
  const value = unwrapServiceResult(
    result,
    'The browser-local batch run could not be loaded.',
  );

  if (isPlainObject(value?.run)) {
    return value.run;
  }

  return isPlainObject(value) ? value : null;
}

function createRunFromResult(result, queueRows) {
  if (
    !isPlainObject(result) ||
    typeof result.batchId !== 'string'
  ) {
    return null;
  }

  const queueById = Object.fromEntries(
    queueRows.map((row) => [row.rowId, row]),
  );

  return {
    batchId: result.batchId,
    status: result.status ?? 'COMPLETED_WITH_ERRORS',
    steps: Array.isArray(result.steps) ? result.steps : [],
    rows: Array.isArray(result.rows)
      ? result.rows.map((row) => ({
          ...queueById[row.rowId],
          ...row,
        }))
      : [],
    startedAt: result.startedAt ?? null,
    completedAt: result.completedAt ?? null,
  };
}

function upsertRun(runs, nextRun) {
  const existingIndex = runs.findIndex(
    (run) => run.batchId === nextRun.batchId,
  );

  if (existingIndex < 0) {
    return [nextRun, ...runs];
  }

  return runs.map((run, index) =>
    index === existingIndex ? nextRun : run,
  );
}

function createScenarioMap(queueRows) {
  return Object.fromEntries(
    queueRows.map((row) => [
      row.rowId,
      row.reasonCode === 'PAYMENT_MISSING'
        ? BATCH_ROW_SCENARIOS.PAYMENT_MISSING
        : BATCH_ROW_SCENARIOS.SUCCESS,
    ]),
  );
}

function getRunKey(run, index) {
  return run.batchId ?? `batch-run-${index}`;
}

function getRowKey(run, row, index) {
  return `${run.batchId ?? 'batch'}-${row.rowId ?? index}`;
}

function getStepKey(step, index) {
  return step.step ?? `batch-step-${index}`;
}

function getRunCounts(run) {
  const rows = Array.isArray(run?.rows) ? run.rows : [];

  return {
    total: rows.length,
    complete: rows.filter((row) => row.status === 'COMPLETE')
      .length,
    failed: rows.filter((row) => row.status === 'FAILED')
      .length,
    queued: rows.filter((row) => row.status === 'QUEUED')
      .length,
    processing: rows.filter(
      (row) => row.status === 'PROCESSING',
    ).length,
  };
}

function getStepStatus(run, step) {
  const result = Array.isArray(run?.steps)
    ? run.steps.find((candidate) => candidate.step === step)
    : null;

  if (typeof result?.status === 'string') {
    return result.status;
  }

  if (run?.status === 'RUNNING') {
    return 'PENDING';
  }

  return run?.status === 'COMPLETE'
    ? 'PASSED'
    : 'PENDING';
}

function getLatestLogEntries(run) {
  const stepEntries = Array.isArray(run?.steps)
    ? run.steps.map((step) => ({
        id: `step-${step.step}`,
        at: step.endedAt ?? step.startedAt ?? null,
        label: formatStatus(step.step),
        status: step.status ?? 'UNKNOWN',
        message:
          step.message ??
          `${formatStatus(step.step)} retained local evidence.`,
      }))
    : [];
  const rowEntries = Array.isArray(run?.rows)
    ? run.rows
        .filter(
          (row) =>
            row.reasonCode !== null &&
            row.reasonCode !== undefined,
        )
        .map((row) => ({
          id: `row-${row.rowId}`,
          at: run.completedAt ?? run.startedAt ?? null,
          label: row.rowId ?? 'Batch row',
          status: row.status ?? 'UNKNOWN',
          message: `${formatStatus(
            row.reasonCode,
          )}. The row remains browser-local.`,
        }))
    : [];

  return [...stepEntries, ...rowEntries].sort(
    (left, right) =>
      Date.parse(right.at ?? 0) - Date.parse(left.at ?? 0),
  );
}

/**
 * Claims-outbound nightly batch route with deterministic local row outcomes.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   batchService?: object,
 *   initialRuns?: readonly Record<string, unknown>[],
 *   queueRows?: readonly Record<string, unknown>[],
 *   onRunCompleted?: Function,
 *   onRetryCompleted?: Function
 * }} props Component props.
 * @returns {JSX.Element} Batch operations page.
 */
export function BatchPage({
  session = null,
  context = null,
  batchService = null,
  initialRuns = INITIAL_BATCH_RUNS,
  queueRows = NIGHTLY_QUEUE_ROWS,
  onRunCompleted,
  onRetryCompleted,
}) {
  const headingId = useId();
  const flowHeadingId = useId();
  const queueHeadingId = useId();
  const resultsHeadingId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const steps = Array.isArray(BATCH_MACHINE_DEFINITION.steps)
    ? BATCH_MACHINE_DEFINITION.steps
    : EMPTY_COLLECTION;
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRowIds, setSelectedRowIds] = useState(() =>
    queueRows.map((row) => row.rowId),
  );
  const [scenarioByRow, setScenarioByRow] = useState(() =>
    createScenarioMap(queueRows),
  );
  const [processing, setProcessing] = useState(false);
  const [retryPending, setRetryPending] = useState(null);
  const [retryValues, setRetryValues] = useState({});
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);

  const sortedRuns = useMemo(
    () =>
      [...runs].sort((left, right) => {
        const timestampDifference =
          Date.parse(
            right.completedAt ?? right.startedAt ?? 0,
          ) -
          Date.parse(
            left.completedAt ?? left.startedAt ?? 0,
          );

        if (
          Number.isFinite(timestampDifference) &&
          timestampDifference !== 0
        ) {
          return timestampDifference;
        }

        return String(right.batchId ?? '').localeCompare(
          String(left.batchId ?? ''),
          'en-US',
        );
      }),
    [runs],
  );

  const latestRun = sortedRuns[0] ?? null;
  const latestCounts = getRunCounts(latestRun);
  const selectedCount = selectedRowIds.length;
  const illustratedSuccessCount = selectedRowIds.filter(
    (rowId) =>
      scenarioByRow[rowId] === BATCH_ROW_SCENARIOS.SUCCESS,
  ).length;
  const localExceptionCount =
    selectedCount - illustratedSuccessCount;
  const latestLogEntries = getLatestLogEntries(latestRun);

  const toggleRow = (rowId) => {
    setSelectedRowIds((current) =>
      current.includes(rowId)
        ? current.filter((identifier) => identifier !== rowId)
        : [...current, rowId],
    );
    setOperationError(null);
    setOperationMessage(null);
  };

  const refreshRun = async (batchId, fallbackRun) => {
    const reader = resolveRunReader(batchService);

    if (reader === null) {
      return fallbackRun;
    }

    try {
      const value = await Promise.resolve(reader(batchId));
      return normalizeRunResult(value) ?? fallbackRun;
    } catch {
      return fallbackRun;
    }
  };

  const handleRunBatch = async () => {
    if (selectedRowIds.length === 0) {
      setOperationError(
        'Select at least one fictional local queue row.',
      );
      return;
    }

    const runBatch = resolveRunMethod(batchService);

    if (runBatch === null) {
      setOperationError(
        'Nightly batch processing is unavailable in this application composition.',
      );
      return;
    }

    setProcessing(true);
    setOperationError(null);
    setOperationMessage(null);

    const batchId = `BATCH-DEMO-${generateUuid()}`;
    const command = {
      batchId,
      rowIds: selectedRowIds,
      scenarioByRow: Object.fromEntries(
        selectedRowIds.map((rowId) => [
          rowId,
          scenarioByRow[rowId] ??
            BATCH_ROW_SCENARIOS.SUCCESS,
        ]),
      ),
      idempotencyKey: generateUuid(),
    };

    try {
      const result = await Promise.resolve(
        runBatch(command, accessContext),
      );
      const data = unwrapServiceResult(
        result,
        'The nightly claims-outbound batch could not be processed.',
      );
      const fallbackRun = createRunFromResult(data, queueRows);

      if (fallbackRun === null) {
        throw new Error(
          'The local batch service returned invalid run evidence.',
        );
      }

      const loadedRun = await refreshRun(
        fallbackRun.batchId,
        fallbackRun,
      );

      setRuns((current) => upsertRun(current, loadedRun));
      setOperationMessage(
        loadedRun.status === 'COMPLETE'
          ? 'The selected rows completed the ten-step browser-local batch.'
          : 'The selected rows completed locally with retained row exceptions.',
      );

      if (typeof onRunCompleted === 'function') {
        await Promise.resolve(
          onRunCompleted(loadedRun, result, command),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The nightly claims-outbound batch could not be processed.',
        ),
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleRetry = async (run, row) => {
    const retryBatchRow = resolveRetryMethod(batchService);
    const retryKey = `${run.batchId}:${row.rowId}`;
    const paymentReference =
      retryValues[retryKey] ?? '****0002';

    if (retryBatchRow === null) {
      setOperationError(
        'Batch row retry is unavailable in this application composition.',
      );
      return;
    }

    if (
      typeof paymentReference !== 'string' ||
      paymentReference.trim().length < 5 ||
      !paymentReference.includes('*')
    ) {
      setOperationError(
        'Enter a masked payment reference containing asterisks.',
      );
      return;
    }

    setRetryPending(retryKey);
    setOperationError(null);
    setOperationMessage(null);

    const command = {
      batchId: run.batchId,
      rowId: row.rowId,
      resolution: {
        paymentReference:
          paymentReference.normalize('NFC').trim(),
      },
      idempotencyKey: generateUuid(),
    };

    try {
      const result = await Promise.resolve(
        retryBatchRow(command, accessContext),
      );
      const data = unwrapServiceResult(
        result,
        'The selected batch row could not be retried.',
      );
      const fallbackRun = {
        ...run,
        status:
          run.rows.every(
            (candidate) =>
              candidate.rowId === row.rowId ||
              candidate.status === 'COMPLETE',
          )
            ? 'COMPLETE'
            : run.status,
        rows: run.rows.map((candidate) =>
          candidate.rowId === row.rowId
            ? {
                ...candidate,
                status: data?.status ?? 'COMPLETE',
                attempt:
                  data?.attempt ??
                  (candidate.attempt ?? 1) + 1,
                reasonCode: data?.reasonCode ?? null,
                reportId:
                  data?.reportId ?? candidate.reportId,
              }
            : candidate,
        ),
      };
      const loadedRun = await refreshRun(
        run.batchId,
        fallbackRun,
      );

      setRuns((current) => upsertRun(current, loadedRun));
      setOperationMessage(
        `Row ${row.rowId} was retried locally. No external payment or reporting system was contacted.`,
      );

      if (typeof onRetryCompleted === 'function') {
        await Promise.resolve(
          onRetryCompleted(
            loadedRun,
            data,
            result,
            command,
          ),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The selected batch row could not be retried.',
        ),
      );
    } finally {
      setRetryPending(null);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="flex items-start gap-4 px-5 py-6 sm:px-7 sm:py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <Activity
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Browser-local claims outbound
            </p>
            <h1
              id={headingId}
              className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              Nightly batch process flow
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Run selected fictional queue rows through the
              deterministic ten-step batch, review independent row
              outcomes, and retry eligible exceptions.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Nightly batch disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Illustrated local processing only
            </p>
            <p className="mt-1 leading-6">
              Volume, success, exceptions, report IDs, and mock IXIT
              handoffs are deterministic browser-local evidence.
              No payer, provider, payment, reporting, queue, or IXIT
              system is contacted.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{operationError}</span>
        </div>
      ) : null}

      {operationMessage !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{operationMessage}</span>
        </div>
      ) : null}

      <section
        className="mt-6 grid gap-4 sm:grid-cols-3"
        aria-label="Batch volume summary"
      >
        <article className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <div className="flex items-center gap-3">
            <Gauge
              className="h-5 w-5 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-content dark:text-content-inverse">
              Selected volume
            </h2>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {selectedCount}
          </p>
          <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
            Local queue rows selected for the next run
          </p>
        </article>

        <article className="rounded-xl border border-success-200 bg-success-50 p-5 shadow-card dark:border-success-700 dark:bg-surface-dark-muted">
          <div className="flex items-center gap-3">
            <CheckCircle2
              className="h-5 w-5 text-success-700 dark:text-success-100"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-content dark:text-content-inverse">
              Illustrated success
            </h2>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {illustratedSuccessCount}
          </p>
          <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
            Rows configured for deterministic success
          </p>
        </article>

        <article className="rounded-xl border border-warning-200 bg-warning-50 p-5 shadow-card dark:border-warning-700 dark:bg-warning-950">
          <div className="flex items-center gap-3">
            <ShieldAlert
              className="h-5 w-5 text-warning-700 dark:text-warning-100"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-content dark:text-content-inverse">
              Local exception rows
            </h2>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {localExceptionCount}
          </p>
          <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
            Rows configured for retained local exceptions
          </p>
        </article>
      </section>

      <section
        className="mt-8"
        aria-labelledby={flowHeadingId}
      >
        <div className="flex items-start gap-3">
          <ListChecks
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id={flowHeadingId}
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Batch steps 1–10
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Named claims-outbound activities execute in this
              fixed order for each active row.
            </p>
          </div>
        </div>

        <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {steps.map((step, index) => (
            <li
              key={getStepKey(step, index)}
              className="rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                  {index + 1}
                </span>
                <StatusBadge
                  status={getStepStatus(
                    latestRun,
                    step.step,
                  )}
                />
              </div>
              <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
                {step.label ?? formatStatus(step.step)}
              </h3>
              <p className="mt-2 text-sm leading-5 text-content-muted dark:text-content-inverse-muted">
                {step.activity ??
                  'Retain deterministic local batch evidence.'}
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-content-subtle dark:text-content-inverse-muted">
                <Clock3
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                Printed {step.printedMinutes ?? '—'} min
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby={queueHeadingId}
        aria-busy={processing}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2
              id={queueHeadingId}
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Local nightly queue rows
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Select rows and choose the deterministic outcome
              illustrated by the next run.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
            type="button"
            disabled={processing || selectedRowIds.length === 0}
            onClick={() => {
              handleRunBatch().catch((error) => {
                setProcessing(false);
                setOperationError(
                  normalizeErrorMessage(
                    error,
                    'The nightly claims-outbound batch could not be processed.',
                  ),
                );
              });
            }}
          >
            {processing ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Play
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
            {processing
              ? 'Running ten local steps…'
              : `Run selected rows (${selectedCount})`}
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {queueRows.map((row) => {
            const selected = selectedRowIds.includes(row.rowId);

            return (
              <article
                key={row.rowId}
                className={`rounded-xl border p-4 transition ${
                  selected
                    ? 'border-primary-400 bg-primary-50 dark:border-primary-700 dark:bg-primary-950'
                    : 'border-border bg-surface-muted dark:border-border-dark dark:bg-surface-dark'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    className="mt-1 h-4 w-4 shrink-0 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                    type="checkbox"
                    checked={selected}
                    disabled={processing}
                    aria-label={`Select batch row ${row.rowId}`}
                    onChange={() => toggleRow(row.rowId)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="break-all font-mono text-sm font-semibold text-content dark:text-content-inverse">
                          {row.rowId}
                        </h3>
                        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                          Claim{' '}
                          <span className="font-mono">
                            {row.claimNumber}
                          </span>{' '}
                          · {formatStatus(row.requestType)}
                        </p>
                      </div>
                      <StatusBadge
                        status={row.status ?? 'QUEUED'}
                      />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Member
                        </dt>
                        <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                          {row.memberId}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Source
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatStatus(row.source)}
                        </dd>
                      </div>
                    </dl>

                    <label className="mt-4 block text-sm font-medium text-content dark:text-content-inverse">
                      Illustrated row outcome
                      <select
                        className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        value={
                          scenarioByRow[row.rowId] ??
                          BATCH_ROW_SCENARIOS.SUCCESS
                        }
                        disabled={processing || !selected}
                        onChange={(event) => {
                          setScenarioByRow((current) => ({
                            ...current,
                            [row.rowId]: event.target.value,
                          }));
                          setOperationError(null);
                          setOperationMessage(null);
                        }}
                      >
                        {SCENARIO_OPTIONS.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {processing ? (
          <div
            className="mt-5"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-content dark:text-content-inverse">
                Processing selected rows independently
              </span>
              <span className="text-content-muted dark:text-content-inverse-muted">
                Browser-local
              </span>
            </div>
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark"
              role="progressbar"
              aria-label="Nightly batch processing"
              aria-valuetext="Running the deterministic ten-step batch locally"
            >
              <div className="h-full w-full animate-pulse rounded-full bg-primary-600 motion-reduce:animate-none" />
            </div>
          </div>
        ) : null}
      </section>

      <section
        className="mt-8"
        aria-labelledby={resultsHeadingId}
      >
        <h2
          id={resultsHeadingId}
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Batch run evidence
        </h2>
        <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
          Successful rows remain complete when another row fails or
          returns to the local queue.
        </p>

        {sortedRuns.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileText
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No batch runs displayed
            </h3>
            <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
              Run selected local rows to create deterministic batch
              evidence.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {sortedRuns.map((run, runIndex) => {
              const counts = getRunCounts(run);

              return (
                <article
                  key={getRunKey(run, runIndex)}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Claims-outbound batch
                      </p>
                      <h3 className="mt-1 break-all font-mono text-base font-semibold text-content dark:text-content-inverse">
                        {run.batchId}
                      </h3>
                      <p className="mt-2 text-xs text-content-muted dark:text-content-inverse-muted">
                        Started {formatDateTime(run.startedAt)}
                        {' · '}
                        Completed {formatDateTime(run.completedAt)}
                      </p>
                    </div>
                    <StatusBadge
                      status={run.status ?? 'UNKNOWN'}
                    />
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {[
                      ['Volume', counts.total],
                      ['Complete', counts.complete],
                      ['Failed', counts.failed],
                      ['Queued', counts.queued],
                      ['Processing', counts.processing],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark"
                      >
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          {label}
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-content dark:text-content-inverse">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {(Array.isArray(run.rows)
                      ? run.rows
                      : EMPTY_COLLECTION
                    ).map((row, rowIndex) => {
                      const retryKey = `${run.batchId}:${row.rowId}`;
                      const retrying =
                        retryPending === retryKey;
                      const retryable =
                        RETRYABLE_ROW_STATUSES.has(
                          row.status,
                        ) &&
                        (row.attempt ?? 1) <
                          MAXIMUM_RETRY_ATTEMPTS;

                      return (
                        <section
                          key={getRowKey(
                            run,
                            row,
                            rowIndex,
                          )}
                          className="rounded-xl border border-border p-4 dark:border-border-dark"
                          aria-busy={retrying}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="break-all font-mono text-sm font-semibold text-content dark:text-content-inverse">
                                {row.rowId ??
                                  `Row ${rowIndex + 1}`}
                              </h4>
                              <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                                Attempt {row.attempt ?? 1}
                              </p>
                            </div>
                            <StatusBadge
                              status={row.status ?? 'UNKNOWN'}
                            />
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                                Claim
                              </dt>
                              <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                                {row.claimNumber ?? '—'}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                                Local report
                              </dt>
                              <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                                {row.reportId ?? 'Not created'}
                              </dd>
                            </div>
                          </dl>

                          {row.reasonCode ? (
                            <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100">
                              <p className="font-semibold">
                                {formatStatus(row.reasonCode)}
                              </p>
                              <p className="mt-1 text-xs leading-5">
                                This outcome is retained only in
                                browser-local demonstration data.
                              </p>
                            </div>
                          ) : null}

                          {retryable ? (
                            <div className="mt-4 border-t border-border pt-4 dark:border-border-dark">
                              <label className="block text-sm font-medium text-content dark:text-content-inverse">
                                Masked payment reference
                                <input
                                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                                  type="text"
                                  value={
                                    retryValues[retryKey] ??
                                    '****0002'
                                  }
                                  maxLength={100}
                                  disabled={
                                    retryPending !== null
                                  }
                                  onChange={(event) => {
                                    setRetryValues(
                                      (current) => ({
                                        ...current,
                                        [retryKey]:
                                          event.target.value,
                                      }),
                                    );
                                    setOperationError(null);
                                  }}
                                />
                              </label>
                              <button
                                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                type="button"
                                disabled={
                                  retryPending !== null
                                }
                                onClick={() => {
                                  handleRetry(
                                    run,
                                    row,
                                  ).catch((error) => {
                                    setOperationError(
                                      normalizeErrorMessage(
                                        error,
                                        'The selected batch row could not be retried.',
                                      ),
                                    );
                                  });
                                }}
                              >
                                {retrying ? (
                                  <Loader2
                                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <RefreshCw
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                )}
                                {retrying
                                  ? 'Retrying locally…'
                                  : 'Retry row locally'}
                              </button>
                            </div>
                          ) : null}

                          {RETRYABLE_ROW_STATUSES.has(
                            row.status,
                          ) &&
                          !retryable ? (
                            <p className="mt-4 text-xs font-medium text-content-subtle dark:text-content-inverse-muted">
                              Retry limit reached.
                            </p>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="batch-log-heading"
      >
        <div className="flex items-start gap-3">
          <FileText
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="batch-log-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Latest local batch log
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Sanitized stage and exception messages for the most
              recent displayed run.
            </p>
          </div>
        </div>

        {latestLogEntries.length === 0 ? (
          <p
            className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
            role="status"
          >
            No stage log entries are available.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {latestLogEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 dark:border-border-dark sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-content dark:text-content-inverse">
                    {entry.label}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-content-muted dark:text-content-inverse-muted">
                    {entry.message}
                  </p>
                  <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                    {formatDateTime(entry.at)}
                  </p>
                </div>
                <StatusBadge
                  className="shrink-0 self-start"
                  status={entry.status}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Batch processing disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional batch processing only
            </p>
            <p className="mt-1 text-sm leading-6">
              Steps, row outcomes, retries, report IDs, and mock
              IXIT handoffs are representative local fixtures.
              They do not represent healthcare, coverage, payment,
              reporting, delivery, or transmission results.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

BatchPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  batchService: PropTypes.object,
  initialRuns: PropTypes.arrayOf(PropTypes.object),
  queueRows: PropTypes.arrayOf(PropTypes.object),
  onRunCompleted: PropTypes.func,
  onRetryCompleted: PropTypes.func,
};

export const ClaimsOutboundBatchPage = BatchPage;
export const NightlyBatchPage = BatchPage;
export const LocalBatchPage = BatchPage;

export default BatchPage;