import {
  DOCUMENT_ARTIFACTS_BY_KEY,
  DOCUMENT_AUDIENCE_SCOPES,
  DOCUMENT_DISCLOSURES,
  DOCUMENT_DOWNLOAD_NOTICE,
  DOCUMENT_LAYOUTS,
  DOCUMENT_VERSION_DETAILS_BY_ID,
} from '../../../fixtures/documents.js';
import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { redactForRole } from '../../../platform/security/maskingPolicy.js';
import { browserClock } from '../../../platform/time/clock.js';
import {
  formatMaskedValue,
  sanitizeFilename,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  DOCUMENT_ARTIFACT_KEYS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from '../domain/operationsSchemas.js';
import {
  OPERATIONS_COLLECTIONS,
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';

export const DOCUMENT_VERSION_SERVICE_SCHEMA_VERSION = 1;

export const DOCUMENT_VERSION_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  MEMBER_CLAIM_MISMATCH: 'MEMBER_CLAIM_MISMATCH',
  REQUEST_CLAIM_MISMATCH: 'REQUEST_CLAIM_MISMATCH',
  REQUEST_TYPE_NOT_AVAILABLE: 'REQUEST_TYPE_NOT_AVAILABLE',
  INVALID_DOCUMENT_STATUS: 'INVALID_DOCUMENT_STATUS',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const DOCUMENT_VERSION_AUDIT_ACTIONS = Object.freeze({
  VERSION_CREATED: 'DOCUMENT_VERSION_CREATED',
  VIEWED: 'DOCUMENT_VIEWED',
  DOWNLOAD_REQUESTED: 'DOWNLOAD_REQUESTED',
});

export const DOCUMENT_VERSION_LIMITS = Object.freeze({
  MAXIMUM_SEARCH_LENGTH: 200,
  MAXIMUM_RESULTS: 200,
  MAXIMUM_FIXTURE_TEXT_LENGTH: 20000,
});

const DOCUMENT_TYPE_VALUES = new Set(Object.values(DOCUMENT_TYPES));
const REQUEST_TYPE_VALUES = new Set(['EOB', 'EOR', 'BOTH']);
const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ARTIFACT_KEY_BY_DOCUMENT_TYPE = Object.freeze({
  [DOCUMENT_TYPES.EOB]: DOCUMENT_ARTIFACT_KEYS.EOB_SAMPLE,
  [DOCUMENT_TYPES.EOR]: DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
});
const LAYOUT_KEY_BY_DOCUMENT_TYPE = Object.freeze({
  [DOCUMENT_TYPES.EOB]: 'EOB',
  [DOCUMENT_TYPES.EOR]: 'EOR',
});

function deepFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreeze(item)));
  }

  if (isPlainObject(value)) {
    const clone = {};

    Object.entries(value).forEach(([key, item]) => {
      clone[key] = deepFreeze(item);
    });

    return Object.freeze(clone);
  }

  return value;
}

function requireRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getSnapshot !== 'function' ||
    typeof value.transact !== 'function'
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Document version service requires an operations repository with getSnapshot() and transact().',
    );
  }

  return value;
}

function requireFixtureGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.getClaimByNumber !== 'function' &&
      typeof value.findClaimByNumber !== 'function' &&
      typeof value.getSnapshot !== 'function')
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Document version service requires a fixture gateway with claim lookup support.',
    );
  }

  return value;
}

function requirePermissionGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Document version service requires a permission gateway with evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.append !== 'function') {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Document version service audit gateway must provide append().',
    );
  }

  return value;
}

function normalizeSessionProvider(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === 'function' ||
    (typeof value === 'object' &&
      (typeof value.getSession === 'function' ||
        typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function'))
  ) {
    return value;
  }

  throw new DocumentVersionServiceError(
    DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Document version service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.operationsRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.operationsRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function getCurrentDate(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Document version service clock must provide now() or nowIso().',
    );
  }

  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Document version service clock must provide a valid timestamp.',
    );
  }

  return date;
}

function createGeneratedId(idGenerator, prefix) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Document version service ID generator must return a non-empty string.',
    );
  }

  const normalized = value.normalize('NFC').trim();

  return normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return createGeneratedId(idGenerator, 'corr-');
}

function createSuccess(
  status,
  data,
  correlationId,
  revision,
  warnings = [],
) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      revision,
      schemaVersion: DOCUMENT_VERSION_SERVICE_SCHEMA_VERSION,
      warnings,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  revision,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
    },
    meta: {
      correlationId,
      revision,
      schemaVersion: DOCUMENT_VERSION_SERVICE_SCHEMA_VERSION,
    },
  });
}

function createFieldError(field, code, message) {
  return {
    field,
    code,
    message,
  };
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function readSession(provider) {
  if (provider === null) {
    return null;
  }

  if (typeof provider === 'function') {
    return provider();
  }

  if (typeof provider.getSession === 'function') {
    return provider.getSession();
  }

  const snapshot =
    typeof provider.getSnapshot === 'function'
      ? provider.getSnapshot()
      : provider.getState();

  return snapshot?.session ?? snapshot?.actor ?? null;
}

function normalizeContext(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? {
        ...value.session,
        correlationId:
          value.correlationId ?? value.session.correlationId,
      }
    : isPlainObject(value.actor)
      ? {
          ...value.actor,
          correlationId:
            value.correlationId ?? value.actor.correlationId,
        }
      : value;
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;
  const actorId =
    source.actorId ?? source.userId ?? source.requestedBy;

  if (
    typeof actorId !== 'string' ||
    actorId.trim().length === 0 ||
    actorId.trim().length > 80 ||
    !isPlatformRole(role)
  ) {
    return null;
  }

  const memberId =
    source.memberId === undefined || source.memberId === null
      ? null
      : normalizeIdentifier(source.memberId);

  if (
    source.memberId !== undefined &&
    source.memberId !== null &&
    memberId === null
  ) {
    return null;
  }

  return deepFreeze({
    actorId: actorId.normalize('NFC').trim(),
    userId: actorId.normalize('NFC').trim(),
    displayName:
      typeof source.displayName === 'string' &&
      source.displayName.trim().length > 0
        ? source.displayName.normalize('NFC').trim()
        : actorId.normalize('NFC').trim(),
    role,
    memberId,
    sessionId:
      typeof source.sessionId === 'string' &&
      source.sessionId.trim().length > 0
        ? source.sessionId.normalize('NFC').trim()
        : null,
    correlationId:
      typeof source.correlationId === 'string'
        ? source.correlationId
        : null,
  });
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.normalize('NFC').trim().toUpperCase();

  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function normalizeEntityId(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      `${name} must be a non-empty string of at most 200 characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function normalizeDocumentQuery(value) {
  const documentId = isPlainObject(value)
    ? value.documentId
    : value;

  if (
    typeof documentId !== 'string' ||
    documentId.trim().length === 0 ||
    documentId.trim().length > 200
  ) {
    return {
      documentId: null,
      errors: [
        createFieldError(
          'documentId',
          'INVALID_IDENTIFIER',
          'Document ID must be a non-empty string of at most 200 characters.',
        ),
      ],
    };
  }

  return {
    documentId: documentId.normalize('NFC').trim(),
    errors: [],
  };
}

function normalizeCreationInput(requestOrCommand, claimOrContext, context) {
  const command =
    typeof requestOrCommand === 'string'
      ? { requestId: requestOrCommand }
      : requestOrCommand;

  if (!isPlainObject(command) || !isJsonCompatible(command)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Document version request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const suppliedClaim =
    isPlainObject(claimOrContext) &&
    typeof claimOrContext.claimNumber === 'string'
      ? claimOrContext
      : isPlainObject(command.claim)
        ? command.claim
        : null;
  const suppliedContext =
    context ??
    (suppliedClaim === null ? claimOrContext : undefined);
  const requestId =
    typeof command.requestId === 'string'
      ? command.requestId.normalize('NFC').trim()
      : typeof command.request?.requestId === 'string'
        ? command.request.requestId.normalize('NFC').trim()
        : null;
  const request = isPlainObject(command.request)
    ? command.request
    : command.requestId !== undefined &&
        command.claimNumber !== undefined &&
        command.requestType !== undefined
      ? command
      : null;
  const documentDate =
    command.documentDate === undefined
      ? null
      : normalizeDateOnly(command.documentDate);
  const errors = [];

  if (
    requestId === null ||
    requestId.length === 0 ||
    requestId.length > 200
  ) {
    errors.push(
      createFieldError(
        'requestId',
        'INVALID_IDENTIFIER',
        'Request ID must be a non-empty string of at most 200 characters.',
      ),
    );
  }

  if (
    command.documentDate !== undefined &&
    documentDate === null
  ) {
    errors.push(
      createFieldError(
        'documentDate',
        'INVALID_DATE',
        'Document date must be a valid YYYY-MM-DD date.',
      ),
    );
  }

  return {
    value: {
      requestId,
      request,
      claim: suppliedClaim,
      context: suppliedContext,
      documentDate,
      createdBy:
        typeof command.createdBy === 'string' &&
        command.createdBy.trim().length > 0
          ? command.createdBy.normalize('NFC').trim()
          : null,
    },
    errors,
  };
}

function normalizeDateOnly(value) {
  if (
    typeof value !== 'string' ||
    !DATE_ONLY_PATTERN.test(value)
  ) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

function resolveRequestedDocumentTypes(requestType) {
  if (requestType === 'BOTH') {
    return [DOCUMENT_TYPES.EOB, DOCUMENT_TYPES.EOR];
  }

  return DOCUMENT_TYPE_VALUES.has(requestType)
    ? [requestType]
    : [];
}

function requestTypeSupportsClaim(claim, documentTypes) {
  if (!Array.isArray(claim.documentTypes)) {
    return true;
  }

  return documentTypes.every((documentType) =>
    claim.documentTypes.includes(documentType),
  );
}

function readClaim(gateway, claimNumber, context) {
  if (typeof gateway.getClaimByNumber === 'function') {
    return gateway.getClaimByNumber(
      claimNumber,
      context,
      ACTIONS.DOCUMENT_VIEW,
    );
  }

  if (typeof gateway.findClaimByNumber === 'function') {
    return gateway.findClaimByNumber(claimNumber, context);
  }

  const snapshot = gateway.getSnapshot();

  return (
    snapshot?.claimsByNumber?.[claimNumber] ??
    snapshot?.claims?.find(
      (claim) => claim.claimNumber === claimNumber,
    ) ??
    null
  );
}

function readMember(gateway, memberId, context) {
  if (typeof gateway.getMemberById === 'function') {
    return gateway.getMemberById(memberId, context);
  }

  if (typeof gateway.findMemberById === 'function') {
    return gateway.findMemberById(memberId, context);
  }

  const snapshot =
    typeof gateway.getSnapshot === 'function'
      ? gateway.getSnapshot()
      : null;

  return (
    snapshot?.membersById?.[memberId] ??
    snapshot?.members?.find(
      (member) => member.memberId === memberId,
    ) ??
    null
  );
}

function readProvider(gateway, providerId, context) {
  if (typeof gateway.getProviderById === 'function') {
    return gateway.getProviderById(providerId, context);
  }

  const snapshot =
    typeof gateway.getSnapshot === 'function'
      ? gateway.getSnapshot()
      : null;

  return (
    snapshot?.providersById?.[providerId] ??
    snapshot?.providers?.find(
      (provider) => provider.providerId === providerId,
    ) ??
    null
  );
}

function readServiceLines(gateway, claimNumber, context) {
  if (typeof gateway.getServiceLinesByClaim === 'function') {
    return gateway.getServiceLinesByClaim(claimNumber, context);
  }

  const snapshot =
    typeof gateway.getSnapshot === 'function'
      ? gateway.getSnapshot()
      : null;

  return (
    snapshot?.serviceLinesByClaim?.[claimNumber] ??
    snapshot?.serviceLines?.filter(
      (line) => line.claimNumber === claimNumber,
    ) ??
    []
  );
}

function getArtifactDescriptor(documentType) {
  const artifactKey = ARTIFACT_KEY_BY_DOCUMENT_TYPE[documentType];
  const artifact = DOCUMENT_ARTIFACTS_BY_KEY[artifactKey];

  if (artifact === undefined) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.ARTIFACT_NOT_FOUND,
      'The representative document artifact is unavailable.',
      {
        documentType,
        artifactKey,
      },
    );
  }

  return artifact;
}

function getLayout(documentType) {
  return DOCUMENT_LAYOUTS[
    LAYOUT_KEY_BY_DOCUMENT_TYPE[documentType]
  ];
}

function createDocumentId(documentType, claimNumber, version) {
  return `DOC-${documentType}-${claimNumber}-V${version}`;
}

function createDocumentFilename(document) {
  const compactDate = document.documentDate.replace(/-/g, '');
  const filename =
    `${document.documentType}_${document.claimNumber}_` +
    `${document.memberId}_${compactDate}_v${document.version}.pdf`;

  return sanitizeFilename(filename, {
    fallback: `${document.documentType}-document.pdf`,
  });
}

function findNextVersion(documents, request, documentType) {
  return (
    Object.values(documents).reduce((maximum, document) => {
      if (
        document.documentType === documentType &&
        document.claimNumber === request.claimNumber &&
        document.memberId === request.memberId
      ) {
        return Math.max(maximum, document.version);
      }

      return maximum;
    }, 0) + 1
  );
}

function ensureUniqueDocumentId(documents, baseId) {
  if (documents[baseId] === undefined) {
    return baseId;
  }

  let suffix = 2;

  while (documents[`${baseId}-${suffix}`] !== undefined) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

function createFixtureText({
  documentType,
  claim,
  member,
  provider,
  serviceLines,
}) {
  const artifact = getArtifactDescriptor(documentType);
  const values = [
    getLayout(documentType)?.title,
    documentType,
    member?.displayName,
    claim.memberId,
    claim.claimNumber,
    provider?.name,
    claim.status,
    claim.serviceDateFrom,
    claim.serviceDateTo,
    ...serviceLines.flatMap((line) => [
      line.procedureDescription,
      ...(Array.isArray(line.reasonCodeIds)
        ? line.reasonCodeIds
        : []),
    ]),
    artifact.searchableText,
    ...DOCUMENT_DISCLOSURES,
  ].filter(
    (value) =>
      typeof value === 'string' && value.trim().length > 0,
  );
  const fixtureText = values.join(' ').trim();

  return fixtureText.slice(
    0,
    DOCUMENT_VERSION_LIMITS.MAXIMUM_FIXTURE_TEXT_LENGTH,
  );
}

function createDocumentDetails(
  document,
  claim,
  member,
  provider,
  serviceLines,
) {
  const retained =
    DOCUMENT_VERSION_DETAILS_BY_ID[document.documentId];

  if (retained !== undefined) {
    return retained;
  }

  return deepFreeze({
    documentId: document.documentId,
    layoutId: getLayout(document.documentType)?.layoutId ?? null,
    audienceScope: getArtifactDescriptor(document.documentType)
      .audienceScope,
    memberName: member?.displayName ?? null,
    providerName: provider?.name ?? null,
    claimStatus: claim?.status ?? null,
    reviewStatus:
      document.documentType === DOCUMENT_TYPES.EOR
        ? 'COMPLETE'
        : null,
    serviceDateFrom: claim?.serviceDateFrom ?? null,
    serviceDateTo: claim?.serviceDateTo ?? null,
    billedAmount: claim?.billedAmount ?? null,
    allowedAmount: claim?.allowedAmount ?? null,
    discountAmount: claim?.discountAmount ?? null,
    planPaidAmount: claim?.planPaidAmount ?? null,
    memberResponsibilityAmount:
      claim?.memberResponsibilityAmount ?? null,
    paymentReferenceMasked:
      claim?.paymentReference === null ||
      claim?.paymentReference === undefined
        ? null
        : formatMaskedValue(claim.paymentReference),
    serviceLines: serviceLines.map((line) => ({
      serviceLineId: line.serviceLineId,
      lineNumber: line.lineNumber,
      serviceDateFrom: line.serviceDateFrom,
      serviceDateTo: line.serviceDateTo,
      procedureDescription: line.procedureDescription,
      status: line.status,
      billedAmount: line.billedAmount,
      allowedAmount: line.allowedAmount,
      planPaidAmount: line.planPaidAmount,
      memberResponsibilityAmount:
        line.memberResponsibilityAmount,
      reasonCodes: Array.isArray(line.reasonCodeIds)
        ? line.reasonCodeIds
        : [],
    })),
    documentNotice: DOCUMENT_DISCLOSURES[0],
    requiredDisclosures: DOCUMENT_DISCLOSURES.slice(1),
  });
}

function createArtifactBinding(document) {
  const artifact = getArtifactDescriptor(document.documentType);

  if (artifact.artifactKey !== document.artifactKey) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.ARTIFACT_NOT_FOUND,
      'Document metadata references an unsupported artifact.',
      {
        documentId: document.documentId,
        artifactKey: document.artifactKey,
      },
    );
  }

  return deepFreeze({
    artifactKey: artifact.artifactKey,
    assetUrl: artifact.assetUrl,
    filename: artifact.filename,
    mediaType: artifact.mediaType,
    checksumAlgorithm: artifact.checksumAlgorithm,
    checksum: artifact.checksum,
    fixtureVersion: artifact.fixtureVersion,
    representativeOnly: artifact.representativeOnly,
    audienceScope: artifact.audienceScope,
  });
}

function isAudienceAllowed(artifact, actor, document) {
  const audience =
    DOCUMENT_AUDIENCE_SCOPES[artifact.audienceScope];

  if (
    audience === undefined ||
    actor === null ||
    !audience.allowedRoles.includes(actor.role)
  ) {
    return false;
  }

  return !(
    actor.role === 'MEMBER' &&
    audience.ownershipRequiredForMember === true &&
    actor.memberId !== document.memberId
  );
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function createPreviewDto({
  document,
  artifact,
  details,
  actor,
}) {
  const owned =
    actor?.role === 'MEMBER' &&
    actor.memberId === document.memberId;
  const role = actor?.role ?? 'ITS';
  const dto = {
    documentId: document.documentId,
    documentType: document.documentType,
    documentTitle: getLayout(document.documentType)?.title ?? null,
    claimNumber: document.claimNumber,
    memberId: document.memberId,
    version: document.version,
    status: document.status,
    documentDate: document.documentDate,
    createdAt: document.createdAt,
    createdBy: document.createdBy,
    requestId: document.requestId,
    representativeOnly: true,
    audienceScope: artifact.audienceScope,
    layout: getLayout(document.documentType),
    details,
    artifact: {
      artifactKey: artifact.artifactKey,
      mediaType: artifact.mediaType,
      checksumAlgorithm: artifact.checksumAlgorithm,
      checksum: artifact.checksum,
      fixtureVersion: artifact.fixtureVersion,
      representativeOnly: artifact.representativeOnly,
    },
    documentNotice: DOCUMENT_DISCLOSURES[0],
    requiredDisclosures: DOCUMENT_DISCLOSURES.slice(1),
  };

  return redactForRole(dto, role, {
    owned,
    fieldPolicies: {
      documentId: 'PRESERVE',
      requestId: 'PRESERVE',
      artifactKey: 'PRESERVE',
      checksum: 'PRESERVE',
      createdBy: 'PRESERVE',
    },
  });
}

function compareDocuments(left, right) {
  if (left.documentDate !== right.documentDate) {
    return right.documentDate.localeCompare(left.documentDate);
  }

  if (left.documentType !== right.documentType) {
    return left.documentType.localeCompare(
      right.documentType,
      'en-US',
    );
  }

  if (left.version !== right.version) {
    return right.version - left.version;
  }

  return left.documentId.localeCompare(
    right.documentId,
    'en-US',
  );
}

function normalizeSearchQuery(value) {
  if (typeof value === 'string') {
    value = { search: value };
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Document search query must be a safe object or string.',
    );
  }

  const searchValue = value.search ?? value.query ?? value.q;
  const search =
    searchValue === undefined ||
    searchValue === null ||
    searchValue === ''
      ? null
      : typeof searchValue === 'string'
        ? searchValue.normalize('NFKC').trim().toLocaleLowerCase('en-US')
        : null;

  if (
    searchValue !== undefined &&
    searchValue !== null &&
    searchValue !== '' &&
    (search === null ||
      search.length === 0 ||
      search.length >
        DOCUMENT_VERSION_LIMITS.MAXIMUM_SEARCH_LENGTH)
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      `Document search must contain at most ${DOCUMENT_VERSION_LIMITS.MAXIMUM_SEARCH_LENGTH} characters.`,
    );
  }

  const documentType =
    value.documentType === undefined ||
    value.documentType === null ||
    value.documentType === ''
      ? null
      : String(value.documentType).trim().toUpperCase();

  if (
    documentType !== null &&
    !DOCUMENT_TYPE_VALUES.has(documentType)
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Document type must be EOB or EOR.',
    );
  }

  const claimNumber =
    value.claimNumber === undefined ||
    value.claimNumber === null ||
    value.claimNumber === ''
      ? null
      : normalizeIdentifier(value.claimNumber);
  const memberId =
    value.memberId === undefined ||
    value.memberId === null ||
    value.memberId === ''
      ? null
      : normalizeIdentifier(value.memberId);

  if (
    value.claimNumber !== undefined &&
    value.claimNumber !== null &&
    value.claimNumber !== '' &&
    claimNumber === null
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Claim number is invalid.',
    );
  }

  if (
    value.memberId !== undefined &&
    value.memberId !== null &&
    value.memberId !== '' &&
    memberId === null
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      'Member ID is invalid.',
    );
  }

  const limit = value.limit ?? 50;

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > DOCUMENT_VERSION_LIMITS.MAXIMUM_RESULTS
  ) {
    throw new DocumentVersionServiceError(
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
      `Document search limit must be between 1 and ${DOCUMENT_VERSION_LIMITS.MAXIMUM_RESULTS}.`,
    );
  }

  return {
    search,
    documentType,
    claimNumber,
    memberId,
    limit,
  };
}

function normalizeRepositoryFailure(
  error,
  correlationId,
  revision,
) {
  const code = getErrorCode(error);

  if (
    code === OPERATIONS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT ||
    code === 'REVISION_CONFLICT'
  ) {
    return createFailure(
      409,
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before document versions could be stored.',
      correlationId,
      revision,
      { retryable: true },
    );
  }

  if (
    code === 'STORAGE_QUOTA_EXCEEDED' ||
    code === 'LOCAL_STORAGE_QUOTA'
  ) {
    return createFailure(
      507,
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof DocumentVersionServiceError) {
    const status =
      error.code ===
      DOCUMENT_VERSION_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND
        ? 404
        : error.code ===
            DOCUMENT_VERSION_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND
          ? 404
          : error.code ===
              DOCUMENT_VERSION_SERVICE_ERROR_CODES.FORBIDDEN
            ? 403
            : error.code ===
                DOCUMENT_VERSION_SERVICE_ERROR_CODES.VERSION_CONFLICT
              ? 409
              : 422;

    return createFailure(
      status,
      error.code,
      error.message,
      correlationId,
      revision,
      { details: error.details },
    );
  }

  return createFailure(
    500,
    DOCUMENT_VERSION_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'Document versions could not be stored.',
    correlationId,
    revision,
    {
      details: {
        dependencyCode: code,
      },
    },
  );
}

/**
 * Error raised when document version service input or dependencies are invalid.
 */
export class DocumentVersionServiceError extends Error {
  /**
   * @param {string} code Stable service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DocumentVersionServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Service for atomic document version allocation and representative artifacts.
 */
export class DocumentVersionService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options containing injected dependencies.
   * @param {{
   *   fixtureGateway?: object,
   *   fixtureRepository?: object,
   *   permissionGateway?: object,
   *   permissionService?: object,
   *   auditGateway?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.repository = requireRepository(resolved.repository);
    this.fixtureGateway = requireFixtureGateway(
      normalizedOptions.fixtureGateway ??
        normalizedOptions.fixtureRepository ??
        normalizedOptions.fixtures,
    );
    this.permissionGateway = requirePermissionGateway(
      normalizedOptions.permissionGateway ??
        normalizedOptions.permissionService,
    );
    this.auditGateway = normalizeAuditGateway(
      normalizedOptions.auditGateway ??
        normalizedOptions.auditService,
    );
    this.sessionProvider = normalizeSessionProvider(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade ??
        this.permissionGateway.sessionProvider,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Document version service ID generator must be a function.',
      );
    }
  }

  getRevision() {
    return this.repository.getSnapshot().revision;
  }

  resolveContext(context) {
    const supplied = normalizeContext(context);

    if (supplied !== null) {
      return supplied;
    }

    try {
      return normalizeContext(readSession(this.sessionProvider));
    } catch {
      return null;
    }
  }

  async authorize(action, document, actor, correlationId) {
    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          DOCUMENT_VERSION_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
          'An active demo session is required.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    let artifact;

    try {
      artifact = createArtifactBinding(document);
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          422,
          DOCUMENT_VERSION_SERVICE_ERROR_CODES.ARTIFACT_NOT_FOUND,
          error.message,
          correlationId,
          this.getRevision(),
          { details: error.details },
        ),
      };
    }

    if (!isAudienceAllowed(artifact, actor, document)) {
      return {
        allowed: false,
        failure: createFailure(
          403,
          DOCUMENT_VERSION_SERVICE_ERROR_CODES.FORBIDDEN,
          'This demo role cannot access the representative document.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action,
          resource: {
            type: 'DOCUMENT',
            id: document.documentId,
            documentId: document.documentId,
            claimNumber: document.claimNumber,
            memberId: document.memberId,
            ownerMemberId: document.memberId,
            audienceScope: artifact.audienceScope,
            owned:
              actor.role !== 'MEMBER' ||
              actor.memberId === document.memberId,
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Document permission evaluation could not be completed.',
          correlationId,
          this.getRevision(),
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        ),
      };
    }

    if (decision?.allowed === true) {
      return {
        allowed: true,
        decision,
        artifact,
      };
    }

    const unauthenticated =
      decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
      decision?.reasonCode === 'SESSION_EXPIRED';

    return {
      allowed: false,
      failure: createFailure(
        unauthenticated ? 401 : 403,
        unauthenticated
          ? DOCUMENT_VERSION_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : DOCUMENT_VERSION_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'This demo role cannot access the representative document.',
        correlationId,
        this.getRevision(),
        {
          details: {
            reasonCode: decision?.reasonCode ?? null,
          },
        },
      ),
    };
  }

  async appendAudit({
    correlationId,
    actor,
    action,
    document,
  }) {
    if (this.auditGateway === null || actor === null) {
      return null;
    }

    try {
      await this.auditGateway.append(
        {
          correlationId,
          actor: {
            userId: actor.actorId,
            displayName: actor.displayName,
            role: actor.role,
          },
          action,
          entity: {
            type: 'DOCUMENT',
            id: document.documentId,
          },
        },
        {
          action,
          entity: {
            type: 'DOCUMENT',
            id: document.documentId,
          },
          before: null,
          after: {
            documentId: document.documentId,
            documentType: document.documentType,
            claimNumber: document.claimNumber,
            memberId: document.memberId,
            version: document.version,
            status: document.status,
            artifactKey: document.artifactKey,
          },
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: DOCUMENT_VERSION_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The document operation completed, but its local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Atomically allocates immutable EOB and/or EOR versions for a request.
   *
   * Supports `createVersions(request, claim, context)` and
   * `createVersions({requestId, claim, documentDate}, context)`.
   *
   * @param {string|Record<string, unknown>} requestOrCommand Request or command.
   * @param {Record<string, unknown>} [claimOrContext] Claim or actor context.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async createVersions(
    requestOrCommand,
    claimOrContext = undefined,
    context = undefined,
  ) {
    const normalized = normalizeCreationInput(
      requestOrCommand,
      claimOrContext,
      context,
    );
    const suppliedContext = normalized.value?.context;
    const actor = this.resolveContext(suppliedContext);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? suppliedContext,
    );
    const initialRevision = this.getRevision();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Document version request validation failed.',
        correlationId,
        initialRevision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const snapshot = this.repository.getSnapshot();
    const request =
      input.request ??
      snapshot.requests[input.requestId] ??
      null;

    if (request === null) {
      return createFailure(
        404,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND,
        'The reprint request does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (request.requestId !== input.requestId) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_REQUEST,
        'The supplied request does not match the request ID.',
        correlationId,
        snapshot.revision,
      );
    }

    if (!REQUEST_TYPE_VALUES.has(request.requestType)) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'The request type cannot produce document versions.',
        correlationId,
        snapshot.revision,
      );
    }

    let claim = input.claim;

    try {
      claim =
        claim ??
        (await readClaim(
          this.fixtureGateway,
          request.claimNumber,
          actor,
        ));
    } catch (error) {
      return createFailure(
        500,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'The fictional claim fixture could not be read.',
        correlationId,
        snapshot.revision,
        {
          details: {
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    if (claim === null || claim === undefined) {
      return createFailure(
        404,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
        'The fictional claim was not found or is not accessible.',
        correlationId,
        snapshot.revision,
      );
    }

    if (
      claim.claimNumber !== request.claimNumber ||
      claim.memberId !== request.memberId
    ) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.MEMBER_CLAIM_MISMATCH,
        'The fictional claim and request member do not match.',
        correlationId,
        snapshot.revision,
      );
    }

    const documentTypes = resolveRequestedDocumentTypes(
      request.requestType,
    );

    if (
      documentTypes.length === 0 ||
      !requestTypeSupportsClaim(claim, documentTypes)
    ) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.REQUEST_TYPE_NOT_AVAILABLE,
        'The requested document type is not available for this fictional claim.',
        correlationId,
        snapshot.revision,
      );
    }

    let member = null;
    let provider = null;
    let serviceLines = [];

    try {
      member = await readMember(
        this.fixtureGateway,
        request.memberId,
        actor,
      );
      provider = await readProvider(
        this.fixtureGateway,
        claim.providerId,
        actor,
      );
      serviceLines = await readServiceLines(
        this.fixtureGateway,
        claim.claimNumber,
        actor,
      );
    } catch (error) {
      return createFailure(
        500,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Document fixture details could not be read.',
        correlationId,
        snapshot.revision,
        {
          details: {
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    const now = getCurrentDate(this.clock);
    const createdAt = now.toISOString();
    const documentDate =
      input.documentDate ?? createdAt.slice(0, 10);
    const createdBy =
      input.createdBy ??
      actor?.actorId ??
      request.requestedBy ??
      'system';
    let createdDocumentIds = [];
    let replayed = false;
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const storedRequest =
            draft.requests[input.requestId];

          if (storedRequest === undefined) {
            throw new DocumentVersionServiceError(
              DOCUMENT_VERSION_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND,
              'The reprint request no longer exists.',
            );
          }

          if (
            storedRequest.claimNumber !== claim.claimNumber ||
            storedRequest.memberId !== claim.memberId
          ) {
            throw new DocumentVersionServiceError(
              DOCUMENT_VERSION_SERVICE_ERROR_CODES.REQUEST_CLAIM_MISMATCH,
              'The reprint request changed before document allocation.',
            );
          }

          const existingDocuments =
            storedRequest.documentReferences
              .map((documentId) => draft.documents[documentId])
              .filter(Boolean);
          const existingTypes = new Set(
            existingDocuments.map(
              (document) => document.documentType,
            ),
          );
          const missingTypes = documentTypes.filter(
            (documentType) => !existingTypes.has(documentType),
          );

          if (missingTypes.length === 0) {
            replayed = true;
            createdDocumentIds = existingDocuments
              .filter((document) =>
                documentTypes.includes(document.documentType),
              )
              .map((document) => document.documentId);
            return;
          }

          createdDocumentIds = missingTypes.map(
            (documentType) => {
              const version = findNextVersion(
                draft.documents,
                storedRequest,
                documentType,
              );
              const documentId = ensureUniqueDocumentId(
                draft.documents,
                createDocumentId(
                  documentType,
                  storedRequest.claimNumber,
                  version,
                ),
              );
              const artifact =
                getArtifactDescriptor(documentType);
              const document = {
                documentId,
                documentType,
                claimNumber: storedRequest.claimNumber,
                memberId: storedRequest.memberId,
                version,
                status: DOCUMENT_STATUSES.COMPLETE,
                documentDate,
                artifactKey: artifact.artifactKey,
                fixtureText: createFixtureText({
                  documentType,
                  claim,
                  member,
                  provider,
                  serviceLines: Array.isArray(serviceLines)
                    ? serviceLines
                    : [],
                }),
                createdAt,
                createdBy,
                requestId: storedRequest.requestId,
              };

              draft.documents[documentId] = document;
              return documentId;
            },
          );

          storedRequest.documentReferences = [
            ...storedRequest.documentReferences,
            ...createdDocumentIds,
          ];
          storedRequest.result =
            documentTypes.length === 2
              ? 'EOB and EOR representative documents stored.'
              : `${documentTypes[0]} representative document stored.`;
          storedRequest.version += 1;
        },
        {
          expectedRevision: snapshot.revision,
        },
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    const documents = createdDocumentIds
      .map((documentId) => storedEnvelope.documents[documentId])
      .filter(Boolean)
      .sort(compareDocuments);
    const warnings = [];

    if (!replayed) {
      for (const document of documents) {
        const warning = await this.appendAudit({
          correlationId,
          actor,
          action:
            DOCUMENT_VERSION_AUDIT_ACTIONS.VERSION_CREATED,
          document,
        });

        if (warning !== null) {
          warnings.push(warning);
        }
      }
    }

    return createSuccess(
      replayed ? 200 : 201,
      {
        requestId: request.requestId,
        replayed,
        documentIds: documents.map(
          (document) => document.documentId,
        ),
        documents,
      },
      correlationId,
      storedEnvelope.revision,
      warnings,
    );
  }

  /**
   * Returns a role-aware preview DTO for one immutable document version.
   *
   * @param {string|Record<string, unknown>} query Document query.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async openDocument(query, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeDocumentQuery(query);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Document query validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const document =
      snapshot.documents[normalized.documentId] ?? null;

    if (document === null) {
      return createFailure(
        404,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND,
        'The representative document does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (document.status !== DOCUMENT_STATUSES.COMPLETE) {
      return createFailure(
        409,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DOCUMENT_STATUS,
        'The representative document is not available for viewing.',
        correlationId,
        snapshot.revision,
      );
    }

    const authorization = await this.authorize(
      ACTIONS.DOCUMENT_VIEW,
      document,
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let claim;
    let member;
    let provider;
    let serviceLines;

    try {
      claim = await readClaim(
        this.fixtureGateway,
        document.claimNumber,
        actor,
      );
      member = await readMember(
        this.fixtureGateway,
        document.memberId,
        actor,
      );
      provider =
        claim === null || claim === undefined
          ? null
          : await readProvider(
              this.fixtureGateway,
              claim.providerId,
              actor,
            );
      serviceLines = await readServiceLines(
        this.fixtureGateway,
        document.claimNumber,
        actor,
      );
    } catch (error) {
      return createFailure(
        500,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Document preview fixtures could not be read.',
        correlationId,
        snapshot.revision,
        {
          details: {
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    if (claim === null || claim === undefined) {
      return createFailure(
        404,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
        'The fictional claim was not found or is not accessible.',
        correlationId,
        snapshot.revision,
      );
    }

    const details = createDocumentDetails(
      document,
      claim,
      member,
      provider,
      Array.isArray(serviceLines) ? serviceLines : [],
    );
    const preview = createPreviewDto({
      document,
      artifact: authorization.artifact,
      details,
      actor,
    });
    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: DOCUMENT_VERSION_AUDIT_ACTIONS.VIEWED,
      document,
    });

    return createSuccess(
      200,
      preview,
      correlationId,
      snapshot.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  /**
   * Returns an authorized same-origin representative artifact descriptor.
   *
   * @param {string|Record<string, unknown>} query Document query.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async downloadDocument(query, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeDocumentQuery(query);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Document download request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const document =
      snapshot.documents[normalized.documentId] ?? null;

    if (document === null) {
      return createFailure(
        404,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.DOCUMENT_NOT_FOUND,
        'The representative document does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (document.status !== DOCUMENT_STATUSES.COMPLETE) {
      return createFailure(
        409,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.INVALID_DOCUMENT_STATUS,
        'The representative document is not available for download.',
        correlationId,
        snapshot.revision,
      );
    }

    const authorization = await this.authorize(
      ACTIONS.DOCUMENT_DOWNLOAD,
      document,
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const artifact = authorization.artifact;
    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action:
        DOCUMENT_VERSION_AUDIT_ACTIONS.DOWNLOAD_REQUESTED,
      document,
    });

    return createSuccess(
      200,
      {
        documentId: document.documentId,
        documentType: document.documentType,
        claimNumber: document.claimNumber,
        memberId: document.memberId,
        version: document.version,
        documentDate: document.documentDate,
        artifactKey: artifact.artifactKey,
        assetUrl: artifact.assetUrl,
        filename: createDocumentFilename(document),
        mediaType: artifact.mediaType,
        checksumAlgorithm: artifact.checksumAlgorithm,
        checksum: artifact.checksum,
        representativeOnly: true,
        notice: DOCUMENT_DOWNLOAD_NOTICE,
        documentNotice: DOCUMENT_DISCLOSURES[0],
        requiredDisclosures: DOCUMENT_DISCLOSURES.slice(1),
      },
      correlationId,
      snapshot.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  /**
   * Searches retained document metadata visible to the current actor.
   *
   * @param {string|Record<string, unknown>} [query] Search filters.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async searchDocuments(query = {}, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const snapshot = this.repository.getSnapshot();
    let normalized;

    try {
      normalized = normalizeSearchQuery(query);
    } catch (error) {
      return createFailure(
        422,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        error.message,
        correlationId,
        snapshot.revision,
      );
    }

    if (actor === null) {
      return createFailure(
        401,
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
        'An active demo session is required.',
        correlationId,
        snapshot.revision,
      );
    }

    const candidates = Object.values(snapshot.documents)
      .filter(
        (document) =>
          document.status === DOCUMENT_STATUSES.COMPLETE,
      )
      .filter(
        (document) =>
          normalized.documentType === null ||
          document.documentType === normalized.documentType,
      )
      .filter(
        (document) =>
          normalized.claimNumber === null ||
          document.claimNumber === normalized.claimNumber,
      )
      .filter(
        (document) =>
          normalized.memberId === null ||
          document.memberId === normalized.memberId,
      )
      .filter((document) => {
        if (normalized.search === null) {
          return true;
        }

        return [
          document.documentId,
          document.documentType,
          document.claimNumber,
          document.memberId,
          document.fixtureText,
        ]
          .join(' ')
          .toLocaleLowerCase('en-US')
          .includes(normalized.search);
      })
      .sort(compareDocuments);
    const items = [];

    for (const document of candidates) {
      if (items.length >= normalized.limit) {
        break;
      }

      const authorization = await this.authorize(
        ACTIONS.DOCUMENT_VIEW,
        document,
        actor,
        correlationId,
      );

      if (!authorization.allowed) {
        continue;
      }

      items.push(
        redactForRole(
          {
            documentId: document.documentId,
            documentType: document.documentType,
            documentTitle:
              getLayout(document.documentType)?.title ?? null,
            claimNumber: document.claimNumber,
            memberId: document.memberId,
            version: document.version,
            status: document.status,
            documentDate: document.documentDate,
            createdAt: document.createdAt,
            audienceScope:
              authorization.artifact.audienceScope,
            representativeOnly: true,
          },
          actor.role,
          {
            owned:
              actor.role === 'MEMBER' &&
              actor.memberId === document.memberId,
            fieldPolicies: {
              documentId: 'PRESERVE',
            },
          },
        ),
      );
    }

    return createSuccess(
      200,
      {
        items,
        total: items.length,
        limit: normalized.limit,
      },
      correlationId,
      snapshot.revision,
    );
  }

  getDocumentById(documentId) {
    const identifier = normalizeEntityId(
      documentId,
      'Document ID',
    );

    return (
      this.repository.getSnapshot().documents[identifier] ??
      null
    );
  }

  getDocumentsByClaim(claimNumber) {
    const identifier = normalizeIdentifier(claimNumber);

    if (identifier === null) {
      throw new DocumentVersionServiceError(
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Claim number is invalid.',
      );
    }

    return deepFreeze(
      Object.values(this.repository.getSnapshot().documents)
        .filter(
          (document) =>
            document.claimNumber === identifier,
        )
        .sort(compareDocuments),
    );
  }

  getArtifactDescriptor(documentOrType) {
    const documentType =
      typeof documentOrType === 'string'
        ? documentOrType.trim().toUpperCase()
        : documentOrType?.documentType;

    if (!DOCUMENT_TYPE_VALUES.has(documentType)) {
      throw new DocumentVersionServiceError(
        DOCUMENT_VERSION_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Document type must be EOB or EOR.',
      );
    }

    return getArtifactDescriptor(documentType);
  }

  create(requestOrCommand, claimOrContext, context) {
    return this.createVersions(
      requestOrCommand,
      claimOrContext,
      context,
    );
  }

  open(query, context = undefined) {
    return this.openDocument(query, context);
  }

  download(query, context = undefined) {
    return this.downloadDocument(query, context);
  }

  search(query = {}, context = undefined) {
    return this.searchDocuments(query, context);
  }

  findDocumentById(documentId) {
    return this.getDocumentById(documentId);
  }

  listDocumentsByClaim(claimNumber) {
    return this.getDocumentsByClaim(claimNumber);
  }
}

/**
 * Creates a document version service.
 *
 * @param {ConstructorParameters<typeof DocumentVersionService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof DocumentVersionService>[1]} [options]
 * Service options.
 * @returns {DocumentVersionService} Document version service.
 */
export function createDocumentVersionService(
  repositoryOrOptions,
  options = {},
) {
  return new DocumentVersionService(
    repositoryOrOptions,
    options,
  );
}

export const LocalDocumentVersionService =
  DocumentVersionService;
export const OperationsDocumentVersionService =
  DocumentVersionService;
export const createLocalDocumentVersionService =
  createDocumentVersionService;
export const createOperationsDocumentVersionService =
  createDocumentVersionService;

export default DocumentVersionService;