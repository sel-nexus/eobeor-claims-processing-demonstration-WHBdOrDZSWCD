import { INITIAL_OPERATIONS_ENVELOPE } from '../../../fixtures/operations.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';
import {
  createOperationsEnvelope,
  isOperationsEnvelope,
} from '../domain/operationsSchemas.js';
import {
  CURRENT_OPERATIONS_SCHEMA_VERSION,
  migrateOperationsEnvelope,
  OperationsMigrationError,
} from './operationsMigrations.js';
import {
  PRIORITY_RANKS,
  REQUEST_STATUSES,
} from '../domain/domainConstants.js';

export const OPERATIONS_REPOSITORY_SCHEMA_VERSION =
  CURRENT_OPERATIONS_SCHEMA_VERSION;
export const OPERATIONS_REPOSITORY_SLICE = 'operationsEnvelope';
export const OPERATIONS_REPOSITORY_LEGACY_SLICE = 'operations';

export const OPERATIONS_COLLECTIONS = Object.freeze({
  REQUESTS: 'requests',
  PIPELINE_RUNS: 'pipelineRuns',
  DOCUMENTS: 'documents',
  INBOUND_RUNS: 'inboundRuns',
  BATCH_RUNS: 'batchRuns',
  REVIEWS: 'reviews',
  ERROR_REPORTS: 'errorReports',
  OUTBOUND_RECORDS: 'outboundRecords',
  IDEMPOTENCY_RESULTS: 'idempotencyResults',
  CDC_EVENTS: 'cdcEvents',
});

export const OPERATIONS_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  INVALID_COLLECTION: 'INVALID_COLLECTION',
  INVALID_ENTITY: 'INVALID_ENTITY',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_REVISION: 'INVALID_REVISION',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
});

const COLLECTION_DEFINITIONS = Object.freeze({
  [OPERATIONS_COLLECTIONS.REQUESTS]: Object.freeze({
    identifier: 'requestId',
  }),
  [OPERATIONS_COLLECTIONS.PIPELINE_RUNS]: Object.freeze({
    identifier: 'runId',
  }),
  [OPERATIONS_COLLECTIONS.DOCUMENTS]: Object.freeze({
    identifier: 'documentId',
  }),
  [OPERATIONS_COLLECTIONS.INBOUND_RUNS]: Object.freeze({
    identifier: 'feedRunId',
  }),
  [OPERATIONS_COLLECTIONS.BATCH_RUNS]: Object.freeze({
    identifier: 'batchId',
  }),
  [OPERATIONS_COLLECTIONS.REVIEWS]: Object.freeze({
    identifier: 'reviewId',
  }),
  [OPERATIONS_COLLECTIONS.ERROR_REPORTS]: Object.freeze({
    identifier: 'errorReportId',
  }),
  [OPERATIONS_COLLECTIONS.OUTBOUND_RECORDS]: Object.freeze({
    identifier: 'outboundId',
  }),
  [OPERATIONS_COLLECTIONS.IDEMPOTENCY_RESULTS]: Object.freeze({
    identifier: 'idempotencyKey',
  }),
  [OPERATIONS_COLLECTIONS.CDC_EVENTS]: Object.freeze({
    identifier: ['cdcEventId', 'eventId'],
  }),
});

const COLLECTION_NAMES = new Set(
  Object.values(OPERATIONS_COLLECTIONS),
);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 200;

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

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'Operations repository requires a storage gateway with read() and commit().',
    );
  }

  return value;
}

function resolveConstructorArguments(gatewayOrOptions, options) {
  if (
    isPlainObject(gatewayOrOptions) &&
    (gatewayOrOptions.gateway !== undefined ||
      gatewayOrOptions.storageGateway !== undefined)
  ) {
    return {
      gateway:
        gatewayOrOptions.gateway ??
        gatewayOrOptions.storageGateway,
      options: gatewayOrOptions,
    };
  }

  return {
    gateway: gatewayOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function requireRevision(value, name = 'Expected revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function requireIdentifier(value, name = 'Identifier') {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_IDENTIFIER,
      `${name} must be a non-empty string of at most 200 characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function requireCollectionName(value) {
  if (typeof value !== 'string' || !COLLECTION_NAMES.has(value)) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_COLLECTION,
      'Operations collection is not supported.',
      {
        collection: value,
        acceptedCollections: [...COLLECTION_NAMES],
      },
    );
  }

  return value;
}

function requirePositiveInteger(value, fallback, maximum) {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Operations query pagination values are outside the supported range.',
      {
        value,
        maximum: maximum ?? null,
      },
    );
  }

  return value;
}

function getCurrentTimestamp(clock) {
  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    return clock.nowIso();
  }

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    const value = clock.now();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  if (typeof clock === 'function') {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  throw new TypeError(
    'Operations repository clock must provide a valid current timestamp.',
  );
}

function createCommitId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Operations repository ID generator must return a non-empty string.',
    );
  }

  return value.trim();
}

function resolveEntityIdentifier(collectionName, entity) {
  if (!isPlainObject(entity) || !isJsonCompatible(entity)) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
      'Operations entity must be a safe JSON-compatible object.',
      { collection: collectionName },
    );
  }

  const identifierFields =
    COLLECTION_DEFINITIONS[collectionName].identifier;
  const fields = Array.isArray(identifierFields)
    ? identifierFields
    : [identifierFields];

  for (const field of fields) {
    if (
      typeof entity[field] === 'string' &&
      entity[field].trim().length > 0
    ) {
      return requireIdentifier(
        entity[field],
        `${collectionName} identifier`,
      );
    }
  }

  throw new OperationsRepositoryError(
    OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
    `Operations entity does not contain a valid ${fields.join(' or ')} identifier.`,
    {
      collection: collectionName,
      acceptedIdentifierFields: fields,
    },
  );
}

function resolveStoredOperations(envelope, preferredSliceName) {
  if (envelope === null || !isPlainObject(envelope.slices)) {
    return {
      value: undefined,
      sliceName: preferredSliceName,
    };
  }

  const slices = envelope.slices;

  if (slices[preferredSliceName] !== undefined) {
    return {
      value: slices[preferredSliceName],
      sliceName: preferredSliceName,
    };
  }

  if (slices[OPERATIONS_REPOSITORY_SLICE] !== undefined) {
    return {
      value: slices[OPERATIONS_REPOSITORY_SLICE],
      sliceName: OPERATIONS_REPOSITORY_SLICE,
    };
  }

  const legacy = slices[OPERATIONS_REPOSITORY_LEGACY_SLICE];

  if (isOperationsEnvelope(legacy)) {
    return {
      value: legacy,
      sliceName: OPERATIONS_REPOSITORY_LEGACY_SLICE,
    };
  }

  if (
    isPlainObject(legacy) &&
    legacy.initialEnvelope !== undefined
  ) {
    return {
      value: legacy.initialEnvelope,
      sliceName: preferredSliceName,
    };
  }

  return {
    value: undefined,
    sliceName: preferredSliceName,
  };
}

function normalizeEnvelope(value) {
  try {
    const migrated = migrateOperationsEnvelope(value);

    if (!isOperationsEnvelope(migrated)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Operations envelope does not satisfy its schema.',
      );
    }

    validateMapIdentifiers(migrated);
    validateAggregateReferences(migrated);

    return createOperationsEnvelope(migrated);
  } catch (error) {
    if (error instanceof OperationsRepositoryError) {
      throw error;
    }

    if (error instanceof OperationsMigrationError) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.MIGRATION_FAILED,
        'Persisted operations data could not be migrated.',
        {
          migrationCode: error.code,
          migrationDetails: error.details,
        },
        error,
      );
    }

    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
      'Operations envelope does not satisfy its schema.',
      undefined,
      error,
    );
  }
}

function validateMapIdentifiers(envelope) {
  Object.entries(COLLECTION_DEFINITIONS).forEach(
    ([collectionName]) => {
      const collection = envelope[collectionName];

      if (!isPlainObject(collection)) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
          `Operations collection ${collectionName} must be an object map.`,
          { collection: collectionName },
        );
      }

      Object.entries(collection).forEach(([key, entity]) => {
        const identifier = resolveEntityIdentifier(
          collectionName,
          entity,
        );

        if (identifier !== key) {
          throw new OperationsRepositoryError(
            OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
            `Operations collection ${collectionName} contains a mismatched map key.`,
            {
              collection: collectionName,
              key,
              identifier,
            },
          );
        }
      });
    },
  );
}

function validateAggregateReferences(envelope) {
  const requestIds = new Set(Object.keys(envelope.requests));
  const documentIds = new Set(Object.keys(envelope.documents));

  Object.values(envelope.pipelineRuns).forEach((run) => {
    if (!requestIds.has(run.requestId)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Pipeline run references an unknown request.',
        {
          runId: run.runId,
          requestId: run.requestId,
        },
      );
    }
  });

  Object.values(envelope.documents).forEach((document) => {
    if (!requestIds.has(document.requestId)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Document references an unknown request.',
        {
          documentId: document.documentId,
          requestId: document.requestId,
        },
      );
    }
  });

  Object.values(envelope.reviews).forEach((review) => {
    if (!requestIds.has(review.requestId)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Manual review references an unknown request.',
        {
          reviewId: review.reviewId,
          requestId: review.requestId,
        },
      );
    }
  });

  Object.values(envelope.errorReports).forEach((report) => {
    if (
      report.requestId !== null &&
      !requestIds.has(report.requestId)
    ) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Error report references an unknown request.',
        {
          errorReportId: report.errorReportId,
          requestId: report.requestId,
        },
      );
    }
  });

  Object.values(envelope.outboundRecords).forEach((record) => {
    if (!documentIds.has(record.documentId)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Outbound record references an unknown document.',
        {
          outboundId: record.outboundId,
          documentId: record.documentId,
        },
      );
    }
  });

  Object.values(envelope.requests).forEach((request) => {
    request.documentReferences.forEach((documentId) => {
      if (!documentIds.has(documentId)) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
          'Request references an unknown document.',
          {
            requestId: request.requestId,
            documentId,
          },
        );
      }
    });

    if (
      request.errorReportId !== null &&
      envelope.errorReports[request.errorReportId] === undefined
    ) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Request references an unknown error report.',
        {
          requestId: request.requestId,
          errorReportId: request.errorReportId,
        },
      );
    }
  });
}

function readEnvelope(
  rootEnvelope,
  preferredSliceName,
  initialEnvelope,
) {
  const resolved = resolveStoredOperations(
    rootEnvelope,
    preferredSliceName,
  );
  const source =
    resolved.value === undefined
      ? initialEnvelope
      : resolved.value;

  return {
    envelope: normalizeEnvelope(source),
    sliceName: resolved.sliceName,
    persisted: resolved.value !== undefined,
  };
}

function buildNextState(
  rootEnvelope,
  sliceName,
  operationsEnvelope,
) {
  const currentSlices = isPlainObject(rootEnvelope?.slices)
    ? rootEnvelope.slices
    : {};

  return {
    ...(rootEnvelope ?? {}),
    slices: {
      ...currentSlices,
      [sliceName]: operationsEnvelope,
    },
  };
}

function normalizeMutationOptions(options) {
  if (Number.isSafeInteger(options)) {
    return {
      expectedRevision: requireRevision(options),
    };
  }

  if (!isPlainObject(options)) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_OPTIONS,
      'Operations mutation options must be an object or revision.',
    );
  }

  return options;
}

function resolveExpectedOperationsRevision(options, currentRevision) {
  const normalized = normalizeMutationOptions(options);
  const value =
    normalized.expectedRevision ??
    normalized.expectedOperationsRevision;

  if (value === undefined || value === null) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
      'Expected operations revision is required.',
    );
  }

  const expected = requireRevision(
    value,
    'Expected operations revision',
  );

  if (expected !== currentRevision) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Operations data changed before the mutation.',
      {
        expectedRevision: expected,
        actualRevision: currentRevision,
      },
    );
  }

  return normalized;
}

function resolveExpectedRootRevision(options, currentRevision) {
  const value =
    options.expectedRootRevision ?? options.rootRevision;

  if (value === undefined || value === null) {
    return currentRevision;
  }

  const expected = requireRevision(value, 'Expected root revision');

  if (expected !== currentRevision) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted operations data changed before the mutation.',
      {
        expectedRevision: expected,
        actualRevision: currentRevision,
      },
    );
  }

  return expected;
}

function normalizeStorageError(error) {
  if (error instanceof OperationsRepositoryError) {
    return error;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    error.code === 'REVISION_CONFLICT'
  ) {
    return new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted operations data changed before the mutation.',
      error.details,
      error,
    );
  }

  return new OperationsRepositoryError(
    OPERATIONS_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    'Operations data could not be persisted.',
    {
      persistenceCode:
        error !== null && typeof error === 'object'
          ? error.code ?? null
          : null,
    },
    error,
  );
}

function normalizeCollectionInput(value, collectionName) {
  if (Array.isArray(value)) {
    const result = {};

    value.forEach((entity) => {
      const identifier = resolveEntityIdentifier(
        collectionName,
        entity,
      );

      if (Object.prototype.hasOwnProperty.call(result, identifier)) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.ALREADY_EXISTS,
          `Operations collection ${collectionName} contains a duplicate identifier.`,
          {
            collection: collectionName,
            identifier,
          },
        );
      }

      result[identifier] = cloneMutable(entity);
    });

    return result;
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_COLLECTION,
      `Operations collection ${collectionName} must be an object map or array.`,
      { collection: collectionName },
    );
  }

  const result = cloneMutable(value);

  Object.entries(result).forEach(([key, entity]) => {
    const identifier = resolveEntityIdentifier(
      collectionName,
      entity,
    );

    if (identifier !== key) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_COLLECTION,
        `Operations collection ${collectionName} contains a mismatched map key.`,
        {
          collection: collectionName,
          key,
          identifier,
        },
      );
    }
  });

  return result;
}

function normalizeStringSet(value, name) {
  if (value === undefined || value === null) {
    return null;
  }

  const source = Array.isArray(value) ? value : [value];

  if (
    source.length === 0 ||
    source.some(
      (item) =>
        typeof item !== 'string' || item.trim().length === 0,
    )
  ) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      `${name} must contain non-empty strings.`,
    );
  }

  return new Set(source.map((item) => item.trim().toUpperCase()));
}

function normalizeRequestQuery(input) {
  if (!isPlainObject(input)) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Request query must be an object.',
    );
  }

  const direction =
    typeof input.sortDirection === 'string'
      ? input.sortDirection.trim().toUpperCase()
      : typeof input.direction === 'string'
        ? input.direction.trim().toUpperCase()
        : 'ASC';

  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Request sort direction must be ASC or DESC.',
    );
  }

  const sortBy = input.sortBy ?? 'QUEUE';

  if (
    !['QUEUE', 'CREATED_AT', 'PRIORITY', 'STATUS', 'DISPLAY_ID'].includes(
      sortBy,
    )
  ) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Request sort field is not supported.',
      { sortBy },
    );
  }

  const offset =
    input.offset === undefined ? null : input.offset;

  if (
    offset !== null &&
    (!Number.isSafeInteger(offset) || offset < 0)
  ) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Request query offset must be a non-negative safe integer.',
    );
  }

  const searchValue = input.search ?? input.query ?? input.q;
  const search =
    searchValue === undefined ||
    searchValue === null ||
    searchValue === ''
      ? null
      : String(searchValue)
          .normalize('NFKC')
          .trim()
          .toLocaleLowerCase('en-US');

  if (search !== null && search.length === 0) {
    throw new OperationsRepositoryError(
      OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Request search query must be non-empty.',
    );
  }

  return {
    statuses: normalizeStringSet(
      input.statuses ?? input.status,
      'Request statuses',
    ),
    priorities: normalizeStringSet(
      input.priorities ?? input.priority,
      'Request priorities',
    ),
    requestTypes: normalizeStringSet(
      input.requestTypes ?? input.requestType,
      'Request types',
    ),
    sourceTypes: normalizeStringSet(
      input.sourceTypes ?? input.sourceType,
      'Request source types',
    ),
    memberId:
      input.memberId === undefined || input.memberId === null
        ? null
        : requireIdentifier(input.memberId, 'Member ID'),
    claimNumber:
      input.claimNumber === undefined ||
      input.claimNumber === null
        ? null
        : requireIdentifier(input.claimNumber, 'Claim number'),
    search,
    sortBy,
    direction,
    page: requirePositiveInteger(input.page, DEFAULT_PAGE),
    limit: requirePositiveInteger(
      input.limit,
      DEFAULT_LIMIT,
      MAXIMUM_LIMIT,
    ),
    offset,
  };
}

function compareRequests(left, right, query) {
  let comparison = 0;

  switch (query.sortBy) {
    case 'CREATED_AT':
      comparison =
        Date.parse(left.createdAt) - Date.parse(right.createdAt);
      break;
    case 'PRIORITY':
      comparison =
        (PRIORITY_RANKS[left.priority] ?? Number.MAX_SAFE_INTEGER) -
        (PRIORITY_RANKS[right.priority] ?? Number.MAX_SAFE_INTEGER);
      break;
    case 'STATUS':
      comparison = left.status.localeCompare(right.status, 'en-US');
      break;
    case 'DISPLAY_ID':
      comparison = left.displayId.localeCompare(
        right.displayId,
        'en-US',
      );
      break;
    case 'QUEUE':
    default:
      comparison =
        (PRIORITY_RANKS[left.priority] ?? Number.MAX_SAFE_INTEGER) -
        (PRIORITY_RANKS[right.priority] ?? Number.MAX_SAFE_INTEGER);

      if (comparison === 0) {
        comparison =
          Date.parse(left.createdAt) -
          Date.parse(right.createdAt);
      }
      break;
  }

  if (comparison === 0) {
    comparison = left.requestId.localeCompare(
      right.requestId,
      'en-US',
    );
  }

  return query.direction === 'ASC' ? comparison : -comparison;
}

function isRequestMatch(request, query) {
  if (
    query.statuses !== null &&
    !query.statuses.has(request.status)
  ) {
    return false;
  }

  if (
    query.priorities !== null &&
    !query.priorities.has(request.priority)
  ) {
    return false;
  }

  if (
    query.requestTypes !== null &&
    !query.requestTypes.has(request.requestType)
  ) {
    return false;
  }

  if (
    query.sourceTypes !== null &&
    !query.sourceTypes.has(request.sourceType)
  ) {
    return false;
  }

  if (
    query.memberId !== null &&
    request.memberId !== query.memberId
  ) {
    return false;
  }

  if (
    query.claimNumber !== null &&
    request.claimNumber !== query.claimNumber
  ) {
    return false;
  }

  if (query.search !== null) {
    const searchable = [
      request.displayId,
      request.claimNumber,
      request.memberId,
      request.requestType,
      request.priority,
      request.status,
      request.sourceType,
      request.sourceDetail,
    ]
      .join(' ')
      .toLocaleLowerCase('en-US');

    if (!searchable.includes(query.search)) {
      return false;
    }
  }

  return true;
}

function createRequestIndex(envelope) {
  const byStatus = {};
  const byClaim = {};
  const byMember = {};

  Object.values(envelope.requests).forEach((request) => {
    if (byStatus[request.status] === undefined) {
      byStatus[request.status] = [];
    }

    if (byClaim[request.claimNumber] === undefined) {
      byClaim[request.claimNumber] = [];
    }

    if (byMember[request.memberId] === undefined) {
      byMember[request.memberId] = [];
    }

    byStatus[request.status].push(request.requestId);
    byClaim[request.claimNumber].push(request.requestId);
    byMember[request.memberId].push(request.requestId);
  });

  return deepFreeze({
    byStatus,
    byClaim,
    byMember,
  });
}

/**
 * Error raised when operations repository data or mutations are invalid.
 */
export class OperationsRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OperationsRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Revision-safe normalized repository for the operations aggregate.
 */
export class OperationsRepository {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or repository options containing `gateway` or `storageGateway`.
   * @param {{
   *   sliceName?: string,
   *   initialEnvelope?: Record<string, unknown>,
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Repository options.
   */
  constructor(gatewayOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      gatewayOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.gateway = requireGateway(resolved.gateway);
    this.sliceName =
      typeof normalizedOptions.sliceName === 'string' &&
      normalizedOptions.sliceName.trim().length > 0
        ? normalizedOptions.sliceName.trim()
        : OPERATIONS_REPOSITORY_SLICE;
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;
    this.initialEnvelope = normalizeEnvelope(
      normalizedOptions.initialEnvelope ??
        INITIAL_OPERATIONS_ENVELOPE,
    );
    this.cachedRootEnvelope = null;
    this.cachedOperationsEnvelope = null;
    this.cachedSliceName = this.sliceName;
    this.cachedPersisted = false;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Operations repository ID generator must be a function.',
      );
    }
  }

  readCurrent() {
    let rootEnvelope;

    try {
      rootEnvelope = this.gateway.read();
    } catch (error) {
      throw normalizeStorageError(error);
    }

    if (
      rootEnvelope === this.cachedRootEnvelope &&
      this.cachedOperationsEnvelope !== null
    ) {
      return {
        rootEnvelope,
        envelope: this.cachedOperationsEnvelope,
        sliceName: this.cachedSliceName,
        persisted: this.cachedPersisted,
      };
    }

    const current = readEnvelope(
      rootEnvelope,
      this.sliceName,
      this.initialEnvelope,
    );

    this.cachedRootEnvelope = rootEnvelope;
    this.cachedOperationsEnvelope = current.envelope;
    this.cachedSliceName = current.sliceName;
    this.cachedPersisted = current.persisted;

    return {
      rootEnvelope,
      ...current,
    };
  }

  invalidate() {
    this.cachedRootEnvelope = null;
    this.cachedOperationsEnvelope = null;
    this.cachedSliceName = this.sliceName;
    this.cachedPersisted = false;
  }

  /**
   * Returns the current operations revision.
   *
   * @returns {number} Operations aggregate revision.
   */
  getRevision() {
    return this.readCurrent().envelope.revision;
  }

  /**
   * Returns the current storage root revision.
   *
   * @returns {number} Storage root revision.
   */
  getRootRevision() {
    return this.readCurrent().rootEnvelope?.rootRevision ?? 0;
  }

  /**
   * Returns the normalized immutable operations envelope.
   *
   * @returns {Readonly<Record<string, unknown>>} Operations envelope.
   */
  getSnapshot() {
    return this.readCurrent().envelope;
  }

  /**
   * Returns repository metadata and the normalized aggregate.
   *
   * @returns {Readonly<Record<string, unknown>>} Repository state.
   */
  getRepositorySnapshot() {
    const current = this.readCurrent();

    return deepFreeze({
      schemaVersion: OPERATIONS_REPOSITORY_SCHEMA_VERSION,
      revision: current.rootEnvelope?.rootRevision ?? 0,
      operationsRevision: current.envelope.revision,
      persisted: current.persisted,
      sliceName: current.sliceName,
      envelope: current.envelope,
      indexes: {
        requests: createRequestIndex(current.envelope),
      },
    });
  }

  /**
   * Persists the baseline when no operations envelope has been stored.
   *
   * @param {{expectedRootRevision?: number}} [options] Commit options.
   * @returns {Readonly<Record<string, unknown>>} Stored envelope.
   */
  initialize(options = {}) {
    if (!isPlainObject(options)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_OPTIONS,
        'Operations initialization options must be an object.',
      );
    }

    const current = this.readCurrent();

    if (current.persisted) {
      return current.envelope;
    }

    const rootRevision =
      current.rootEnvelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );

    try {
      this.gateway.commit(
        expectedRootRevision,
        buildNextState(
          current.rootEnvelope,
          current.sliceName,
          current.envelope,
        ),
        {},
      );
      this.invalidate();
      return this.getSnapshot();
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  /**
   * Atomically mutates the complete normalized operations aggregate.
   *
   * The mutator receives a detached mutable draft. Returning a plain object
   * replaces the draft; returning undefined commits the mutated draft.
   *
   * @param {(draft: Record<string, unknown>) => unknown} mutator Mutator.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Committed envelope.
   */
  transact(mutator, options = {}) {
    if (typeof mutator !== 'function') {
      throw new TypeError(
        'Operations transaction mutator must be a function.',
      );
    }

    const current = this.readCurrent();
    const normalizedOptions = resolveExpectedOperationsRevision(
      options,
      current.envelope.revision,
    );
    const rootRevision =
      current.rootEnvelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      normalizedOptions,
      rootRevision,
    );
    const draft = cloneMutable(current.envelope);
    const mutationResult = mutator(draft);
    const candidate =
      mutationResult === undefined ? draft : mutationResult;

    if (!isPlainObject(candidate) || !isJsonCompatible(candidate)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Operations transaction must produce a safe JSON-compatible object.',
      );
    }

    const nextEnvelope = normalizeEnvelope({
      ...candidate,
      schemaVersion: OPERATIONS_REPOSITORY_SCHEMA_VERSION,
      revision: current.envelope.revision + 1,
      commitId: createCommitId(this.idGenerator),
      updatedAt: getCurrentTimestamp(this.clock),
    });

    try {
      this.gateway.commit(
        expectedRootRevision,
        buildNextState(
          current.rootEnvelope,
          current.sliceName,
          nextEnvelope,
        ),
        {},
      );
      this.invalidate();
      return this.getSnapshot();
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  /**
   * Replaces the complete operations envelope.
   *
   * @param {Record<string, unknown>} envelope Replacement envelope.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored envelope.
   */
  replace(envelope, options = {}) {
    if (!isPlainObject(envelope) || !isJsonCompatible(envelope)) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENVELOPE,
        'Replacement operations envelope must be safe JSON-compatible data.',
      );
    }

    return this.transact(() => cloneMutable(envelope), options);
  }

  /**
   * Returns one normalized collection as an immutable object map.
   *
   * @param {string} collectionName Collection name.
   * @returns {Readonly<Record<string, unknown>>} Collection map.
   */
  getCollection(collectionName) {
    const name = requireCollectionName(collectionName);
    return this.getSnapshot()[name];
  }

  /**
   * Returns one entity from a normalized collection.
   *
   * @param {string} collectionName Collection name.
   * @param {string} identifier Entity identifier.
   * @returns {Readonly<Record<string, unknown>>|null} Entity or null.
   */
  getEntity(collectionName, identifier) {
    const name = requireCollectionName(collectionName);
    const id = requireIdentifier(identifier);

    return this.getSnapshot()[name][id] ?? null;
  }

  /**
   * Creates or replaces one entity within a collection.
   *
   * @param {string} collectionName Collection name.
   * @param {Record<string, unknown>} entity Entity data.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored entity.
   */
  upsertEntity(collectionName, entity, options = {}) {
    const name = requireCollectionName(collectionName);
    const identifier = resolveEntityIdentifier(name, entity);
    const normalizedEntity = cloneMutable(entity);

    const envelope = this.transact((draft) => {
      draft[name][identifier] = normalizedEntity;
    }, options);

    return envelope[name][identifier];
  }

  /**
   * Creates an entity and rejects duplicate identifiers.
   *
   * @param {string} collectionName Collection name.
   * @param {Record<string, unknown>} entity Entity data.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored entity.
   */
  createEntity(collectionName, entity, options = {}) {
    const name = requireCollectionName(collectionName);
    const identifier = resolveEntityIdentifier(name, entity);
    const normalizedEntity = cloneMutable(entity);

    const envelope = this.transact((draft) => {
      if (
        Object.prototype.hasOwnProperty.call(
          draft[name],
          identifier,
        )
      ) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.ALREADY_EXISTS,
          'Operations entity already exists.',
          {
            collection: name,
            identifier,
          },
        );
      }

      draft[name][identifier] = normalizedEntity;
    }, options);

    return envelope[name][identifier];
  }

  /**
   * Updates an existing entity using a patch or updater function.
   *
   * @param {string} collectionName Collection name.
   * @param {string} identifier Entity identifier.
   * @param {Record<string, unknown>|Function} changes Patch or updater.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Updated entity.
   */
  updateEntity(
    collectionName,
    identifier,
    changes,
    options = {},
  ) {
    const name = requireCollectionName(collectionName);
    const id = requireIdentifier(identifier);

    if (
      typeof changes !== 'function' &&
      (!isPlainObject(changes) || !isJsonCompatible(changes))
    ) {
      throw new OperationsRepositoryError(
        OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
        'Operations entity changes must be a safe object or updater function.',
      );
    }

    const envelope = this.transact((draft) => {
      const current = draft[name][id];

      if (current === undefined) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.NOT_FOUND,
          'Operations entity was not found.',
          {
            collection: name,
            identifier: id,
          },
        );
      }

      const updated =
        typeof changes === 'function'
          ? changes(cloneMutable(current))
          : {
              ...current,
              ...cloneMutable(changes),
            };

      if (!isPlainObject(updated) || !isJsonCompatible(updated)) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
          'Operations entity update produced invalid data.',
          {
            collection: name,
            identifier: id,
          },
        );
      }

      const updatedIdentifier = resolveEntityIdentifier(name, updated);

      if (updatedIdentifier !== id) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
          'Operations entity identifier cannot be changed.',
          {
            collection: name,
            identifier: id,
            updatedIdentifier,
          },
        );
      }

      draft[name][id] = updated;
    }, options);

    return envelope[name][id];
  }

  /**
   * Replaces a complete normalized collection.
   *
   * @param {string} collectionName Collection name.
   * @param {unknown[]|Record<string, unknown>} collection Collection data.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored collection.
   */
  replaceCollection(
    collectionName,
    collection,
    options = {},
  ) {
    const name = requireCollectionName(collectionName);
    const normalized = normalizeCollectionInput(collection, name);
    const envelope = this.transact((draft) => {
      draft[name] = normalized;
    }, options);

    return envelope[name];
  }

  /**
   * Returns requests matching local filters and deterministic sorting.
   *
   * @param {Record<string, unknown>} [input] Request filters.
   * @returns {Readonly<Record<string, unknown>>} Paged request result.
   */
  listRequests(input = {}) {
    const query = normalizeRequestQuery(input);
    const envelope = this.getSnapshot();
    const requests = Object.values(envelope.requests)
      .filter((request) => isRequestMatch(request, query))
      .sort((left, right) =>
        compareRequests(left, right, query),
      );
    const start =
      query.offset ?? (query.page - 1) * query.limit;
    const items = requests.slice(start, start + query.limit);

    return deepFreeze({
      items,
      page:
        query.offset === null
          ? query.page
          : Math.floor(start / query.limit) + 1,
      offset: start,
      limit: query.limit,
      total: requests.length,
      totalPages:
        requests.length === 0
          ? 0
          : Math.ceil(requests.length / query.limit),
      revision: envelope.revision,
    });
  }

  getRequestById(requestId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.REQUESTS,
      requestId,
    );
  }

  getPipelineRunById(runId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.PIPELINE_RUNS,
      runId,
    );
  }

  getPipelineRunByRequestId(requestId) {
    const identifier = requireIdentifier(requestId, 'Request ID');

    return (
      Object.values(this.getSnapshot().pipelineRuns).find(
        (run) => run.requestId === identifier,
      ) ?? null
    );
  }

  getDocumentById(documentId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.DOCUMENTS,
      documentId,
    );
  }

  getDocumentsByClaim(claimNumber) {
    const identifier = requireIdentifier(
      claimNumber,
      'Claim number',
    );

    return deepFreeze(
      Object.values(this.getSnapshot().documents)
        .filter(
          (document) => document.claimNumber === identifier,
        )
        .sort((left, right) => {
          if (left.documentType !== right.documentType) {
            return left.documentType.localeCompare(
              right.documentType,
              'en-US',
            );
          }

          return right.version - left.version;
        }),
    );
  }

  getInboundRunById(feedRunId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.INBOUND_RUNS,
      feedRunId,
    );
  }

  getBatchRunById(batchId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.BATCH_RUNS,
      batchId,
    );
  }

  getReviewById(reviewId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.REVIEWS,
      reviewId,
    );
  }

  getReviewByRequestId(requestId) {
    const identifier = requireIdentifier(requestId, 'Request ID');

    return (
      Object.values(this.getSnapshot().reviews).find(
        (review) => review.requestId === identifier,
      ) ?? null
    );
  }

  getErrorReportById(errorReportId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.ERROR_REPORTS,
      errorReportId,
    );
  }

  getOutboundRecordById(outboundId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.OUTBOUND_RECORDS,
      outboundId,
    );
  }

  getOutboundRecordsByDocumentId(documentId) {
    const identifier = requireIdentifier(
      documentId,
      'Document ID',
    );

    return deepFreeze(
      Object.values(this.getSnapshot().outboundRecords)
        .filter((record) => record.documentId === identifier)
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) -
            Date.parse(right.createdAt),
        ),
    );
  }

  getCdcEventById(eventId) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.CDC_EVENTS,
      eventId,
    );
  }

  getIdempotencyResult(idempotencyKey) {
    return this.getEntity(
      OPERATIONS_COLLECTIONS.IDEMPOTENCY_RESULTS,
      idempotencyKey,
    );
  }

  /**
   * Stores an idempotency record, rejecting reuse with another request hash.
   *
   * @param {Record<string, unknown>} record Idempotency record.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Existing or stored record.
   */
  saveIdempotencyResult(record, options = {}) {
    const identifier = resolveEntityIdentifier(
      OPERATIONS_COLLECTIONS.IDEMPOTENCY_RESULTS,
      record,
    );
    const existing =
      this.getSnapshot().idempotencyResults[identifier];

    if (existing !== undefined) {
      if (
        existing.commandName !== record.commandName ||
        existing.requestHash !== record.requestHash
      ) {
        throw new OperationsRepositoryError(
          OPERATIONS_REPOSITORY_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Idempotency key was already used for a different command.',
          {
            idempotencyKey: identifier,
          },
        );
      }

      return existing;
    }

    return this.createEntity(
      OPERATIONS_COLLECTIONS.IDEMPOTENCY_RESULTS,
      record,
      options,
    );
  }

  /**
   * Converts interrupted processing runs to resumable paused state.
   *
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Hydration result.
   */
  hydrate(options = {}) {
    const current = this.getSnapshot();
    const interruptedRequestIds = Object.values(current.requests)
      .filter(
        (request) =>
          request.status === REQUEST_STATUSES.PROCESSING,
      )
      .map((request) => request.requestId);
    const interruptedRunIds = Object.values(current.pipelineRuns)
      .filter((run) => run.status === 'RUNNING')
      .map((run) => run.runId);

    if (
      interruptedRequestIds.length === 0 &&
      interruptedRunIds.length === 0
    ) {
      return deepFreeze({
        changed: false,
        pausedRequestIds: [],
        pausedRunIds: [],
        envelope: current,
      });
    }

    const interruptedRequests = new Set(interruptedRequestIds);
    const interruptedRuns = new Set(interruptedRunIds);
    const timestamp = getCurrentTimestamp(this.clock);
    const envelope = this.transact((draft) => {
      interruptedRequests.forEach((requestId) => {
        const request = draft.requests[requestId];

        request.status = REQUEST_STATUSES.PAUSED;
        request.result =
          'Playback paused after browser hydration.';
        request.version += 1;
      });

      interruptedRuns.forEach((runId) => {
        const run = draft.pipelineRuns[runId];

        run.status = 'PAUSED';
        run.updatedAt = timestamp;
        run.checkpoint = {
          ...run.checkpoint,
          step: run.currentStep,
          resumable: true,
        };
      });
    }, options);

    return deepFreeze({
      changed: true,
      pausedRequestIds: interruptedRequestIds,
      pausedRunIds: interruptedRunIds,
      envelope,
    });
  }

  /**
   * Subscribes to storage invalidation events.
   *
   * @param {(event: Readonly<Record<string, unknown>>) => void} listener
   * Repository listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Operations repository listener must be a function.',
      );
    }

    if (typeof this.gateway.subscribe !== 'function') {
      return () => {};
    }

    return this.gateway.subscribe((event) => {
      this.invalidate();
      listener(event);
    });
  }

  load() {
    return this.getSnapshot();
  }

  read() {
    return this.getSnapshot();
  }

  commit(expectedRevision, envelope, options = {}) {
    return this.replace(envelope, {
      ...(isPlainObject(options) ? options : {}),
      expectedRevision,
    });
  }

  replaceAll(envelope, options = {}) {
    return this.replace(envelope, options);
  }

  transaction(mutator, options = {}) {
    return this.transact(mutator, options);
  }

  recoverInterruptedRuns(options = {}) {
    return this.hydrate(options);
  }

  saveRequest(request, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.REQUESTS,
      request,
      options,
    );
  }

  savePipelineRun(run, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.PIPELINE_RUNS,
      run,
      options,
    );
  }

  saveDocument(document, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.DOCUMENTS,
      document,
      options,
    );
  }

  saveInboundRun(run, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.INBOUND_RUNS,
      run,
      options,
    );
  }

  saveBatchRun(run, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.BATCH_RUNS,
      run,
      options,
    );
  }

  saveReview(review, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.REVIEWS,
      review,
      options,
    );
  }

  saveErrorReport(report, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.ERROR_REPORTS,
      report,
      options,
    );
  }

  saveOutboundRecord(record, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.OUTBOUND_RECORDS,
      record,
      options,
    );
  }

  saveCdcEvent(event, options = {}) {
    return this.upsertEntity(
      OPERATIONS_COLLECTIONS.CDC_EVENTS,
      event,
      options,
    );
  }

  findRequestById(requestId) {
    return this.getRequestById(requestId);
  }

  findPipelineRunById(runId) {
    return this.getPipelineRunById(runId);
  }

  findDocumentById(documentId) {
    return this.getDocumentById(documentId);
  }

  findInboundRunById(feedRunId) {
    return this.getInboundRunById(feedRunId);
  }

  findBatchRunById(batchId) {
    return this.getBatchRunById(batchId);
  }

  findReviewById(reviewId) {
    return this.getReviewById(reviewId);
  }

  findErrorReportById(errorReportId) {
    return this.getErrorReportById(errorReportId);
  }

  findOutboundRecordById(outboundId) {
    return this.getOutboundRecordById(outboundId);
  }
}

/**
 * Creates a normalized operations repository.
 *
 * @param {ConstructorParameters<typeof OperationsRepository>[0]}
 * gatewayOrOptions Gateway or repository options.
 * @param {ConstructorParameters<typeof OperationsRepository>[1]} [options]
 * Repository options.
 * @returns {OperationsRepository} Operations repository.
 */
export function createOperationsRepository(
  gatewayOrOptions,
  options = {},
) {
  return new OperationsRepository(gatewayOrOptions, options);
}

export const LocalOperationsRepository = OperationsRepository;
export const OperationsAggregateRepository = OperationsRepository;
export const createLocalOperationsRepository =
  createOperationsRepository;
export const createOperationsAggregateRepository =
  createOperationsRepository;

export default OperationsRepository;