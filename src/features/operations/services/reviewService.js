import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  PIPELINE_STATUSES,
  REQUEST_STATUSES,
} from '../domain/domainConstants.js';
import {
  ERROR_REPORT_STATUSES,
  REVIEW_STATUSES,
  isOperationsUuid,
} from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';

export const REVIEW_SERVICE_SCHEMA_VERSION = 1;

export const REVIEW_DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
});

export const CLAIM_ADJUSTMENT_FIELDS = Object.freeze([
  'patientResponsibilityCents',
  'memberResponsibilityCents',
]);

export const REVIEW_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  REVIEW_NOT_FOUND: 'REVIEW_NOT_FOUND',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  INVALID_DECISION: 'INVALID_DECISION',
  INVALID_REVIEW_STATE: 'INVALID_REVIEW_STATE',
  REASON_REQUIRED: 'REASON_REQUIRED',
  FIELD_NOT_ALLOWLISTED: 'FIELD_NOT_ALLOWLISTED',
  INVALID_ADJUSTMENT_VALUE: 'INVALID_ADJUSTMENT_VALUE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const REVIEW_AUDIT_ACTIONS = Object.freeze({
  DECIDED: 'REVIEW_DECIDED',
  CLAIM_ADJUSTED: 'CLAIM_ADJUSTED',
});

export const REVIEW_SERVICE_LIMITS = Object.freeze({
  MAXIMUM_IDENTIFIER_LENGTH: 100,
  MAXIMUM_REASON_LENGTH: 100,
  MAXIMUM_COMMENT_LENGTH: 500,
  MAXIMUM_ADJUSTMENT_CENTS: Number.MAX_SAFE_INTEGER,
});

const REVIEW_DECISION_VALUES = new Set(
  Object.values(REVIEW_DECISIONS),
);
const CLAIM_ADJUSTMENT_FIELD_VALUES = new Set(
  CLAIM_ADJUSTMENT_FIELDS,
);
const REVIEW_ROLES = new Set(['BOS', 'ADMIN']);
const MAXIMUM_ERROR_REPORT_ID_LENGTH = 100;

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

function cloneMutable(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneMutable(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneMutable(item),
      ]),
    );
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
    throw new ReviewServiceError(
      REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Review service requires an operations repository with getSnapshot() and transact().',
    );
  }

  return value;
}

function normalizeFixtureGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const canReadClaim =
    typeof value.getClaimByNumber === 'function' ||
    typeof value.findClaimByNumber === 'function' ||
    typeof value.getSnapshot === 'function';
  const canUpdateClaim =
    typeof value.adjustClaim === 'function' ||
    typeof value.applyClaimAdjustment === 'function' ||
    typeof value.updateClaim === 'function';

  if (
    typeof value !== 'object' ||
    !canReadClaim ||
    !canUpdateClaim
  ) {
    throw new ReviewServiceError(
      REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Review service fixture gateway must support claim lookup and claim adjustment.',
    );
  }

  return value;
}

function normalizePermissionGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new ReviewServiceError(
      REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Review service permission gateway must provide evaluate().',
    );
  }

  return value;
}

function normalizeAuditGateway(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    typeof value.append !== 'function'
  ) {
    throw new ReviewServiceError(
      REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Review service audit gateway must provide append().',
    );
  }

  return value;
}

function normalizePipelineOrchestrator(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.resumeRequest !== 'function' &&
      typeof value.resume !== 'function')
  ) {
    throw new ReviewServiceError(
      REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Review service pipeline orchestrator must provide resumeRequest() or resume().',
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

  throw new ReviewServiceError(
    REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Review service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
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
  const actorId =
    source.actorId ?? source.userId ?? source.requestedBy;
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;

  if (
    typeof actorId !== 'string' ||
    actorId.trim().length === 0 ||
    actorId.trim().length > 80 ||
    !isPlatformRole(role)
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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim().toUpperCase()
        : null,
    correlationId:
      typeof source.correlationId === 'string' &&
      source.correlationId.trim().length > 0
        ? source.correlationId.normalize('NFC').trim()
        : null,
  });
}

function getCurrentTimestamp(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Review service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Review service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedUuid(idGenerator, name) {
  const value = idGenerator();

  if (!isOperationsUuid(value)) {
    throw new TypeError(
      `${name} generator must return an RFC 4122 UUID.`,
    );
  }

  return value.toLowerCase();
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return `corr-${createGeneratedUuid(
    idGenerator,
    'Review service ID',
  )}`;
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
      schemaVersion: REVIEW_SERVICE_SCHEMA_VERSION,
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
      schemaVersion: REVIEW_SERVICE_SCHEMA_VERSION,
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

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function normalizeEntityId(value, field, errors) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length >
      REVIEW_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH
  ) {
    errors.push(
      createFieldError(
        field,
        'INVALID_IDENTIFIER',
        `${field} must be a non-empty string of at most ${REVIEW_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH} characters.`,
      ),
    );
    return null;
  }

  return value.normalize('NFC').trim();
}

function normalizeReasonCode(value, errors) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length >
      REVIEW_SERVICE_LIMITS.MAXIMUM_REASON_LENGTH
  ) {
    errors.push(
      createFieldError(
        'reasonCode',
        'REASON_REQUIRED',
        `Reason code is required and must not exceed ${REVIEW_SERVICE_LIMITS.MAXIMUM_REASON_LENGTH} characters.`,
      ),
    );
    return null;
  }

  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
}

function normalizeComment(value, errors) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (
    typeof value !== 'string' ||
    value.trim().length >
      REVIEW_SERVICE_LIMITS.MAXIMUM_COMMENT_LENGTH
  ) {
    errors.push(
      createFieldError(
        'comment',
        'INVALID_LENGTH',
        `Review comment must not exceed ${REVIEW_SERVICE_LIMITS.MAXIMUM_COMMENT_LENGTH} characters.`,
      ),
    );
    return '';
  }

  return value.normalize('NFC').trim();
}

function normalizeIdempotencyKey(value, errors) {
  if (!isOperationsUuid(value)) {
    errors.push(
      createFieldError(
        'idempotencyKey',
        'INVALID_UUID',
        'Idempotency key must be an RFC 4122 UUID.',
      ),
    );
    return null;
  }

  return value.toLowerCase();
}

function normalizeDecisionCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Review decision request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    'reviewId',
    'decision',
    'reasonCode',
    'comment',
    'idempotencyKey',
  ]);
  const errors = Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Review decision field ${field} is not supported.`,
      ),
    );
  const reviewId = normalizeEntityId(
    value.reviewId,
    'reviewId',
    errors,
  );
  const decision =
    typeof value.decision === 'string'
      ? value.decision.trim().toUpperCase()
      : value.decision;
  const reasonCode = normalizeReasonCode(
    value.reasonCode,
    errors,
  );
  const comment = normalizeComment(value.comment, errors);
  const idempotencyKey = normalizeIdempotencyKey(
    value.idempotencyKey,
    errors,
  );

  if (!REVIEW_DECISION_VALUES.has(decision)) {
    errors.push(
      createFieldError(
        'decision',
        'INVALID_DECISION',
        'Review decision must be APPROVE or REJECT.',
      ),
    );
  }

  return {
    value: {
      reviewId,
      decision,
      reasonCode,
      comment,
      idempotencyKey,
    },
    errors,
  };
}

function normalizeAdjustmentCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Claim adjustment request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    'claimNumber',
    'field',
    'newValue',
    'reasonCode',
    'comment',
    'notes',
    'idempotencyKey',
  ]);
  const errors = Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Claim adjustment field ${field} is not supported.`,
      ),
    );
  const claimNumber = normalizeEntityId(
    value.claimNumber,
    'claimNumber',
    errors,
  );
  const field =
    typeof value.field === 'string'
      ? value.field.normalize('NFC').trim()
      : value.field;
  const reasonCode = normalizeReasonCode(
    value.reasonCode,
    errors,
  );
  const comment = normalizeComment(
    value.comment ?? value.notes,
    errors,
  );
  const idempotencyKey = normalizeIdempotencyKey(
    value.idempotencyKey,
    errors,
  );

  if (!CLAIM_ADJUSTMENT_FIELD_VALUES.has(field)) {
    errors.push(
      createFieldError(
        'field',
        'FIELD_NOT_ALLOWLISTED',
        `Claim adjustment field must be one of: ${CLAIM_ADJUSTMENT_FIELDS.join(', ')}.`,
      ),
    );
  }

  if (
    !Number.isSafeInteger(value.newValue) ||
    value.newValue < 0 ||
    value.newValue >
      REVIEW_SERVICE_LIMITS.MAXIMUM_ADJUSTMENT_CENTS
  ) {
    errors.push(
      createFieldError(
        'newValue',
        'INVALID_ADJUSTMENT_VALUE',
        'Claim adjustment value must be a non-negative safe integer number of cents.',
      ),
    );
  }

  return {
    value: {
      claimNumber,
      field,
      newValue: value.newValue,
      reasonCode,
      comment,
      idempotencyKey,
    },
    errors,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(value[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashCommand(commandName, value) {
  const source = `${commandName}|${canonicalize(value)}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function readClaim(gateway, claimNumber, actor) {
  if (typeof gateway.getClaimByNumber === 'function') {
    return gateway.getClaimByNumber(
      claimNumber,
      actor,
      ACTIONS.REPRINT_APPROVE,
    );
  }

  if (typeof gateway.findClaimByNumber === 'function') {
    return gateway.findClaimByNumber(claimNumber, actor);
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

function resolveFixtureRevisions(gateway) {
  const snapshot =
    typeof gateway.getSnapshot === 'function'
      ? gateway.getSnapshot()
      : null;

  return {
    expectedRevision:
      typeof gateway.getOverlayRevision === 'function'
        ? gateway.getOverlayRevision()
        : snapshot?.overlayRevision,
    expectedRootRevision:
      typeof gateway.getRevision === 'function'
        ? gateway.getRevision()
        : snapshot?.revision,
  };
}

function resolveResponsibilityCents(claim, field) {
  if (
    Number.isSafeInteger(claim?.[field]) &&
    claim[field] >= 0
  ) {
    return claim[field];
  }

  if (
    Number.isSafeInteger(claim?.patientResponsibilityCents) &&
    claim.patientResponsibilityCents >= 0
  ) {
    return claim.patientResponsibilityCents;
  }

  if (
    Number.isSafeInteger(claim?.memberResponsibilityCents) &&
    claim.memberResponsibilityCents >= 0
  ) {
    return claim.memberResponsibilityCents;
  }

  if (
    typeof claim?.memberResponsibilityAmount === 'number' &&
    Number.isFinite(claim.memberResponsibilityAmount) &&
    claim.memberResponsibilityAmount >= 0
  ) {
    return Math.round(claim.memberResponsibilityAmount * 100);
  }

  return null;
}

async function applyClaimAdjustment(
  gateway,
  claim,
  command,
  actor,
  correlationId,
) {
  const adjustment = {
    claimNumber: claim.claimNumber,
    field: command.field,
    newValue: command.newValue,
    reasonCode: command.reasonCode,
    comment: command.comment,
  };

  if (typeof gateway.applyClaimAdjustment === 'function') {
    return gateway.applyClaimAdjustment(adjustment, {
      correlationId,
      updatedBy: actor.actorId,
    });
  }

  if (typeof gateway.adjustClaim === 'function') {
    return gateway.adjustClaim(adjustment, {
      correlationId,
      updatedBy: actor.actorId,
    });
  }

  const revisions = resolveFixtureRevisions(gateway);

  return gateway.updateClaim(
    claim.claimNumber,
    {
      [command.field]: command.newValue,
    },
    {
      ...(Number.isSafeInteger(revisions.expectedRevision)
        ? { expectedRevision: revisions.expectedRevision }
        : {}),
      ...(Number.isSafeInteger(revisions.expectedRootRevision)
        ? {
            expectedRootRevision:
              revisions.expectedRootRevision,
          }
        : {}),
      updatedBy: actor.actorId,
      correlationId,
      reasonCode: command.reasonCode,
    },
  );
}

function getProcessingTimeMs(request, completedAt) {
  const startedAt = request.startedAt ?? request.createdAt;
  const duration =
    Date.parse(completedAt) - Date.parse(startedAt);

  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function createUniqueErrorReportId(errorReports, reviewId) {
  const safeReviewId = reviewId
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .slice(0, MAXIMUM_ERROR_REPORT_ID_LENGTH - 13);
  const baseId = `ERROR-REVIEW-${safeReviewId}`.slice(
    0,
    MAXIMUM_ERROR_REPORT_ID_LENGTH,
  );

  if (errorReports[baseId] === undefined) {
    return baseId;
  }

  let suffix = 2;

  while (suffix < 10000) {
    const suffixText = `-${suffix}`;
    const candidate =
      `${baseId.slice(
        0,
        MAXIMUM_ERROR_REPORT_ID_LENGTH - suffixText.length,
      )}${suffixText}`;

    if (errorReports[candidate] === undefined) {
      return candidate;
    }

    suffix += 1;
  }

  throw new ReviewServiceError(
    REVIEW_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'A unique review error report identifier could not be allocated.',
  );
}

function createReviewErrorReport({
  errorReportId,
  review,
  request,
  command,
  actor,
  createdAt,
}) {
  return {
    errorReportId,
    requestId: request.requestId,
    claimNumber: request.claimNumber,
    severity: 'ERROR',
    status: ERROR_REPORT_STATUSES.OPEN,
    summary: 'Manual review rejected',
    details:
      'An authorized operations reviewer rejected the fictional reprint request.',
    context: {
      stage: request.currentStep,
      code: 'MANUAL_REVIEW_REJECTED',
      reviewId: review.reviewId,
      triggerCode: review.triggerCode,
      reasonCode: command.reasonCode,
      comment: command.comment,
      simulated: true,
    },
    resolution: {
      recommendation:
        'Correct the fictional claim or request data before creating a new reprint request.',
      retryFrom: request.currentStep,
    },
    createdAt,
    relatedEntities: {
      requestId: request.requestId,
      claimNumber: request.claimNumber,
      reviewId: review.reviewId,
    },
    auditTrail: [
      {
        at: createdAt,
        action: 'CREATED',
        actor: actor.actorId,
      },
    ],
    stackTrace:
      'ReviewDecisionError: deterministic manual review rejected',
    footer: 'Fictional demo data',
  };
}

function findPipelineRunByRequestId(envelope, requestId) {
  return (
    Object.values(envelope.pipelineRuns).find(
      (run) => run.requestId === requestId,
    ) ?? null
  );
}

function getResumeMethod(orchestrator) {
  if (orchestrator === null) {
    return null;
  }

  return typeof orchestrator.resumeRequest === 'function'
    ? orchestrator.resumeRequest.bind(orchestrator)
    : orchestrator.resume.bind(orchestrator);
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
      REVIEW_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before the review operation completed.',
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
      REVIEW_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof ReviewServiceError) {
    const status =
      error.code === REVIEW_SERVICE_ERROR_CODES.REVIEW_NOT_FOUND ||
      error.code === REVIEW_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND ||
      error.code === REVIEW_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND
        ? 404
        : error.code ===
              REVIEW_SERVICE_ERROR_CODES.INVALID_REVIEW_STATE ||
            error.code ===
              REVIEW_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT
          ? 409
          : error.code === REVIEW_SERVICE_ERROR_CODES.FORBIDDEN
            ? 403
            : error.code ===
                REVIEW_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
              ? 401
              : 422;

    return createFailure(
      status,
      error.code,
      error.message,
      correlationId,
      revision,
      {
        details: error.details,
        retryable:
          error.code ===
          REVIEW_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      },
    );
  }

  return createFailure(
    500,
    REVIEW_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The local review operation could not be completed.',
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
 * Error raised when review-service input, dependencies, or state are invalid.
 */
export class ReviewServiceError extends Error {
  /**
   * @param {string} code Stable review-service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ReviewServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Coordinates authorized manual-review decisions and fictional claim
 * responsibility adjustments.
 */
export class ReviewService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options.
   * @param {{
   *   fixtureGateway?: object,
   *   fixtureRepository?: object,
   *   pipelineOrchestrator?: object,
   *   pipelineService?: object,
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
    this.fixtureGateway = normalizeFixtureGateway(
      normalizedOptions.fixtureGateway ??
        normalizedOptions.fixtureRepository ??
        normalizedOptions.fixtures,
    );
    this.pipelineOrchestrator = normalizePipelineOrchestrator(
      normalizedOptions.pipelineOrchestrator ??
        normalizedOptions.pipelineService,
    );
    this.permissionGateway = normalizePermissionGateway(
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
        this.permissionGateway?.sessionProvider,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Review service ID generator must be a function.',
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

  async authorize(actor, action, resource, correlationId) {
    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          REVIEW_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
          'An active demo session is required.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    if (!REVIEW_ROLES.has(actor.role)) {
      return {
        allowed: false,
        failure: createFailure(
          403,
          REVIEW_SERVICE_ERROR_CODES.FORBIDDEN,
          'Manual review decisions and claim adjustments are available only to BOS and Admin demo roles.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    if (this.permissionGateway === null) {
      return {
        allowed: true,
        actor,
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action,
          resource,
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Review permission evaluation could not be completed.',
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

    if (
      decision?.allowed === true &&
      REVIEW_ROLES.has(actor.role)
    ) {
      return {
        allowed: true,
        actor,
        decision,
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
          ? REVIEW_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : REVIEW_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'This demo role cannot perform the review operation.',
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
    entityType,
    entityId,
    before,
    after,
  }) {
    if (this.auditGateway === null) {
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
            type: entityType,
            id: entityId,
          },
        },
        {
          action,
          entity: {
            type: entityType,
            id: entityId,
          },
          before,
          after,
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: REVIEW_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'The review operation completed, but its local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Approves or rejects one open manual review.
   *
   * Approval persists the decision before resuming the deterministic pipeline
   * from its stored checkpoint. Rejection atomically fails the request and
   * creates a local error report.
   *
   * @param {Record<string, unknown>} command Review decision command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async decideReview(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeDecisionCommand(command);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      const reasonMissing = normalized.errors.some(
        (error) => error.code === 'REASON_REQUIRED',
      );
      const invalidDecision = normalized.errors.some(
        (error) => error.code === 'INVALID_DECISION',
      );

      return createFailure(
        422,
        reasonMissing
          ? REVIEW_SERVICE_ERROR_CODES.REASON_REQUIRED
          : invalidDecision
            ? REVIEW_SERVICE_ERROR_CODES.INVALID_DECISION
            : REVIEW_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Review decision request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const input = normalized.value;
    const review = snapshot.reviews[input.reviewId];

    if (review === undefined) {
      return createFailure(
        404,
        REVIEW_SERVICE_ERROR_CODES.REVIEW_NOT_FOUND,
        'The manual review does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const request = snapshot.requests[review.requestId];

    if (request === undefined) {
      return createFailure(
        404,
        REVIEW_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND,
        'The reviewed reprint request does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const permissionAction =
      input.decision === REVIEW_DECISIONS.APPROVE
        ? ACTIONS.REPRINT_APPROVE
        : ACTIONS.REPRINT_REJECT;
    const authorization = await this.authorize(
      actor,
      permissionAction,
      {
        type: 'MANUAL_REVIEW',
        id: review.reviewId,
        requestId: review.requestId,
        claimNumber: request.claimNumber,
        memberId: request.memberId,
      },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const requestHash = hashCommand('decideReview', {
      reviewId: input.reviewId,
      decision: input.decision,
      reasonCode: input.reasonCode,
      comment: input.comment,
    });
    const existing =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existing !== undefined) {
      if (
        existing.commandName !== 'decideReview' ||
        existing.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          REVIEW_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another review decision.',
          correlationId,
          snapshot.revision,
        );
      }

      if (
        input.decision === REVIEW_DECISIONS.APPROVE &&
        existing.result.resumeIdempotencyKey !== undefined
      ) {
        return this.resumeApprovedReview({
          input,
          actor,
          correlationId,
          storedResult: existing.result,
          replayed: true,
        });
      }

      return createSuccess(
        200,
        {
          ...existing.result,
          replayed: true,
          transmitted: false,
        },
        correlationId,
        snapshot.revision,
      );
    }

    if (review.status !== REVIEW_STATUSES.OPEN) {
      return createFailure(
        409,
        REVIEW_SERVICE_ERROR_CODES.INVALID_REVIEW_STATE,
        'Only an open manual review may be decided.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: review.status,
            decisionBy: review.decisionBy,
            decidedAt: review.decidedAt,
          },
        },
      );
    }

    if (
      request.status !== REQUEST_STATUSES.MANUAL_REVIEW
    ) {
      return createFailure(
        409,
        REVIEW_SERVICE_ERROR_CODES.INVALID_REVIEW_STATE,
        'The reviewed request is not waiting for manual review.',
        correlationId,
        snapshot.revision,
        {
          details: {
            requestStatus: request.status,
          },
        },
      );
    }

    if (
      input.decision === REVIEW_DECISIONS.APPROVE &&
      this.pipelineOrchestrator === null
    ) {
      return createFailure(
        500,
        REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Pipeline resume is unavailable for review approval.',
        correlationId,
        snapshot.revision,
      );
    }

    const decidedAt = getCurrentTimestamp(this.clock);
    const resumeIdempotencyKey =
      input.decision === REVIEW_DECISIONS.APPROVE
        ? createGeneratedUuid(
            this.idGenerator,
            'Review pipeline resume ID',
          )
        : null;
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const storedReview = draft.reviews[input.reviewId];
          const committed =
            draft.idempotencyResults[input.idempotencyKey];

          if (committed !== undefined) {
            if (
              committed.commandName !== 'decideReview' ||
              committed.requestHash !== requestHash
            ) {
              throw new ReviewServiceError(
                REVIEW_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another review decision.',
              );
            }

            return;
          }

          if (storedReview === undefined) {
            throw new ReviewServiceError(
              REVIEW_SERVICE_ERROR_CODES.REVIEW_NOT_FOUND,
              'The manual review no longer exists.',
            );
          }

          const storedRequest =
            draft.requests[storedReview.requestId];

          if (storedRequest === undefined) {
            throw new ReviewServiceError(
              REVIEW_SERVICE_ERROR_CODES.REQUEST_NOT_FOUND,
              'The reviewed reprint request no longer exists.',
            );
          }

          if (
            storedReview.status !== REVIEW_STATUSES.OPEN ||
            storedRequest.status !==
              REQUEST_STATUSES.MANUAL_REVIEW
          ) {
            throw new ReviewServiceError(
              REVIEW_SERVICE_ERROR_CODES.INVALID_REVIEW_STATE,
              'The manual review changed before the decision could be stored.',
              {
                reviewStatus: storedReview.status,
                requestStatus: storedRequest.status,
              },
            );
          }

          storedReview.status =
            input.decision === REVIEW_DECISIONS.APPROVE
              ? REVIEW_STATUSES.APPROVED
              : REVIEW_STATUSES.REJECTED;
          storedReview.decisionBy = actor.actorId;
          storedReview.decidedAt = decidedAt;

          let errorReportId = null;

          if (input.decision === REVIEW_DECISIONS.REJECT) {
            errorReportId = createUniqueErrorReportId(
              draft.errorReports,
              storedReview.reviewId,
            );
            const errorReport = createReviewErrorReport({
              errorReportId,
              review: storedReview,
              request: storedRequest,
              command: input,
              actor,
              createdAt: decidedAt,
            });

            draft.errorReports[errorReportId] = errorReport;
            storedRequest.status = REQUEST_STATUSES.FAILED;
            storedRequest.completedAt = decidedAt;
            storedRequest.processingTimeMs =
              getProcessingTimeMs(storedRequest, decidedAt);
            storedRequest.result =
              'Manual review rejected the fictional reprint request.';
            storedRequest.errorReportId = errorReportId;
            storedRequest.version += 1;

            const run = findPipelineRunByRequestId(
              draft,
              storedRequest.requestId,
            );

            if (run !== null) {
              run.status = PIPELINE_STATUSES.FAILED;
              run.updatedAt = decidedAt;
              run.checkpoint = {
                ...run.checkpoint,
                nextStep: null,
                resumable: false,
                errorReportId,
              };
            }
          }

          const result = {
            reviewId: storedReview.reviewId,
            requestId: storedReview.requestId,
            decision: input.decision,
            reviewStatus: storedReview.status,
            requestStatus: storedRequest.status,
            reasonCode: input.reasonCode,
            comment: input.comment,
            decidedBy: actor.actorId,
            decidedAt,
            errorReportId,
            ...(resumeIdempotencyKey === null
              ? {}
              : {
                  resumeIdempotencyKey,
                  resumeFrom:
                    findPipelineRunByRequestId(
                      draft,
                      storedRequest.requestId,
                    )?.checkpoint?.nextStep ??
                    findPipelineRunByRequestId(
                      draft,
                      storedRequest.requestId,
                    )?.checkpoint?.step ??
                    storedRequest.currentStep,
                }),
            transmitted: false,
          };

          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'decideReview',
            requestHash,
            result,
            createdAt: decidedAt,
          };
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

    const storedResult =
      storedEnvelope.idempotencyResults[
        input.idempotencyKey
      ].result;
    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: REVIEW_AUDIT_ACTIONS.DECIDED,
      entityType: 'MANUAL_REVIEW',
      entityId: input.reviewId,
      before: {
        reviewId: review.reviewId,
        requestId: review.requestId,
        status: review.status,
        decisionBy: review.decisionBy,
        decidedAt: review.decidedAt,
      },
      after: {
        reviewId: input.reviewId,
        requestId: review.requestId,
        decision: input.decision,
        status: storedResult.reviewStatus,
        reasonCode: input.reasonCode,
        comment: input.comment,
        decidedBy: actor.actorId,
        decidedAt,
        errorReportId: storedResult.errorReportId,
        simulated: true,
      },
    });

    if (input.decision === REVIEW_DECISIONS.APPROVE) {
      return this.resumeApprovedReview({
        input,
        actor,
        correlationId,
        storedResult,
        replayed: false,
        warnings:
          auditWarning === null ? [] : [auditWarning],
      });
    }

    return createSuccess(
      200,
      {
        ...storedResult,
        replayed: false,
        transmitted: false,
      },
      correlationId,
      storedEnvelope.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  async resumeApprovedReview({
    input,
    actor,
    correlationId,
    storedResult,
    replayed,
    warnings = [],
  }) {
    const resume = getResumeMethod(this.pipelineOrchestrator);

    if (resume === null) {
      return createFailure(
        500,
        REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Pipeline resume is unavailable for review approval.',
        correlationId,
        this.getRevision(),
      );
    }

    let result;

    try {
      result = await resume(
        {
          requestId: storedResult.requestId,
          mode: 'IMMEDIATE',
          scenario: 'SUCCESS',
          expectedCheckpoint:
            storedResult.resumeFrom,
          reviewApproved: true,
          idempotencyKey:
            storedResult.resumeIdempotencyKey,
        },
        actor,
      );
    } catch (error) {
      return createFailure(
        500,
        REVIEW_SERVICE_ERROR_CODES.PROCESSING_FAILED,
        'The review was approved, but the deterministic pipeline could not be resumed.',
        correlationId,
        this.getRevision(),
        {
          retryable: true,
          recoveryAction: 'RESUME_REQUEST',
          details: {
            reviewId: input.reviewId,
            dependencyCode: getErrorCode(error),
          },
        },
      );
    }

    if (result?.ok !== true) {
      return createFailure(
        result?.status ?? 409,
        REVIEW_SERVICE_ERROR_CODES.PROCESSING_FAILED,
        result?.error?.message ??
          'The review was approved, but the deterministic pipeline could not be resumed.',
        correlationId,
        result?.meta?.revision ?? this.getRevision(),
        {
          retryable: result?.error?.retryable === true,
          recoveryAction:
            result?.error?.recoveryAction ??
            'RESUME_REQUEST',
          details: {
            reviewId: input.reviewId,
            dependencyCode:
              result?.error?.code ?? null,
          },
        },
      );
    }

    return createSuccess(
      200,
      {
        ...storedResult,
        requestStatus:
          result.data?.status ??
          REQUEST_STATUSES.PROCESSING,
        currentStep:
          result.data?.currentStep ??
          storedResult.resumeFrom,
        documentIds: Array.isArray(
          result.data?.documentIds,
        )
          ? result.data.documentIds
          : [],
        pipelineResult: result.data,
        replayed:
          replayed === true ||
          result.data?.replayed === true,
        transmitted: false,
      },
      correlationId,
      result.meta?.revision ?? this.getRevision(),
      [
        ...warnings,
        ...(Array.isArray(result.meta?.warnings)
          ? result.meta.warnings
          : []),
      ],
    );
  }

  /**
   * Applies an allowlisted fictional responsibility adjustment.
   *
   * @param {Record<string, unknown>} command Claim adjustment command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async adjustClaim(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const normalized = normalizeAdjustmentCommand(command);
    const snapshot = this.repository.getSnapshot();

    if (normalized.errors.length > 0) {
      const reasonMissing = normalized.errors.some(
        (error) => error.code === 'REASON_REQUIRED',
      );
      const fieldBlocked = normalized.errors.some(
        (error) => error.code === 'FIELD_NOT_ALLOWLISTED',
      );
      const invalidValue = normalized.errors.some(
        (error) =>
          error.code === 'INVALID_ADJUSTMENT_VALUE',
      );

      return createFailure(
        422,
        reasonMissing
          ? REVIEW_SERVICE_ERROR_CODES.REASON_REQUIRED
          : fieldBlocked
            ? REVIEW_SERVICE_ERROR_CODES.FIELD_NOT_ALLOWLISTED
            : invalidValue
              ? REVIEW_SERVICE_ERROR_CODES.INVALID_ADJUSTMENT_VALUE
              : REVIEW_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Claim adjustment request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    if (this.fixtureGateway === null) {
      return createFailure(
        500,
        REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Claim adjustment fixtures are unavailable.',
        correlationId,
        snapshot.revision,
      );
    }

    const input = normalized.value;
    const authorization = await this.authorize(
      actor,
      ACTIONS.REPRINT_APPROVE,
      {
        type: 'CLAIM',
        id: input.claimNumber,
        claimNumber: input.claimNumber,
        operation: 'ADJUST',
      },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const requestHash = hashCommand('adjustClaim', {
      claimNumber: input.claimNumber,
      field: input.field,
      newValue: input.newValue,
      reasonCode: input.reasonCode,
      comment: input.comment,
    });
    const existing =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existing !== undefined) {
      if (
        existing.commandName !== 'adjustClaim' ||
        existing.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          REVIEW_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another claim adjustment.',
          correlationId,
          snapshot.revision,
        );
      }

      return createSuccess(
        200,
        {
          ...existing.result,
          replayed: true,
          transmitted: false,
        },
        correlationId,
        snapshot.revision,
      );
    }

    let claim;

    try {
      claim = await readClaim(
        this.fixtureGateway,
        input.claimNumber,
        actor,
      );
    } catch (error) {
      return createFailure(
        500,
        REVIEW_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
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
        REVIEW_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
        'The fictional claim does not exist or is not accessible.',
        correlationId,
        snapshot.revision,
      );
    }

    const beforeValue = resolveResponsibilityCents(
      claim,
      input.field,
    );

    if (beforeValue === null) {
      return createFailure(
        422,
        REVIEW_SERVICE_ERROR_CODES.INVALID_ADJUSTMENT_VALUE,
        'The existing fictional responsibility value is unavailable.',
        correlationId,
        snapshot.revision,
      );
    }

    let mutationResult;

    try {
      mutationResult = await applyClaimAdjustment(
        this.fixtureGateway,
        claim,
        input,
        actor,
        correlationId,
      );
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    const adjustedAt = getCurrentTimestamp(this.clock);
    const result = {
      claimNumber: input.claimNumber,
      field: input.field,
      beforeValue,
      newValue: input.newValue,
      reasonCode: input.reasonCode,
      comment: input.comment,
      adjustedBy: actor.actorId,
      adjustedAt,
      fixtureReference:
        typeof mutationResult === 'string'
          ? mutationResult.slice(
              0,
              REVIEW_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH,
            )
          : mutationResult?.claimNumber ??
            input.claimNumber,
      localOnly: true,
      transmitted: false,
    };
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const committed =
            draft.idempotencyResults[input.idempotencyKey];

          if (committed !== undefined) {
            if (
              committed.commandName !== 'adjustClaim' ||
              committed.requestHash !== requestHash
            ) {
              throw new ReviewServiceError(
                REVIEW_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another claim adjustment.',
              );
            }

            return;
          }

          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'adjustClaim',
            requestHash,
            result: cloneMutable(result),
            createdAt: adjustedAt,
          };
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

    const auditWarning = await this.appendAudit({
      correlationId,
      actor,
      action: REVIEW_AUDIT_ACTIONS.CLAIM_ADJUSTED,
      entityType: 'CLAIM',
      entityId: input.claimNumber,
      before: {
        claimNumber: input.claimNumber,
        field: input.field,
        valueCents: beforeValue,
      },
      after: {
        claimNumber: input.claimNumber,
        field: input.field,
        valueCents: input.newValue,
        reasonCode: input.reasonCode,
        comment: input.comment,
        adjustedBy: actor.actorId,
        adjustedAt,
        simulated: true,
      },
    });

    return createSuccess(
      200,
      {
        ...result,
        replayed: false,
      },
      correlationId,
      storedEnvelope.revision,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  getReviewById(reviewId) {
    if (
      typeof reviewId !== 'string' ||
      reviewId.trim().length === 0 ||
      reviewId.trim().length >
        REVIEW_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new ReviewServiceError(
        REVIEW_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Review ID must be a non-empty string of at most 100 characters.',
      );
    }

    return (
      this.repository.getSnapshot().reviews[
        reviewId.normalize('NFC').trim()
      ] ?? null
    );
  }

  getReviewByRequestId(requestId) {
    if (
      typeof requestId !== 'string' ||
      requestId.trim().length === 0 ||
      requestId.trim().length >
        REVIEW_SERVICE_LIMITS.MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new ReviewServiceError(
        REVIEW_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Request ID must be a non-empty string of at most 100 characters.',
      );
    }

    const identifier = requestId.normalize('NFC').trim();

    return (
      Object.values(
        this.repository.getSnapshot().reviews,
      ).find((review) => review.requestId === identifier) ??
      null
    );
  }

  decide(command, context = undefined) {
    return this.decideReview(command, context);
  }

  approveReview(command, context = undefined) {
    return this.decideReview(
      {
        ...command,
        decision: REVIEW_DECISIONS.APPROVE,
      },
      context,
    );
  }

  rejectReview(command, context = undefined) {
    return this.decideReview(
      {
        ...command,
        decision: REVIEW_DECISIONS.REJECT,
      },
      context,
    );
  }

  adjust(command, context = undefined) {
    return this.adjustClaim(command, context);
  }

  findReviewById(reviewId) {
    return this.getReviewById(reviewId);
  }

  findReviewByRequestId(requestId) {
    return this.getReviewByRequestId(requestId);
  }
}

/**
 * Creates a browser-local review service.
 *
 * @param {ConstructorParameters<typeof ReviewService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof ReviewService>[1]} [options]
 * Service options.
 * @returns {ReviewService} Review service.
 */
export function createReviewService(
  repositoryOrOptions,
  options = {},
) {
  return new ReviewService(repositoryOrOptions, options);
}

export const LocalReviewService = ReviewService;
export const OperationsReviewService = ReviewService;
export const ManualReviewService = ReviewService;
export const createLocalReviewService = createReviewService;
export const createOperationsReviewService =
  createReviewService;
export const createManualReviewService = createReviewService;

export default ReviewService;