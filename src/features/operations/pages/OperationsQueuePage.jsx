import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  FileSearch,
  Filter,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareCheckBig,
  X,
} from 'lucide-react';
import { INITIAL_REQUESTS } from '../../../fixtures/operations.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { downloadBlob } from '../../../platform/utils/download.js';
import {
  formatCsv,
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['BOS', 'ADMIN']);
const PROCESSABLE_STATUSES = new Set([
  'PENDING',
  'FAILED',
]);
const EMPTY_COLLECTION = Object.freeze([]);

const STATUS_OPTIONS = Object.freeze([
  'PENDING',
  'PROCESSING',
  'PAUSED',
  'MANUAL_REVIEW',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
]);

const PRIORITY_OPTIONS = Object.freeze([
  'URGENT',
  'HIGH',
  'NORMAL',
]);

const REQUEST_TYPE_OPTIONS = Object.freeze([
  'EOB',
  'EOR',
  'BOTH',
]);

const SORT_OPTIONS = Object.freeze([
  Object.freeze({
    value: 'QUEUE',
    label: 'Queue order',
  }),
  Object.freeze({
    value: 'CREATED_AT',
    label: 'Created time',
  }),
  Object.freeze({
    value: 'PRIORITY',
    label: 'Priority',
  }),
  Object.freeze({
    value: 'STATUS',
    label: 'Status',
  }),
  Object.freeze({
    value: 'DISPLAY_ID',
    label: 'Request ID',
  }),
]);

const PRIORITY_RANKS = Object.freeze({
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
});

const CSV_HEADERS = Object.freeze([
  'display_id',
  'claim_number',
  'request_type',
  'priority',
  'status',
  'created_at',
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

  if (result?.error?.retryable === true) {
    error.retryable = true;
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

function resolveListMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.listRequests === 'function') {
    return service.listRequests.bind(service);
  }

  if (typeof service.list === 'function') {
    return service.list.bind(service);
  }

  return null;
}

function resolveBulkMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.bulkProcess === 'function') {
    return service.bulkProcess.bind(service);
  }

  if (typeof service.process === 'function') {
    return service.process.bind(service);
  }

  return null;
}

function resolveExportMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.exportRows === 'function') {
    return service.exportRows.bind(service);
  }

  if (typeof service.exportQueue === 'function') {
    return service.exportQueue.bind(service);
  }

  if (typeof service.export === 'function') {
    return service.export.bind(service);
  }

  return null;
}

function normalizeRequestCollection(result) {
  const value = unwrapServiceResult(
    result,
    'The browser-local operations queue could not be loaded.',
  );

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.requests)) {
    return value.requests;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(
    'The local queue service returned an invalid request collection.',
  );
}

function normalizeBulkResult(result) {
  const value = unwrapServiceResult(
    result,
    'The selected browser-local requests could not be processed.',
  );

  if (!isPlainObject(value)) {
    throw new TypeError(
      'The local bulk service returned invalid processing evidence.',
    );
  }

  return {
    ...value,
    results: Array.isArray(value.results)
      ? value.results
      : [],
  };
}

function createEmptyFilters() {
  return {
    search: '',
    status: '',
    priority: '',
    requestType: '',
    sortBy: 'QUEUE',
    sortDirection: 'ASC',
  };
}

function normalizeSearchText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
    : '';
}

function requestMatchesFilters(request, filters) {
  if (
    filters.status.length > 0 &&
    request.status !== filters.status
  ) {
    return false;
  }

  if (
    filters.priority.length > 0 &&
    request.priority !== filters.priority
  ) {
    return false;
  }

  if (
    filters.requestType.length > 0 &&
    request.requestType !== filters.requestType
  ) {
    return false;
  }

  const search = normalizeSearchText(filters.search);

  if (search.length === 0) {
    return true;
  }

  return [
    request.requestId,
    request.displayId,
    request.claimNumber,
    request.memberId,
    request.requestType,
    request.priority,
    request.status,
    request.sourceType,
    request.sourceDetail,
  ]
    .filter(
      (value) =>
        value !== null && value !== undefined,
    )
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(search);
}

function compareRequests(left, right, filters) {
  let comparison = 0;

  switch (filters.sortBy) {
    case 'CREATED_AT':
      comparison =
        Date.parse(left.createdAt ?? 0) -
        Date.parse(right.createdAt ?? 0);
      break;
    case 'PRIORITY':
      comparison =
        (PRIORITY_RANKS[left.priority] ??
          Number.MAX_SAFE_INTEGER) -
        (PRIORITY_RANKS[right.priority] ??
          Number.MAX_SAFE_INTEGER);
      break;
    case 'STATUS':
      comparison = String(left.status ?? '').localeCompare(
        String(right.status ?? ''),
        'en-US',
      );
      break;
    case 'DISPLAY_ID':
      comparison = String(
        left.displayId ?? left.requestId ?? '',
      ).localeCompare(
        String(right.displayId ?? right.requestId ?? ''),
        'en-US',
      );
      break;
    case 'QUEUE':
    default:
      comparison =
        (PRIORITY_RANKS[left.priority] ??
          Number.MAX_SAFE_INTEGER) -
        (PRIORITY_RANKS[right.priority] ??
          Number.MAX_SAFE_INTEGER);

      if (comparison === 0) {
        comparison =
          Date.parse(left.createdAt ?? 0) -
          Date.parse(right.createdAt ?? 0);
      }
      break;
  }

  if (comparison === 0) {
    comparison = String(left.requestId ?? '').localeCompare(
      String(right.requestId ?? ''),
      'en-US',
    );
  }

  return filters.sortDirection === 'DESC'
    ? -comparison
    : comparison;
}

function createServiceQuery(filters) {
  return {
    page: 1,
    limit: 200,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
    ...(filters.search.trim().length === 0
      ? {}
      : { search: filters.search.trim() }),
    ...(filters.status.length === 0
      ? {}
      : { statuses: [filters.status] }),
    ...(filters.priority.length === 0
      ? {}
      : { priorities: [filters.priority] }),
    ...(filters.requestType.length === 0
      ? {}
      : { requestTypes: [filters.requestType] }),
  };
}

function createLocalCsvBlob(requests) {
  if (typeof globalThis.Blob !== 'function') {
    throw new Error(
      'Browser Blob APIs are unavailable for local export.',
    );
  }

  const csv = formatCsv(
    [
      CSV_HEADERS,
      ...requests.map((request) => [
        request.displayId ?? request.requestId,
        request.claimNumber,
        request.requestType,
        request.priority,
        request.status,
        request.createdAt,
      ]),
    ],
    {
      formulaSafe: true,
      formulaPrefix: "'",
      lineEnding: '\r\n',
    },
  );

  return new globalThis.Blob([`${csv}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
}

function getRequestKey(request, index) {
  return (
    request.requestId ??
    request.displayId ??
    `operations-request-${index}`
  );
}

function getResultKey(result, index) {
  return (
    result.requestId ??
    `bulk-result-${index}`
  );
}

function getResultSummary(results) {
  return {
    total: results.length,
    complete: results.filter(
      (result) => result.status === 'COMPLETE',
    ).length,
    failed: results.filter(
      (result) => result.status === 'FAILED',
    ).length,
    processing: results.filter(
      (result) =>
        result.status === 'PROCESSING' ||
        result.status === 'RUNNING',
    ).length,
  };
}

/**
 * Filterable browser-local operations queue with bulk processing and export.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   bulkOperationService?: object,
 *   queueService?: object,
 *   requestService?: object,
 *   initialRequests?: readonly Record<string, unknown>[],
 *   initialFilters?: Record<string, unknown>|null,
 *   onNavigate?: Function,
 *   onBulkCompleted?: Function,
 *   onExported?: Function
 * }} props Component props.
 * @returns {JSX.Element} Operations queue page.
 */
export function OperationsQueuePage({
  session = null,
  context = null,
  bulkOperationService = null,
  queueService = null,
  requestService = null,
  initialRequests = INITIAL_REQUESTS,
  initialFilters = null,
  onNavigate,
  onBulkCompleted,
  onExported,
}) {
  const headingId = useId();
  const searchId = useId();
  const statusId = useId();
  const priorityId = useId();
  const requestTypeId = useId();
  const sortById = useId();
  const sortDirectionId = useId();
  const selectAllId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service =
    bulkOperationService ??
    queueService ??
    requestService;
  const listRequests = useMemo(
    () => resolveListMethod(service),
    [service],
  );
  const bulkProcess = useMemo(
    () => resolveBulkMethod(service),
    [service],
  );
  const exportRows = useMemo(
    () => resolveExportMethod(service),
    [service],
  );
  const initialFilterState = useMemo(
    () => ({
      ...createEmptyFilters(),
      ...(isPlainObject(initialFilters)
        ? initialFilters
        : {}),
    }),
    [initialFilters],
  );
  const [filterValues, setFilterValues] = useState(
    initialFilterState,
  );
  const [appliedFilters, setAppliedFilters] = useState(
    initialFilterState,
  );
  const [requests, setRequests] = useState(initialRequests);
  const [selectedRequestIds, setSelectedRequestIds] =
    useState([]);
  const [bulkResults, setBulkResults] = useState([]);
  const [loading, setLoading] = useState(
    listRequests !== null,
  );
  const [bulkPending, setBulkPending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [navigationPending, setNavigationPending] =
    useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [reloadSequence, setReloadSequence] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (listRequests === null) {
        setRequests(initialRequests);
        setLoading(false);
        return;
      }

      setLoading(true);
      setOperationError(null);

      try {
        const result = await Promise.resolve(
          listRequests(
            createServiceQuery(appliedFilters),
            accessContext,
          ),
        );
        const loadedRequests =
          normalizeRequestCollection(result);

        if (active) {
          setRequests(loadedRequests);
          setSelectedRequestIds((current) =>
            current.filter((requestId) =>
              loadedRequests.some(
                (request) =>
                  request.requestId === requestId,
              ),
            ),
          );
        }
      } catch (error) {
        if (active) {
          setRequests([]);
          setOperationError(
            normalizeErrorMessage(
              error,
              'The browser-local operations queue could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load().catch((error) => {
      if (active) {
        setLoading(false);
        setRequests([]);
        setOperationError(
          normalizeErrorMessage(
            error,
            'The browser-local operations queue could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    appliedFilters,
    authenticated,
    initialRequests,
    listRequests,
    reloadSequence,
    role,
  ]);

  const visibleRequests = useMemo(
    () =>
      requests
        .filter((request) =>
          requestMatchesFilters(request, appliedFilters),
        )
        .sort((left, right) =>
          compareRequests(left, right, appliedFilters),
        ),
    [appliedFilters, requests],
  );

  const visibleRequestIds = useMemo(
    () =>
      visibleRequests
        .map((request) => request.requestId)
        .filter(
          (requestId) =>
            typeof requestId === 'string' &&
            requestId.length > 0,
        ),
    [visibleRequests],
  );

  const selectedRequests = useMemo(
    () =>
      requests.filter((request) =>
        selectedRequestIds.includes(request.requestId),
      ),
    [requests, selectedRequestIds],
  );

  const selectedEligible = selectedRequests.filter(
    (request) =>
      PROCESSABLE_STATUSES.has(request.status),
  );
  const selectedBlocked =
    selectedRequests.length - selectedEligible.length;
  const selectedUrgent = selectedRequests.filter(
    (request) => request.priority === 'URGENT',
  ).length;
  const allVisibleSelected =
    visibleRequestIds.length > 0 &&
    visibleRequestIds.every((requestId) =>
      selectedRequestIds.includes(requestId),
    );
  const someVisibleSelected =
    !allVisibleSelected &&
    visibleRequestIds.some((requestId) =>
      selectedRequestIds.includes(requestId),
    );
  const resultSummary = getResultSummary(bulkResults);
  const filtersActive =
    appliedFilters.search.trim().length > 0 ||
    appliedFilters.status.length > 0 ||
    appliedFilters.priority.length > 0 ||
    appliedFilters.requestType.length > 0 ||
    appliedFilters.sortBy !== 'QUEUE' ||
    appliedFilters.sortDirection !== 'ASC';

  const updateFilter = (field, value) => {
    setFilterValues((current) => ({
      ...current,
      [field]: value,
    }));
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleApplyFilters = (event) => {
    event.preventDefault();
    setAppliedFilters({
      ...filterValues,
      search: filterValues.search.normalize('NFKC').trim(),
    });
    setSelectedRequestIds([]);
    setBulkResults([]);
    setOperationError(null);
    setOperationMessage(null);
  };

  const clearFilters = () => {
    const empty = createEmptyFilters();

    setFilterValues(empty);
    setAppliedFilters(empty);
    setSelectedRequestIds([]);
    setBulkResults([]);
    setOperationError(null);
    setOperationMessage(null);
  };

  const toggleRequest = (requestId) => {
    setSelectedRequestIds((current) =>
      current.includes(requestId)
        ? current.filter(
            (identifier) => identifier !== requestId,
          )
        : [...current, requestId],
    );
    setBulkResults([]);
    setOperationError(null);
    setOperationMessage(null);
  };

  const toggleAllVisible = () => {
    setSelectedRequestIds((current) => {
      if (allVisibleSelected) {
        return current.filter(
          (requestId) =>
            !visibleRequestIds.includes(requestId),
        );
      }

      return [
        ...new Set([
          ...current,
          ...visibleRequestIds,
        ]),
      ];
    });
    setBulkResults([]);
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleBulkProcess = async () => {
    if (selectedRequestIds.length === 0) {
      setOperationError(
        'Select at least one browser-local request.',
      );
      return;
    }

    if (bulkProcess === null) {
      setOperationError(
        'Bulk request processing is unavailable in this application composition.',
      );
      return;
    }

    setBulkPending(true);
    setBulkResults([]);
    setOperationError(null);
    setOperationMessage(null);

    const command = {
      requestIds: selectedRequestIds,
      action: 'PROCESS',
      scenario: 'SUCCESS',
      mode: 'IMMEDIATE',
      idempotencyKey: generateUuid(),
    };

    try {
      const result = await Promise.resolve(
        bulkProcess(command, accessContext),
      );
      const data = normalizeBulkResult(result);

      setBulkResults(data.results);
      setOperationMessage(
        `${data.results.length} selected ${
          data.results.length === 1
            ? 'request was'
            : 'requests were'
        } evaluated independently. ${
          data.results.filter(
            (row) => row.status === 'COMPLETE',
          ).length
        } completed and ${
          data.results.filter(
            (row) => row.status === 'FAILED',
          ).length
        } retained an exception.`,
      );

      if (typeof onBulkCompleted === 'function') {
        await Promise.resolve(
          onBulkCompleted(data, result, command),
        );
      }

      setReloadSequence((current) => current + 1);
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The selected browser-local requests could not be processed.',
        ),
      );
    } finally {
      setBulkPending(false);
    }
  };

  const handleExport = async () => {
    if (visibleRequests.length === 0) {
      setOperationError(
        'There are no current queue rows to export.',
      );
      return;
    }

    setExportPending(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      let descriptor;
      let serviceResult = null;

      if (exportRows !== null) {
        serviceResult = await Promise.resolve(
          exportRows(
            {
              filters: createServiceQuery(appliedFilters),
              filename: 'operations-queue-demo.csv',
            },
            accessContext,
          ),
        );
        descriptor = unwrapServiceResult(
          serviceResult,
          'The current operations queue rows could not be exported.',
        );
      } else {
        descriptor = {
          blob: createLocalCsvBlob(visibleRequests),
          filename: 'operations-queue-demo.csv',
          rowCount: visibleRequests.length,
          localOnly: true,
          transmitted: false,
        };
      }

      if (
        !isPlainObject(descriptor) ||
        typeof descriptor.filename !== 'string' ||
        typeof globalThis.Blob !== 'function' ||
        !(descriptor.blob instanceof globalThis.Blob)
      ) {
        throw new Error(
          'The local queue service returned an invalid export descriptor.',
        );
      }

      downloadBlob(
        descriptor.blob,
        descriptor.filename,
        {
          cleanupDelayMs: 0,
        },
      );

      setOperationMessage(
        `${descriptor.rowCount ?? visibleRequests.length} current fictional queue ${
          (descriptor.rowCount ?? visibleRequests.length) === 1
            ? 'row was'
            : 'rows were'
        } exported locally. No external system was contacted.`,
      );

      if (typeof onExported === 'function') {
        await Promise.resolve(
          onExported(
            descriptor,
            visibleRequests,
            serviceResult,
          ),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The current operations queue rows could not be exported.',
        ),
      );
    } finally {
      setExportPending(false);
    }
  };

  const handleNavigation = async (
    event,
    request,
    key,
  ) => {
    if (typeof onNavigate !== 'function') {
      return;
    }

    event.preventDefault();
    setNavigationPending(key);
    setOperationError(null);

    const href =
      `/operations/requests/${encodeURIComponent(
        request.requestId ?? '',
      )}`;

    try {
      await Promise.resolve(
        onNavigate(
          {
            type: 'REPRINT_REQUEST',
            href,
            requestId: request.requestId,
            request,
          },
          event,
        ),
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The selected browser-local request could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
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
            <ClipboardList
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Browser-local operations
            </p>
            <h1
              id={headingId}
              className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              Reprint request queue
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Filter, sort, select, and independently process
              fictional request rows. Exported queue data remains
              in your browser.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Operations queue disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Local queue simulation only
            </p>
            <p className="mt-1 leading-6">
              Queue filters, processing results, selections, and
              exports use deterministic browser-local data. No
              payer, provider, healthcare, payment, reporting,
              delivery, queue, or integration system is contacted.
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
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="queue-filters-heading"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Filter
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="queue-filters-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Queue filters and sorting
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Apply filters before selecting rows for processing.
              </p>
            </div>
          </div>

          {filtersActive ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse"
              type="button"
              disabled={loading || bulkPending}
              onClick={clearFilters}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </button>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={handleApplyFilters}
        >
          <div className="sm:col-span-2 lg:col-span-3">
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={searchId}
            >
              Search queue
            </label>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <input
                id={searchId}
                className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="search"
                value={filterValues.search}
                maxLength={200}
                autoComplete="off"
                placeholder="Request, claim, member, source, or status"
                disabled={loading || bulkPending}
                onChange={(event) =>
                  updateFilter('search', event.target.value)
                }
              />
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={statusId}
            >
              Status
            </label>
            <select
              id={statusId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.status}
              disabled={loading || bulkPending}
              onChange={(event) =>
                updateFilter('status', event.target.value)
              }
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={priorityId}
            >
              Priority
            </label>
            <select
              id={priorityId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.priority}
              disabled={loading || bulkPending}
              onChange={(event) =>
                updateFilter('priority', event.target.value)
              }
            >
              <option value="">All priorities</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {formatStatus(priority)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={requestTypeId}
            >
              Document request
            </label>
            <select
              id={requestTypeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.requestType}
              disabled={loading || bulkPending}
              onChange={(event) =>
                updateFilter(
                  'requestType',
                  event.target.value,
                )
              }
            >
              <option value="">EOB, EOR, and both</option>
              {REQUEST_TYPE_OPTIONS.map((requestType) => (
                <option key={requestType} value={requestType}>
                  {formatStatus(requestType)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={sortById}
            >
              Sort by
            </label>
            <select
              id={sortById}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.sortBy}
              disabled={loading || bulkPending}
              onChange={(event) =>
                updateFilter('sortBy', event.target.value)
              }
            >
              {SORT_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={sortDirectionId}
            >
              Direction
            </label>
            <select
              id={sortDirectionId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.sortDirection}
              disabled={loading || bulkPending}
              onChange={(event) =>
                updateFilter(
                  'sortDirection',
                  event.target.value,
                )
              }
            >
              <option value="ASC">Ascending</option>
              <option value="DESC">Descending</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
              type="submit"
              disabled={loading || bulkPending}
            >
              {loading ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Filter
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {loading ? 'Loading queue…' : 'Apply filters'}
            </button>
          </div>
        </form>
      </section>

      <section
        className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-labelledby="queue-scorecard-heading"
      >
        <h2 id="queue-scorecard-heading" className="sr-only">
          Selection validation scorecard
        </h2>

        <article className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
          <p className="text-sm font-semibold text-content-muted dark:text-content-inverse-muted">
            Selected rows
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {selectedRequests.length}
          </p>
          <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
            Across the current loaded queue
          </p>
        </article>

        <article className="rounded-xl border border-success-200 bg-success-50 p-5 shadow-card dark:border-success-700 dark:bg-surface-dark-muted">
          <p className="text-sm font-semibold text-success-700 dark:text-success-100">
            Processable
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {selectedEligible.length}
          </p>
          <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
            Pending or failed requests
          </p>
        </article>

        <article className="rounded-xl border border-warning-200 bg-warning-50 p-5 shadow-card dark:border-warning-700 dark:bg-warning-950">
          <p className="text-sm font-semibold text-warning-700 dark:text-warning-100">
            Ineligible state
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {selectedBlocked}
          </p>
          <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
            Still returned as independent row results
          </p>
        </article>

        <article className="rounded-xl border border-danger-200 bg-danger-50 p-5 shadow-card dark:border-danger-700 dark:bg-danger-950">
          <p className="text-sm font-semibold text-danger-700 dark:text-danger-100">
            Urgent selected
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-content dark:text-content-inverse">
            {selectedUrgent}
          </p>
          <p className="mt-1 text-xs text-content-muted dark:text-content-inverse-muted">
            Priority does not bypass validation
          </p>
        </article>
      </section>

      <section
        className="mt-8"
        aria-labelledby="operations-queue-heading"
        aria-busy={loading || bulkPending}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2
              id="operations-queue-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Current queue rows
            </h2>
            <p
              className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted"
              aria-live="polite"
            >
              {loading
                ? 'Loading authorized browser-local requests.'
                : `${visibleRequests.length} authorized ${
                    visibleRequests.length === 1
                      ? 'row'
                      : 'rows'
                  } displayed; ${selectedRequests.length} selected.`}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised"
              type="button"
              disabled={
                loading ||
                bulkPending ||
                visibleRequests.length === 0
              }
              onClick={() =>
                setReloadSequence((current) => current + 1)
              }
            >
              <RefreshCw
                className="h-4 w-4"
                aria-hidden="true"
              />
              Refresh queue
            </button>

            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised"
              type="button"
              disabled={
                loading ||
                exportPending ||
                visibleRequests.length === 0
              }
              onClick={() => {
                handleExport().catch((error) => {
                  setExportPending(false);
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The current operations queue rows could not be exported.',
                    ),
                  );
                });
              }}
            >
              {exportPending ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Download
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {exportPending
                ? 'Creating export…'
                : 'Export current rows'}
            </button>

            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
              type="button"
              disabled={
                loading ||
                bulkPending ||
                selectedRequestIds.length === 0
              }
              onClick={() => {
                handleBulkProcess().catch((error) => {
                  setBulkPending(false);
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The selected browser-local requests could not be processed.',
                    ),
                  );
                });
              }}
            >
              {bulkPending ? (
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
              {bulkPending
                ? 'Processing independently…'
                : `Process selected (${selectedRequestIds.length})`}
            </button>
          </div>
        </div>

        {!loading && visibleRequests.length > 0 ? (
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-card dark:border-border-dark dark:bg-surface-dark-muted">
            <label
              className="inline-flex min-h-10 cursor-pointer items-center gap-3 text-sm font-semibold text-content dark:text-content-inverse"
              htmlFor={selectAllId}
            >
              <input
                id={selectAllId}
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                type="checkbox"
                checked={allVisibleSelected}
                ref={(element) => {
                  if (element !== null) {
                    element.indeterminate =
                      someVisibleSelected;
                  }
                }}
                disabled={bulkPending}
                onChange={toggleAllVisible}
              />
              Select all current rows
            </label>
            <span className="text-xs text-content-subtle dark:text-content-inverse-muted">
              {visibleRequestIds.length} selectable
            </span>
          </div>
        ) : null}

        {loading ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <Loader2
              className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-content dark:text-content-inverse">
              Loading browser-local request rows
            </p>
          </div>
        ) : null}

        {!loading && visibleRequests.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileSearch
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No authorized queue rows found
            </h3>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Adjust or clear the filters to view other
              browser-local fictional requests.
            </p>
          </div>
        ) : null}

        {!loading && visibleRequests.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {visibleRequests.map((request, index) => {
              const requestId = request.requestId ?? '';
              const selected =
                selectedRequestIds.includes(requestId);
              const processable =
                PROCESSABLE_STATUSES.has(request.status);
              const href =
                `/operations/requests/${encodeURIComponent(
                  requestId,
                )}`;
              const navigationKey = `request-${requestId}`;
              const opening =
                navigationPending === navigationKey;

              return (
                <article
                  key={getRequestKey(request, index)}
                  className={`rounded-xl border p-5 shadow-card transition dark:bg-surface-dark-muted ${
                    selected
                      ? 'border-primary-400 bg-primary-50 dark:border-primary-700 dark:bg-primary-950'
                      : 'border-border bg-surface dark:border-border-dark'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      className="mt-1 h-4 w-4 shrink-0 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                      type="checkbox"
                      checked={selected}
                      disabled={
                        bulkPending ||
                        requestId.length === 0
                      }
                      aria-label={`Select request ${
                        request.displayId ?? requestId
                      }`}
                      onChange={() =>
                        toggleRequest(requestId)
                      }
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                            Reprint request
                          </p>
                          <h3 className="mt-1 break-all font-mono text-base font-semibold text-content dark:text-content-inverse">
                            {request.displayId ??
                              requestId ??
                              'Local request'}
                          </h3>
                          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                            Claim{' '}
                            <span className="font-mono font-medium">
                              {request.claimNumber ?? 'Restricted'}
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge
                            status={request.priority ?? 'NORMAL'}
                            variant={
                              request.priority === 'URGENT'
                                ? 'error'
                                : request.priority === 'HIGH'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          />
                          <StatusBadge
                            status={request.status ?? 'UNKNOWN'}
                          />
                        </div>
                      </div>

                      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Member
                          </dt>
                          <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                            {request.memberId ?? 'Restricted'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Type
                          </dt>
                          <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                            {formatStatus(
                              request.requestType,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Source
                          </dt>
                          <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                            {formatStatus(
                              request.sourceType,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Created
                          </dt>
                          <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                            {formatDateTime(
                              request.createdAt,
                            )}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 dark:border-border-dark sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-2 text-xs">
                          {processable ? (
                            <SquareCheckBig
                              className="h-4 w-4 shrink-0 text-success-700 dark:text-success-100"
                              aria-hidden="true"
                            />
                          ) : (
                            <ShieldAlert
                              className="h-4 w-4 shrink-0 text-warning-700 dark:text-warning-100"
                              aria-hidden="true"
                            />
                          )}
                          <span className="text-content-muted dark:text-content-inverse-muted">
                            {processable
                              ? 'Eligible for independent bulk processing.'
                              : 'Current state is not processable; bulk evaluation retains an independent error result.'}
                          </span>
                        </div>

                        <a
                          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                          href={href}
                          aria-busy={opening}
                          onClick={(event) => {
                            handleNavigation(
                              event,
                              request,
                              navigationKey,
                            ).catch((error) => {
                              setOperationError(
                                normalizeErrorMessage(
                                  error,
                                  'The selected browser-local request could not be opened.',
                                ),
                              );
                            });
                          }}
                        >
                          {opening
                            ? 'Opening…'
                            : 'Open request'}
                          {opening ? (
                            <Loader2
                              className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                          )}
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      {bulkResults.length > 0 ? (
        <section
          className="mt-8"
          aria-labelledby="bulk-results-heading"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="bulk-results-heading"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                Independent bulk results
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Every selected request retains its own outcome;
                one failure does not replace another row&apos;s
                successful result.
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ['Evaluated', resultSummary.total],
              ['Complete', resultSummary.complete],
              [
                'Failed or ineligible',
                resultSummary.failed,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  {label}
                </dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums text-content dark:text-content-inverse">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {bulkResults.map((result, index) => {
              const sourceRequest = requests.find(
                (request) =>
                  request.requestId === result.requestId,
              );

              return (
                <article
                  key={getResultKey(result, index)}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Bulk row result
                      </p>
                      <h3 className="mt-1 break-all font-mono text-sm font-semibold text-content dark:text-content-inverse">
                        {sourceRequest?.displayId ??
                          result.requestId ??
                          `Result ${index + 1}`}
                      </h3>
                    </div>
                    <StatusBadge
                      status={result.status ?? 'UNKNOWN'}
                    />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Claim
                      </dt>
                      <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                        {sourceRequest?.claimNumber ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Error code
                      </dt>
                      <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                        {result.errorCode
                          ? formatStatus(result.errorCode)
                          : 'None'}
                      </dd>
                    </div>
                  </dl>

                  {Array.isArray(result.documentIds) &&
                  result.documentIds.length > 0 ? (
                    <p className="mt-4 text-xs text-content-muted dark:text-content-inverse-muted">
                      Representative documents:{' '}
                      <span className="font-mono font-semibold text-content dark:text-content-inverse">
                        {result.documentIds.length}
                      </span>
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Bulk operations disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional queue processing only
            </p>
            <p className="mt-1 text-sm leading-6">
              Queue ordering, eligibility, bulk outcomes,
              documents, errors, and exported CSV rows are
              deterministic browser-local demonstration evidence.
              They do not represent authoritative healthcare,
              coverage, payment, benefit, appeal, reporting,
              delivery, or transmission results.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

OperationsQueuePage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  bulkOperationService: PropTypes.object,
  queueService: PropTypes.object,
  requestService: PropTypes.object,
  initialRequests: PropTypes.arrayOf(PropTypes.object),
  initialFilters: PropTypes.object,
  onNavigate: PropTypes.func,
  onBulkCompleted: PropTypes.func,
  onExported: PropTypes.func,
};

export const QueuePage = OperationsQueuePage;
export const BulkOperationsQueuePage = OperationsQueuePage;
export const LocalOperationsQueuePage = OperationsQueuePage;

export default OperationsQueuePage;