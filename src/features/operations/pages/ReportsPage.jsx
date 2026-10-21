import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  CalendarDays,
  ChevronRight,
  Download,
  FileSearch,
  FileText,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { downloadStaticAsset } from '../../../platform/utils/download.js';
import {
  formatDate,
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EMPTY_COLLECTION = Object.freeze([]);
const REPORT_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
]);
const DOCUMENT_TYPES = new Set(['EOB', 'EOR']);

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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim().toUpperCase()
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

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeReportCollection(result) {
  const value = unwrapServiceResult(
    result,
    'Completed representative reports could not be loaded.',
  );

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.reports)) {
    return value.reports;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(
    'The local report provider returned an invalid collection.',
  );
}

function resolveListMethod(provider) {
  if (provider === null || provider === undefined) {
    return null;
  }

  if (typeof provider.listCompletedReports === 'function') {
    return provider.listCompletedReports.bind(provider);
  }

  if (typeof provider.getCompletedReports === 'function') {
    return provider.getCompletedReports.bind(provider);
  }

  if (typeof provider.provideCompletedReports === 'function') {
    return provider.provideCompletedReports.bind(provider);
  }

  if (typeof provider.listReports === 'function') {
    return provider.listReports.bind(provider);
  }

  return null;
}

function resolveDownloadMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.downloadDocument === 'function') {
    return service.downloadDocument.bind(service);
  }

  if (typeof service.download === 'function') {
    return service.download.bind(service);
  }

  return null;
}

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toUpperCase()
    : '';
}

function normalizeDateFilter(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return '';
  }

  const normalized = value.trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalized
    : '';
}

function createEmptyFilters(memberId = '') {
  return {
    documentType: '',
    claimNumber: '',
    memberId,
    completedFrom: '',
    completedTo: '',
    version: '',
  };
}

function normalizeFilters(filters, ownedMemberId) {
  const documentType =
    typeof filters.documentType === 'string'
      ? filters.documentType.trim().toUpperCase()
      : '';
  const version =
    filters.version === '' ? null : Number(filters.version);

  return {
    documentType: DOCUMENT_TYPES.has(documentType)
      ? documentType
      : '',
    claimNumber: normalizeIdentifier(filters.claimNumber),
    memberId:
      ownedMemberId.length > 0
        ? ownedMemberId
        : normalizeIdentifier(filters.memberId),
    completedFrom: normalizeDateFilter(
      filters.completedFrom,
    ),
    completedTo: normalizeDateFilter(filters.completedTo),
    version:
      Number.isSafeInteger(version) && version >= 1
        ? version
        : null,
  };
}

function getReportId(report) {
  const value =
    report.reportId ??
    report.documentId;

  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

function getReportKey(report, index) {
  return getReportId(report) || `completed-report-${index}`;
}

function getReportTitle(report) {
  if (
    typeof report.documentTitle === 'string' &&
    report.documentTitle.trim().length > 0
  ) {
    return report.documentTitle;
  }

  return report.documentType === 'EOR'
    ? 'Explanation of Review'
    : 'Explanation of Benefits';
}

function getCompletionTimestamp(report) {
  return (
    report.completedAt ??
    report.createdAt ??
    report.documentDate ??
    null
  );
}

function getDateOnly(value) {
  if (typeof value !== 'string') {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : null;
}

function isMaskedIdentifier(value) {
  return (
    typeof value === 'string' &&
    (value.includes('*') ||
      value.startsWith('[REDACTED'))
  );
}

function matchesIdentifier(value, expected) {
  if (expected.length === 0) {
    return true;
  }

  if (isMaskedIdentifier(value)) {
    return true;
  }

  return normalizeIdentifier(value) === expected;
}

function reportMatchesFilters(report, filters) {
  if (
    filters.documentType.length > 0 &&
    report.documentType !== filters.documentType
  ) {
    return false;
  }

  if (
    !matchesIdentifier(
      report.claimNumber,
      filters.claimNumber,
    )
  ) {
    return false;
  }

  if (
    !matchesIdentifier(report.memberId, filters.memberId)
  ) {
    return false;
  }

  if (
    filters.version !== null &&
    report.version !== filters.version
  ) {
    return false;
  }

  const completedDate = getDateOnly(
    getCompletionTimestamp(report),
  );

  if (
    filters.completedFrom.length > 0 &&
    (completedDate === null ||
      completedDate < filters.completedFrom)
  ) {
    return false;
  }

  if (
    filters.completedTo.length > 0 &&
    (completedDate === null ||
      completedDate > filters.completedTo)
  ) {
    return false;
  }

  return true;
}

function compareReports(left, right) {
  const completionDifference =
    Date.parse(getCompletionTimestamp(right) ?? 0) -
    Date.parse(getCompletionTimestamp(left) ?? 0);

  if (
    Number.isFinite(completionDifference) &&
    completionDifference !== 0
  ) {
    return completionDifference;
  }

  const dateComparison = String(
    right.documentDate ?? '',
  ).localeCompare(String(left.documentDate ?? ''));

  if (dateComparison !== 0) {
    return dateComparison;
  }

  const versionComparison =
    (right.version ?? 0) - (left.version ?? 0);

  if (versionComparison !== 0) {
    return versionComparison;
  }

  return getReportId(left).localeCompare(
    getReportId(right),
    'en-US',
  );
}

function createProviderQuery(filters) {
  return {
    limit: 200,
    ...(filters.documentType.length === 0
      ? {}
      : { documentType: filters.documentType }),
    ...(filters.claimNumber.length === 0
      ? {}
      : { claimNumber: filters.claimNumber }),
    ...(filters.memberId.length === 0
      ? {}
      : { memberId: filters.memberId }),
  };
}

/**
 * Completed browser-local report portal with role-scoped filters and
 * representative document downloads.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   completedReportProvider?: object,
 *   reportProvider?: object,
 *   reportService?: object,
 *   documentService?: object,
 *   documentVersionService?: object,
 *   initialReports?: readonly Record<string, unknown>[],
 *   initialFilters?: Record<string, unknown>,
 *   onNavigate?: Function,
 *   onDownloaded?: Function
 * }} props Component props.
 * @returns {JSX.Element} Completed reports page.
 */
export function ReportsPage({
  session = null,
  context = null,
  completedReportProvider = null,
  reportProvider = null,
  reportService = null,
  documentService = null,
  documentVersionService = null,
  initialReports = EMPTY_COLLECTION,
  initialFilters = null,
  onNavigate,
  onDownloaded,
}) {
  const headingId = useId();
  const documentTypeId = useId();
  const claimNumberId = useId();
  const memberIdInput = useId();
  const completedFromId = useId();
  const completedToId = useId();
  const versionId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const ownedMemberId =
    role === 'MEMBER'
      ? accessContext?.memberId ?? ''
      : '';
  const resolvedReportProvider =
    completedReportProvider ??
    reportProvider ??
    reportService;
  const resolvedDocumentService =
    documentService ??
    documentVersionService ??
    reportService;
  const initialFilterValues = useMemo(
    () => ({
      ...createEmptyFilters(ownedMemberId),
      ...(isPlainObject(initialFilters)
        ? initialFilters
        : {}),
      ...(ownedMemberId.length > 0
        ? { memberId: ownedMemberId }
        : {}),
    }),
    [initialFilters, ownedMemberId],
  );
  const [filterValues, setFilterValues] = useState(
    initialFilterValues,
  );
  const [appliedFilters, setAppliedFilters] = useState(() =>
    normalizeFilters(initialFilterValues, ownedMemberId),
  );
  const [reports, setReports] = useState(initialReports);
  const [loading, setLoading] = useState(
    initialReports.length === 0,
  );
  const [loadError, setLoadError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [downloadPending, setDownloadPending] =
    useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);

  useEffect(() => {
    setFilterValues((current) => ({
      ...current,
      ...(ownedMemberId.length > 0
        ? { memberId: ownedMemberId }
        : {}),
    }));
  }, [ownedMemberId]);

  useEffect(() => {
    let active = true;

    const loadReports = async () => {
      if (
        !authenticated ||
        role === null ||
        !REPORT_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (initialReports.length > 0) {
        setReports(initialReports);
        setLoading(false);
        setLoadError(null);
        return;
      }

      const listReports = resolveListMethod(
        resolvedReportProvider,
      );

      if (listReports === null) {
        setReports([]);
        setLoading(false);
        setLoadError(
          'Completed report listing is unavailable in this application composition.',
        );
        return;
      }

      setLoading(true);
      setLoadError(null);
      setOperationError(null);
      setOperationMessage(null);

      try {
        const result = await Promise.resolve(
          listReports(
            accessContext,
            createProviderQuery(appliedFilters),
          ),
        );
        const loadedReports =
          normalizeReportCollection(result);

        if (active) {
          setReports(loadedReports);
        }
      } catch (error) {
        if (active) {
          setReports([]);
          setLoadError(
            normalizeErrorMessage(
              error,
              'Completed representative reports could not be loaded from browser-local data.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadReports().catch((error) => {
      if (active) {
        setLoading(false);
        setReports([]);
        setLoadError(
          normalizeErrorMessage(
            error,
            'Completed representative reports could not be loaded from browser-local data.',
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
    initialReports,
    resolvedReportProvider,
    role,
  ]);

  const visibleReports = useMemo(
    () =>
      reports
        .filter((report) =>
          reportMatchesFilters(report, appliedFilters),
        )
        .sort(compareReports),
    [appliedFilters, reports],
  );

  const handleFilterChange = (field, value) => {
    setFilterValues((current) => ({
      ...current,
      [field]: value,
    }));
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleSearch = (event) => {
    event.preventDefault();

    const normalized = normalizeFilters(
      filterValues,
      ownedMemberId,
    );

    if (
      normalized.completedFrom.length > 0 &&
      normalized.completedTo.length > 0 &&
      normalized.completedFrom > normalized.completedTo
    ) {
      setOperationError(
        'Completion time from must not be after completion time to.',
      );
      return;
    }

    if (
      filterValues.version !== '' &&
      normalized.version === null
    ) {
      setOperationError(
        'Version must be a positive whole number.',
      );
      return;
    }

    setOperationError(null);
    setOperationMessage(null);
    setAppliedFilters(normalized);
  };

  const clearFilters = () => {
    const emptyFilters = createEmptyFilters(ownedMemberId);

    setFilterValues(emptyFilters);
    setAppliedFilters(
      normalizeFilters(emptyFilters, ownedMemberId),
    );
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleNavigation = async (
    event,
    report,
    key,
  ) => {
    const reportId = getReportId(report);

    if (reportId.length === 0) {
      event.preventDefault();
      setOperationError(
        'The representative report does not contain a document identifier.',
      );
      return;
    }

    if (typeof onNavigate !== 'function') {
      return;
    }

    event.preventDefault();
    setNavigationPending(key);
    setOperationError(null);
    setOperationMessage(null);

    const href = `/documents/${encodeURIComponent(reportId)}`;

    try {
      await Promise.resolve(
        onNavigate(
          {
            type: 'DOCUMENT',
            href,
            documentId: reportId,
            report,
          },
          event,
        ),
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The representative report could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  const handleDownload = async (report) => {
    const reportId = getReportId(report);

    if (reportId.length === 0) {
      setOperationError(
        'The representative report does not contain a document identifier.',
      );
      return;
    }

    if (
      role === 'MEMBER' &&
      (ownedMemberId.length === 0 ||
        normalizeIdentifier(report.memberId) !==
          ownedMemberId)
    ) {
      setOperationError(
        'This representative report is unavailable for the current demo member.',
      );
      return;
    }

    const downloadDocument = resolveDownloadMethod(
      resolvedDocumentService,
    );

    if (downloadDocument === null) {
      setOperationError(
        'Representative report download is unavailable in this application composition.',
      );
      return;
    }

    setDownloadPending(reportId);
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        downloadDocument(
          { documentId: reportId },
          accessContext,
        ),
      );
      const descriptor = unwrapServiceResult(
        result,
        'The representative report could not be prepared for download.',
      );

      if (
        !isPlainObject(descriptor) ||
        typeof descriptor.assetUrl !== 'string' ||
        typeof descriptor.filename !== 'string'
      ) {
        throw new Error(
          'The local document service returned an invalid download descriptor.',
        );
      }

      if (
        typeof descriptor.documentId === 'string' &&
        descriptor.documentId !== reportId
      ) {
        throw new Error(
          'The local document service returned a mismatched download descriptor.',
        );
      }

      if (
        role === 'MEMBER' &&
        typeof descriptor.memberId === 'string' &&
        normalizeIdentifier(descriptor.memberId) !==
          ownedMemberId
      ) {
        throw new Error(
          'The local document service returned a report for another demo member.',
        );
      }

      downloadStaticAsset(
        {
          assetUrl: descriptor.assetUrl,
          filename: descriptor.filename,
        },
        {
          openInNewTab: false,
        },
      );

      setOperationMessage(
        'The representative static report download was started locally.',
      );

      if (typeof onDownloaded === 'function') {
        await Promise.resolve(
          onDownloaded(descriptor, report, result),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The representative report could not be downloaded.',
        ),
      );
    } finally {
      setDownloadPending(null);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (
    role === null ||
    !REPORT_ROLES.has(role) ||
    (role === 'MEMBER' && ownedMemberId.length === 0)
  ) {
    return <AccessDenied authenticated />;
  }

  const filtersActive =
    appliedFilters.documentType.length > 0 ||
    appliedFilters.claimNumber.length > 0 ||
    (role !== 'MEMBER' &&
      appliedFilters.memberId.length > 0) ||
    appliedFilters.completedFrom.length > 0 ||
    appliedFilters.completedTo.length > 0 ||
    appliedFilters.version !== null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="flex items-start gap-4 px-5 py-6 sm:px-7 sm:py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <FileText
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Completed local mock-IXIT reports
            </p>
            <h1
              id={headingId}
              className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              Representative report portal
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Filter completed fictional EOB and EOR report
              metadata, open authorized document versions, and
              download approved same-origin static samples.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Completed report disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Browser-local report metadata
            </p>
            <p className="mt-1 leading-6">
              Mock IXIT, delivery, and report statuses are local
              projections only. No payer, provider, healthcare,
              reporting, document-delivery, payment, email, CRM,
              fax, or IXIT system is contacted.
            </p>
            <p className="mt-1 text-xs leading-5">
              Downloads are representative static samples with
              fictional data and are not authoritative claim
              documents.
            </p>
          </div>
        </div>
      </aside>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="report-filters-heading"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="report-filters-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Report filters
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Filter by document type, claim, member, completion
              time, or version.
            </p>
          </div>

          {filtersActive ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse"
              type="button"
              disabled={loading}
              onClick={clearFilters}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </button>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={handleSearch}
        >
          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={documentTypeId}
            >
              Document type
            </label>
            <select
              id={documentTypeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.documentType}
              disabled={loading}
              onChange={(event) =>
                handleFilterChange(
                  'documentType',
                  event.target.value,
                )
              }
            >
              <option value="">EOB and EOR</option>
              <option value="EOB">
                Explanation of Benefits
              </option>
              <option value="EOR">
                Explanation of Review
              </option>
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={claimNumberId}
            >
              Claim number
            </label>
            <input
              id={claimNumberId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={filterValues.claimNumber}
              maxLength={40}
              autoComplete="off"
              disabled={loading}
              placeholder="CL2024001"
              onChange={(event) =>
                handleFilterChange(
                  'claimNumber',
                  event.target.value,
                )
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={memberIdInput}
            >
              Member ID
            </label>
            <input
              id={memberIdInput}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={filterValues.memberId}
              maxLength={40}
              autoComplete="off"
              disabled={loading || role === 'MEMBER'}
              placeholder="Exact fictional member ID"
              onChange={(event) =>
                handleFilterChange(
                  'memberId',
                  event.target.value,
                )
              }
            />
            {role === 'MEMBER' ? (
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                Member reports are restricted to the current
                fictional member.
              </p>
            ) : null}
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={completedFromId}
            >
              Completion time from
            </label>
            <input
              id={completedFromId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="date"
              value={filterValues.completedFrom}
              disabled={loading}
              onChange={(event) =>
                handleFilterChange(
                  'completedFrom',
                  event.target.value,
                )
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={completedToId}
            >
              Completion time to
            </label>
            <input
              id={completedToId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="date"
              value={filterValues.completedTo}
              disabled={loading}
              onChange={(event) =>
                handleFilterChange(
                  'completedTo',
                  event.target.value,
                )
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={versionId}
            >
              Version
            </label>
            <input
              id={versionId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={filterValues.version}
              disabled={loading}
              placeholder="Any version"
              onChange={(event) =>
                handleFilterChange(
                  'version',
                  event.target.value,
                )
              }
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Search
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {loading
                ? 'Loading reports…'
                : 'Apply report filters'}
            </button>
          </div>
        </form>
      </section>

      {loadError !== null ? (
        <div
          className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}

      {operationError !== null ? (
        <div
          className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          {operationError}
        </div>
      ) : null}

      {operationMessage !== null ? (
        <div
          className="mt-5 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
        >
          {operationMessage}
        </div>
      ) : null}

      <section
        className="mt-8"
        aria-labelledby="completed-reports-heading"
        aria-busy={loading}
      >
        <h2
          id="completed-reports-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Completed reports
        </h2>
        <p
          className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted"
          aria-live="polite"
        >
          {loading
            ? 'Loading authorized completed report metadata.'
            : `${visibleReports.length} authorized completed ${
                visibleReports.length === 1
                  ? 'report'
                  : 'reports'
              } found.`}
        </p>

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
              Loading browser-local report metadata
            </p>
          </div>
        ) : null}

        {!loading &&
        visibleReports.length === 0 &&
        loadError === null ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileSearch
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No authorized completed reports found
            </h3>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Adjust the filters or clear them to view all
              completed representative reports available to the
              current demo role.
            </p>
          </div>
        ) : null}

        {!loading && visibleReports.length > 0 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleReports.map((report, index) => {
              const reportId = getReportId(report);
              const href = `/documents/${encodeURIComponent(
                reportId,
              )}`;
              const key = `report-${reportId}`;
              const opening =
                navigationPending === key;
              const downloading =
                downloadPending === reportId;

              return (
                <article
                  key={getReportKey(report, index)}
                  className="flex min-h-72 flex-col rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                      <FileText
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                    </span>
                    <StatusBadge
                      status={report.status ?? 'COMPLETE'}
                    />
                  </div>

                  <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                    {getReportTitle(report)}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                    {reportId || 'Representative report'}
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Claim
                      </dt>
                      <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                        {report.claimNumber ?? 'Restricted'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Member
                      </dt>
                      <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                        {report.memberId ?? 'Restricted'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Version
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {report.version ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Delivery
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatStatus(
                          report.deliveryStatus ??
                            'NOT_CREATED',
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 space-y-1 text-xs text-content-muted dark:text-content-inverse-muted">
                    <p className="flex items-center gap-2">
                      <CalendarDays
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      Document date{' '}
                      {formatDate(report.documentDate)}
                    </p>
                    <p>
                      Completed{' '}
                      {formatDateTime(
                        getCompletionTimestamp(report),
                      )}
                    </p>
                  </div>

                  <p className="mt-3 text-xs font-semibold text-success-700 dark:text-success-100">
                    Mock IXIT transmitted: No
                  </p>

                  <div className="mt-auto grid gap-2 pt-5">
                    <a
                      className="inline-flex min-h-10 items-center justify-between gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark"
                      href={href}
                      aria-busy={opening}
                      onClick={(event) => {
                        handleNavigation(
                          event,
                          report,
                          key,
                        ).catch((error) => {
                          setOperationError(
                            normalizeErrorMessage(
                              error,
                              'The representative report could not be opened.',
                            ),
                          );
                        });
                      }}
                    >
                      <span>
                        {opening
                          ? 'Opening…'
                          : 'Open representative report'}
                      </span>
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

                    <button
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                      type="button"
                      disabled={
                        downloadPending !== null ||
                        reportId.length === 0 ||
                        report.downloadAvailable === false
                      }
                      onClick={() => {
                        handleDownload(report).catch((error) => {
                          setOperationError(
                            normalizeErrorMessage(
                              error,
                              'The representative report could not be downloaded.',
                            ),
                          );
                        });
                      }}
                    >
                      {downloading ? (
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
                      {downloading
                        ? 'Preparing…'
                        : report.downloadAvailable === false
                          ? 'Download unavailable'
                          : 'Download static sample'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Representative report notice"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              This is not a bill.
            </p>
            <p className="mt-1 text-sm leading-6">
              Representative demo document generated from a static
              sample; not an authoritative claim document. No
              coverage, payment, benefit, appeal, delivery,
              reporting, or transmission decision is represented
              by these reports.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

ReportsPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  completedReportProvider: PropTypes.object,
  reportProvider: PropTypes.object,
  reportService: PropTypes.object,
  documentService: PropTypes.object,
  documentVersionService: PropTypes.object,
  initialReports: PropTypes.arrayOf(PropTypes.object),
  initialFilters: PropTypes.object,
  onNavigate: PropTypes.func,
  onDownloaded: PropTypes.func,
};

export const CompletedReportsPage = ReportsPage;
export const LocalReportsPage = ReportsPage;
export const MockIxitReportsPage = ReportsPage;

export default ReportsPage;