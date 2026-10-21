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
  FileText,
  Loader2,
  Pencil,
  Save,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { redactForRole } from '../../../platform/security/maskingPolicy.js';
import {
  formatCurrency,
  formatDate,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EDIT_ROLES = new Set(['BOS', 'ADMIN']);
const RESTRICTED_MEMBER_ROLES = new Set(['MEMBER', 'CSR']);

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
    throw new Error(
      result.error?.message ??
        fallback,
    );
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

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(fallback);
}

function normalizeMemberResult(result) {
  const value = unwrapServiceResult(
    result,
    'The local member record could not be loaded.',
  );

  if (isPlainObject(value?.member)) {
    return value.member;
  }

  return isPlainObject(value) ? value : null;
}

function resolveMemberMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.resolveMember === 'function') {
    return service.resolveMember.bind(service);
  }

  if (typeof service.getMemberById === 'function') {
    return service.getMemberById.bind(service);
  }

  if (typeof service.findMemberById === 'function') {
    return service.findMemberById.bind(service);
  }

  if (typeof service.getMember === 'function') {
    return service.getMember.bind(service);
  }

  return null;
}

async function readMember(service, memberId, context) {
  const method = resolveMemberMethod(service);

  if (method === null) {
    return null;
  }

  return normalizeMemberResult(
    await Promise.resolve(method(memberId, context)),
  );
}

async function readCoverages(service, memberId, context) {
  if (service === null || service === undefined) {
    return [];
  }

  if (typeof service.getCoveragesByMember === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.getCoveragesByMember(memberId, context),
      ),
      'The local coverage records could not be loaded.',
    );
  }

  if (typeof service.getCoverages === 'function') {
    const values = normalizeCollectionResult(
      await Promise.resolve(service.getCoverages(context)),
      'The local coverage records could not be loaded.',
    );

    return values.filter(
      (coverage) => coverage.memberId === memberId,
    );
  }

  const snapshot =
    typeof service.getSnapshot === 'function'
      ? await Promise.resolve(service.getSnapshot())
      : null;
  const values = Array.isArray(snapshot?.coverages)
    ? snapshot.coverages
    : Object.values(snapshot?.coveragesById ?? {});

  return values.filter(
    (coverage) => coverage.memberId === memberId,
  );
}

async function readClaims(service, memberId, context) {
  if (service === null || service === undefined) {
    return [];
  }

  if (typeof service.searchClaims === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.searchClaims(
          {
            memberId,
            page: 1,
            limit: 100,
          },
          context,
        ),
      ),
      'The local claim records could not be loaded.',
    );
  }

  if (typeof service.getClaimsByMember === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        service.getClaimsByMember(memberId, context),
      ),
      'The local claim records could not be loaded.',
    );
  }

  if (typeof service.getClaims === 'function') {
    const values = normalizeCollectionResult(
      await Promise.resolve(service.getClaims(context)),
      'The local claim records could not be loaded.',
    );

    return values.filter((claim) => claim.memberId === memberId);
  }

  const snapshot =
    typeof service.getSnapshot === 'function'
      ? await Promise.resolve(service.getSnapshot())
      : null;
  const values = Array.isArray(snapshot?.claims)
    ? snapshot.claims
    : Object.values(snapshot?.claimsByNumber ?? {});

  return values.filter((claim) => claim.memberId === memberId);
}

async function readDocuments(
  documentService,
  claims,
  memberId,
  context,
) {
  if (documentService === null || documentService === undefined) {
    return [];
  }

  if (typeof documentService.searchDocuments === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        documentService.searchDocuments(
          {
            memberId,
            limit: 200,
          },
          context,
        ),
      ),
      'The representative documents could not be loaded.',
    );
  }

  if (typeof documentService.search === 'function') {
    return normalizeCollectionResult(
      await Promise.resolve(
        documentService.search(
          {
            memberId,
            limit: 200,
          },
          context,
        ),
      ),
      'The representative documents could not be loaded.',
    );
  }

  const claimNumbers = new Set(
    claims
      .map((claim) => claim.claimNumber)
      .filter(Boolean),
  );

  if (
    typeof documentService.getDocumentsByClaim === 'function'
  ) {
    const values = await Promise.all(
      [...claimNumbers].map((claimNumber) =>
        Promise.resolve(
          documentService.getDocumentsByClaim(
            claimNumber,
            context,
          ),
        ),
      ),
    );

    return values.flatMap((value) =>
      normalizeCollectionResult(
        value,
        'The representative documents could not be loaded.',
      ),
    );
  }

  const snapshot =
    typeof documentService.getSnapshot === 'function'
      ? await Promise.resolve(documentService.getSnapshot())
      : null;
  const documents = Array.isArray(snapshot?.documents)
    ? snapshot.documents
    : Object.values(snapshot?.documents ?? {});

  return documents.filter(
    (document) =>
      document.memberId === memberId &&
      claimNumbers.has(document.claimNumber),
  );
}

function formatAddress(address) {
  if (typeof address === 'string') {
    return address;
  }

  if (!isPlainObject(address)) {
    return '—';
  }

  const locality = [
    address.city,
    address.state,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return [
    address.line1,
    address.line2,
    locality,
  ]
    .filter(Boolean)
    .join(' · ');
}

function getDocumentKey(document, index) {
  return (
    document.documentId ??
    document.reportId ??
    `member-document-${index}`
  );
}

function getClaimKey(claim, index) {
  return claim.claimNumber ?? `member-claim-${index}`;
}

function getCoverageKey(coverage, index) {
  return coverage.coverageId ?? `member-coverage-${index}`;
}

function createMemberEditState(member) {
  return {
    displayName:
      typeof member?.displayName === 'string'
        ? member.displayName
        : '',
    active:
      typeof member?.active === 'boolean'
        ? member.active
        : true,
  };
}

function createCoverageEditState(coverage) {
  return {
    planName:
      typeof coverage?.planName === 'string'
        ? coverage.planName
        : '',
    groupNumber:
      typeof coverage?.groupNumber === 'string'
        ? coverage.groupNumber
        : '',
    status:
      typeof coverage?.status === 'string'
        ? coverage.status
        : 'ACTIVE',
  };
}

/**
 * Role-filtered member lookup and local data route.
 *
 * @param {{
 *   memberId?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>,
 *   memberService?: object,
 *   discoveryService?: object,
 *   fixtureRepository?: object,
 *   documentService?: object,
 *   documentVersionService?: object,
 *   initialMember?: Record<string, unknown>|null,
 *   initialCoverages?: readonly Record<string, unknown>[],
 *   initialClaims?: readonly Record<string, unknown>[],
 *   initialDocuments?: readonly Record<string, unknown>[],
 *   onNavigate?: Function,
 *   onUpdateMember?: Function,
 *   onUpdateCoverage?: Function
 * }} props Component props.
 * @returns {JSX.Element} Member detail page.
 */
export function MemberPage({
  memberId,
  session = null,
  context,
  memberService = null,
  discoveryService = null,
  fixtureRepository = null,
  documentService = null,
  documentVersionService = null,
  initialMember = null,
  initialCoverages = [],
  initialClaims = [],
  initialDocuments = [],
  onNavigate,
  onUpdateMember,
  onUpdateCoverage,
}) {
  const routeParams = useParams();
  const memberHeadingId = useId();
  const feedbackId = useId();
  const resolvedMemberId =
    memberId ??
    routeParams.memberId ??
    routeParams.id ??
    '';
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const canEdit = role !== null && EDIT_ROLES.has(role);
  const dataService =
    memberService ??
    discoveryService ??
    fixtureRepository;
  const relatedDataService =
    fixtureRepository ??
    memberService ??
    discoveryService;
  const resolvedDocumentService =
    documentService ?? documentVersionService;
  const [member, setMember] = useState(initialMember);
  const [coverages, setCoverages] = useState(
    initialCoverages,
  );
  const [claims, setClaims] = useState(initialClaims);
  const [documents, setDocuments] = useState(
    initialDocuments,
  );
  const [loading, setLoading] = useState(
    initialMember === null,
  );
  const [loadError, setLoadError] = useState(null);
  const [editingMember, setEditingMember] = useState(false);
  const [editingCoverageId, setEditingCoverageId] =
    useState(null);
  const [memberForm, setMemberForm] = useState(() =>
    createMemberEditState(initialMember),
  );
  const [coverageForm, setCoverageForm] = useState(() =>
    createCoverageEditState(null),
  );
  const [saving, setSaving] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        typeof resolvedMemberId !== 'string' ||
        resolvedMemberId.trim().length === 0
      ) {
        setLoading(false);
        setLoadError('A fictional member identifier is required.');
        return;
      }

      setLoading(true);
      setLoadError(null);
      setOperationError(null);

      try {
        const normalizedMemberId =
          resolvedMemberId.normalize('NFC').trim();
        const loadedMember =
          initialMember ??
          (await readMember(
            dataService,
            normalizedMemberId,
            accessContext,
          ));

        if (!active) {
          return;
        }

        if (loadedMember === null) {
          setMember(null);
          setCoverages([]);
          setClaims([]);
          setDocuments([]);
          setLoadError(
            'The member record is unavailable for the current demo role.',
          );
          return;
        }

        if (
          loadedMember.restricted === true &&
          role !== null &&
          RESTRICTED_MEMBER_ROLES.has(role)
        ) {
          setMember(loadedMember);
          setCoverages([]);
          setClaims([]);
          setDocuments([]);
          return;
        }

        const loadedCoverages =
          initialCoverages.length > 0
            ? initialCoverages
            : await readCoverages(
                relatedDataService,
                normalizedMemberId,
                accessContext,
              );
        const loadedClaims =
          initialClaims.length > 0
            ? initialClaims
            : await readClaims(
                relatedDataService,
                normalizedMemberId,
                accessContext,
              );
        const loadedDocuments =
          initialDocuments.length > 0
            ? initialDocuments
            : await readDocuments(
                resolvedDocumentService,
                loadedClaims,
                normalizedMemberId,
                accessContext,
              );

        if (!active) {
          return;
        }

        setMember(loadedMember);
        setCoverages(loadedCoverages);
        setClaims(loadedClaims);
        setDocuments(loadedDocuments);
        setMemberForm(createMemberEditState(loadedMember));
      } catch (error) {
        if (active) {
          setMember(null);
          setCoverages([]);
          setClaims([]);
          setDocuments([]);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The browser-local member record could not be loaded.',
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
            'The browser-local member record could not be loaded.',
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
    initialClaims,
    initialCoverages,
    initialDocuments,
    initialMember,
    relatedDataService,
    resolvedDocumentService,
    resolvedMemberId,
    role,
  ]);

  const restricted =
    member?.restricted === true &&
    role !== null &&
    RESTRICTED_MEMBER_ROLES.has(role);

  const visibleMember = useMemo(() => {
    if (member === null || role === null) {
      return member;
    }

    return redactForRole(member, role, {
      owned:
        role === 'MEMBER' &&
        accessContext?.memberId === member.memberId,
    });
  }, [accessContext?.memberId, member, role]);

  const visibleCoverages = useMemo(
    () =>
      role === null
        ? []
        : coverages.map((coverage) =>
            redactForRole(coverage, role, {
              owned:
                role === 'MEMBER' &&
                accessContext?.memberId ===
                  coverage.memberId,
            }),
          ),
    [accessContext?.memberId, coverages, role],
  );

  const visibleClaims = useMemo(
    () =>
      role === null
        ? []
        : claims.map((claim) =>
            redactForRole(claim, role, {
              owned:
                role === 'MEMBER' &&
                accessContext?.memberId === claim.memberId,
            }),
          ),
    [accessContext?.memberId, claims, role],
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
              },
            }),
          ),
    [accessContext?.memberId, documents, role],
  );

  const handleNavigation = (event, destination) => {
    if (typeof onNavigate !== 'function') {
      return;
    }

    event.preventDefault();
    setOperationError(null);

    try {
      const result = onNavigate(destination, event);

      if (
        result !== null &&
        (typeof result === 'object' ||
          typeof result === 'function') &&
        typeof result.then === 'function'
      ) {
        Promise.resolve(result).catch((error) => {
          setOperationError(
            normalizeErrorMessage(
              error,
              'The selected local record could not be opened.',
            ),
          );
        });
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The selected local record could not be opened.',
        ),
      );
    }
  };

  const startMemberEdit = () => {
    setMemberForm(createMemberEditState(member));
    setEditingMember(true);
    setOperationError(null);
    setOperationMessage(null);
  };

  const saveMember = async (event) => {
    event.preventDefault();

    if (!canEdit || member === null) {
      return;
    }

    const displayName = memberForm.displayName
      .normalize('NFC')
      .trim();

    if (displayName.length < 2 || displayName.length > 80) {
      setOperationError(
        'Display name must contain 2–80 characters.',
      );
      return;
    }

    const changes = {
      displayName,
      active: memberForm.active,
    };

    setSaving('member');
    setOperationError(null);
    setOperationMessage(null);

    try {
      let updated;

      if (typeof onUpdateMember === 'function') {
        updated = await Promise.resolve(
          onUpdateMember(
            {
              memberId: member.memberId,
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
        typeof relatedDataService?.updateMember === 'function'
      ) {
        const expectedRevision =
          typeof relatedDataService.getOverlayRevision ===
          'function'
            ? relatedDataService.getOverlayRevision()
            : 0;

        updated = await Promise.resolve(
          relatedDataService.updateMember(
            member.memberId,
            changes,
            {
              expectedRevision,
              updatedBy:
                accessContext?.userId ??
                accessContext?.actorId ??
                'system',
            },
          ),
        );
      } else {
        throw new Error(
          'Member editing is unavailable in this application composition.',
        );
      }

      const normalized = normalizeMemberResult(updated);
      const nextMember =
        normalized === null
          ? { ...member, ...changes }
          : normalized;

      setMember(nextMember);
      setMemberForm(createMemberEditState(nextMember));
      setEditingMember(false);
      setOperationMessage(
        'Fictional member details were updated locally.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The fictional member details could not be updated.',
        ),
      );
    } finally {
      setSaving(null);
    }
  };

  const startCoverageEdit = (coverage) => {
    setEditingCoverageId(coverage.coverageId);
    setCoverageForm(createCoverageEditState(coverage));
    setOperationError(null);
    setOperationMessage(null);
  };

  const saveCoverage = async (event) => {
    event.preventDefault();

    if (!canEdit || editingCoverageId === null) {
      return;
    }

    const current = coverages.find(
      (coverage) =>
        coverage.coverageId === editingCoverageId,
    );

    if (current === undefined) {
      setOperationError(
        'The selected fictional coverage record is unavailable.',
      );
      return;
    }

    const changes = {
      planName: coverageForm.planName.normalize('NFC').trim(),
      groupNumber:
        coverageForm.groupNumber.normalize('NFC').trim(),
      status: coverageForm.status,
    };

    if (
      changes.planName.length === 0 ||
      changes.groupNumber.length === 0
    ) {
      setOperationError(
        'Plan name and group number are required.',
      );
      return;
    }

    setSaving(`coverage-${editingCoverageId}`);
    setOperationError(null);
    setOperationMessage(null);

    try {
      let updated;

      if (typeof onUpdateCoverage === 'function') {
        updated = await Promise.resolve(
          onUpdateCoverage(
            {
              coverageId: editingCoverageId,
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
        typeof relatedDataService?.updateCoverage === 'function'
      ) {
        const expectedRevision =
          typeof relatedDataService.getOverlayRevision ===
          'function'
            ? relatedDataService.getOverlayRevision()
            : 0;

        updated = await Promise.resolve(
          relatedDataService.updateCoverage(
            editingCoverageId,
            changes,
            {
              expectedRevision,
              updatedBy:
                accessContext?.userId ??
                accessContext?.actorId ??
                'system',
            },
          ),
        );
      } else {
        throw new Error(
          'Coverage editing is unavailable in this application composition.',
        );
      }

      const normalized = unwrapServiceResult(
        updated,
        'The fictional coverage record could not be updated.',
      );
      const nextCoverage = isPlainObject(normalized?.coverage)
        ? normalized.coverage
        : isPlainObject(normalized)
          ? normalized
          : { ...current, ...changes };

      setCoverages((values) =>
        values.map((coverage) =>
          coverage.coverageId === editingCoverageId
            ? nextCoverage
            : coverage,
        ),
      );
      setEditingCoverageId(null);
      setOperationMessage(
        'Fictional coverage details were updated locally.',
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The fictional coverage details could not be updated.',
        ),
      );
    } finally {
      setSaving(null);
    }
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
            Loading authorized member details
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Reading browser-local fictional fixtures.
          </p>
        </section>
      </main>
    );
  }

  if (restricted) {
    return <AccessDenied authenticated />;
  }

  if (loadError !== null || member === null) {
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
            Member details unavailable
          </h1>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            {loadError ??
              'This member may be unavailable, or the current demo role may not have access.'}
          </p>
          <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
            No additional member, coverage, claim, or document
            details were displayed.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-muted dark:hover:text-content-inverse"
        href="/claims"
        onClick={(event) =>
          handleNavigation(event, {
            type: 'MEMBER_SEARCH',
            href: '/claims',
          })
        }
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to local search
      </a>

      <header
        className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={memberHeadingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <UserRound
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Authorized fictional member
              </p>
              <h1
                id={memberHeadingId}
                className="mt-1 break-words text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                {visibleMember?.displayName ??
                  'Fictional member'}
              </h1>
              <p className="mt-2 break-all font-mono text-sm text-content-muted dark:text-content-inverse-muted">
                Member ID: {visibleMember?.memberId ?? 'Restricted'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StatusBadge
              status={
                visibleMember?.active === false
                  ? 'INACTIVE'
                  : 'ACTIVE'
              }
            />
            {canEdit ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-primary-950"
                type="button"
                disabled={saving !== null}
                onClick={
                  editingMember
                    ? () => setEditingMember(false)
                    : startMemberEdit
                }
              >
                {editingMember ? (
                  <X className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Pencil
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
                {editingMember ? 'Cancel edit' : 'Edit member'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Member data disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <p className="leading-6">
            Details are filtered and redacted for the current demo
            role. All records are fictional, browser-local, and are
            not retrieved from a payer or healthcare system.
          </p>
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
          aria-labelledby="member-profile-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="member-profile-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Member profile
            </h2>
            {canEdit ? (
              <span className="text-xs font-medium text-content-subtle dark:text-content-inverse-muted">
                Local fixture editing permitted
              </span>
            ) : null}
          </div>

          {editingMember ? (
            <form
              className="mt-5 grid gap-5 sm:grid-cols-2"
              onSubmit={saveMember}
            >
              <div className="sm:col-span-2">
                <label
                  className="block text-sm font-medium text-content dark:text-content-inverse"
                  htmlFor={`${memberHeadingId}-display-name`}
                >
                  Display name
                </label>
                <input
                  id={`${memberHeadingId}-display-name`}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  value={memberForm.displayName}
                  maxLength={80}
                  disabled={saving !== null}
                  onChange={(event) => {
                    setMemberForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }));
                    setOperationError(null);
                  }}
                />
              </div>
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse">
                <input
                  className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                  type="checkbox"
                  checked={memberForm.active}
                  disabled={saving !== null}
                  onChange={(event) =>
                    setMemberForm((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                />
                Active fictional member
              </label>
              <div className="sm:col-span-2">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                  type="submit"
                  disabled={saving !== null}
                >
                  {saving === 'member' ? (
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
                  {saving === 'member'
                    ? 'Saving locally…'
                    : 'Save member'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Date of birth
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatDate(visibleMember?.dateOfBirth)}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Email
                </dt>
                <dd className="mt-1 break-all text-sm font-medium text-content dark:text-content-inverse">
                  {visibleMember?.email ?? '—'}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Phone
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {visibleMember?.phoneMasked ?? '—'}
                </dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                  Address
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatAddress(visibleMember?.address)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="member-summary-heading"
        >
          <h2
            id="member-summary-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Local record summary
          </h2>
          <dl className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Coverage records
              </dt>
              <dd className="font-semibold text-content dark:text-content-inverse">
                {visibleCoverages.length}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Authorized claims
              </dt>
              <dd className="font-semibold text-content dark:text-content-inverse">
                {visibleClaims.length}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Documents
              </dt>
              <dd className="font-semibold text-content dark:text-content-inverse">
                {visibleDocuments.length}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4 dark:border-border-dark">
              <dt className="text-sm text-content-muted dark:text-content-inverse-muted">
                Current demo role
              </dt>
              <dd className="font-mono text-sm font-semibold text-primary-700 dark:text-primary-300">
                {role}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section
        className="mt-6"
        aria-labelledby="coverage-heading"
      >
        <div>
          <h2
            id="coverage-heading"
            className="text-xl font-semibold text-content dark:text-content-inverse"
          >
            Coverage and group
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Authorized fictional plan and group information.
          </p>
        </div>

        {visibleCoverages.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              No authorized coverage records are available.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {visibleCoverages.map((coverage, index) => {
              const sourceCoverage = coverages[index] ?? coverage;
              const coverageKey = getCoverageKey(
                coverage,
                index,
              );
              const editing =
                editingCoverageId ===
                sourceCoverage.coverageId;
              const coverageSaving =
                saving ===
                `coverage-${sourceCoverage.coverageId}`;

              return (
                <article
                  key={coverageKey}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-content dark:text-content-inverse">
                        {coverage.planName ?? 'Fictional plan'}
                      </h3>
                      <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                        {coverage.coverageId ?? 'Restricted'}
                      </p>
                    </div>
                    <StatusBadge
                      status={coverage.status ?? 'UNKNOWN'}
                    />
                  </div>

                  {editing ? (
                    <form
                      className="mt-5 space-y-4"
                      onSubmit={saveCoverage}
                    >
                      <div>
                        <label className="block text-sm font-medium text-content dark:text-content-inverse">
                          Plan name
                          <input
                            className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                            value={coverageForm.planName}
                            disabled={saving !== null}
                            onChange={(event) =>
                              setCoverageForm((current) => ({
                                ...current,
                                planName: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-content dark:text-content-inverse">
                          Group number
                          <input
                            className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                            value={coverageForm.groupNumber}
                            disabled={saving !== null}
                            onChange={(event) =>
                              setCoverageForm((current) => ({
                                ...current,
                                groupNumber: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-content dark:text-content-inverse">
                          Status
                          <select
                            className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                            value={coverageForm.status}
                            disabled={saving !== null}
                            onChange={(event) =>
                              setCoverageForm((current) => ({
                                ...current,
                                status: event.target.value,
                              }))
                            }
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="TERMINATED">
                              Terminated
                            </option>
                          </select>
                        </label>
                      </div>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row">
                        <button
                          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong px-4 py-2 text-sm font-semibold text-content disabled:opacity-60 dark:border-border-dark-strong dark:text-content-inverse"
                          type="button"
                          disabled={saving !== null}
                          onClick={() =>
                            setEditingCoverageId(null)
                          }
                        >
                          Cancel
                        </button>
                        <button
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          type="submit"
                          disabled={saving !== null}
                        >
                          {coverageSaving ? (
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
                          {coverageSaving
                            ? 'Saving…'
                            : 'Save coverage'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Group
                          </dt>
                          <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                            {coverage.groupNumber ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Product
                          </dt>
                          <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                            {coverage.productType ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Effective
                          </dt>
                          <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                            {formatDate(
                              coverage.effectiveDate,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                            Termination
                          </dt>
                          <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                            {formatDate(
                              coverage.terminationDate,
                            )}
                          </dd>
                        </div>
                      </dl>
                      {canEdit ? (
                        <button
                          className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                          type="button"
                          disabled={saving !== null}
                          onClick={() =>
                            startCoverageEdit(sourceCoverage)
                          }
                        >
                          <Pencil
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Edit coverage
                        </button>
                      ) : null}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="mt-8"
        aria-labelledby="member-claims-heading"
      >
        <h2
          id="member-claims-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Authorized claims
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Claims outside the current role&apos;s access scope are
          not displayed.
        </p>

        {visibleClaims.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              No authorized fictional claims are available.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {visibleClaims.map((claim, index) => {
              const claimNumber =
                claim.claimNumber ?? '';
              const href = `/claims/${encodeURIComponent(
                claimNumber,
              )}`;

              return (
                <a
                  key={getClaimKey(claim, index)}
                  className="group rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                  href={href}
                  onClick={(event) =>
                    handleNavigation(event, {
                      type: 'CLAIM',
                      href,
                      claim,
                    })
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono font-semibold text-content dark:text-content-inverse">
                        {claim.claimNumber ??
                          'Restricted claim'}
                      </p>
                      <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                        {claim.providerName ??
                          claim.providerId ??
                          'Authorized fictional provider'}
                      </p>
                    </div>
                    <StatusBadge
                      status={claim.status ?? 'UNKNOWN'}
                    />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Service date
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatDate(claim.serviceDateFrom)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Type
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {claim.claimType ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Billed
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatCurrency(claim.billedAmount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Responsibility
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatCurrency(
                          claim.memberResponsibilityAmount,
                        )}
                      </dd>
                    </div>
                  </dl>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                    Open claim
                    <ChevronRight
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="mt-8"
        aria-labelledby="member-documents-heading"
      >
        <h2
          id="member-documents-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Representative documents
        </h2>
        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
          Static fictional documents visible to the current demo
          role.
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
              No authorized representative documents are available.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleDocuments.map((document, index) => {
              const documentId =
                document.documentId ?? document.reportId ?? '';
              const href = `/documents/${encodeURIComponent(
                documentId,
              )}`;

              return (
                <a
                  key={getDocumentKey(document, index)}
                  className="group flex min-h-44 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                  href={href}
                  onClick={(event) =>
                    handleNavigation(event, {
                      type: 'DOCUMENT',
                      href,
                      document,
                    })
                  }
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
                    {document.documentTitle ??
                      (document.documentType === 'EOB'
                        ? 'Explanation of Benefits'
                        : 'Explanation of Review')}
                  </h3>
                  <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                    Claim {document.claimNumber ?? 'Restricted'}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                    <CalendarDays
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {formatDate(document.documentDate)}
                    <span aria-hidden="true">·</span>
                    Version {document.version ?? '—'}
                  </div>
                  <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300">
                    Open representative document
                    <ChevronRight
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

MemberPage.propTypes = {
  memberId: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  memberService: PropTypes.object,
  discoveryService: PropTypes.object,
  fixtureRepository: PropTypes.object,
  documentService: PropTypes.object,
  documentVersionService: PropTypes.object,
  initialMember: PropTypes.object,
  initialCoverages: PropTypes.arrayOf(PropTypes.object),
  initialClaims: PropTypes.arrayOf(PropTypes.object),
  initialDocuments: PropTypes.arrayOf(PropTypes.object),
  onNavigate: PropTypes.func,
  onUpdateMember: PropTypes.func,
  onUpdateCoverage: PropTypes.func,
};

export const MemberDetailsPage = MemberPage;
export const MemberLookupPage = MemberPage;
export const LocalMemberPage = MemberPage;

export default MemberPage;