import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Download,
  FileClock,
  FileText,
  Loader2,
  Printer,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import DocumentPreview from '../components/DocumentPreview.jsx';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import ConfirmDialog from '../../../platform/components/ConfirmDialog.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { downloadStaticAsset } from '../../../platform/utils/download.js';
import {
  formatDate,
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EMPTY_COLLECTION = Object.freeze([]);
const DOCUMENT_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
]);
const FAX_ROLES = new Set(['BOS', 'ADMIN']);

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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
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

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeDocumentResult(result, fallback) {
  const value = unwrapServiceResult(result, fallback);

  if (isPlainObject(value?.document)) {
    return value.document;
  }

  if (isPlainObject(value?.preview)) {
    return value.preview;
  }

  return isPlainObject(value) ? value : null;
}

function normalizeCollectionResult(result, fallback) {
  const value = unwrapServiceResult(result, fallback);

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.documents)) {
    return value.documents;
  }

  if (Array.isArray(value?.records)) {
    return value.records;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(fallback);
}

function resolveOpenMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.openDocument === 'function') {
    return service.openDocument.bind(service);
  }

  if (typeof service.open === 'function') {
    return service.open.bind(service);
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

async function readPriorVersions(
  service,
  document,
  context,
) {
  if (
    service === null ||
    service === undefined ||
    typeof document?.claimNumber !== 'string'
  ) {
    return [];
  }

  let values;

  if (typeof service.searchDocuments === 'function') {
    values = normalizeCollectionResult(
      await Promise.resolve(
        service.searchDocuments(
          {
            claimNumber: document.claimNumber,
            memberId: document.memberId,
            documentType: document.documentType,
            limit: 200,
          },
          context,
        ),
      ),
      'Prior representative document versions could not be loaded.',
    );
  } else if (typeof service.search === 'function') {
    values = normalizeCollectionResult(
      await Promise.resolve(
        service.search(
          {
            claimNumber: document.claimNumber,
            memberId: document.memberId,
            documentType: document.documentType,
            limit: 200,
          },
          context,
        ),
      ),
      'Prior representative document versions could not be loaded.',
    );
  } else if (
    typeof service.getDocumentsByClaim === 'function'
  ) {
    values = normalizeCollectionResult(
      await Promise.resolve(
        service.getDocumentsByClaim(
          document.claimNumber,
          context,
        ),
      ),
      'Prior representative document versions could not be loaded.',
    );
  } else if (
    typeof service.listDocumentsByClaim === 'function'
  ) {
    values = normalizeCollectionResult(
      await Promise.resolve(
        service.listDocumentsByClaim(
          document.claimNumber,
          context,
        ),
      ),
      'Prior representative document versions could not be loaded.',
    );
  } else {
    return [];
  }

  return values
    .filter(
      (candidate) =>
        candidate.documentId !== document.documentId &&
        candidate.claimNumber === document.claimNumber &&
        candidate.memberId === document.memberId &&
        candidate.documentType === document.documentType,
    )
    .sort((left, right) => {
      const versionDifference =
        (right.version ?? 0) - (left.version ?? 0);

      if (versionDifference !== 0) {
        return versionDifference;
      }

      return String(right.documentDate ?? '').localeCompare(
        String(left.documentDate ?? ''),
      );
    });
}

async function readOutboundRecords(service, documentId) {
  if (
    service === null ||
    service === undefined ||
    typeof documentId !== 'string' ||
    documentId.length === 0
  ) {
    return [];
  }

  if (
    typeof service.getOutboundRecordsByDocumentId ===
    'function'
  ) {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.getOutboundRecordsByDocumentId(documentId),
      ),
      'Local outbound records could not be loaded.',
    );
  }

  if (typeof service.listByDocumentId === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.listByDocumentId(documentId),
      ),
      'Local outbound records could not be loaded.',
    );
  }

  return [];
}

function isAuthorizationError(error) {
  return [
    'AUTHENTICATION_REQUIRED',
    'FORBIDDEN',
    'PERMISSION_DENIED',
    'ACTION_FORBIDDEN',
  ].includes(error?.code);
}

function getDocumentTitle(document) {
  if (
    typeof document?.documentTitle === 'string' &&
    document.documentTitle.trim().length > 0
  ) {
    return document.documentTitle;
  }

  return document?.documentType === 'EOR'
    ? 'Explanation of Review'
    : 'Explanation of Benefits';
}

function getDocumentKey(document, index) {
  return document.documentId ?? `document-version-${index}`;
}

/**
 * Ownership-safe representative document view and download route.
 *
 * @param {{
 *   documentId?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   documentService?: object,
 *   documentVersionService?: object,
 *   outboundService?: object,
 *   initialDocument?: Record<string, unknown>|null,
 *   initialPreview?: Record<string, unknown>|null,
 *   initialVersions?: readonly Record<string, unknown>[],
 *   initialOutboundRecords?: readonly Record<string, unknown>[],
 *   onNavigate?: Function,
 *   onDownloaded?: Function,
 *   onFaxChanged?: Function
 * }} props Component props.
 * @returns {JSX.Element} Representative document page.
 */
export function DocumentPage({
  documentId,
  session = null,
  context = null,
  documentService = null,
  documentVersionService = null,
  outboundService = null,
  initialDocument = null,
  initialPreview = null,
  initialVersions = EMPTY_COLLECTION,
  initialOutboundRecords = EMPTY_COLLECTION,
  onNavigate,
  onDownloaded,
  onFaxChanged,
}) {
  const routeParams = useParams();
  const headingId = useId();
  const resolvedDocumentId =
    documentId ??
    routeParams.documentId ??
    routeParams.id ??
    '';
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const resolvedDocumentService =
    documentService ?? documentVersionService;
  const [document, setDocument] = useState(
    initialPreview ?? initialDocument,
  );
  const [versions, setVersions] = useState(initialVersions);
  const [outboundRecords, setOutboundRecords] = useState(
    initialOutboundRecords,
  );
  const [loading, setLoading] = useState(
    initialPreview === null && initialDocument === null,
  );
  const [loadError, setLoadError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [downloadDialogOpen, setDownloadDialogOpen] =
    useState(false);
  const [faxDialogOpen, setFaxDialogOpen] = useState(false);
  const [sendFaxDialogOpen, setSendFaxDialogOpen] =
    useState(false);
  const [faxDestination, setFaxDestination] = useState(
    '(***) ***-0101',
  );
  const [faxPending, setFaxPending] = useState(false);
  const [navigationPending, setNavigationPending] =
    useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        typeof resolvedDocumentId !== 'string' ||
        resolvedDocumentId.trim().length === 0
      ) {
        setLoading(false);
        setLoadError(
          'A representative document identifier is required.',
        );
        return;
      }

      if (!authenticated || role === null) {
        setLoading(false);
        return;
      }

      if (!DOCUMENT_ROLES.has(role)) {
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      setLoading(true);
      setLoadError(null);
      setAccessDenied(false);
      setOperationError(null);

      try {
        const identifier =
          resolvedDocumentId.normalize('NFC').trim();
        const openDocument = resolveOpenMethod(
          resolvedDocumentService,
        );
        let loadedDocument =
          initialPreview ?? initialDocument;

        if (loadedDocument === null) {
          if (openDocument === null) {
            throw new Error(
              'Document viewing is unavailable in this application composition.',
            );
          }

          loadedDocument = normalizeDocumentResult(
            await Promise.resolve(
              openDocument(
                { documentId: identifier },
                accessContext,
              ),
            ),
            'The representative document could not be loaded.',
          );
        }

        if (!active) {
          return;
        }

        if (loadedDocument === null) {
          setDocument(null);
          setLoadError(
            'The representative document is unavailable for the current demo role.',
          );
          return;
        }

        if (
          role === 'MEMBER' &&
          (accessContext.memberId === null ||
            loadedDocument.memberId !==
              accessContext.memberId)
        ) {
          setDocument(null);
          setAccessDenied(true);
          return;
        }

        if (
          loadedDocument.audienceScope === 'PROVIDER' &&
          !FAX_ROLES.has(role)
        ) {
          setDocument(null);
          setAccessDenied(true);
          return;
        }

        const loadedVersions =
          initialVersions.length > 0
            ? initialVersions
            : await readPriorVersions(
                resolvedDocumentService,
                loadedDocument,
                accessContext,
              );
        const loadedOutboundRecords =
          initialOutboundRecords.length > 0
            ? initialOutboundRecords
            : await readOutboundRecords(
                outboundService,
                loadedDocument.documentId ?? identifier,
              );

        if (!active) {
          return;
        }

        setDocument(loadedDocument);
        setVersions(loadedVersions);
        setOutboundRecords(loadedOutboundRecords);
      } catch (error) {
        if (!active) {
          return;
        }

        if (isAuthorizationError(error)) {
          setDocument(null);
          setAccessDenied(true);
        } else {
          setDocument(null);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The representative document could not be loaded.',
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
        setLoadError(
          normalizeErrorMessage(
            error,
            'The representative document could not be loaded.',
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
    initialDocument,
    initialOutboundRecords,
    initialPreview,
    initialVersions,
    outboundService,
    resolvedDocumentId,
    resolvedDocumentService,
    role,
  ]);

  const faxRecord = useMemo(
    () =>
      outboundRecords.find(
        (record) => record.kind === 'FAX',
      ) ?? null,
    [outboundRecords],
  );
  const canManageFax =
    role !== null && FAX_ROLES.has(role);
  const requestHref =
    typeof document?.requestId === 'string'
      ? `/operations/requests/${encodeURIComponent(
          document.requestId,
        )}`
      : '/operations/queue';
  const claimHref =
    typeof document?.claimNumber === 'string'
      ? `/claims/${encodeURIComponent(document.claimNumber)}`
      : '/claims';

  const handleNavigation = async (
    event,
    destination,
    key,
  ) => {
    if (typeof onNavigate !== 'function') {
      return;
    }

    event.preventDefault();
    setNavigationPending(key);
    setOperationError(null);

    try {
      await Promise.resolve(
        onNavigate(destination, event),
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The selected browser-local route could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  const handleDownload = async () => {
    const downloadDocument = resolveDownloadMethod(
      resolvedDocumentService,
    );

    if (
      downloadDocument === null ||
      document === null
    ) {
      throw new Error(
        'Representative document download is unavailable in this application composition.',
      );
    }

    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        downloadDocument(
          { documentId: document.documentId },
          accessContext,
        ),
      );
      const descriptor = unwrapServiceResult(
        result,
        'The representative document could not be prepared for download.',
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
      const message = normalizeErrorMessage(
        error,
        'The representative document could not be downloaded.',
      );

      setOperationError(message);
      throw new Error(message);
    }
  };

  const refreshOutboundRecords = async () => {
    if (document === null) {
      return;
    }

    const records = await readOutboundRecords(
      outboundService,
      document.documentId,
    );

    setOutboundRecords(records);
  };

  const handleCreateFax = async () => {
    if (
      !canManageFax ||
      document === null ||
      outboundService === null
    ) {
      throw new Error(
        'Fax simulation is unavailable for the current demo role.',
      );
    }

    const createFax =
      typeof outboundService.createFaxOutbox === 'function'
        ? outboundService.createFaxOutbox.bind(
            outboundService,
          )
        : typeof outboundService.createFax === 'function'
          ? outboundService.createFax.bind(outboundService)
          : null;

    if (createFax === null) {
      throw new Error(
        'Fax outbox creation is unavailable in this application composition.',
      );
    }

    setFaxPending(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        createFax(
          {
            documentId: document.documentId,
            destinationMasked: faxDestination,
            idempotencyKey: generateUuid(),
          },
          accessContext,
        ),
      );

      unwrapServiceResult(
        result,
        'The local fax outbox row could not be created.',
      );
      await refreshOutboundRecords();
      setOperationMessage(
        'Fax outbox marked ready for demonstration. No external transmission occurred.',
      );

      if (typeof onFaxChanged === 'function') {
        await Promise.resolve(
          onFaxChanged(result, document),
        );
      }
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The local fax outbox row could not be created.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setFaxPending(false);
    }
  };

  const handleMarkFaxSent = async () => {
    if (
      !canManageFax ||
      document === null ||
      faxRecord === null ||
      outboundService === null
    ) {
      throw new Error(
        'The local fax row is unavailable for simulation.',
      );
    }

    const markSent =
      typeof outboundService.markFaxSent === 'function'
        ? outboundService.markFaxSent.bind(outboundService)
        : typeof outboundService.markFaxAsSent === 'function'
          ? outboundService.markFaxAsSent.bind(
              outboundService,
            )
          : null;

    if (markSent === null) {
      throw new Error(
        'Fax sent simulation is unavailable in this application composition.',
      );
    }

    setFaxPending(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        markSent(
          {
            outboundId: faxRecord.outboundId,
            documentId: document.documentId,
            idempotencyKey: generateUuid(),
          },
          accessContext,
        ),
      );

      unwrapServiceResult(
        result,
        'The local fax row could not be marked sent.',
      );
      await refreshOutboundRecords();
      setOperationMessage(
        'Fax marked sent for demonstration. No external transmission occurred.',
      );

      if (typeof onFaxChanged === 'function') {
        await Promise.resolve(
          onFaxChanged(result, document),
        );
      }
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The local fax row could not be marked sent.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setFaxPending(false);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (
    role === null ||
    !DOCUMENT_ROLES.has(role) ||
    accessDenied
  ) {
    return <AccessDenied authenticated />;
  }

  if (loading) {
    return (
      <main
        className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6"
        aria-busy="true"
      >
        <section
          className="w-full rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          role="status"
        >
          <Loader2
            className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium text-content dark:text-content-inverse">
            Loading representative document
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Applying ownership and demo-role checks to
            browser-local metadata.
          </p>
        </section>
      </main>
    );
  }

  if (loadError !== null || document === null) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
        <section
          className="w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8"
          role="alert"
        >
          <ShieldAlert
            className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
            aria-hidden="true"
          />
          <h1 className="mt-3 text-xl font-semibold text-content dark:text-content-inverse">
            Document unavailable
          </h1>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            {loadError ??
              'The representative document may be unavailable, or the current demo role may not have access.'}
          </p>
          <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
            No claim, member, financial, service, artifact, or
            outbound details were displayed.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-muted dark:hover:text-content-inverse"
        href={requestHref}
        onClick={(event) => {
          handleNavigation(
            event,
            {
              type: 'REPRINT_REQUEST',
              href: requestHref,
              requestId: document.requestId,
            },
            'request',
          ).catch((error) => {
            setOperationError(
              normalizeErrorMessage(
                error,
                'The request route could not be opened.',
              ),
            );
          });
        }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to request
      </a>

      <header
        className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <FileText
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Representative document version
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                {getDocumentTitle(document)}
              </h1>
              <p className="mt-2 break-all font-mono text-sm text-content-muted dark:text-content-inverse-muted">
                {document.documentId}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StatusBadge
              status={document.status ?? 'COMPLETE'}
            />
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              type="button"
              onClick={() => {
                setOperationError(null);
                setDownloadDialogOpen(true);
              }}
            >
              <Download
                className="h-4 w-4"
                aria-hidden="true"
              />
              Download static sample
            </button>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Representative document disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Ownership-safe static document
            </p>
            <p className="mt-1 leading-6">
              This route displays role-filtered browser-local
              metadata and links only to an approved same-origin
              representative PDF. It is not an authoritative claim
              document, and no payer, provider, healthcare,
              payment, storage, delivery, or fax system is
              contacted.
            </p>
          </div>
        </div>
      </aside>

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
          className="mt-5 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
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
        aria-labelledby="document-metadata-heading"
      >
        <div className="flex items-start gap-3">
          <FileClock
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="document-metadata-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Version metadata
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Immutable browser-local identifiers and dates.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Document type', document.documentType],
            ['Version', document.version],
            ['Document date', formatDate(document.documentDate)],
            ['Created', formatDateTime(document.createdAt)],
            ['Claim number', document.claimNumber],
            ['Member ID', document.memberId],
            ['Request ID', document.requestId],
            [
              'Audience',
              formatStatus(
                document.audienceScope ?? 'MEMBER',
              ),
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                {label}
              </dt>
              <dd
                className={`mt-1 break-all text-sm font-medium text-content dark:text-content-inverse ${
                  label.endsWith('ID') ||
                  label === 'Claim number'
                    ? 'font-mono'
                    : ''
                }`}
              >
                {value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>

        <a
          className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
          href={claimHref}
          onClick={(event) => {
            handleNavigation(
              event,
              {
                type: 'CLAIM',
                href: claimHref,
                claimNumber: document.claimNumber,
              },
              'claim',
            ).catch((error) => {
              setOperationError(
                normalizeErrorMessage(
                  error,
                  'The claim route could not be opened.',
                ),
              );
            });
          }}
        >
          View authorized claim
          {navigationPending === 'claim' ? (
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
      </section>

      <div className="mt-6">
        <DocumentPreview
          preview={document}
          context={accessContext}
          owned={
            role === 'MEMBER' &&
            accessContext.memberId === document.memberId
          }
        />
      </div>

      <section
        className="mt-8"
        aria-labelledby="prior-versions-heading"
      >
        <div className="flex items-start gap-3">
          <FileClock
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="prior-versions-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Prior versions
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Earlier immutable versions visible to the current
              demo role.
            </p>
          </div>
        </div>

        {versions.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              No authorized prior versions are available.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {versions.map((version, index) => {
              const versionId = version.documentId ?? '';
              const href = `/documents/${encodeURIComponent(
                versionId,
              )}`;
              const key = `version-${versionId}`;

              return (
                <a
                  key={getDocumentKey(version, index)}
                  className="group flex min-h-40 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                  href={href}
                  onClick={(event) => {
                    handleNavigation(
                      event,
                      {
                        type: 'DOCUMENT',
                        href,
                        documentId: versionId,
                        document: version,
                      },
                      key,
                    ).catch((error) => {
                      setOperationError(
                        normalizeErrorMessage(
                          error,
                          'The prior document version could not be opened.',
                        ),
                      );
                    });
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                      <FileText
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                    </span>
                    <StatusBadge
                      status={version.status ?? 'COMPLETE'}
                    />
                  </div>
                  <h3 className="mt-4 font-semibold text-content dark:text-content-inverse">
                    Version {version.version ?? '—'}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                    {versionId}
                  </p>
                  <p className="mt-3 flex items-center gap-2 text-xs text-content-muted dark:text-content-inverse-muted">
                    <CalendarDays
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {formatDate(version.documentDate)}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                    {navigationPending === key
                      ? 'Opening…'
                      : 'Open prior version'}
                    {navigationPending === key ? (
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
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      {canManageFax ? (
        <section
          className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="fax-controls-heading"
          aria-busy={faxPending}
        >
          <div className="flex items-start gap-3">
            <Printer
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="fax-controls-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Local fax simulation
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Creates and updates browser-local outbox metadata
                only. No external transmission occurs.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-content dark:text-content-inverse">
                  Fax outbox status
                </p>
                <div className="mt-2">
                  <StatusBadge
                    status={faxRecord?.status ?? 'NOT_REQUESTED'}
                  />
                </div>
                {faxRecord?.outboundId ? (
                  <p className="mt-2 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                    {faxRecord.outboundId}
                  </p>
                ) : null}
              </div>

              {faxRecord === null ? (
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                  type="button"
                  disabled={faxPending}
                  onClick={() => setFaxDialogOpen(true)}
                >
                  <Printer
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Create ready fax row
                </button>
              ) : faxRecord.status === 'READY' ? (
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                  type="button"
                  disabled={faxPending}
                  onClick={() => setSendFaxDialogOpen(true)}
                >
                  <Send
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Mark sent locally
                </button>
              ) : (
                <p className="text-sm font-medium text-success-700 dark:text-success-100">
                  Fax simulation complete. Transmitted: No.
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Download and transmission notice"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
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
              coverage, payment, benefit, appeal, delivery, or fax
              decision is represented by this route.
            </p>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={downloadDialogOpen}
        title="Download representative static document?"
        description="This approved same-origin PDF contains fictional demonstration data. It is not an authoritative claim document and must not be used for healthcare or payment decisions."
        confirmLabel="Download static sample"
        cancelLabel="Cancel"
        onConfirm={handleDownload}
        onOpenChange={setDownloadDialogOpen}
      />

      <ConfirmDialog
        open={faxDialogOpen}
        title="Create local fax outbox row?"
        description="This action marks a browser-local fax row ready for demonstration. No fax gateway or external recipient is contacted."
        confirmLabel="Create ready fax row"
        cancelLabel="Cancel"
        loading={faxPending}
        onConfirm={handleCreateFax}
        onOpenChange={setFaxDialogOpen}
      >
        <label className="mt-4 block text-sm font-medium text-content dark:text-content-inverse">
          Masked destination
          <input
            className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
            type="text"
            value={faxDestination}
            maxLength={100}
            disabled={faxPending}
            onChange={(event) => {
              setFaxDestination(event.target.value);
              setOperationError(null);
            }}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={sendFaxDialogOpen}
        title="Mark fax sent for demonstration?"
        description="This changes only browser-local metadata from Ready to Sent. No external transmission occurs."
        confirmLabel="Mark sent locally"
        cancelLabel="Cancel"
        loading={faxPending}
        onConfirm={handleMarkFaxSent}
        onOpenChange={setSendFaxDialogOpen}
      />
    </div>
  );
}

DocumentPage.propTypes = {
  documentId: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  documentService: PropTypes.object,
  documentVersionService: PropTypes.object,
  outboundService: PropTypes.object,
  initialDocument: PropTypes.object,
  initialPreview: PropTypes.object,
  initialVersions: PropTypes.arrayOf(PropTypes.object),
  initialOutboundRecords: PropTypes.arrayOf(
    PropTypes.object,
  ),
  onNavigate: PropTypes.func,
  onDownloaded: PropTypes.func,
  onFaxChanged: PropTypes.func,
};

export const RepresentativeDocumentPage = DocumentPage;
export const DocumentVersionPage = DocumentPage;
export const LocalDocumentPage = DocumentPage;

export default DocumentPage;