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
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EMPTY_COLLECTION = Object.freeze([]);
const MEMBER_DOCUMENT_TYPES = new Set(['EOB', 'EOR']);

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
  const memberId =
    typeof source.memberId === 'string' &&
    source.memberId.trim().length > 0
      ? source.memberId.normalize('NFC').trim()
      : null;

  if (role === null) {
    return null;
  }

  return {
    ...source,
    role,
    memberId,
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

function normalizeDocumentCollection(result) {
  const value = unwrapServiceResult(
    result,
    'Representative documents could not be loaded.',
  );

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.documents)) {
    return value.documents;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(
    'The local document service returned an invalid document collection.',
  );
}

function resolveSearchMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.searchDocuments === 'function') {
    return service.searchDocuments.bind(service);
  }

  if (typeof service.search === 'function') {
    return service.search.bind(service);
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

function isMemberOwnedDocument(document, memberId) {
  if (!isPlainObject(document)) {
    return false;
  }

  const audienceScope =
    document.audienceScope ??
    document.layout?.audienceScope;
  const hasRemittanceRows =
    Array.isArray(document.remittanceRows) ||
    Array.isArray(document.details?.remittanceRows);

  return (
    document.memberId === memberId &&
    MEMBER_DOCUMENT_TYPES.has(document.documentType) &&
    audienceScope !== 'PROVIDER' &&
    audienceScope !== 'OPERATIONS' &&
    !hasRemittanceRows
  );
}

function normalizeSearchText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
    : '';
}

function documentMatchesQuery(document, query) {
  if (query.length === 0) {
    return true;
  }

  return [
    document.documentId,
    document.reportId,
    document.documentType,
    document.documentTitle,
    document.claimNumber,
    document.documentDate,
    document.status,
    document.version,
  ]
    .filter(
      (value) =>
        value !== null && value !== undefined,
    )
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(query);
}

function compareDocuments(left, right) {
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

  return String(
    left.documentId ?? left.reportId ?? '',
  ).localeCompare(
    String(right.documentId ?? right.reportId ?? ''),
    'en-US',
  );
}

function getDocumentTitle(document) {
  if (
    typeof document.documentTitle === 'string' &&
    document.documentTitle.trim().length > 0
  ) {
    return document.documentTitle;
  }

  return document.documentType === 'EOR'
    ? 'Explanation of Review'
    : 'Explanation of Benefits';
}

function getDocumentKey(document, index) {
  return (
    document.documentId ??
    document.reportId ??
    `member-document-${index}`
  );
}

function getDocumentId(document) {
  const value =
    document.documentId ?? document.reportId;

  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

/**
 * Member-owned representative document portal.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   documentService?: object,
 *   documentVersionService?: object,
 *   initialDocuments?: readonly Record<string, unknown>[],
 *   initialQuery?: string,
 *   onNavigate?: Function,
 *   onDownloaded?: Function
 * }} props Component props.
 * @returns {JSX.Element} Member document portal.
 */
export function MemberDocumentsPage({
  session = null,
  context = null,
  documentService = null,
  documentVersionService = null,
  initialDocuments = EMPTY_COLLECTION,
  initialQuery = '',
  onNavigate,
  onDownloaded,
}) {
  const headingId = useId();
  const searchId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const memberId = accessContext?.memberId ?? null;
  const authenticated = accessContext !== null;
  const resolvedDocumentService =
    documentService ?? documentVersionService;
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [query, setQuery] = useState(() =>
    normalizeSearchText(initialQuery),
  );
  const [documents, setDocuments] = useState(
    initialDocuments,
  );
  const [loading, setLoading] = useState(
    initialDocuments.length === 0,
  );
  const [loadError, setLoadError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);
  const [downloadPending, setDownloadPending] =
    useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        !authenticated ||
        role !== 'MEMBER' ||
        memberId === null
      ) {
        setLoading(false);
        return;
      }

      if (initialDocuments.length > 0) {
        setDocuments(initialDocuments);
        setLoading(false);
        setLoadError(null);
        return;
      }

      const searchDocuments = resolveSearchMethod(
        resolvedDocumentService,
      );

      if (searchDocuments === null) {
        setDocuments([]);
        setLoading(false);
        setLoadError(null);
        return;
      }

      setLoading(true);
      setLoadError(null);
      setOperationError(null);

      try {
        const result = await Promise.resolve(
          searchDocuments(
            {
              memberId,
              ...(query.length > 0
                ? { search: query }
                : {}),
              limit: 200,
            },
            accessContext,
          ),
        );
        const loadedDocuments =
          normalizeDocumentCollection(result);

        if (active) {
          setDocuments(loadedDocuments);
        }
      } catch (error) {
        if (active) {
          setDocuments([]);
          setLoadError(
            normalizeErrorMessage(
              error,
              'Your representative documents could not be loaded from browser-local data.',
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
        setDocuments([]);
        setLoadError(
          normalizeErrorMessage(
            error,
            'Your representative documents could not be loaded from browser-local data.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    authenticated,
    initialDocuments,
    memberId,
    query,
    resolvedDocumentService,
    role,
  ]);

  const visibleDocuments = useMemo(() => {
    if (role !== 'MEMBER' || memberId === null) {
      return [];
    }

    return documents
      .filter((document) =>
        isMemberOwnedDocument(document, memberId),
      )
      .filter((document) =>
        documentMatchesQuery(document, query),
      )
      .sort(compareDocuments);
  }, [documents, memberId, query, role]);

  const handleSearch = (event) => {
    event.preventDefault();
    setQuery(normalizeSearchText(queryInput));
    setOperationError(null);
    setOperationMessage(null);
  };

  const clearSearch = () => {
    setQueryInput('');
    setQuery('');
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleNavigation = async (
    event,
    document,
    key,
  ) => {
    if (
      !isMemberOwnedDocument(document, memberId) ||
      getDocumentId(document).length === 0
    ) {
      event.preventDefault();
      setOperationError(
        'This representative document is unavailable for the current demo member.',
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

    const documentId = getDocumentId(document);
    const href = `/documents/${encodeURIComponent(
      documentId,
    )}`;

    try {
      await Promise.resolve(
        onNavigate(
          {
            type: 'DOCUMENT',
            href,
            documentId,
            document,
          },
          event,
        ),
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The representative document could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  const handleDownload = async (document) => {
    const documentId = getDocumentId(document);

    if (
      !isMemberOwnedDocument(document, memberId) ||
      documentId.length === 0
    ) {
      setOperationError(
        'This representative document is unavailable for the current demo member.',
      );
      return;
    }

    const downloadDocument = resolveDownloadMethod(
      resolvedDocumentService,
    );

    if (downloadDocument === null) {
      setOperationError(
        'Representative document download is unavailable in this application composition.',
      );
      return;
    }

    setDownloadPending(documentId);
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        downloadDocument(
          { documentId },
          accessContext,
        ),
      );
      const descriptor = unwrapServiceResult(
        result,
        'The representative document could not be prepared for download.',
      );

      if (
        !isPlainObject(descriptor) ||
        descriptor.documentId !== documentId ||
        descriptor.memberId !== memberId ||
        descriptor.representativeOnly !== true ||
        typeof descriptor.assetUrl !== 'string' ||
        typeof descriptor.filename !== 'string'
      ) {
        throw new Error(
          'The local document service returned an invalid member download descriptor.',
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
        'The representative static document download was started locally.',
      );

      if (typeof onDownloaded === 'function') {
        await Promise.resolve(
          onDownloaded(descriptor, document, result),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The representative document could not be downloaded.',
        ),
      );
    } finally {
      setDownloadPending(null);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role !== 'MEMBER' || memberId === null) {
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
            <FileText
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Member document portal
            </p>
            <h1
              id={headingId}
              className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
            >
              My representative documents
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Search and open fictional EOB and EOR versions
              associated with your current demo member.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Member document privacy disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Member-owned documents only
            </p>
            <p className="mt-1 leading-6">
              Only representative documents associated with your
              fictional demo member are shown. Provider remittance
              artifacts and multi-patient rows are not exposed on
              this route.
            </p>
            <p className="mt-1 text-xs leading-5">
              No payer, provider, healthcare, payment, storage, or
              document-delivery system is contacted.
            </p>
          </div>
        </div>
      </aside>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="member-document-search-heading"
      >
        <h2
          id="member-document-search-heading"
          className="text-lg font-semibold text-content dark:text-content-inverse"
        >
          Search document versions
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Search by document ID, claim number, type, status, date,
          or version.
        </p>

        <form
          className="mt-5 flex flex-col gap-3 sm:flex-row"
          onSubmit={handleSearch}
        >
          <div className="min-w-0 flex-1">
            <label
              className="sr-only"
              htmlFor={searchId}
            >
              Search my representative documents
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <input
                id={searchId}
                className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="search"
                value={queryInput}
                autoComplete="off"
                placeholder="Claim number, EOB, EOR, date, or version"
                disabled={loading}
                onChange={(event) => {
                  setQueryInput(event.target.value);
                  setOperationError(null);
                }}
              />
            </div>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
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
            {loading ? 'Searching…' : 'Search'}
          </button>

          {query.length > 0 || queryInput.length > 0 ? (
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
              type="button"
              disabled={loading}
              onClick={clearSearch}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          ) : null}
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
        aria-labelledby="member-document-results-heading"
        aria-busy={loading}
      >
        <div>
          <h2
            id="member-document-results-heading"
            className="text-xl font-semibold text-content dark:text-content-inverse"
          >
            Document versions
          </h2>
          <p
            className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted"
            aria-live="polite"
          >
            {loading
              ? 'Loading authorized browser-local documents.'
              : `${visibleDocuments.length} authorized ${
                  visibleDocuments.length === 1
                    ? 'version'
                    : 'versions'
                } found.`}
          </p>
        </div>

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
              Loading member-owned document metadata
            </p>
          </div>
        ) : null}

        {!loading &&
        visibleDocuments.length === 0 &&
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
              No authorized document versions found
            </h3>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              {query.length > 0
                ? 'Adjust the search text or clear the search to view all available member-owned versions.'
                : 'No member-owned representative EOB or EOR versions are currently available.'}
            </p>
          </div>
        ) : null}

        {!loading && visibleDocuments.length > 0 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleDocuments.map((document, index) => {
              const documentId = getDocumentId(document);
              const href = `/documents/${encodeURIComponent(
                documentId,
              )}`;
              const key = `document-${documentId}`;
              const opening =
                navigationPending === key;
              const downloading =
                downloadPending === documentId;

              return (
                <article
                  key={getDocumentKey(document, index)}
                  className="flex min-h-64 flex-col rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                      <FileText
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                    </span>
                    <StatusBadge
                      status={document.status ?? 'COMPLETE'}
                    />
                  </div>

                  <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                    {getDocumentTitle(document)}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                    {documentId || 'Representative document'}
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Claim
                      </dt>
                      <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                        {document.claimNumber ?? 'Restricted'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Version
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {document.version ?? '—'}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-4 flex items-center gap-2 text-xs text-content-muted dark:text-content-inverse-muted">
                    <CalendarDays
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {formatDate(document.documentDate)}
                  </p>

                  <div className="mt-auto grid gap-2 pt-5">
                    <a
                      className="inline-flex min-h-10 items-center justify-between gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark"
                      href={href}
                      aria-busy={opening}
                      onClick={(event) => {
                        handleNavigation(
                          event,
                          document,
                          key,
                        ).catch((error) => {
                          setOperationError(
                            normalizeErrorMessage(
                              error,
                              'The representative document could not be opened.',
                            ),
                          );
                        });
                      }}
                    >
                      <span>
                        {opening
                          ? 'Opening…'
                          : 'Open document'}
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
                        documentId.length === 0
                      }
                      onClick={() => {
                        handleDownload(document).catch((error) => {
                          setOperationError(
                            normalizeErrorMessage(
                              error,
                              'The representative document could not be downloaded.',
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
        aria-label="Representative document notice"
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
              coverage, payment, benefit, appeal, delivery, or
              healthcare decision is represented by these files.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

MemberDocumentsPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  documentService: PropTypes.object,
  documentVersionService: PropTypes.object,
  initialDocuments: PropTypes.arrayOf(PropTypes.object),
  initialQuery: PropTypes.string,
  onNavigate: PropTypes.func,
  onDownloaded: PropTypes.func,
};

export const MemberDocumentPortalPage =
  MemberDocumentsPage;
export const MyDocumentsPage = MemberDocumentsPage;
export const LocalMemberDocumentsPage =
  MemberDocumentsPage;

export default MemberDocumentsPage;