import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  AP_REPRINT_HEADER,
  AP_REPRINT_SCENARIOS,
  CHANGE_835_HEADER,
  CHANGE_835_SCENARIOS,
} from '../../../fixtures/operations.js';

const EMPTY_COLLECTION = Object.freeze([]);
const AUTHORIZED_ROLES = new Set(['BOS', 'ADMIN']);
const FEED_TYPES = Object.freeze({
  AP_REPRINT: 'AP_REPRINT',
  CHANGE_835: 'CHANGE_835',
});
const FEED_TYPE_VALUES = new Set(Object.values(FEED_TYPES));

const FEED_TYPE_OPTIONS = Object.freeze([
  Object.freeze({
    value: FEED_TYPES.AP_REPRINT,
    label: 'AP reprint',
    description:
      'Creates browser-local reprint requests from an approved fictional AP feed.',
  }),
  Object.freeze({
    value: FEED_TYPES.CHANGE_835,
    label: '835 change',
    description:
      'Applies allowlisted fictional claim changes and creates local CDC evidence.',
  }),
]);

const EXPECTED_HEADERS = Object.freeze({
  [FEED_TYPES.AP_REPRINT]: AP_REPRINT_HEADER,
  [FEED_TYPES.CHANGE_835]: CHANGE_835_HEADER,
});

function deepFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreeze(item)));
  }

  if (isPlainObject(value)) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          deepFreeze(item),
        ]),
      ),
    );
  }

  return value;
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

function createFallbackFixtures() {
  return deepFreeze([
    ...AP_REPRINT_SCENARIOS.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      feedType: FEED_TYPES.AP_REPRINT,
      filename: scenario.filename,
      maskedApiKeyId: scenario.maskedApiKeyId,
      header: scenario.header,
      expectedStatus: scenario.expectedStatus,
      expectedAccepted: scenario.expectedAccepted ?? null,
      expectedFailed: scenario.expectedFailed ?? null,
      localOnly: true,
      disclosure: 'No file leaves this browser',
    })),
    ...CHANGE_835_SCENARIOS.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      feedType: FEED_TYPES.CHANGE_835,
      filename: scenario.filename,
      maskedApiKeyId: scenario.maskedApiKeyId,
      header: scenario.header,
      expectedStatus: scenario.expectedStatus,
      expectedAccepted: scenario.expectedAccepted ?? null,
      expectedFailed: scenario.expectedFailed ?? null,
      expectedCdcOperation:
        scenario.expectedCdcOperation ?? null,
      localOnly: true,
      disclosure: 'No file leaves this browser',
    })),
  ]);
}

const FALLBACK_FIXTURES = createFallbackFixtures();

function normalizeFixtureCollection(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.fixtures)
        ? value.fixtures
        : null;

  if (source === null) {
    throw new TypeError(
      'The local CSV fixture parser returned an invalid fixture collection.',
    );
  }

  return source
    .filter(
      (fixture) =>
        isPlainObject(fixture) &&
        typeof fixture.scenarioId === 'string' &&
        FEED_TYPE_VALUES.has(fixture.feedType) &&
        typeof fixture.filename === 'string' &&
        Array.isArray(fixture.header),
    )
    .map((fixture) => {
      const fallback = FALLBACK_FIXTURES.find(
        (candidate) =>
          candidate.scenarioId === fixture.scenarioId,
      );

      return {
        ...fallback,
        ...fixture,
        header: [...fixture.header],
      };
    });
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

function resolveApplyMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.applyInboundRows === 'function') {
    return service.applyInboundRows.bind(service);
  }

  if (typeof service.apply === 'function') {
    return service.apply.bind(service);
  }

  if (typeof service.process === 'function') {
    return service.process.bind(service);
  }

  return null;
}

function resolveRetryMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.retryInboundRow === 'function') {
    return service.retryInboundRow.bind(service);
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

  if (typeof service.getInboundRunById === 'function') {
    return service.getInboundRunById.bind(service);
  }

  if (typeof service.findInboundRunById === 'function') {
    return service.findInboundRunById.bind(service);
  }

  return null;
}

function normalizeRun(value) {
  const resolved = unwrapServiceResult(
    value,
    'The browser-local inbound run could not be loaded.',
  );

  if (isPlainObject(resolved?.run)) {
    return resolved.run;
  }

  return isPlainObject(resolved) ? resolved : null;
}

function createRunFromResult(result, fixture) {
  if (!isPlainObject(result)) {
    return null;
  }

  const feedRunId =
    typeof result.feedRunId === 'string'
      ? result.feedRunId
      : null;

  if (feedRunId === null) {
    return null;
  }

  return {
    feedRunId,
    feedType: result.feedType ?? fixture.feedType,
    filename: result.filename ?? fixture.filename,
    maskedApiKeyId: fixture.maskedApiKeyId,
    header: fixture.header,
    status: result.status ?? 'COMPLETE',
    rows: Array.isArray(result.rows) ? result.rows : [],
    createdAt: result.createdAt ?? null,
  };
}

function upsertRun(runs, nextRun) {
  const index = runs.findIndex(
    (run) => run.feedRunId === nextRun.feedRunId,
  );

  if (index < 0) {
    return [nextRun, ...runs];
  }

  return runs.map((run, runIndex) =>
    runIndex === index ? nextRun : run,
  );
}

function getRunKey(run, index) {
  return run.feedRunId ?? `inbound-run-${index}`;
}

function getRowKey(run, row, index) {
  return `${run.feedRunId ?? 'run'}-${row.rowNumber ?? index}`;
}

function getCorrectionKey(run, row) {
  return `${run.feedRunId}:${row.rowNumber}`;
}

function getFeedLabel(feedType) {
  return (
    FEED_TYPE_OPTIONS.find(
      (option) => option.value === feedType,
    )?.label ?? formatStatus(feedType)
  );
}

function getRunCounts(run) {
  const rows = Array.isArray(run?.rows) ? run.rows : [];

  return {
    total: rows.length,
    applied: rows.filter((row) => row.status === 'APPLIED')
      .length,
    failed: rows.filter((row) => row.status === 'FAILED')
      .length,
    pending: rows.filter((row) => row.status === 'PENDING')
      .length,
  };
}

function normalizeCorrectionValues(header, values) {
  const source = isPlainObject(values) ? values : {};

  return Object.fromEntries(
    header.map((field) => [
      field,
      source[field] === null || source[field] === undefined
        ? ''
        : String(source[field]),
    ]),
  );
}

function validateCorrectionValues(header, values) {
  return header.every(
    (field) =>
      typeof values[field] === 'string' &&
      values[field].trim().length > 0,
  );
}

function getFieldErrors(error) {
  return Array.isArray(error?.fieldErrors)
    ? error.fieldErrors.filter(
        (fieldError) =>
          isPlainObject(fieldError) &&
          typeof fieldError.message === 'string',
      )
    : [];
}

/**
 * Browser-local inbound AP reprint and 835 fixture route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   inboundService?: object,
 *   csvParser?: object,
 *   parser?: object,
 *   initialRuns?: readonly Record<string, unknown>[],
 *   initialFeedType?: string
 * }} props Component props.
 * @returns {JSX.Element} Inbound operations page.
 */
export function InboundPage({
  session = null,
  context = null,
  inboundService = null,
  csvParser = null,
  parser = null,
  initialRuns = EMPTY_COLLECTION,
  initialFeedType = FEED_TYPES.AP_REPRINT,
}) {
  const headingId = useId();
  const feedTypeId = useId();
  const fixtureId = useId();
  const fileInputId = useId();
  const resultsHeadingId = useId();
  const fileInputRef = useRef(null);
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const resolvedParser = csvParser ?? parser;
  const normalizedInitialFeedType = FEED_TYPE_VALUES.has(
    initialFeedType,
  )
    ? initialFeedType
    : FEED_TYPES.AP_REPRINT;
  const [approvedFixtures, setApprovedFixtures] = useState(
    FALLBACK_FIXTURES,
  );
  const [feedType, setFeedType] = useState(
    normalizedInitialFeedType,
  );
  const [selectedScenarioId, setSelectedScenarioId] =
    useState('');
  const [runs, setRuns] = useState(initialRuns);
  const [loadingFixtures, setLoadingFixtures] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [retryPending, setRetryPending] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState([]);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [corrections, setCorrections] = useState({});
  const [expandedRetry, setExpandedRetry] = useState(null);

  useEffect(() => {
    let active = true;

    const loadApprovedFixtures = async () => {
      if (
        resolvedParser === null ||
        resolvedParser === undefined ||
        typeof resolvedParser.listApprovedFixtures !== 'function'
      ) {
        setApprovedFixtures(FALLBACK_FIXTURES);
        return;
      }

      setLoadingFixtures(true);

      try {
        const result = await Promise.resolve(
          resolvedParser.listApprovedFixtures(),
        );
        const fixtures = normalizeFixtureCollection(result);

        if (active) {
          setApprovedFixtures(
            fixtures.length > 0 ? fixtures : FALLBACK_FIXTURES,
          );
        }
      } catch (error) {
        if (active) {
          setApprovedFixtures(FALLBACK_FIXTURES);
          setOperationError(
            normalizeErrorMessage(
              error,
              'Approved inbound fixture metadata could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoadingFixtures(false);
        }
      }
    };

    loadApprovedFixtures().catch((error) => {
      if (active) {
        setLoadingFixtures(false);
        setApprovedFixtures(FALLBACK_FIXTURES);
        setOperationError(
          normalizeErrorMessage(
            error,
            'Approved inbound fixture metadata could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [resolvedParser]);

  const fixturesForFeed = useMemo(
    () =>
      approvedFixtures.filter(
        (fixture) => fixture.feedType === feedType,
      ),
    [approvedFixtures, feedType],
  );

  useEffect(() => {
    if (
      selectedScenarioId.length > 0 &&
      fixturesForFeed.some(
        (fixture) =>
          fixture.scenarioId === selectedScenarioId,
      )
    ) {
      return;
    }

    const preferred =
      fixturesForFeed.find(
        (fixture) =>
          fixture.expectedStatus === 'COMPLETE',
      ) ?? fixturesForFeed[0];

    setSelectedScenarioId(preferred?.scenarioId ?? '');
  }, [fixturesForFeed, selectedScenarioId]);

  const selectedFixture = useMemo(
    () =>
      fixturesForFeed.find(
        (fixture) =>
          fixture.scenarioId === selectedScenarioId,
      ) ?? null,
    [fixturesForFeed, selectedScenarioId],
  );

  const expectedHeader =
    EXPECTED_HEADERS[feedType] ?? EMPTY_COLLECTION;
  const visibleRuns = useMemo(
    () =>
      [...runs].sort((left, right) => {
        const timeDifference =
          Date.parse(right.createdAt ?? 0) -
          Date.parse(left.createdAt ?? 0);

        if (
          Number.isFinite(timeDifference) &&
          timeDifference !== 0
        ) {
          return timeDifference;
        }

        return String(right.feedRunId ?? '').localeCompare(
          String(left.feedRunId ?? ''),
          'en-US',
        );
      }),
    [runs],
  );

  const selectFixtureByFilename = (filename) => {
    const normalizedFilename =
      typeof filename === 'string'
        ? filename.normalize('NFC').trim()
        : '';
    const fixture = approvedFixtures.find(
      (candidate) =>
        candidate.filename === normalizedFilename,
    );

    setOperationError(null);
    setFieldErrors([]);
    setOperationMessage(null);

    if (fixture === undefined) {
      setOperationError(
        'That filename is not an approved browser-local fixture. No file content was read.',
      );
      return;
    }

    setFeedType(fixture.feedType);
    setSelectedScenarioId(fixture.scenarioId);
    setOperationMessage(
      `${fixture.filename} selected by filename. No file content was read or transmitted.`,
    );
  };

  const handleFileSelection = (files) => {
    const file = files?.[0];

    if (file === undefined) {
      return;
    }

    selectFixtureByFilename(file.name);
  };

  const refreshRun = async (feedRunId, fallbackRun) => {
    const readRun = resolveRunReader(inboundService);

    if (readRun === null) {
      return fallbackRun;
    }

    try {
      const value = await Promise.resolve(readRun(feedRunId));
      return normalizeRun(value) ?? fallbackRun;
    } catch {
      return fallbackRun;
    }
  };

  const handleApplyFixture = async () => {
    if (selectedFixture === null) {
      setOperationError(
        'Select an approved browser-local fixture.',
      );
      return;
    }

    const applyInboundRows = resolveApplyMethod(inboundService);

    if (applyInboundRows === null) {
      setOperationError(
        'Inbound fixture processing is unavailable in this application composition.',
      );
      return;
    }

    setProcessing(true);
    setOperationError(null);
    setFieldErrors([]);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        applyInboundRows(
          {
            scenarioId: selectedFixture.scenarioId,
            feedType: selectedFixture.feedType,
            filename: selectedFixture.filename,
            maskedApiKeyId:
              selectedFixture.maskedApiKeyId,
            header: selectedFixture.header,
            idempotencyKey: generateUuid(),
          },
          accessContext,
        ),
      );
      const data = unwrapServiceResult(
        result,
        'The approved inbound fixture could not be processed.',
      );
      const fallbackRun = createRunFromResult(
        data,
        selectedFixture,
      );

      if (fallbackRun !== null) {
        const loadedRun = await refreshRun(
          fallbackRun.feedRunId,
          fallbackRun,
        );

        setRuns((current) => upsertRun(current, loadedRun));
      }

      setOperationMessage(
        data?.status === 'COMPLETE'
          ? 'The approved fixture was processed locally. Every row was applied.'
          : data?.status === 'COMPLETED_WITH_ERRORS'
            ? 'The approved fixture was processed locally. Successful rows were retained and failed rows can be retried independently.'
            : 'The approved fixture run completed locally with retained row evidence.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The approved inbound fixture could not be processed.',
        ),
      );
      setFieldErrors(getFieldErrors(error));
    } finally {
      setProcessing(false);
    }
  };

  const openRetry = (run, row) => {
    const key = getCorrectionKey(run, row);
    const header = Array.isArray(run.header)
      ? run.header
      : EXPECTED_HEADERS[run.feedType] ?? [];

    setCorrections((current) => ({
      ...current,
      [key]:
        current[key] ??
        normalizeCorrectionValues(header, row.values),
    }));
    setExpandedRetry(key);
    setOperationError(null);
    setFieldErrors([]);
    setOperationMessage(null);
  };

  const handleRetry = async (run, row) => {
    const retryInboundRow = resolveRetryMethod(inboundService);
    const key = getCorrectionKey(run, row);
    const header = Array.isArray(run.header)
      ? run.header
      : EXPECTED_HEADERS[run.feedType] ?? [];
    const correctedValues =
      corrections[key] ??
      normalizeCorrectionValues(header, row.values);

    if (retryInboundRow === null) {
      setOperationError(
        'Inbound row retry is unavailable in this application composition.',
      );
      return;
    }

    if (!validateCorrectionValues(header, correctedValues)) {
      setOperationError(
        'Every field in the exact feed schema is required before retry.',
      );
      return;
    }

    setRetryPending(key);
    setOperationError(null);
    setFieldErrors([]);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        retryInboundRow(
          {
            feedRunId: run.feedRunId,
            rowNumber: row.rowNumber,
            correctedValues: Object.fromEntries(
              header.map((field) => [
                field,
                correctedValues[field]
                  .normalize('NFC')
                  .trim(),
              ]),
            ),
            idempotencyKey: generateUuid(),
          },
          accessContext,
        ),
      );

      unwrapServiceResult(
        result,
        'The failed inbound row could not be retried.',
      );

      const loadedRun = await refreshRun(run.feedRunId, run);

      setRuns((current) => upsertRun(current, loadedRun));
      setExpandedRetry(null);
      setOperationMessage(
        `Row ${row.rowNumber} was retried locally. Other row outcomes were not changed.`,
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The failed inbound row could not be retried.',
        ),
      );
      setFieldErrors(getFieldErrors(error));
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
            <FileSpreadsheet
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Browser-local inbound operations
            </p>
            <h1
              id={headingId}
              className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              AP reprint and 835 fixtures
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Select an approved fictional CSV scenario, validate
              its exact ordered header, and process independent
              rows without uploading or transmitting a file.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Inbound fixture privacy disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              No file leaves this browser
            </p>
            <p className="mt-1 leading-6">
              Picker and drag-and-drop controls use only the
              selected filename to match a bundled approved
              fixture. File bytes and arbitrary CSV content are
              not read, uploaded, parsed, or transmitted.
            </p>
            <p className="mt-1 text-xs leading-5">
              AP requests, 835 changes, CDC evidence, row results,
              and retries remain in browser-local fictional data.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null || fieldErrors.length > 0 ? (
        <div
          className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              {operationError !== null ? (
                <p>{operationError}</p>
              ) : null}
              {fieldErrors.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {fieldErrors.map((error, index) => (
                    <li
                      key={`${error.field ?? 'field'}-${index}`}
                    >
                      {error.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 lg:col-span-2"
          aria-labelledby="fixture-selection-heading"
          aria-busy={loadingFixtures || processing}
        >
          <div className="flex items-start gap-3">
            <Upload
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="fixture-selection-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Select an approved fixture
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Only bundled scenario metadata can be selected.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={feedTypeId}
              >
                Feed type
              </label>
              <select
                id={feedTypeId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                value={feedType}
                disabled={loadingFixtures || processing}
                onChange={(event) => {
                  setFeedType(event.target.value);
                  setSelectedScenarioId('');
                  setOperationError(null);
                  setFieldErrors([]);
                  setOperationMessage(null);
                }}
              >
                {FEED_TYPE_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                {
                  FEED_TYPE_OPTIONS.find(
                    (option) => option.value === feedType,
                  )?.description
                }
              </p>
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={fixtureId}
              >
                Approved scenario
              </label>
              <select
                id={fixtureId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                value={selectedScenarioId}
                disabled={
                  loadingFixtures ||
                  processing ||
                  fixturesForFeed.length === 0
                }
                onChange={(event) => {
                  setSelectedScenarioId(event.target.value);
                  setOperationError(null);
                  setFieldErrors([]);
                  setOperationMessage(null);
                }}
              >
                {fixturesForFeed.map((fixture) => (
                  <option
                    key={fixture.scenarioId}
                    value={fixture.scenarioId}
                  >
                    {fixture.filename}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className={`mt-5 rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragActive
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
                : 'border-border-strong bg-surface-muted dark:border-border-dark-strong dark:bg-surface-dark'
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) {
                setDragActive(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleFileSelection(event.dataTransfer.files);
            }}
          >
            <Upload
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <p className="mt-3 font-semibold text-content dark:text-content-inverse">
              Drop an approved fixture filename
            </p>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              The browser matches the filename to bundled data. It
              does not read the dropped file.
            </p>
            <input
              ref={fileInputRef}
              id={fileInputId}
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              disabled={processing}
              onChange={(event) => {
                handleFileSelection(event.target.files);
                event.target.value = '';
              }}
            />
            <label
              className="mt-4 inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus-within:ring-2 focus-within:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised"
              htmlFor={fileInputId}
            >
              <FileSpreadsheet
                className="h-4 w-4"
                aria-hidden="true"
              />
              Browse filenames
            </label>
          </div>

          {selectedFixture !== null ? (
            <div className="mt-5 rounded-xl border border-border p-4 dark:border-border-dark">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                    Selected fixture
                  </p>
                  <p className="mt-1 break-all font-mono text-sm font-semibold text-content dark:text-content-inverse">
                    {selectedFixture.filename}
                  </p>
                  <p className="mt-2 text-xs text-content-muted dark:text-content-inverse-muted">
                    Scenario {selectedFixture.scenarioId}
                  </p>
                </div>
                <StatusBadge
                  status={
                    selectedFixture.expectedStatus ??
                    'READY'
                  }
                />
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    Feed
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-content dark:text-content-inverse">
                    {getFeedLabel(selectedFixture.feedType)}
                  </dd>
                </div>
                <div className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    Masked API key ID
                  </dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-content dark:text-content-inverse">
                    {selectedFixture.maskedApiKeyId ?? '—'}
                  </dd>
                </div>
                <div className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    Expected outcome
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-content dark:text-content-inverse">
                    {formatStatus(
                      selectedFixture.expectedStatus,
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div className="mt-5">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="button"
              disabled={
                processing ||
                loadingFixtures ||
                selectedFixture === null
              }
              onClick={() => {
                handleApplyFixture().catch((error) => {
                  setProcessing(false);
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The approved inbound fixture could not be processed.',
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
                <FileCheck2
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {processing
                ? 'Processing locally…'
                : 'Process approved fixture'}
            </button>
          </div>

          {processing ? (
            <div
              className="mt-5"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-content dark:text-content-inverse">
                  Deterministic row processing
                </span>
                <span className="text-content-muted dark:text-content-inverse-muted">
                  Browser-local
                </span>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark"
                role="progressbar"
                aria-label="Inbound fixture processing"
                aria-valuetext="Processing the approved fixture locally"
              >
                <div className="h-full w-full animate-pulse rounded-full bg-primary-600 motion-reduce:animate-none" />
              </div>
            </div>
          ) : null}
        </section>

        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="exact-header-heading"
        >
          <div className="flex items-start gap-3">
            <FileCheck2
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="exact-header-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Exact ordered header
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Column names and order must match exactly.
              </p>
            </div>
          </div>

          <ol className="mt-5 space-y-2">
            {expectedHeader.map((column, index) => (
              <li
                key={column}
                className="flex items-center gap-3 rounded-lg bg-surface-muted px-3 py-2 dark:bg-surface-dark"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 dark:bg-primary-900 dark:text-primary-100"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <code className="break-all text-xs font-semibold text-content dark:text-content-inverse">
                  {column}
                </code>
              </li>
            ))}
          </ol>

          <div className="mt-5 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100">
            <p className="font-semibold">
              Exact-schema validation
            </p>
            <p className="mt-1">
              Missing, reordered, or additional columns reject the
              fixture before any row is applied.
            </p>
          </div>
        </section>
      </div>

      <section
        className="mt-8"
        aria-labelledby={resultsHeadingId}
      >
        <h2
          id={resultsHeadingId}
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Inbound run evidence
        </h2>
        <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
          Each row retains its own outcome. A failed row does not
          roll back rows that were applied successfully.
        </p>

        {visibleRuns.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileSpreadsheet
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No inbound runs displayed
            </h3>
            <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
              Process an approved fixture to create browser-local
              row evidence.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {visibleRuns.map((run, runIndex) => {
              const counts = getRunCounts(run);
              const header = Array.isArray(run.header)
                ? run.header
                : EXPECTED_HEADERS[run.feedType] ?? [];

              return (
                <article
                  key={getRunKey(run, runIndex)}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        {getFeedLabel(run.feedType)} run
                      </p>
                      <h3 className="mt-1 break-all font-mono text-base font-semibold text-content dark:text-content-inverse">
                        {run.feedRunId}
                      </h3>
                      <p className="mt-2 break-all text-sm text-content-muted dark:text-content-inverse-muted">
                        {run.filename ?? 'Approved local fixture'}
                      </p>
                      <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                        Created {formatDateTime(run.createdAt)}
                      </p>
                    </div>
                    <StatusBadge
                      status={run.status ?? 'UNKNOWN'}
                    />
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Rows', counts.total],
                      ['Applied', counts.applied],
                      ['Failed', counts.failed],
                      ['Pending', counts.pending],
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

                  {Array.isArray(run.rows) &&
                  run.rows.length > 0 ? (
                    <div className="mt-5 space-y-3">
                      {run.rows.map((row, rowIndex) => {
                        const key = getCorrectionKey(run, row);
                        const correcting =
                          expandedRetry === key;
                        const pending = retryPending === key;
                        const correctionValues =
                          corrections[key] ??
                          normalizeCorrectionValues(
                            header,
                            row.values,
                          );

                        return (
                          <section
                            key={getRowKey(
                              run,
                              row,
                              rowIndex,
                            )}
                            className="rounded-xl border border-border p-4 dark:border-border-dark"
                            aria-busy={pending}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-content dark:text-content-inverse">
                                  Row{' '}
                                  {row.rowNumber ??
                                    rowIndex + 2}
                                </p>
                                <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                                  Attempt {row.attempt ?? 1}
                                  {row.resultReference
                                    ? ` · Local reference ${row.resultReference}`
                                    : ''}
                                </p>
                              </div>
                              <StatusBadge
                                status={
                                  row.status ?? 'UNKNOWN'
                                }
                              />
                            </div>

                            {isPlainObject(row.values) ? (
                              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {header.map((field) => (
                                  <div
                                    key={field}
                                    className="min-w-0 rounded-lg bg-surface-muted p-3 dark:bg-surface-dark"
                                  >
                                    <dt className="break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                                      {field}
                                    </dt>
                                    <dd className="mt-1 break-all text-sm font-medium text-content dark:text-content-inverse">
                                      {row.values[field] ??
                                        '—'}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}

                            {row.errorCode ? (
                              <div className="mt-4 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100">
                                <p className="font-semibold">
                                  {formatStatus(
                                    row.errorCode,
                                  )}
                                </p>
                                <p className="mt-1 text-xs leading-5">
                                  Correct this fictional row and
                                  retry it independently.
                                </p>
                              </div>
                            ) : null}

                            {row.status === 'FAILED' ? (
                              correcting ? (
                                <div className="mt-4 border-t border-border pt-4 dark:border-border-dark">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <h4 className="font-semibold text-content dark:text-content-inverse">
                                        Correct row values
                                      </h4>
                                      <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
                                        All exact-schema fields
                                        are required.
                                      </p>
                                    </div>
                                    <button
                                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content-muted transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised"
                                      type="button"
                                      aria-label="Close retry controls"
                                      disabled={pending}
                                      onClick={() =>
                                        setExpandedRetry(null)
                                      }
                                    >
                                      <X
                                        className="h-4 w-4"
                                        aria-hidden="true"
                                      />
                                    </button>
                                  </div>

                                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    {header.map((field) => (
                                      <label
                                        key={field}
                                        className="block text-sm font-medium text-content dark:text-content-inverse"
                                      >
                                        <span className="break-all font-mono text-xs">
                                          {field}
                                        </span>
                                        <input
                                          className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                                          type="text"
                                          value={
                                            correctionValues[
                                              field
                                            ] ?? ''
                                          }
                                          disabled={pending}
                                          autoComplete="off"
                                          onChange={(event) => {
                                            setCorrections(
                                              (current) => ({
                                                ...current,
                                                [key]: {
                                                  ...correctionValues,
                                                  [field]:
                                                    event.target
                                                      .value,
                                                },
                                              }),
                                            );
                                            setOperationError(
                                              null,
                                            );
                                          }}
                                        />
                                      </label>
                                    ))}
                                  </div>

                                  <button
                                    className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                    type="button"
                                    disabled={
                                      pending ||
                                      row.attempt >= 3
                                    }
                                    onClick={() => {
                                      handleRetry(
                                        run,
                                        row,
                                      ).catch((error) => {
                                        setOperationError(
                                          normalizeErrorMessage(
                                            error,
                                            'The failed inbound row could not be retried.',
                                          ),
                                        );
                                      });
                                    }}
                                  >
                                    {pending ? (
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
                                    {pending
                                      ? 'Retrying locally…'
                                      : row.attempt >= 3
                                        ? 'Retry limit reached'
                                        : 'Retry corrected row'}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                                  type="button"
                                  disabled={
                                    retryPending !== null ||
                                    row.attempt >= 3
                                  }
                                  onClick={() =>
                                    openRetry(run, row)
                                  }
                                >
                                  <RefreshCw
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                  {row.attempt >= 3
                                    ? 'Retry limit reached'
                                    : 'Correct and retry row'}
                                </button>
                              )
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
                      role="status"
                    >
                      This run contains no row-level evidence.
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Inbound processing disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional inbound processing only
            </p>
            <p className="mt-1 text-sm leading-6">
              AP requests, 835 changes, retries, and CDC records
              are deterministic browser-local demonstrations. No
              accounts-payable, remittance, payer, provider,
              healthcare, payment, file-transfer, or external
              integration system is contacted.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

InboundPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  inboundService: PropTypes.object,
  csvParser: PropTypes.object,
  parser: PropTypes.object,
  initialRuns: PropTypes.arrayOf(PropTypes.object),
  initialFeedType: PropTypes.string,
};

export const InboundOperationsPage = InboundPage;
export const InboundFixturePage = InboundPage;
export const LocalInboundPage = InboundPage;

export default InboundPage;