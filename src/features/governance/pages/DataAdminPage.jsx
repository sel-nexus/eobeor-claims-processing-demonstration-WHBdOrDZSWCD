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
  Database,
  FileText,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  CLAIMS,
  MEMBERS,
} from '../../../fixtures/membersClaims.js';
import {
  INITIAL_REQUESTS,
} from '../../../fixtures/operations.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import ConfirmDialog from '../../../platform/components/ConfirmDialog.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDateTime,
  formatMaskedValue,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set([
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);
const EDIT_ROLES = new Set(['BOS', 'ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);

const ENTITY_TYPES = Object.freeze({
  MEMBER: 'MEMBER',
  CLAIM: 'CLAIM',
  REPRINT: 'REPRINT',
});

const ENTITY_TYPE_OPTIONS = Object.freeze([
  Object.freeze({
    value: ENTITY_TYPES.MEMBER,
    label: 'Member metadata',
  }),
  Object.freeze({
    value: ENTITY_TYPES.CLAIM,
    label: 'Claim metadata',
  }),
  Object.freeze({
    value: ENTITY_TYPES.REPRINT,
    label: 'Reprint metadata',
  }),
]);

const CLAIM_STATUSES = Object.freeze([
  'PROCESSED',
  'PAID',
  'DENIED',
  'PENDING_REVIEW',
  'COMPLETE',
]);

const REPRINT_STATUSES = Object.freeze([
  'PENDING',
  'PROCESSING',
  'PAUSED',
  'MANUAL_REVIEW',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
]);

const REPRINT_TYPES = Object.freeze([
  'EOB',
  'EOR',
  'BOTH',
]);

const PRIORITIES = Object.freeze([
  'URGENT',
  'HIGH',
  'NORMAL',
]);

const SOURCE_REPLICAS = Object.freeze([
  Object.freeze({
    sourceId: 'member-master',
    name: 'Member master replica',
    databaseLabel: 'Conceptual member DB',
    entityLabel: 'Member metadata',
  }),
  Object.freeze({
    sourceId: 'claims-replica',
    name: 'Claims processing replica',
    databaseLabel: 'Conceptual claims DB',
    entityLabel: 'Claim headers',
  }),
  Object.freeze({
    sourceId: 'coverage-store',
    name: 'Coverage store replica',
    databaseLabel: 'Conceptual coverage DB',
    entityLabel: 'Plan and group metadata',
  }),
  Object.freeze({
    sourceId: 'provider-directory',
    name: 'Provider directory replica',
    databaseLabel: 'Conceptual provider DB',
    entityLabel: 'Provider metadata',
  }),
  Object.freeze({
    sourceId: 'service-lines',
    name: 'Service-line replica',
    databaseLabel: 'Conceptual service DB',
    entityLabel: 'Claim service rows',
  }),
  Object.freeze({
    sourceId: 'reason-codes',
    name: 'Reason-code catalog',
    databaseLabel: 'Conceptual code DB',
    entityLabel: 'Processing explanations',
  }),
  Object.freeze({
    sourceId: 'restrictions',
    name: 'Restriction registry',
    databaseLabel: 'Conceptual access DB',
    entityLabel: 'Local access fixtures',
  }),
  Object.freeze({
    sourceId: 'reprint-requests',
    name: 'Reprint request store',
    databaseLabel: 'Conceptual operations DB',
    entityLabel: 'EOB and EOR requests',
  }),
  Object.freeze({
    sourceId: 'document-metadata',
    name: 'Document metadata replica',
    databaseLabel: 'Conceptual document DB',
    entityLabel: 'Representative versions',
  }),
  Object.freeze({
    sourceId: 'merged-data-lake',
    name: 'Merged local data lake',
    databaseLabel: 'Conceptual analytics DB',
    entityLabel: 'Joined demonstration rows',
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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
        : null,
  };
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    const error = new Error(
      result.error?.message ?? fallback,
    );

    if (typeof result.error?.code === 'string') {
      error.code = result.error.code;
    }

    if (Array.isArray(result.error?.fieldErrors)) {
      error.fieldErrors = result.error.fieldErrors;
    }

    throw error;
  }

  return result?.ok === true ? result.data : result;
}

function normalizeCollection(value, property, fallback) {
  const resolved = unwrapServiceResult(value, fallback);

  if (Array.isArray(resolved)) {
    return resolved;
  }

  if (Array.isArray(resolved?.[property])) {
    return resolved[property];
  }

  if (Array.isArray(resolved?.items)) {
    return resolved.items;
  }

  if (resolved === null || resolved === undefined) {
    return [];
  }

  throw new TypeError(fallback);
}

function resolveIdentifier(entityType, value) {
  if (!isPlainObject(value)) {
    return '';
  }

  switch (entityType) {
    case ENTITY_TYPES.MEMBER:
      return value.memberId ?? '';
    case ENTITY_TYPES.CLAIM:
      return value.claimNumber ?? '';
    case ENTITY_TYPES.REPRINT:
      return value.requestId ?? value.displayId ?? '';
    default:
      return '';
  }
}

function createEmptyForm(entityType) {
  switch (entityType) {
    case ENTITY_TYPES.MEMBER:
      return {
        memberId: '',
        displayName: '',
        active: true,
      };
    case ENTITY_TYPES.CLAIM:
      return {
        claimNumber: '',
        memberId: '',
        status: 'PROCESSED',
        eligibleForReprint: true,
      };
    case ENTITY_TYPES.REPRINT:
      return {
        requestId: '',
        displayId: '',
        claimNumber: '',
        memberId: '',
        requestType: 'EOB',
        priority: 'NORMAL',
        status: 'PENDING',
      };
    default:
      return {};
  }
}

function createEditForm(entityType, value) {
  const empty = createEmptyForm(entityType);

  return Object.fromEntries(
    Object.keys(empty).map((field) => [
      field,
      value?.[field] ?? empty[field],
    ]),
  );
}

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toUpperCase()
    : '';
}

function normalizeDisplayText(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

function validateForm(entityType, form) {
  const errors = [];

  if (entityType === ENTITY_TYPES.MEMBER) {
    if (normalizeIdentifier(form.memberId).length === 0) {
      errors.push('Member ID is required.');
    }

    const displayName = normalizeDisplayText(
      form.displayName,
    );

    if (
      displayName.length < 2 ||
      displayName.length > 80
    ) {
      errors.push(
        'Display name must contain 2–80 characters.',
      );
    }
  }

  if (entityType === ENTITY_TYPES.CLAIM) {
    if (normalizeIdentifier(form.claimNumber).length === 0) {
      errors.push('Claim number is required.');
    }

    if (normalizeIdentifier(form.memberId).length === 0) {
      errors.push('Member ID is required.');
    }

    if (!CLAIM_STATUSES.includes(form.status)) {
      errors.push('Select a supported claim status.');
    }
  }

  if (entityType === ENTITY_TYPES.REPRINT) {
    if (normalizeDisplayText(form.requestId).length === 0) {
      errors.push('Request ID is required.');
    }

    if (normalizeIdentifier(form.claimNumber).length === 0) {
      errors.push('Claim number is required.');
    }

    if (normalizeIdentifier(form.memberId).length === 0) {
      errors.push('Member ID is required.');
    }

    if (!REPRINT_TYPES.includes(form.requestType)) {
      errors.push('Select a supported reprint type.');
    }

    if (!PRIORITIES.includes(form.priority)) {
      errors.push('Select a supported priority.');
    }

    if (!REPRINT_STATUSES.includes(form.status)) {
      errors.push('Select a supported reprint status.');
    }
  }

  return errors;
}

function normalizeForm(entityType, form) {
  if (entityType === ENTITY_TYPES.MEMBER) {
    return {
      memberId: normalizeIdentifier(form.memberId),
      displayName: normalizeDisplayText(form.displayName),
      active: form.active === true,
    };
  }

  if (entityType === ENTITY_TYPES.CLAIM) {
    return {
      claimNumber: normalizeIdentifier(form.claimNumber),
      memberId: normalizeIdentifier(form.memberId),
      status: form.status,
      eligibleForReprint:
        form.eligibleForReprint === true,
    };
  }

  return {
    requestId: normalizeDisplayText(form.requestId),
    displayId: normalizeIdentifier(form.displayId),
    claimNumber: normalizeIdentifier(form.claimNumber),
    memberId: normalizeIdentifier(form.memberId),
    requestType: form.requestType,
    priority: form.priority,
    status: form.status,
  };
}

function resolveMethod(service, names) {
  if (service === null || service === undefined) {
    return null;
  }

  const name = names.find(
    (candidate) => typeof service[candidate] === 'function',
  );

  return name === undefined
    ? null
    : service[name].bind(service);
}

function getEntityMethods(service, entityType) {
  switch (entityType) {
    case ENTITY_TYPES.MEMBER:
      return {
        create: resolveMethod(service, [
          'createMember',
          'addMember',
        ]),
        update: resolveMethod(service, [
          'updateMember',
          'saveMember',
        ]),
        remove: resolveMethod(service, [
          'deleteMember',
          'removeMember',
        ]),
      };
    case ENTITY_TYPES.CLAIM:
      return {
        create: resolveMethod(service, [
          'createClaim',
          'addClaim',
        ]),
        update: resolveMethod(service, [
          'updateClaim',
          'saveClaim',
        ]),
        remove: resolveMethod(service, [
          'deleteClaim',
          'removeClaim',
        ]),
      };
    case ENTITY_TYPES.REPRINT:
      return {
        create: resolveMethod(service, [
          'createReprintMetadata',
          'createRequest',
          'addRequest',
        ]),
        update: resolveMethod(service, [
          'updateReprintMetadata',
          'updateRequest',
          'saveRequest',
        ]),
        remove: resolveMethod(service, [
          'deleteReprintMetadata',
          'deleteRequest',
          'removeRequest',
        ]),
      };
    default:
      return {
        create: null,
        update: null,
        remove: null,
      };
  }
}

function mergeEntity(collection, entityType, entity) {
  const identifier = resolveIdentifier(entityType, entity);
  const index = collection.findIndex(
    (candidate) =>
      resolveIdentifier(entityType, candidate) === identifier,
  );

  if (index < 0) {
    return [entity, ...collection];
  }

  return collection.map((candidate, candidateIndex) =>
    candidateIndex === index ? entity : candidate,
  );
}

function getCollectionForType(
  entityType,
  members,
  claims,
  requests,
) {
  switch (entityType) {
    case ENTITY_TYPES.MEMBER:
      return members;
    case ENTITY_TYPES.CLAIM:
      return claims;
    case ENTITY_TYPES.REPRINT:
      return requests;
    default:
      return [];
  }
}

function getRecordTitle(entityType, record) {
  switch (entityType) {
    case ENTITY_TYPES.MEMBER:
      return record.displayName ?? 'Fictional member';
    case ENTITY_TYPES.CLAIM:
      return record.claimNumber ?? 'Fictional claim';
    case ENTITY_TYPES.REPRINT:
      return (
        record.displayId ??
        record.requestId ??
        'Fictional reprint request'
      );
    default:
      return 'Local metadata';
  }
}

function getRecordStatus(entityType, record) {
  if (entityType === ENTITY_TYPES.MEMBER) {
    return record.active === false ? 'INACTIVE' : 'ACTIVE';
  }

  return record.status ?? 'UNKNOWN';
}

function getRecordSubtitle(entityType, record, role) {
  const privileged = EDIT_ROLES.has(role);

  if (entityType === ENTITY_TYPES.MEMBER) {
    return privileged
      ? `Member ${record.memberId ?? '—'}`
      : `Member ${formatMaskedValue(record.memberId)}`;
  }

  if (entityType === ENTITY_TYPES.CLAIM) {
    return `Member ${
      privileged
        ? record.memberId ?? '—'
        : formatMaskedValue(record.memberId)
    }`;
  }

  return `Claim ${record.claimNumber ?? '—'}`;
}

function createMergedRows(members, claims, requests) {
  const membersById = Object.fromEntries(
    members.map((member) => [member.memberId, member]),
  );
  const requestsByClaim = requests.reduce(
    (result, request) => {
      if (typeof request.claimNumber !== 'string') {
        return result;
      }

      if (result[request.claimNumber] === undefined) {
        result[request.claimNumber] = [];
      }

      result[request.claimNumber].push(request);
      return result;
    },
    {},
  );

  return claims.map((claim) => {
    const member = membersById[claim.memberId] ?? null;
    const claimRequests =
      requestsByClaim[claim.claimNumber] ?? [];

    return {
      rowId: `lake-${claim.claimNumber}`,
      claimNumber: claim.claimNumber,
      claimStatus: claim.status,
      memberId: claim.memberId,
      memberName: member?.displayName ?? 'Unavailable',
      memberActive: member?.active !== false,
      requestCount: claimRequests.length,
      requestStatuses: [
        ...new Set(
          claimRequests
            .map((request) => request.status)
            .filter(Boolean),
        ),
      ],
      eligibleForReprint:
        claim.eligibleForReprint === true,
    };
  });
}

function getRecordKey(entityType, record, index) {
  return (
    resolveIdentifier(entityType, record) ||
    `${entityType.toLowerCase()}-${index}`
  );
}

/**
 * Local data administration route for fictional member, claim, and reprint
 * metadata.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   dataAdminService?: object,
 *   dataService?: object,
 *   fixtureRepository?: object,
 *   requestService?: object,
 *   initialMembers?: readonly Record<string, unknown>[],
 *   initialClaims?: readonly Record<string, unknown>[],
 *   initialRequests?: readonly Record<string, unknown>[],
 *   onCreate?: Function,
 *   onUpdate?: Function,
 *   onDelete?: Function
 * }} props Component props.
 * @returns {JSX.Element} Local data administration page.
 */
export function DataAdminPage({
  session = null,
  context = null,
  dataAdminService = null,
  dataService = null,
  fixtureRepository = null,
  requestService = null,
  initialMembers = MEMBERS,
  initialClaims = CLAIMS,
  initialRequests = INITIAL_REQUESTS,
  onCreate,
  onUpdate,
  onDelete,
}) {
  const headingId = useId();
  const entityTypeId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const canEdit = role !== null && EDIT_ROLES.has(role);
  const service =
    dataAdminService ??
    dataService ??
    fixtureRepository;
  const [members, setMembers] = useState(initialMembers);
  const [claims, setClaims] = useState(initialClaims);
  const [requests, setRequests] = useState(initialRequests);
  const [entityType, setEntityType] = useState(
    ENTITY_TYPES.MEMBER,
  );
  const [form, setForm] = useState(() =>
    createEmptyForm(ENTITY_TYPES.MEMBER),
  );
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] =
    useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [validationErrors, setValidationErrors] = useState([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        return;
      }

      const snapshotReader = resolveMethod(service, [
        'getDataAdminSnapshot',
        'getSnapshot',
        'load',
      ]);
      const requestReader = resolveMethod(requestService, [
        'listRequests',
        'list',
      ]);

      if (snapshotReader === null && requestReader === null) {
        return;
      }

      setLoading(true);
      setOperationError(null);

      try {
        if (snapshotReader !== null) {
          const snapshotResult = await Promise.resolve(
            snapshotReader(accessContext),
          );
          const snapshot = unwrapServiceResult(
            snapshotResult,
            'Local data administration metadata could not be loaded.',
          );

          if (active && isPlainObject(snapshot)) {
            if (Array.isArray(snapshot.members)) {
              setMembers(snapshot.members);
            }

            if (Array.isArray(snapshot.claims)) {
              setClaims(snapshot.claims);
            }

            if (Array.isArray(snapshot.requests)) {
              setRequests(snapshot.requests);
            }
          }
        }

        if (requestReader !== null) {
          const requestResult = await Promise.resolve(
            requestReader(
              {
                page: 1,
                limit: 200,
              },
              accessContext,
            ),
          );
          const loadedRequests = normalizeCollection(
            requestResult,
            'requests',
            'Local reprint metadata could not be loaded.',
          );

          if (active) {
            setRequests(loadedRequests);
          }
        }
      } catch (error) {
        if (active) {
          setOperationError(
            normalizeErrorMessage(
              error,
              'Local data administration metadata could not be loaded.',
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
        setOperationError(
          normalizeErrorMessage(
            error,
            'Local data administration metadata could not be loaded.',
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
    requestService,
    role,
    service,
  ]);

  const selectedCollection = getCollectionForType(
    entityType,
    members,
    claims,
    requests,
  );
  const mergedRows = useMemo(
    () => createMergedRows(members, claims, requests),
    [claims, members, requests],
  );

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(createEmptyForm(entityType));
    setValidationErrors([]);
    setOperationError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(createEmptyForm(entityType));
    setFormOpen(true);
    setValidationErrors([]);
    setOperationError(null);
    setOperationMessage(null);
  };

  const startEdit = (record) => {
    setEditingId(resolveIdentifier(entityType, record));
    setForm(createEditForm(entityType, record));
    setFormOpen(true);
    setValidationErrors([]);
    setOperationError(null);
    setOperationMessage(null);
  };

  const updateLocalCollection = (
    selectedEntityType,
    updater,
  ) => {
    if (selectedEntityType === ENTITY_TYPES.MEMBER) {
      setMembers(updater);
    } else if (selectedEntityType === ENTITY_TYPES.CLAIM) {
      setClaims(updater);
    } else {
      setRequests(updater);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!canEdit) {
      return;
    }

    const errors = validateForm(entityType, form);

    if (errors.length > 0) {
      setValidationErrors(errors);
      setOperationError('Metadata validation failed.');
      return;
    }

    const values = normalizeForm(entityType, form);
    const identifier =
      editingId ?? resolveIdentifier(entityType, values);
    const methods = getEntityMethods(service, entityType);
    const genericCreate = resolveMethod(service, [
      'createEntity',
    ]);
    const genericUpdate = resolveMethod(service, [
      'updateEntity',
    ]);

    setPendingAction('SAVE');
    setValidationErrors([]);
    setOperationError(null);
    setOperationMessage(null);

    try {
      let result = null;

      if (editingId === null) {
        if (typeof onCreate === 'function') {
          result = await Promise.resolve(
            onCreate(
              {
                entityType,
                values,
              },
              accessContext,
            ),
          );
        } else if (methods.create !== null) {
          result = await Promise.resolve(
            methods.create(values, accessContext),
          );
        } else if (genericCreate !== null) {
          result = await Promise.resolve(
            genericCreate(
              entityType,
              values,
              accessContext,
            ),
          );
        }
      } else if (typeof onUpdate === 'function') {
        result = await Promise.resolve(
          onUpdate(
            {
              entityType,
              identifier,
              values,
            },
            accessContext,
          ),
        );
      } else if (methods.update !== null) {
        result = await Promise.resolve(
          methods.update(
            identifier,
            values,
            accessContext,
          ),
        );
      } else if (genericUpdate !== null) {
        result = await Promise.resolve(
          genericUpdate(
            entityType,
            identifier,
            values,
            accessContext,
          ),
        );
      }

      const resolved = unwrapServiceResult(
        result,
        'The fictional metadata could not be saved.',
      );
      const savedEntity =
        isPlainObject(resolved?.entity)
          ? resolved.entity
          : isPlainObject(resolved?.member)
            ? resolved.member
            : isPlainObject(resolved?.claim)
              ? resolved.claim
              : isPlainObject(resolved?.request)
                ? resolved.request
                : isPlainObject(resolved)
                  ? resolved
                  : values;

      updateLocalCollection(entityType, (current) =>
        mergeEntity(current, entityType, savedEntity),
      );
      setFormOpen(false);
      setEditingId(null);
      setForm(createEmptyForm(entityType));
      setOperationMessage(
        `${formatStatus(entityType)} metadata was ${
          editingId === null ? 'created' : 'updated'
        } locally.`,
      );
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The fictional metadata could not be saved.',
        ),
      );
      setValidationErrors(
        Array.isArray(error?.fieldErrors)
          ? error.fieldErrors.map(
              (fieldError) => fieldError.message,
            )
          : [],
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || deleteCandidate === null) {
      throw new Error(
        'The fictional metadata record is unavailable.',
      );
    }

    const candidateType = deleteCandidate.entityType;
    const identifier = resolveIdentifier(
      candidateType,
      deleteCandidate.record,
    );
    const methods = getEntityMethods(service, candidateType);
    const genericDelete = resolveMethod(service, [
      'deleteEntity',
      'removeEntity',
    ]);

    setPendingAction('DELETE');
    setOperationError(null);
    setOperationMessage(null);

    try {
      let result = null;

      if (typeof onDelete === 'function') {
        result = await Promise.resolve(
          onDelete(
            {
              entityType: candidateType,
              identifier,
              record: deleteCandidate.record,
            },
            accessContext,
          ),
        );
      } else if (methods.remove !== null) {
        result = await Promise.resolve(
          methods.remove(identifier, accessContext),
        );
      } else if (genericDelete !== null) {
        result = await Promise.resolve(
          genericDelete(
            candidateType,
            identifier,
            accessContext,
          ),
        );
      }

      unwrapServiceResult(
        result,
        'The fictional metadata could not be removed.',
      );

      updateLocalCollection(candidateType, (current) =>
        current.filter(
          (record) =>
            resolveIdentifier(candidateType, record) !==
            identifier,
        ),
      );
      setDeleteCandidate(null);
      setOperationMessage(
        `${formatStatus(candidateType)} metadata was removed locally.`,
      );
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The fictional metadata could not be removed.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setPendingAction(null);
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
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <Database
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Browser-local data governance
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Local data administration
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Review conceptual source replicas and merged
                fictional data-lake rows. BOS and Admin roles may
                maintain local member, claim, and reprint
                metadata.
              </p>
            </div>
          </div>

          <StatusBadge
            status={role}
            variant="neutral"
            label={`${formatStatus(role)} demo role`}
          />
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Local data administration disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Conceptual databases — no live connectivity
            </p>
            <p className="mt-1 leading-6">
              Source replicas, database labels, merged rows, and
              CRUD actions are browser-local fictional
              demonstrations. No payer, provider, healthcare,
              database, queue, payment, or external integration
              system is contacted.
            </p>
            {role === 'CSR' ? (
              <p className="mt-1 leading-6">
                CSR access is read-only and member identifiers are
                masked.
              </p>
            ) : null}
            {role === 'ITS' ? (
              <p className="mt-1 leading-6">
                ITS access is limited to conceptual source
                inventory and aggregate row counts. Record-level
                member and claim data is not displayed.
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      {operationError !== null ||
      validationErrors.length > 0 ? (
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
              {validationErrors.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {validationErrors.map((error, index) => (
                    <li key={`${error}-${index}`}>{error}</li>
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

      <section
        className="mt-8"
        aria-labelledby="source-replicas-heading"
        aria-busy={loading}
      >
        <div className="flex items-start gap-3">
          <Layers3
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="source-replicas-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Ten conceptual source replicas
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Labels describe the demonstration architecture only.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {SOURCE_REPLICAS.map((source) => (
            <article
              key={source.sourceId}
              className="flex min-h-52 flex-col rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                <Database
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-content dark:text-content-inverse">
                {source.name}
              </h3>
              <p className="mt-2 font-mono text-xs text-primary-700 dark:text-primary-300">
                {source.databaseLabel}
              </p>
              <p className="mt-2 text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                {source.entityLabel}
              </p>
              <div className="mt-auto pt-4">
                <StatusBadge
                  status="SIMULATED"
                  variant="neutral"
                  label="Local fixture"
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      {loading ? (
        <div
          className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-surface p-5 text-sm text-content-muted shadow-card dark:border-border-dark dark:bg-surface-dark-muted dark:text-content-inverse-muted"
          role="status"
        >
          <Loader2
            className="h-5 w-5 animate-spin text-primary-600 motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading browser-local metadata
        </div>
      ) : null}

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="local-record-summary-heading"
      >
        <div className="flex items-start gap-3">
          <Database
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="local-record-summary-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Local record summary
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Counts reflect the currently composed fictional
              browser-local data.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Member records', members.length],
            ['Claim records', claims.length],
            ['Reprint records', requests.length],
            ['Merged data-lake rows', mergedRows.length],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
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
      </section>

      {role !== 'ITS' ? (
        <section
          className="mt-8"
          aria-labelledby="metadata-administration-heading"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                id="metadata-administration-heading"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                Metadata administration
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                {canEdit
                  ? 'Create, edit, or remove fictional browser-local metadata.'
                  : 'Review constrained role-filtered metadata.'}
              </p>
            </div>

            {canEdit ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                type="button"
                disabled={pendingAction !== null}
                onClick={startCreate}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create metadata
              </button>
            ) : null}
          </div>

          <div className="mt-5">
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={entityTypeId}
            >
              Metadata type
            </label>
            <select
              id={entityTypeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse sm:max-w-sm"
              value={entityType}
              disabled={pendingAction !== null}
              onChange={(event) => {
                const nextType = event.target.value;

                setEntityType(nextType);
                setForm(createEmptyForm(nextType));
                setFormOpen(false);
                setEditingId(null);
                setValidationErrors([]);
                setOperationError(null);
              }}
            >
              {ENTITY_TYPE_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {formOpen && canEdit ? (
            <form
              className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-5 shadow-card dark:border-primary-800 dark:bg-primary-950 sm:p-6"
              onSubmit={handleSave}
              noValidate
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-content dark:text-content-inverse">
                    {editingId === null ? 'Create' : 'Edit'}{' '}
                    {formatStatus(entityType).toLowerCase()}{' '}
                    metadata
                  </h3>
                  <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                    Changes affect fictional browser-local
                    demonstration rows only.
                  </p>
                </div>
                <button
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-content-muted hover:bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark"
                  type="button"
                  aria-label="Close metadata form"
                  disabled={pendingAction !== null}
                  onClick={closeForm}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {entityType === ENTITY_TYPES.MEMBER ? (
                  <>
                    <label className="block text-sm font-medium text-content dark:text-content-inverse">
                      Member ID
                      <input
                        className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        value={form.memberId}
                        maxLength={40}
                        disabled={
                          pendingAction !== null ||
                          editingId !== null
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            memberId: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="block text-sm font-medium text-content dark:text-content-inverse">
                      Display name
                      <input
                        className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        value={form.displayName}
                        maxLength={80}
                        disabled={pendingAction !== null}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse">
                      <input
                        className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                        type="checkbox"
                        checked={form.active}
                        disabled={pendingAction !== null}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            active: event.target.checked,
                          }))
                        }
                      />
                      Active fictional member
                    </label>
                  </>
                ) : null}

                {entityType === ENTITY_TYPES.CLAIM ? (
                  <>
                    <label className="block text-sm font-medium text-content dark:text-content-inverse">
                      Claim number
                      <input
                        className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        value={form.claimNumber}
                        maxLength={40}
                        disabled={
                          pendingAction !== null ||
                          editingId !== null
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            claimNumber: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="block text-sm font-medium text-content dark:text-content-inverse">
                      Member ID
                      <input
                        className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        value={form.memberId}
                        maxLength={40}
                        disabled={pendingAction !== null}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            memberId: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="block text-sm font-medium text-content dark:text-content-inverse">
                      Claim status
                      <select
                        className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        value={form.status}
                        disabled={pendingAction !== null}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            status: event.target.value,
                          }))
                        }
                      >
                        {CLAIM_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {formatStatus(status)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse">
                      <input
                        className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                        type="checkbox"
                        checked={form.eligibleForReprint}
                        disabled={pendingAction !== null}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            eligibleForReprint:
                              event.target.checked,
                          }))
                        }
                      />
                      Eligible for local reprint
                    </label>
                  </>
                ) : null}

                {entityType === ENTITY_TYPES.REPRINT ? (
                  <>
                    {[
                      ['requestId', 'Request ID'],
                      ['displayId', 'Display ID'],
                      ['claimNumber', 'Claim number'],
                      ['memberId', 'Member ID'],
                    ].map(([field, label]) => (
                      <label
                        key={field}
                        className="block text-sm font-medium text-content dark:text-content-inverse"
                      >
                        {label}
                        <input
                          className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                          value={form[field]}
                          maxLength={200}
                          disabled={
                            pendingAction !== null ||
                            (field === 'requestId' &&
                              editingId !== null)
                          }
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                    {[
                      [
                        'requestType',
                        'Document type',
                        REPRINT_TYPES,
                      ],
                      ['priority', 'Priority', PRIORITIES],
                      [
                        'status',
                        'Request status',
                        REPRINT_STATUSES,
                      ],
                    ].map(([field, label, options]) => (
                      <label
                        key={field}
                        className="block text-sm font-medium text-content dark:text-content-inverse"
                      >
                        {label}
                        <select
                          className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                          value={form[field]}
                          disabled={pendingAction !== null}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                        >
                          {options.map((option) => (
                            <option key={option} value={option}>
                              {formatStatus(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </>
                ) : null}
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={closeForm}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                  type="submit"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'SAVE' ? (
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
                  {pendingAction === 'SAVE'
                    ? 'Saving locally…'
                    : 'Save metadata'}
                </button>
              </div>
            </form>
          ) : null}

          {selectedCollection.length === 0 ? (
            <div
              className="mt-5 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              role="status"
            >
              <FileText
                className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm text-content-muted dark:text-content-inverse-muted">
                No fictional {formatStatus(entityType).toLowerCase()}{' '}
                metadata is available.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {selectedCollection.map((record, index) => (
                <article
                  key={getRecordKey(entityType, record, index)}
                  className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        {formatStatus(entityType)} metadata
                      </p>
                      <h3 className="mt-1 break-words font-semibold text-content dark:text-content-inverse">
                        {getRecordTitle(entityType, record)}
                      </h3>
                      <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                        {getRecordSubtitle(
                          entityType,
                          record,
                          role,
                        )}
                      </p>
                    </div>
                    <StatusBadge
                      status={getRecordStatus(
                        entityType,
                        record,
                      )}
                    />
                  </div>

                  {entityType === ENTITY_TYPES.REPRINT ? (
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Type
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatStatus(record.requestType)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Priority
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatStatus(record.priority)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Member
                        </dt>
                        <dd className="mt-1 font-mono font-medium text-content dark:text-content-inverse">
                          {canEdit
                            ? record.memberId ?? '—'
                            : formatMaskedValue(
                                record.memberId,
                              )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Created
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatDateTime(record.createdAt)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  {entityType === ENTITY_TYPES.CLAIM ? (
                    <p className="mt-4 text-sm text-content-muted dark:text-content-inverse-muted">
                      Reprint eligibility:{' '}
                      <span className="font-semibold text-content dark:text-content-inverse">
                        {record.eligibleForReprint === true
                          ? 'Eligible'
                          : 'Not eligible'}
                      </span>
                    </p>
                  ) : null}

                  {canEdit ? (
                    <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 dark:border-border-dark sm:flex-row">
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => startEdit(record)}
                      >
                        <Pencil
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                        Edit metadata
                      </button>
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-danger-600 bg-surface px-4 py-2 text-sm font-semibold text-danger-700 hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-500 disabled:opacity-60 dark:bg-surface-dark dark:text-danger-100"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => {
                          setDeleteCandidate({
                            entityType,
                            record,
                          });
                          setOperationError(null);
                          setOperationMessage(null);
                        }}
                      >
                        <Trash2
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                        Remove metadata
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {role !== 'ITS' ? (
        <section
          className="mt-8"
          aria-labelledby="merged-data-lake-heading"
        >
          <div className="flex items-start gap-3">
            <Database
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="merged-data-lake-heading"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                Merged local data-lake rows
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Fictional member, claim, and reprint metadata joined
                in memory for demonstration.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {mergedRows.map((row) => (
              <article
                key={row.rowId}
                className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono font-semibold text-content dark:text-content-inverse">
                      {row.claimNumber}
                    </p>
                    <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                      {role === 'CSR'
                        ? 'Authorized fictional member'
                        : row.memberName}
                    </p>
                  </div>
                  <StatusBadge status={row.claimStatus} />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Member ID
                    </dt>
                    <dd className="mt-1 font-mono font-medium text-content dark:text-content-inverse">
                      {canEdit
                        ? row.memberId
                        : formatMaskedValue(row.memberId)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Member state
                    </dt>
                    <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                      {row.memberActive ? 'Active' : 'Inactive'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Reprint rows
                    </dt>
                    <dd className="mt-1 font-semibold tabular-nums text-content dark:text-content-inverse">
                      {row.requestCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Eligible
                    </dt>
                    <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                      {row.eligibleForReprint ? 'Yes' : 'No'}
                    </dd>
                  </div>
                </dl>

                {row.requestStatuses.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {row.requestStatuses.map((status) => (
                      <StatusBadge
                        key={status}
                        status={status}
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {role === 'ITS' ? (
        <section
          className="mt-8 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          aria-labelledby="its-constrained-view-heading"
        >
          <ShieldAlert
            className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
            aria-hidden="true"
          />
          <h2
            id="its-constrained-view-heading"
            className="mt-3 text-lg font-semibold text-content dark:text-content-inverse"
          >
            Record-level data is restricted
          </h2>
          <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
            The ITS demo role can review conceptual source labels
            and aggregate counts, but member, claim, and reprint
            rows are not displayed on this route.
          </p>
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Local data administration limitations"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Not production data administration
            </p>
            <p className="mt-1 text-sm leading-6">
              CRUD controls, source replicas, merged rows, and
              conceptual database labels do not provide secure
              identity, server authorization, durable storage,
              database administration, healthcare processing, or
              external synchronization.
            </p>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Remove this fictional metadata record?"
        description="This removes the selected row from the current browser-local demonstration view. It does not affect any real member, claim, reprint, payer, provider, or database system."
        confirmLabel="Remove metadata"
        cancelLabel="Cancel"
        confirmationText={
          deleteCandidate === null
            ? undefined
            : `REMOVE ${resolveIdentifier(
                deleteCandidate.entityType,
                deleteCandidate.record,
              )}`
        }
        destructive
        loading={pendingAction === 'DELETE'}
        onConfirm={handleDelete}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteCandidate(null);
          }
        }}
      />
    </div>
  );
}

DataAdminPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  dataAdminService: PropTypes.object,
  dataService: PropTypes.object,
  fixtureRepository: PropTypes.object,
  requestService: PropTypes.object,
  initialMembers: PropTypes.arrayOf(PropTypes.object),
  initialClaims: PropTypes.arrayOf(PropTypes.object),
  initialRequests: PropTypes.arrayOf(PropTypes.object),
  onCreate: PropTypes.func,
  onUpdate: PropTypes.func,
  onDelete: PropTypes.func,
};

export const LocalDataAdminPage = DataAdminPage;
export const DataAdministrationPage = DataAdminPage;
export const GovernanceDataAdminPage = DataAdminPage;

export default DataAdminPage;