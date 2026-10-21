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
  ChevronRight,
  CircleDollarSign,
  FileText,
  Loader2,
  Pencil,
  ReceiptText,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { redactForRole } from '../../../platform/security/maskingPolicy.js';
import {
  formatCurrency,
  formatDate,
  formatMaskedValue,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EDIT_ROLES = new Set(['BOS', 'ADMIN']);
const REPRINT_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
]);
const RESTRICTED_CLAIM_ROLES = new Set(['MEMBER', 'CSR']);
const EMPTY_COLLECTION = Object.freeze([]);

const CLAIM_STATUSES = Object.freeze([
  'PROCESSED',
  'PAID',
  'DENIED',
  'PENDING_REVIEW',
  'COMPLETE',
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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
        : null,
  };
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.error?.message ?? fallback);
  }

  return result?.ok === true ? result.data : result;
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

  if (Array.isArray(value?.serviceLines)) {
    return value.serviceLines;
  }

  if (Array.isArray(value?.reasonCodes)) {
    return value.reasonCodes;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(fallback);
}

function normalizeEntityResult(result, property, fallback) {
  const value = unwrapServiceResult(result, fallback);

  if (isPlainObject(value?.[property])) {
    return value[property];
  }

  return isPlainObject(value) ? value : null;
}

function resolveClaimMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getClaimByNumber === 'function') {
    return service.getClaimByNumber.bind(service);
  }

  if (typeof service.resolveClaim === 'function') {
    return service.resolveClaim.bind(service);
  }

  if (typeof service.findClaimByNumber === 'function') {
    return service.findClaimByNumber.bind(service);
  }

  if (typeof service.getClaim === 'function') {
    return service.getClaim.bind(service);
  }

  return null;
}

async function readClaim(service, claimNumber, context) {
  const method = resolveClaimMethod(service);

  if (method === null) {
    return null;
  }

  return normalizeEntityResult(
    await Promise.resolve(
      method(claimNumber, context, 'CLAIM_VIEW'),
    ),
    'claim',
    'The local claim record could not be loaded.',
  );
}

async function readProvider(
  service,
  providerId,
  context,
) {
  if (
    service === null ||
    service === undefined ||
    typeof providerId !== 'string' ||
    providerId.length === 0
  ) {
    return null;
  }

  if (typeof service.getProviderById === 'function') {
    return normalizeEntityResult(
      await Promise.resolve(
        service.getProviderById(providerId, context),
      ),
      'provider',
      'The local provider record could not be loaded.',
    );
  }

  if (typeof service.findProviderById === 'function') {
    return normalizeEntityResult(
      await Promise.resolve(
        service.findProviderById(providerId, context),
      ),
      'provider',
      'The local provider record could not be loaded.',
    );
  }

  const snapshot =
    typeof service.getSnapshot === 'function'
      ? await Promise.resolve(service.getSnapshot())
      : null;

  return (
    snapshot?.providersById?.[providerId] ??
    snapshot?.providers?.find(
      (provider) => provider.providerId === providerId,
    ) ??
    null
  );
}

async function readServiceLines(
  service,
  claimNumber,
  context,
) {
  if (service === null || service === undefined) {
    return [];
  }

  if (typeof service.getServiceLinesByClaim === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.getServiceLinesByClaim(
          claimNumber,
          context,
        ),
      ),
      'The local service-line records could not be loaded.',
    );
  }

  if (typeof service.getServiceLines === 'function') {
    const values = normalizeCollectionResult(
      await Promise.resolve(service.getServiceLines(context)),
      'The local service-line records could not be loaded.',
    );

    return values.filter(
      (line) => line.claimNumber === claimNumber,
    );
  }

  const snapshot =
    typeof service.getSnapshot === 'function'
      ? await Promise.resolve(service.getSnapshot())
      : null;

  if (
    Array.isArray(
      snapshot?.serviceLinesByClaim?.[claimNumber],
    )
  ) {
    return snapshot.serviceLinesByClaim[claimNumber];
  }

  return Array.isArray(snapshot?.serviceLines)
    ? snapshot.serviceLines.filter(
        (line) => line.claimNumber === claimNumber,
      )
    : [];
}

async function readReasonCodes(
  service,
  claimNumber,
  serviceLines,
  context,
) {
  if (service === null || service === undefined) {
    return [];
  }

  if (typeof service.getReasonCodesByClaim === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.getReasonCodesByClaim(
          claimNumber,
          context,
        ),
      ),
      'The local reason-code records could not be loaded.',
    );
  }

  const reasonCodeIds = new Set(
    serviceLines.flatMap((line) =>
      Array.isArray(line.reasonCodeIds)
        ? line.reasonCodeIds
        : [],
    ),
  );
  const snapshot =
    typeof service.getSnapshot === 'function'
      ? await Promise.resolve(service.getSnapshot())
      : null;
  const values = Array.isArray(snapshot?.reasonCodes)
    ? snapshot.reasonCodes
    : Object.values(snapshot?.reasonCodesById ?? {});

  return values.filter((reason) =>
    reasonCodeIds.has(reason.reasonCodeId),
  );
}

async function readDocuments(
  service,
  claimNumber,
  memberId,
  context,
) {
  if (service === null || service === undefined) {
    return [];
  }

  if (typeof service.searchDocuments === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.searchDocuments(
          {
            claimNumber,
            ...(typeof memberId === 'string'
              ? { memberId }
              : {}),
            limit: 200,
          },
          context,
        ),
      ),
      'The representative documents could not be loaded.',
    );
  }

  if (typeof service.search === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.search(
          {
            claimNumber,
            ...(typeof memberId === 'string'
              ? { memberId }
              : {}),
            limit: 200,
          },
          context,
        ),
      ),
      'The representative documents could not be loaded.',
    );
  }

  if (typeof service.getDocumentsByClaim === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.getDocumentsByClaim(
          claimNumber,
          context,
        ),
      ),
      'The representative documents could not be loaded.',
    );
  }

  if (typeof service.listDocumentsByClaim === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.listDocumentsByClaim(
          claimNumber,
          context,
        ),
      ),
      'The representative documents could not be loaded.',
    );
  }

  const snapshot =
    typeof service.getSnapshot === 'function'
      ? await Promise.resolve(service.getSnapshot())
      : null;
  const values = Array.isArray(snapshot?.documents)
    ? snapshot.documents
    : Object.values(snapshot?.documents ?? {});

  return values.filter(
    (document) => document.claimNumber === claimNumber,
  );
}

function createClaimEditState(claim) {
  return {
    status:
      typeof claim?.status === 'string'
        ? claim.status
        : 'PROCESSED',
    billedAmount:
      typeof claim?.billedAmount === 'number'
        ? String(claim.billedAmount)
        : '',
    discountAmount:
      typeof claim?.discountAmount === 'number'
        ? String(claim.discountAmount)
        : '',
    allowedAmount:
      typeof claim?.allowedAmount === 'number'
        ? String(claim.allowedAmount)
        : '',
    planPaidAmount:
      typeof claim?.planPaidAmount === 'number'
        ? String(claim.planPaidAmount)
        : '',
    memberResponsibilityAmount:
      typeof claim?.memberResponsibilityAmount === 'number'
        ? String(claim.memberResponsibilityAmount)
        : '',
    eligibleForReprint:
      claim?.eligibleForReprint === true,
  };
}

function parseMoney(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return null;
  }

  const amount = Number(value);

  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100) / 100
    : null;
}

function amountsBalance(left, right) {
  return Math.abs(left - right) < 0.005;
}

function getLineKey(line, index) {
  return (
    line.serviceLineId ??
    `${line.claimNumber ?? 'claim'}-${line.lineNumber ?? index}`
  );
}

function getDocumentKey(document, index) {
  return (
    document.documentId ??
    document.reportId ??
    `claim-document-${index}`
  );
}

function getReasonKey(reason, index) {
  return (
    reason.reasonCodeId ??
    `${reason.groupCode ?? 'reason'}-${reason.code ?? index}`
  );
}

function getDocumentTitle(document) {
  if (
    typeof document.documentTitle === 'string' &&
    document.documentTitle.trim().length > 0
  ) {
    return document.documentTitle;
  }

  return document.documentType === 'EOB'
    ? 'Explanation of Benefits'
    : 'Explanation of Review';
}

/**
 * Role-filtered claim detail and local data route.
 *
 * @param {{
 *   claimNumber?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>,
 *   claimService?: object,
 *   discoveryService?: object,
 *   fixtureRepository?: object,
 *   documentService?: object,
 *   documentVersionService?: object,
 *   initialClaim?: Record<string, unknown>|null,
 *   initialProvider?: Record<string, unknown>|null,
 *   initialServiceLines?: readonly Record<string, unknown>[],
 *   initialReasonCodes?: readonly Record<string, unknown>[],
 *   initialDocuments?: readonly Record<string, unknown>[],
 *   onNavigate?: Function,
 *   onUpdateClaim?: Function,
 *   onCreateReprint?: Function
 * }} props Component props.
 * @returns {JSX.Element} Claim detail page.
 */
export function ClaimPage({
  claimNumber,
  session = null,
  context,
  claimService = null,
  discoveryService = null,
  fixtureRepository = null,
  documentService = null,
  documentVersionService = null,
  initialClaim = null,
  initialProvider = null,
  initialServiceLines = EMPTY_COLLECTION,
  initialReasonCodes = EMPTY_COLLECTION,
  initialDocuments = EMPTY_COLLECTION,
  onNavigate,
  onUpdateClaim,
  onCreateReprint,
}) {
  const routeParams = useParams();
  const claimHeadingId = useId();
  const feedbackId = useId();
  const resolvedClaimNumber =
    claimNumber ??
    routeParams.claimNumber ??
    routeParams.id ??
    '';
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const canEdit = role !== null && EDIT_ROLES.has(role);
  const canRequestReprint =
    role !== null && REPRINT_ROLES.has(role);
  const dataService =
    claimService ??
    discoveryService ??
    fixtureRepository;
  const relatedDataService =
    fixtureRepository ??
    claimService ??
    discoveryService;
  const resolvedDocumentService =
    documentService ?? documentVersionService;
  const [claim, setClaim] = useState(initialClaim);
  const [provider, setProvider] = useState(initialProvider);
  const [serviceLines, setServiceLines] = useState(
    initialServiceLines,
  );
  const [reasonCodes, setReasonCodes] = useState(
    initialReasonCodes,
  );
  const [documents, setDocuments] = useState(
    initialDocuments,
  );
  const [loading, setLoading] = useState(
    initialClaim === null,
  );
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [claimForm, setClaimForm] = useState(() =>
    createClaimEditState(initialClaim),
  );
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        typeof resolvedClaimNumber !== 'string' ||
        resolvedClaimNumber.trim().length === 0
      ) {
        setLoading(false);
        setLoadError('A fictional claim number is required.');
        return;
      }

      setLoading(true);
      setLoadError(null);
      setOperationError(null);

      try {
        const identifier =
          resolvedClaimNumber.normalize('NFC').trim();
        const loadedClaim =
          initialClaim ??
          (await readClaim(
            dataService,
            identifier,
            accessContext,
          ));

        if (!active) {
          return;
        }

        if (loadedClaim === null) {
          setClaim(null);
          setProvider(null);
          setServiceLines([]);
          setReasonCodes([]);
          setDocuments([]);
          setLoadError(
            'The claim record is unavailable for the current demo role.',
          );
          return;
        }

        if (
          loadedClaim.restricted === true &&
          role !== null &&
          RESTRICTED_CLAIM_ROLES.has(role)
        ) {
          setClaim(loadedClaim);
          setProvider(null);
          setServiceLines([]);
          setReasonCodes([]);
          setDocuments([]);
          return;
        }

        const loadedProvider =
          initialProvider ??
          (await readProvider(
            relatedDataService,
            loadedClaim.providerId,
            accessContext,
          ));
        const loadedServiceLines =
          initialServiceLines.length > 0
            ? initialServiceLines
            : await readServiceLines(
                relatedDataService,
                identifier,
                accessContext,
              );
        const loadedReasonCodes =
          initialReasonCodes.length > 0
            ? initialReasonCodes
            : await readReasonCodes(
                relatedDataService,
                identifier,
                loadedServiceLines,
                accessContext,
              );
        const loadedDocuments =
          initialDocuments.length > 0
            ? initialDocuments
            : await readDocuments(
                resolvedDocumentService,
                identifier,
                loadedClaim.memberId,
                accessContext,
              );

        if (!active) {
          return;
        }

        setClaim(loadedClaim);
        setProvider(loadedProvider);
        setServiceLines(loadedServiceLines);
        setReasonCodes(loadedReasonCodes);
        setDocuments(loadedDocuments);
        setClaimForm(createClaimEditState(loadedClaim));
      } catch (error) {
        if (active) {
          setClaim(null);
          setProvider(null);
          setServiceLines([]);
          setReasonCodes([]);
          setDocuments([]);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The browser-local claim record could not be loaded.',
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
            'The browser-local claim record could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    dataService,
    initialClaim,
    initialDocuments,
    initialProvider,
    initialReasonCodes,
    initialServiceLines,
    relatedDataService,
    resolvedClaimNumber,
    resolvedDocumentService,
    role,
  ]);

  const restricted =
    claim?.restricted === true &&
    role !== null &&
    RESTRICTED_CLAIM_ROLES.has(role);
  const ownershipDenied =
    role === 'MEMBER' &&
    claim !== null &&
    accessContext?.memberId !== claim.memberId;

  const visibleClaim = useMemo(() => {
    if (claim === null || role === null) {
      return claim;
    }

    return redactForRole(claim, role, {
      owned:
        role === 'MEMBER' &&
        accessContext?.memberId === claim.memberId,
      fieldPolicies: {
        claimNumber: 'PRESERVE',
      },
    });
  }, [accessContext?.memberId, claim, role]);

  const visibleProvider = useMemo(() => {
    if (provider === null || role === null) {
      return provider;
    }

    return redactForRole(provider, role, {
      owned: false,
    });
  }, [provider, role]);

  const visibleServiceLines = useMemo(
    () =>
      role === null
        ? []
        : serviceLines.map((line) =>
            redactForRole(line, role, {
              owned:
                role === 'MEMBER' &&
                accessContext?.memberId === claim?.memberId,
              fieldPolicies: {
                serviceLineId: 'PRESERVE',
                claimNumber: 'PRESERVE',
              },
            }),
          ),
    [
      accessContext?.memberId,
      claim?.memberId,
      role,
      serviceLines,
    ],
  );

  const visibleReasonCodes = useMemo(
    () =>
      role === null
        ? []
        : reasonCodes.map((reason) =>
            redactForRole(reason, role, {
              owned:
                role === 'MEMBER' &&
                accessContext?.memberId === claim?.memberId,
              fieldPolicies: {
                reasonCodeId: 'PRESERVE',
                code: 'PRESERVE',
                groupCode: 'PRESERVE',
              },
            }),
          ),
    [
      accessContext?.memberId,
      claim?.memberId,
      reasonCodes,
      role,
    ],
  );

  const visibleDocuments = useMemo(
    () =>
      role === null
        ? []
        : documents.map((document) =>
            redactForRole(document, role, {
              owned:
                role === 'MEMBER' &&
                accessContext?.memberId ===
                  document.memberId,
              fieldPolicies: {
                documentId: 'PRESERVE',
                reportId: 'PRESERVE',
                claimNumber: 'PRESERVE',
              },
            }),
          ),
    [accessContext?.memberId, documents, role],
  );

  const reasonCodesById = useMemo(
    () =>
      Object.fromEntries(
        visibleReasonCodes.map((reason) => [
          reason.reasonCodeId,
          reason,
        ]),
      ),
    [visibleReasonCodes],
  );

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
          'The selected local record could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  const startEdit = () => {
    setClaimForm(createClaimEditState(claim));
    setEditing(true);
    setOperationError(null);
    setOperationMessage(null);
  };

  const saveClaim = async (event) => {
    event.preventDefault();

    if (!canEdit || claim === null) {
      return;
    }

    const billedAmount = parseMoney(
      claimForm.billedAmount,
    );
    const discountAmount = parseMoney(
      claimForm.discountAmount,
    );
    const allowedAmount = parseMoney(
      claimForm.allowedAmount,
    );
    const planPaidAmount = parseMoney(
      claimForm.planPaidAmount,
    );
    const memberResponsibilityAmount = parseMoney(
      claimForm.memberResponsibilityAmount,
    );

    if (
      billedAmount === null ||
      discountAmount === null ||
      allowedAmount === null ||
      planPaidAmount === null ||
      memberResponsibilityAmount === null
    ) {
      setOperationError(
        'Financial values must be non-negative amounts.',
      );
      return;
    }

    if (
      !amountsBalance(
        billedAmount - discountAmount,
        allowedAmount,
      )
    ) {
      setOperationError(
        'Allowed amount must equal billed amount minus the discount.',
      );
      return;
    }

    if (
      !amountsBalance(
        planPaidAmount + memberResponsibilityAmount,
        allowedAmount,
      )
    ) {
      setOperationError(
        'Allowed amount must equal plan paid plus member responsibility.',
      );
      return;
    }

    const changes = {
      status: claimForm.status,
      billedAmount,
      discountAmount,
      allowedAmount,
      planPaidAmount,
      memberResponsibilityAmount,
      eligibleForReprint: claimForm.eligibleForReprint,
    };

    setSaving(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      let updated;

      if (typeof onUpdateClaim === 'function') {
        updated = await Promise.resolve(
          onUpdateClaim(
            {
              claimNumber: claim.claimNumber,
              changes,
              expectedRevision:
                typeof relatedDataService?.getOverlayRevision ===
                'function'
                  ? relatedDataService.getOverlayRevision()
                  : undefined,
            },
            accessContext,
          ),
        );
      } else if (
        typeof relatedDataService?.updateClaim === 'function'
      ) {
        const expectedRevision =
          typeof relatedDataService.getOverlayRevision ===
          'function'
            ? relatedDataService.getOverlayRevision()
            : 0;
        const expectedRootRevision =
          typeof relatedDataService.getRevision === 'function'
            ? relatedDataService.getRevision()
            : undefined;

        updated = await Promise.resolve(
          relatedDataService.updateClaim(
            claim.claimNumber,
            changes,
            {
              expectedRevision,
              ...(Number.isSafeInteger(expectedRootRevision)
                ? { expectedRootRevision }
                : {}),
              updatedBy:
                accessContext?.userId ??
                accessContext?.actorId ??
                'system',
            },
          ),
        );
      } else {
        throw new Error(
          'Claim editing is unavailable in this application composition.',
        );
      }

      const normalized = normalizeEntityResult(
        updated,
        'claim',
        'The fictional claim could not be updated.',
      );
      const nextClaim =
        normalized === null
          ? { ...claim, ...changes }
          : normalized;

      setClaim(nextClaim);
      setClaimForm(createClaimEditState(nextClaim));
      setEditing(false);
      setOperationMessage(
        'Fictional claim details were updated locally.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The fictional claim details could not be updated.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReprint = async (event) => {
    const href =
      `/operations/requests/new?claimNumber=${encodeURIComponent(
        claim?.claimNumber ?? '',
      )}&memberId=${encodeURIComponent(
        claim?.memberId ?? '',
      )}`;

    if (typeof onCreateReprint === 'function') {
      event.preventDefault();
      setNavigationPending('reprint');
      setOperationError(null);

      try {
        await Promise.resolve(
          onCreateReprint(
            {
              claimNumber: claim?.claimNumber,
              memberId: claim?.memberId,
              documentTypes: claim?.documentTypes ?? [],
              href,
            },
            accessContext,
          ),
        );
      } catch (error) {
        setOperationError(
          normalizeErrorMessage(
            error,
            'The local reprint request could not be started.',
          ),
        );
      } finally {
        setNavigationPending(null);
      }

      return;
    }

    await handleNavigation(
      event,
      {
        type: 'REPRINT_REQUEST',
        href,
        claim,
      },
      'reprint',
    );
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
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
            Loading authorized claim details
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Reading browser-local fictional fixtures.
          </p>
        </section>
      </main>
    );
  }

  if (restricted || ownershipDenied) {
    return <AccessDenied authenticated />;
  }

  if (loadError !== null || claim === null) {
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
            Claim details unavailable
          </h1>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            {loadError ??
              'This claim may be unavailable, or the current demo role may not have access.'}
          </p>
          <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
            No additional claim, provider, service, financial, or
            document details were displayed.
          </p>
        </section>
      </main>
    );
  }

  const memberHref = `/members/${encodeURIComponent(
    claim.memberId ?? '',
  )}`;
  const reprintHref =
    `/operations/requests/new?claimNumber=${encodeURIComponent(
      claim.claimNumber,
    )}&memberId=${encodeURIComponent(claim.memberId)}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-muted dark:hover:text-content-inverse"
        href="/claims"
        onClick={(event) => {
          handleNavigation(
            event,
            {
              type: 'CLAIM_SEARCH',
              href: '/claims',
            },
            'back',
          ).catch((error) => {
            setOperationError(
              normalizeErrorMessage(
                error,
                'The local claim search could not be opened.',
              ),
            );
          });
        }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to local search
      </a>

      <header
        className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={claimHeadingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <ReceiptText
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Authorized fictional claim
              </p>
              <h1
                id={claimHeadingId}
                className="mt-1 break-all font-mono text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                {visibleClaim?.claimNumber ??
                  'Restricted claim'}
              </h1>
              <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                {visibleProvider?.name ??
                  visibleClaim?.providerName ??
                  'Authorized fictional provider'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StatusBadge
              status={visibleClaim?.status ?? 'UNKNOWN'}
            />
            {canEdit ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-primary-950"
                type="button"
                disabled={saving}
                onClick={
                  editing
                    ? () => {
                        setEditing(false);
                        setClaimForm(
                          createClaimEditState(claim),
                        );
                        setOperationError(null);
                      }
                    : startEdit
                }
              >
                {editing ? (
                  <X className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Pencil
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
                {editing ? 'Cancel edit' : 'Edit claim'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Claim data disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Browser-local fictional claim
            </p>
            <p className="mt-1 leading-6">
              Claim, provider, service, financial, and document
              details are filtered for the current demo role. No
              payer, provider, healthcare, or payment system was
              contacted.
            </p>
            {role === 'CSR' ? (
              <p className="mt-1 leading-6">
                CSR access is read-only. Financial and status
                values cannot be changed from this route.
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          id={feedbackId}
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

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 lg:col-span-2"
          aria-labelledby="claim-overview-heading"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                id="claim-overview-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Claim overview
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Local claim identity, dates, and processing state.
              </p>
            </div>
            {canEdit ? (
              <span className="text-xs font-medium text-content-subtle dark:text-content-inverse-muted">
                Local fixture editing permitted
              </span>
            ) : null}
          </div>

          {editing ? (
            <form
              className="mt-5 space-y-6"
              onSubmit={saveClaim}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium text-content dark:text-content-inverse">
                  Claim status
                  <select
                    className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    value={claimForm.status}
                    disabled={saving}
                    onChange={(event) => {
                      setClaimForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }));
                      setOperationError(null);
                    }}
                  >
                    {CLAIM_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse">
                  <input
                    className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                    type="checkbox"
                    checked={claimForm.eligibleForReprint}
                    disabled={saving}
                    onChange={(event) => {
                      setClaimForm((current) => ({
                        ...current,
                        eligibleForReprint:
                          event.target.checked,
                      }));
                      setOperationError(null);
                    }}
                  />
                  Eligible for local reprint demonstration
                </label>
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-content dark:text-content-inverse">
                  Financial values
                </legend>
                <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                  Values must balance before the fictional fixture
                  can be saved.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ['billedAmount', 'Billed amount'],
                    ['discountAmount', 'Discount amount'],
                    ['allowedAmount', 'Allowed amount'],
                    ['planPaidAmount', 'Plan paid'],
                    [
                      'memberResponsibilityAmount',
                      'Member responsibility',
                    ],
                  ].map(([field, label]) => (
                    <label
                      key={field}
                      className="block text-sm font-medium text-content dark:text-content-inverse"
                    >
                      {label}
                      <div className="relative mt-2">
                        <span
                          className="pointer-events-none absolute left-3 top-2.5 text-sm text-content-subtle dark:text-content-inverse-muted"
                          aria-hidden="true"
                        >
                          $
                        </span>
                        <input
                          className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-7 pr-3 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={claimForm[field]}
                          disabled={saving}
                          onChange={(event) => {
                            setClaimForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }));
                            setOperationError(null);
                          }}
                        />
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setClaimForm(createClaimEditState(claim));
                    setOperationError(null);
                  }}
                >
                  <RotateCcw
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Reset values
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                  {saving
                    ? 'Saving locally…'
                    : 'Save claim'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Member ID
                </dt>
                <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                  {visibleClaim?.memberId ?? 'Restricted'}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Claim type
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {visibleClaim?.claimType ?? '—'}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Coverage ID
                </dt>
                <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                  {visibleClaim?.coverageId ?? '—'}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Service dates
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatDate(visibleClaim?.serviceDateFrom)}
                  {visibleClaim?.serviceDateTo !==
                  visibleClaim?.serviceDateFrom
                    ? ` – ${formatDate(
                        visibleClaim?.serviceDateTo,
                      )}`
                    : ''}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Received
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatDate(visibleClaim?.receivedDate)}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Processed
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatDate(visibleClaim?.processedDate)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="claim-actions-heading"
        >
          <h2
            id="claim-actions-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Local actions
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Contextual links remain subject to demo role checks.
          </p>

          <div className="mt-5 space-y-3">
            <a
              className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
              href={memberHref}
              onClick={(event) => {
                handleNavigation(
                  event,
                  {
                    type: 'MEMBER',
                    href: memberHref,
                    memberId: claim.memberId,
                  },
                  'member',
                ).catch((error) => {
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The local member record could not be opened.',
                    ),
                  );
                });
              }}
            >
              <span className="inline-flex items-center gap-2">
                <UserRound
                  className="h-4 w-4 text-primary-700 dark:text-primary-300"
                  aria-hidden="true"
                />
                View member
              </span>
              {navigationPending === 'member' ? (
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

            {canRequestReprint ? (
              <a
                className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  claim.eligibleForReprint === true
                    ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700'
                    : 'pointer-events-none border-border bg-surface-muted text-content-subtle dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse-muted'
                }`}
                href={reprintHref}
                aria-disabled={
                  claim.eligibleForReprint !== true
                }
                onClick={(event) => {
                  if (claim.eligibleForReprint !== true) {
                    event.preventDefault();
                    return;
                  }

                  handleReprint(event).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The local reprint request could not be started.',
                      ),
                    );
                  });
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <FileText
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  {claim.eligibleForReprint === true
                    ? 'Request EOB or EOR'
                    : 'Reprint not eligible'}
                </span>
                {navigationPending === 'reprint' ? (
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
            ) : null}
          </div>

          <dl className="mt-5 space-y-3 border-t border-border pt-4 dark:border-border-dark">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Reprint eligibility
              </dt>
              <dd className="text-sm font-semibold text-content dark:text-content-inverse">
                {visibleClaim?.eligibleForReprint === true
                  ? 'Eligible'
                  : 'Not eligible'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Document types
              </dt>
              <dd className="text-right text-sm font-semibold text-content dark:text-content-inverse">
                {Array.isArray(visibleClaim?.documentTypes) &&
                visibleClaim.documentTypes.length > 0
                  ? visibleClaim.documentTypes.join(', ')
                  : 'None'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Current role
              </dt>
              <dd className="font-mono text-sm font-semibold text-primary-700 dark:text-primary-300">
                {role}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="financial-summary-heading"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
            <CircleDollarSign
              className="h-5 w-5"
              aria-hidden="true"
            />
          </span>
          <div>
            <h2
              id="financial-summary-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Financial summary
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Representative claim amounts. This is not a bill.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Provider billed', visibleClaim?.billedAmount],
            ['Plan discount', visibleClaim?.discountAmount],
            ['Allowed amount', visibleClaim?.allowedAmount],
            ['Plan paid', visibleClaim?.planPaidAmount],
            [
              'Member responsibility',
              visibleClaim?.memberResponsibilityAmount,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                {label}
              </dt>
              <dd className="mt-2 text-lg font-semibold tabular-nums text-content dark:text-content-inverse">
                {formatCurrency(value)}
              </dd>
            </div>
          ))}
        </dl>

        {visibleClaim?.paymentReference !== undefined &&
        visibleClaim.paymentReference !== null ? (
          <p className="mt-4 text-xs text-content-subtle dark:text-content-inverse-muted">
            Payment reference:{' '}
            <span className="font-mono font-semibold">
              {formatMaskedValue(
                visibleClaim.paymentReference,
              )}
            </span>
          </p>
        ) : null}
      </section>

      <section
        className="mt-8"
        aria-labelledby="provider-heading"
      >
        <h2
          id="provider-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Provider
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Authorized fictional provider information associated
          with this claim.
        </p>

        <article className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
              <Stethoscope
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-content dark:text-content-inverse">
                {visibleProvider?.name ??
                  visibleClaim?.providerName ??
                  'Authorized fictional provider'}
              </h3>
              <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                Provider ID:{' '}
                {visibleProvider?.providerId ??
                  visibleClaim?.providerId ??
                  'Restricted'}
              </p>

              <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    Provider type
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                    {visibleProvider?.providerType ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    Network status
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                    {visibleProvider?.networkStatus ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    NPI
                  </dt>
                  <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                    {visibleProvider?.npi ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                    Location
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                    {[
                      visibleProvider?.address?.city,
                      visibleProvider?.address?.state,
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </article>
      </section>

      <section
        className="mt-8"
        aria-labelledby="service-lines-heading"
      >
        <h2
          id="service-lines-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Service details
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Authorized fictional service lines and processing reason
          codes.
        </p>

        {visibleServiceLines.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              No authorized service-line details are available.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {visibleServiceLines.map((line, index) => {
              const lineReasons = Array.isArray(
                line.reasonCodeIds,
              )
                ? line.reasonCodeIds
                    .map(
                      (reasonCodeId) =>
                        reasonCodesById[reasonCodeId],
                    )
                    .filter(Boolean)
                : [];

              return (
                <article
                  key={getLineKey(line, index)}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Service line {line.lineNumber ?? index + 1}
                      </p>
                      <h3 className="mt-1 font-semibold text-content dark:text-content-inverse">
                        {line.procedureDescription ??
                          'Fictional service'}
                      </h3>
                      <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                        {formatDate(line.serviceDateFrom)}
                        {line.serviceDateTo !==
                        line.serviceDateFrom
                          ? ` – ${formatDate(
                              line.serviceDateTo,
                            )}`
                          : ''}
                      </p>
                    </div>
                    <StatusBadge
                      status={line.status ?? 'UNKNOWN'}
                    />
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Procedure
                      </dt>
                      <dd className="mt-1 font-mono font-medium text-content dark:text-content-inverse">
                        {line.procedureCode ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Units
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {line.units ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Billed
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatCurrency(line.billedAmount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Allowed
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatCurrency(line.allowedAmount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Plan paid
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatCurrency(line.planPaidAmount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Responsibility
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatCurrency(
                          line.memberResponsibilityAmount,
                        )}
                      </dd>
                    </div>
                  </dl>

                  {lineReasons.length > 0 ? (
                    <div className="mt-5 border-t border-border pt-4 dark:border-border-dark">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Reason codes
                      </p>
                      <ul className="mt-3 grid gap-3 md:grid-cols-2">
                        {lineReasons.map((reason, reasonIndex) => (
                          <li
                            key={getReasonKey(
                              reason,
                              reasonIndex,
                            )}
                            className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark"
                          >
                            <p className="font-mono text-sm font-semibold text-content dark:text-content-inverse">
                              {reason.groupCode}
                              {reason.code}
                              {reason.shortLabel
                                ? ` · ${reason.shortLabel}`
                                : ''}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                              {reason.description}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="mt-8"
        aria-labelledby="claim-documents-heading"
      >
        <h2
          id="claim-documents-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Representative documents
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Static fictional document versions visible to the
          current demo role.
        </p>

        {visibleDocuments.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileText
              className="mx-auto h-7 w-7 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted">
              No authorized representative documents are
              available for this claim.
            </p>
            {claim.eligibleForReprint === true &&
            canRequestReprint ? (
              <a
                className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                href={reprintHref}
                onClick={(event) => {
                  handleReprint(event).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The local reprint request could not be started.',
                      ),
                    );
                  });
                }}
              >
                Request a representative document
                <ChevronRight
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              </a>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleDocuments.map((document, index) => {
              const documentId =
                document.documentId ??
                document.reportId ??
                '';
              const href = `/documents/${encodeURIComponent(
                documentId,
              )}`;
              const navigationKey = `document-${documentId}`;

              return (
                <a
                  key={getDocumentKey(document, index)}
                  className="group flex min-h-48 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                  href={href}
                  aria-busy={
                    navigationPending === navigationKey
                  }
                  onClick={(event) => {
                    handleNavigation(
                      event,
                      {
                        type: 'DOCUMENT',
                        href,
                        document,
                      },
                      navigationKey,
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
                    {document.documentId ??
                      document.reportId ??
                      'Representative document'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                    <CalendarDays
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {formatDate(document.documentDate)}
                    <span aria-hidden="true">·</span>
                    Version {document.version ?? '—'}
                  </div>
                  <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                    {navigationPending === navigationKey
                      ? 'Opening…'
                      : 'Open representative document'}
                    {navigationPending === navigationKey ? (
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

      <aside
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        role="note"
        aria-label="Representative claim disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-content dark:text-content-inverse">
              Fictional demonstration only
            </p>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              This claim and its documents are not authoritative
              healthcare or payment records. No coverage, payment,
              benefit, or appeal decision is represented by this
              route.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

ClaimPage.propTypes = {
  claimNumber: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  claimService: PropTypes.object,
  discoveryService: PropTypes.object,
  fixtureRepository: PropTypes.object,
  documentService: PropTypes.object,
  documentVersionService: PropTypes.object,
  initialClaim: PropTypes.object,
  initialProvider: PropTypes.object,
  initialServiceLines: PropTypes.arrayOf(PropTypes.object),
  initialReasonCodes: PropTypes.arrayOf(PropTypes.object),
  initialDocuments: PropTypes.arrayOf(PropTypes.object),
  onNavigate: PropTypes.func,
  onUpdateClaim: PropTypes.func,
  onCreateReprint: PropTypes.func,
};

export const ClaimDetailsPage = ClaimPage;
export const ClaimDetailPage = ClaimPage;
export const LocalClaimPage = ClaimPage;

export default ClaimPage;