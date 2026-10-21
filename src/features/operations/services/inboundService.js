import { ACTIONS } from '../../../platform/contracts/capabilities.js';
import { browserClock } from '../../../platform/time/clock.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';
import {
  INBOUND_FEED_TYPES,
  INBOUND_ROW_STATUSES,
  INBOUND_RUN_STATUSES,
  isOperationsUuid,
} from '../domain/operationsSchemas.js';
import {
  OPERATIONS_REPOSITORY_ERROR_CODES,
} from '../repositories/operationsRepository.js';
import {
  CSV_FIXTURE_PARSER_DISCLOSURE,
  CSV_FIXTURE_PARSER_ERROR_CODES,
  CsvFixtureParserError,
  createCsvFixtureParser,
} from './csvFixtureParser.js';

export const INBOUND_SERVICE_SCHEMA_VERSION = 1;

export const INBOUND_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  BAD_HEADER: 'BAD_HEADER',
  EMPTY_FILE: 'EMPTY_FILE',
  ROW_LIMIT_EXCEEDED: 'ROW_LIMIT_EXCEEDED',
  FIXTURE_TOO_LARGE: 'FIXTURE_TOO_LARGE',
  FIXTURE_CONTROL_MISMATCH: 'FIXTURE_CONTROL_MISMATCH',
  UNSUPPORTED_FEED_TYPE: 'UNSUPPORTED_FEED_TYPE',
  FEED_RUN_NOT_FOUND: 'FEED_RUN_NOT_FOUND',
  ROW_NOT_FOUND: 'ROW_NOT_FOUND',
  ROW_VALIDATION_FAILED: 'ROW_VALIDATION_FAILED',
  FIELD_NOT_ALLOWLISTED: 'FIELD_NOT_ALLOWLISTED',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  MEMBER_CLAIM_MISMATCH: 'MEMBER_CLAIM_MISMATCH',
  DUPLICATE_OPEN_REQUEST: 'DUPLICATE_OPEN_REQUEST',
  RETRY_NOT_ALLOWED: 'RETRY_NOT_ALLOWED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const INBOUND_AUDIT_ACTIONS = Object.freeze({
  RUN_CREATED: 'INBOUND_RUN_CREATED',
  ROW_APPLIED: 'INBOUND_ROW_APPLIED',
  ROW_FAILED: 'INBOUND_ROW_FAILED',
  ROW_RETRIED: 'INBOUND_ROW_RETRIED',
  CDC_EVENT_CREATED: 'CDC_EVENT_CREATED',
});

export const INBOUND_SERVICE_LIMITS = Object.freeze({
  MAXIMUM_ROWS: 5000,
  MAXIMUM_RETRY_ATTEMPTS: 3,
  MAXIMUM_SOURCE_DETAIL_LENGTH: 200,
});

export const CHANGE_835_ALLOWLISTED_FIELDS = Object.freeze([
  'coverage_status',
  'claim_status',
  'provider_reference',
]);

const FEED_TYPE_VALUES = new Set(Object.values(INBOUND_FEED_TYPES));
const CHANGE_835_FIELD_VALUES = new Set(
  CHANGE_835_ALLOWLISTED_FIELDS,
);
const INTERNAL_ROLES = new Set(['BOS', 'ADMIN']);
const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const MASKED_API_KEY_PATTERN = /^\*{4}[A-Z0-9]{4}$/;
const MAXIMUM_IDENTIFIER_LENGTH = 100;

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
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Inbound service requires an operations repository with getSnapshot() and transact().',
    );
  }

  return value;
}

function normalizeParser(value, options) {
  if (value === undefined || value === null) {
    return createCsvFixtureParser(options);
  }

  if (
    typeof value !== 'object' ||
    typeof value.parse !== 'function'
  ) {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Inbound service CSV parser must provide parse().',
    );
  }

  return value;
}

function normalizeRequestService(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    (typeof value.createRequest !== 'function' &&
      typeof value.create !== 'function')
  ) {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Inbound service request service must provide createRequest() or create().',
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
  const canApplyChange =
    typeof value.apply835Change === 'function' ||
    typeof value.applyClaimChange === 'function' ||
    typeof value.updateClaim === 'function' ||
    typeof value.updateCoverage === 'function';

  if (
    typeof value !== 'object' ||
    !canReadClaim ||
    !canApplyChange
  ) {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Inbound service fixture gateway must support claim lookup and allowlisted fixture updates.',
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
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Inbound service permission gateway must provide evaluate().',
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
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Inbound service audit gateway must provide append().',
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

  throw new InboundServiceError(
    INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
    'Inbound service session provider must be a function or expose getSession(), getSnapshot(), or getState().',
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
      'Inbound service clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Inbound service clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function createGeneratedValue(idGenerator, prefix, maximumLength = 100) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Inbound service ID generator must return a non-empty string.',
    );
  }

  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-');
  const identifier = normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;

  if (identifier.length > maximumLength) {
    throw new TypeError(
      `Inbound service generated an identifier longer than ${maximumLength} characters.`,
    );
  }

  return identifier;
}

function createCorrelationId(idGenerator, context) {
  if (
    typeof context?.correlationId === 'string' &&
    context.correlationId.trim().length > 0 &&
    context.correlationId.trim().length <= 200
  ) {
    return context.correlationId.normalize('NFC').trim();
  }

  return createGeneratedValue(idGenerator, 'corr-', 200);
}

function createFeedRunId(idGenerator, feedType) {
  return createGeneratedValue(
    idGenerator,
    `FEED-${feedType}-`,
    MAXIMUM_IDENTIFIER_LENGTH,
  );
}

function createCdcEventId(idGenerator) {
  return createGeneratedValue(
    idGenerator,
    'CDC-835-',
    MAXIMUM_IDENTIFIER_LENGTH,
  );
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
      schemaVersion: INBOUND_SERVICE_SCHEMA_VERSION,
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
      schemaVersion: INBOUND_SERVICE_SCHEMA_VERSION,
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

function normalizeFeedType(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return FEED_TYPE_VALUES.has(normalized) ? normalized : null;
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.normalize('NFC').trim().toUpperCase();

  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function normalizePriority(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : null;

  return ['URGENT', 'HIGH', 'NORMAL'].includes(normalized)
    ? normalized
    : null;
}

function normalizeRequestType(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : null;

  return ['EOB', 'EOR', 'BOTH'].includes(normalized)
    ? normalized
    : null;
}

function normalizeIdempotencyKey(value, fieldErrors) {
  if (!isOperationsUuid(value)) {
    fieldErrors.push(
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

function normalizeApplyCommand(value) {
  const command =
    typeof value === 'string'
      ? { filename: value }
      : value;

  if (!isPlainObject(command) || !isJsonCompatible(command)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Inbound feed request must be a safe JSON-compatible object or an approved fixture filename.',
        ),
      ],
    };
  }

  const errors = [];
  const idempotencyKey = normalizeIdempotencyKey(
    command.idempotencyKey,
    errors,
  );
  const feedType =
    command.feedType === undefined
      ? null
      : normalizeFeedType(command.feedType);

  if (command.feedType !== undefined && feedType === null) {
    errors.push(
      createFieldError(
        'feedType',
        'UNSUPPORTED_FEED_TYPE',
        'Inbound feed type must be AP_REPRINT or CHANGE_835.',
      ),
    );
  }

  if (
    command.filename !== undefined &&
    (typeof command.filename !== 'string' ||
      command.filename.trim().length === 0 ||
      command.filename.trim().length > 255)
  ) {
    errors.push(
      createFieldError(
        'filename',
        'INVALID_FILENAME',
        'Inbound fixture filename must be a non-empty string of at most 255 characters.',
      ),
    );
  }

  if (
    command.maskedApiKeyId !== undefined &&
    (typeof command.maskedApiKeyId !== 'string' ||
      !MASKED_API_KEY_PATTERN.test(
        command.maskedApiKeyId.trim().toUpperCase(),
      ))
  ) {
    errors.push(
      createFieldError(
        'maskedApiKeyId',
        'INVALID_MASKED_API_KEY',
        'Only a predefined masked API key identifier may be used.',
      ),
    );
  }

  if (
    command.header !== undefined &&
    (!Array.isArray(command.header) ||
      command.header.some(
        (column) =>
          typeof column !== 'string' ||
          column.length === 0,
      ))
  ) {
    errors.push(
      createFieldError(
        'header',
        'INVALID_HEADER',
        'Inbound fixture header must be an array of non-empty strings.',
      ),
    );
  }

  if (
    command.rows !== undefined &&
    (!Array.isArray(command.rows) ||
      command.rows.some(
        (row) =>
          !isPlainObject(row) ||
          !Number.isInteger(row.rowNumber) ||
          row.rowNumber <= 1 ||
          !isPlainObject(row.values) ||
          !isJsonCompatible(row.values),
      ))
  ) {
    errors.push(
      createFieldError(
        'rows',
        'INVALID_ROWS',
        'Inbound rows must contain row numbers greater than one and safe value objects.',
      ),
    );
  }

  return {
    value: {
      scenarioId:
        typeof command.scenarioId === 'string'
          ? command.scenarioId.normalize('NFC').trim()
          : undefined,
      feedType,
      filename:
        typeof command.filename === 'string'
          ? command.filename.normalize('NFC').trim()
          : undefined,
      maskedApiKeyId:
        typeof command.maskedApiKeyId === 'string'
          ? command.maskedApiKeyId.trim().toUpperCase()
          : undefined,
      header: command.header,
      rows: command.rows,
      idempotencyKey,
    },
    errors,
  };
}

function normalizeRetryCommand(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Inbound row retry request must be a safe JSON-compatible object.',
        ),
      ],
    };
  }

  const errors = [];
  const feedRunId =
    typeof value.feedRunId === 'string' &&
    value.feedRunId.trim().length > 0 &&
    value.feedRunId.trim().length <= MAXIMUM_IDENTIFIER_LENGTH
      ? value.feedRunId.normalize('NFC').trim()
      : null;

  if (feedRunId === null) {
    errors.push(
      createFieldError(
        'feedRunId',
        'INVALID_IDENTIFIER',
        'Feed run ID must be a non-empty string of at most 100 characters.',
      ),
    );
  }

  if (
    !Number.isInteger(value.rowNumber) ||
    value.rowNumber <= 1
  ) {
    errors.push(
      createFieldError(
        'rowNumber',
        'INVALID_ROW_NUMBER',
        'Inbound row number must be an integer greater than one.',
      ),
    );
  }

  if (
    !isPlainObject(value.correctedValues) ||
    !isJsonCompatible(value.correctedValues)
  ) {
    errors.push(
      createFieldError(
        'correctedValues',
        'INVALID_VALUES',
        'Corrected row values must be a safe JSON-compatible object.',
      ),
    );
  }

  const idempotencyKey = normalizeIdempotencyKey(
    value.idempotencyKey,
    errors,
  );

  return {
    value: {
      feedRunId,
      rowNumber: value.rowNumber,
      correctedValues: value.correctedValues,
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

  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function valuesMatch(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function createParserControl(command) {
  return {
    ...(command.scenarioId === undefined
      ? {}
      : { scenarioId: command.scenarioId }),
    ...(command.feedType === null
      ? {}
      : { feedType: command.feedType }),
    ...(command.filename === undefined
      ? {}
      : { filename: command.filename }),
    ...(command.header === undefined
      ? {}
      : { header: command.header }),
    ...(command.maskedApiKeyId === undefined
      ? {}
      : { maskedApiKeyId: command.maskedApiKeyId }),
  };
}

function resolveApprovedFixture(parser, command) {
  const parsed = parser.parse(createParserControl(command));

  if (
    command.rows !== undefined &&
    !valuesMatch(command.rows, parsed.rows)
  ) {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.FIXTURE_CONTROL_MISMATCH,
      'Supplied inbound rows do not match the approved local fixture.',
    );
  }

  if (
    command.feedType !== null &&
    command.feedType !== parsed.feedType
  ) {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.FIXTURE_CONTROL_MISMATCH,
      'Supplied feed type does not match the approved local fixture.',
    );
  }

  return parsed;
}

function validateExactRowShape(feedType, values) {
  if (!isPlainObject(values) || !isJsonCompatible(values)) {
    return {
      valid: false,
      code: INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
      message: 'Inbound row values must be a safe object.',
    };
  }

  const expectedFields =
    feedType === INBOUND_FEED_TYPES.AP_REPRINT
      ? [
          'claim_number',
          'member_id',
          'request_type',
          'priority',
          'source_reference',
        ]
      : [
          'record_type',
          'member_id',
          'claim_number',
          'field',
          'new_value',
        ];
  const fields = Object.keys(values);

  if (
    fields.length !== expectedFields.length ||
    fields.some(
      (field, index) => field !== expectedFields[index],
    )
  ) {
    return {
      valid: false,
      code: INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
      message:
        'Inbound row values do not match the exact ordered feed schema.',
    };
  }

  const claimNumber = normalizeIdentifier(values.claim_number);
  const memberId = normalizeIdentifier(values.member_id);

  if (claimNumber === null || memberId === null) {
    return {
      valid: false,
      code: INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
      message:
        'Inbound claim number and member ID must be valid identifiers.',
    };
  }

  if (feedType === INBOUND_FEED_TYPES.AP_REPRINT) {
    if (
      normalizeRequestType(values.request_type) === null ||
      normalizePriority(values.priority) === null ||
      typeof values.source_reference !== 'string' ||
      values.source_reference.trim().length === 0 ||
      values.source_reference.trim().length > 100
    ) {
      return {
        valid: false,
        code: INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
        message:
          'AP reprint row contains an invalid request type, priority, or source reference.',
      };
    }
  } else {
    const field =
      typeof values.field === 'string'
        ? values.field.trim().toLowerCase()
        : null;

    if (!CHANGE_835_FIELD_VALUES.has(field)) {
      return {
        valid: false,
        code: INBOUND_SERVICE_ERROR_CODES.FIELD_NOT_ALLOWLISTED,
        message:
          'The requested 835 claim field is not allowlisted.',
      };
    }

    if (
      typeof values.record_type !== 'string' ||
      values.record_type.trim().toUpperCase() !== 'CLM' ||
      typeof values.new_value !== 'string' ||
      values.new_value.trim().length === 0 ||
      values.new_value.trim().length > 200
    ) {
      return {
        valid: false,
        code: INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
        message:
          '835 row must contain a CLM record and a non-empty new value.',
      };
    }
  }

  return {
    valid: true,
    claimNumber,
    memberId,
  };
}

function deriveRowIdempotencyKey(parentKey, rowNumber, attempt) {
  const source = `${parentKey}|${rowNumber}|${attempt}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  const compact = parentKey.replace(/-/g, '').toLowerCase();
  const hashValue = (hash >>> 0).toString(16).padStart(8, '0');

  return [
    hashValue,
    compact.slice(8, 12),
    `4${compact.slice(13, 16)}`,
    `8${compact.slice(17, 20)}`,
    compact.slice(20, 32),
  ].join('-');
}

function getRequestCreationMethod(requestService) {
  if (requestService === null) {
    return null;
  }

  return typeof requestService.createRequest === 'function'
    ? requestService.createRequest.bind(requestService)
    : requestService.create.bind(requestService);
}

function readClaim(gateway, claimNumber, context) {
  if (gateway === null) {
    return null;
  }

  if (typeof gateway.getClaimByNumber === 'function') {
    return gateway.getClaimByNumber(
      claimNumber,
      context,
      ACTIONS.REPRINT_REQUEST,
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

async function applyFixtureChange(
  gateway,
  claim,
  field,
  newValue,
  actor,
  metadata,
) {
  if (gateway === null) {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      '835 processing requires a fixture mutation gateway.',
    );
  }

  if (typeof gateway.apply835Change === 'function') {
    return gateway.apply835Change(
      {
        claimNumber: claim.claimNumber,
        memberId: claim.memberId,
        field,
        newValue,
      },
      metadata,
    );
  }

  if (typeof gateway.applyClaimChange === 'function') {
    return gateway.applyClaimChange(
      claim.claimNumber,
      field,
      newValue,
      metadata,
    );
  }

  const revisions = resolveFixtureRevisions(gateway);
  const options = {
    ...(Number.isSafeInteger(revisions.expectedRevision)
      ? { expectedRevision: revisions.expectedRevision }
      : {}),
    ...(Number.isSafeInteger(revisions.expectedRootRevision)
      ? {
          expectedRootRevision:
            revisions.expectedRootRevision,
        }
      : {}),
    updatedBy: actor?.actorId ?? 'system',
  };

  if (field === 'coverage_status') {
    if (
      typeof gateway.updateCoverage !== 'function' ||
      typeof claim.coverageId !== 'string'
    ) {
      throw new InboundServiceError(
        INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        'Fixture gateway cannot update the claim coverage status.',
      );
    }

    return gateway.updateCoverage(
      claim.coverageId,
      {
        status: newValue.trim().toUpperCase(),
      },
      options,
    );
  }

  if (typeof gateway.updateClaim !== 'function') {
    throw new InboundServiceError(
      INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'Fixture gateway cannot update the allowlisted claim field.',
    );
  }

  const changes =
    field === 'claim_status'
      ? {
          status: newValue.trim().toUpperCase(),
        }
      : {
          providerReference: newValue.normalize('NFC').trim(),
        };

  return gateway.updateClaim(
    claim.claimNumber,
    changes,
    options,
  );
}

function getBeforeValue(claim, field, fixtureGateway) {
  if (field === 'claim_status') {
    return claim.status ?? null;
  }

  if (field === 'provider_reference') {
    return claim.providerReference ?? claim.providerId ?? null;
  }

  if (
    field === 'coverage_status' &&
    typeof fixtureGateway?.getCoverageById === 'function'
  ) {
    const coverage = fixtureGateway.getCoverageById(
      claim.coverageId,
      null,
    );

    return coverage?.status ?? null;
  }

  return null;
}

function getAppliedReference(result, fallback) {
  if (typeof result === 'string' && result.trim().length > 0) {
    return result.trim().slice(0, MAXIMUM_IDENTIFIER_LENGTH);
  }

  if (isPlainObject(result)) {
    const candidate =
      result.requestId ??
      result.cdcEventId ??
      result.eventId ??
      result.resultReference;

    if (
      typeof candidate === 'string' &&
      candidate.trim().length > 0
    ) {
      return candidate
        .trim()
        .slice(0, MAXIMUM_IDENTIFIER_LENGTH);
    }
  }

  return fallback;
}

function createInboundRow(row, status, attempt, errorCode, reference) {
  return {
    rowNumber: row.rowNumber,
    values: cloneMutable(row.values),
    status,
    attempt,
    errorCode,
    resultReference: reference,
  };
}

function createRunStatus(rows) {
  const failed = rows.filter(
    (row) => row.status === INBOUND_ROW_STATUSES.FAILED,
  ).length;
  const applied = rows.filter(
    (row) => row.status === INBOUND_ROW_STATUSES.APPLIED,
  ).length;

  if (failed === 0 && applied > 0) {
    return INBOUND_RUN_STATUSES.COMPLETE;
  }

  if (failed > 0 && applied > 0) {
    return INBOUND_RUN_STATUSES.COMPLETED_WITH_ERRORS;
  }

  return INBOUND_RUN_STATUSES.FAILED;
}

function summarizeRows(rows) {
  return {
    accepted: rows.filter(
      (row) => row.status === INBOUND_ROW_STATUSES.APPLIED,
    ).length,
    failed: rows.filter(
      (row) => row.status === INBOUND_ROW_STATUSES.FAILED,
    ).length,
  };
}

function createStoredResult(run) {
  const summary = summarizeRows(run.rows);

  return {
    feedRunId: run.feedRunId,
    feedType: run.feedType,
    filename: run.filename,
    status: run.status,
    accepted: summary.accepted,
    failed: summary.failed,
    rows: run.rows.map((row) => ({
      rowNumber: row.rowNumber,
      status: row.status,
      attempt: row.attempt,
      errorCode: row.errorCode,
      resultReference: row.resultReference,
      ...(run.feedType === INBOUND_FEED_TYPES.AP_REPRINT
        ? { requestId: row.resultReference }
        : { cdcEventId: row.resultReference }),
    })),
    disclosure: CSV_FIXTURE_PARSER_DISCLOSURE,
    localOnly: true,
    transmitted: false,
  };
}

function normalizeParserFailure(
  error,
  correlationId,
  revision,
) {
  const parserCode = getErrorCode(error);
  const mappings = {
    [CSV_FIXTURE_PARSER_ERROR_CODES.BAD_HEADER]: [
      422,
      INBOUND_SERVICE_ERROR_CODES.BAD_HEADER,
    ],
    [CSV_FIXTURE_PARSER_ERROR_CODES.EMPTY_FILE]: [
      422,
      INBOUND_SERVICE_ERROR_CODES.EMPTY_FILE,
    ],
    [CSV_FIXTURE_PARSER_ERROR_CODES.ROW_LIMIT_EXCEEDED]: [
      413,
      INBOUND_SERVICE_ERROR_CODES.ROW_LIMIT_EXCEEDED,
    ],
    [CSV_FIXTURE_PARSER_ERROR_CODES.FIXTURE_TOO_LARGE]: [
      413,
      INBOUND_SERVICE_ERROR_CODES.FIXTURE_TOO_LARGE,
    ],
    [CSV_FIXTURE_PARSER_ERROR_CODES.UNSUPPORTED_FEED_TYPE]: [
      422,
      INBOUND_SERVICE_ERROR_CODES.UNSUPPORTED_FEED_TYPE,
    ],
    [CSV_FIXTURE_PARSER_ERROR_CODES.FIXTURE_CONTROL_MISMATCH]: [
      422,
      INBOUND_SERVICE_ERROR_CODES.FIXTURE_CONTROL_MISMATCH,
    ],
  };
  const [status, code] = mappings[parserCode] ?? [
    422,
    INBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
  ];

  return createFailure(
    status,
    code,
    error instanceof Error
      ? error.message
      : 'The approved inbound fixture could not be resolved.',
    correlationId,
    revision,
    {
      details: {
        parserCode,
        parserDetails:
          error !== null && typeof error === 'object'
            ? error.details ?? null
            : null,
      },
    },
  );
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
      INBOUND_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      'Local operations data changed before inbound processing completed.',
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
      INBOUND_SERVICE_ERROR_CODES.QUOTA_EXCEEDED,
      'Browser-local storage quota was exceeded.',
      correlationId,
      revision,
      { recoveryAction: 'EXPORT_SNAPSHOT' },
    );
  }

  if (error instanceof InboundServiceError) {
    const status =
      error.code ===
          INBOUND_SERVICE_ERROR_CODES.FEED_RUN_NOT_FOUND ||
        error.code === INBOUND_SERVICE_ERROR_CODES.ROW_NOT_FOUND ||
        error.code === INBOUND_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND
        ? 404
        : error.code ===
              INBOUND_SERVICE_ERROR_CODES.RETRY_NOT_ALLOWED ||
            error.code ===
              INBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT ||
            error.code ===
              INBOUND_SERVICE_ERROR_CODES.DUPLICATE_OPEN_REQUEST
          ? 409
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
          INBOUND_SERVICE_ERROR_CODES.REVISION_CONFLICT,
      },
    );
  }

  return createFailure(
    500,
    INBOUND_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
    'The local inbound operation could not be stored.',
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
 * Error raised when inbound service input or dependencies are invalid.
 */
export class InboundServiceError extends Error {
  /**
   * @param {string} code Stable inbound service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'InboundServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Applies approved browser-local AP reprint and 835 fixture rows.
 */
export class InboundService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or service options.
   * @param {{
   *   csvParser?: object,
   *   parser?: object,
   *   requestService?: object,
   *   fixtureGateway?: object,
   *   fixtureRepository?: object,
   *   permissionGateway?: object,
   *   permissionService?: object,
   *   auditGateway?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   maximumRows?: number,
   *   maximumBytes?: number
   * }} [options] Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.repository = requireRepository(resolved.repository);
    this.parser = normalizeParser(
      normalizedOptions.csvParser ??
        normalizedOptions.parser,
      {
        maximumRows:
          normalizedOptions.maximumRows ??
          INBOUND_SERVICE_LIMITS.MAXIMUM_ROWS,
        ...(normalizedOptions.maximumBytes === undefined
          ? {}
          : {
              maximumBytes: normalizedOptions.maximumBytes,
            }),
      },
    );
    this.requestService = normalizeRequestService(
      normalizedOptions.requestService,
    );
    this.fixtureGateway = normalizeFixtureGateway(
      normalizedOptions.fixtureGateway ??
        normalizedOptions.fixtureRepository ??
        normalizedOptions.fixtures,
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
        'Inbound service ID generator must be a function.',
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

  async authorize(actor, correlationId) {
    if (actor !== null && !INTERNAL_ROLES.has(actor.role)) {
      return {
        allowed: false,
        failure: createFailure(
          403,
          INBOUND_SERVICE_ERROR_CODES.FORBIDDEN,
          'Inbound fixture processing is available only to BOS and Admin demo roles.',
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

    if (actor === null) {
      return {
        allowed: false,
        failure: createFailure(
          401,
          INBOUND_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED,
          'An active demo session is required.',
          correlationId,
          this.getRevision(),
        ),
      };
    }

    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionGateway.evaluate({
          action: ACTIONS.OPERATIONAL_SUMMARY_VIEW,
          resource: {
            type: 'INBOUND_FIXTURE',
            id: 'local',
          },
          session: actor,
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'Inbound permission evaluation could not be completed.',
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
      INTERNAL_ROLES.has(actor.role)
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
          ? INBOUND_SERVICE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : INBOUND_SERVICE_ERROR_CODES.FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'Inbound fixture processing is available only to BOS and Admin demo roles.',
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
    after,
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
          before: null,
          after,
          outcome: 'SUCCESS',
        },
      );

      return null;
    } catch (error) {
      return {
        code: INBOUND_SERVICE_ERROR_CODES.AUDIT_FAILED,
        message:
          'Inbound processing completed, but a local audit event could not be recorded.',
        dependencyCode: getErrorCode(error),
      };
    }
  }

  async processApRow(
    row,
    parentIdempotencyKey,
    attempt,
    actor,
  ) {
    const validation = validateExactRowShape(
      INBOUND_FEED_TYPES.AP_REPRINT,
      row.values,
    );

    if (!validation.valid) {
      return createInboundRow(
        row,
        INBOUND_ROW_STATUSES.FAILED,
        attempt,
        validation.code,
        null,
      );
    }

    const createRequest = getRequestCreationMethod(
      this.requestService,
    );

    if (createRequest === null) {
      return createInboundRow(
        row,
        INBOUND_ROW_STATUSES.FAILED,
        attempt,
        INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
        null,
      );
    }

    const sourceReference =
      row.values.source_reference.normalize('NFC').trim();
    const sourceDetail = `AP reprint row ${sourceReference}`.slice(
      0,
      INBOUND_SERVICE_LIMITS.MAXIMUM_SOURCE_DETAIL_LENGTH,
    );
    let result;

    try {
      result = await createRequest(
        {
          claimNumber: validation.claimNumber,
          memberId: validation.memberId,
          requestType: normalizeRequestType(
            row.values.request_type,
          ),
          priority: normalizePriority(row.values.priority),
          sourceType: 'FILE_FEED',
          sourceDetail,
          processNow: false,
          idempotencyKey: deriveRowIdempotencyKey(
            parentIdempotencyKey,
            row.rowNumber,
            attempt,
          ),
        },
        actor ?? undefined,
      );
    } catch (error) {
      return createInboundRow(
        row,
        INBOUND_ROW_STATUSES.FAILED,
        attempt,
        getErrorCode(error) ??
          INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
        null,
      );
    }

    if (result?.ok !== true) {
      return createInboundRow(
        row,
        INBOUND_ROW_STATUSES.FAILED,
        attempt,
        result?.error?.code ??
          INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
        null,
      );
    }

    const requestId =
      result.data?.requestId ??
      result.data?.request?.requestId ??
      null;

    if (
      typeof requestId !== 'string' ||
      requestId.trim().length === 0
    ) {
      return createInboundRow(
        row,
        INBOUND_ROW_STATUSES.FAILED,
        attempt,
        INBOUND_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        null,
      );
    }

    return createInboundRow(
      row,
      INBOUND_ROW_STATUSES.APPLIED,
      attempt,
      null,
      requestId.trim().slice(0, MAXIMUM_IDENTIFIER_LENGTH),
    );
  }

  async process835Row(
    row,
    attempt,
    actor,
    correlationId,
  ) {
    const validation = validateExactRowShape(
      INBOUND_FEED_TYPES.CHANGE_835,
      row.values,
    );

    if (!validation.valid) {
      return {
        row: createInboundRow(
          row,
          INBOUND_ROW_STATUSES.FAILED,
          attempt,
          validation.code,
          null,
        ),
        cdcEvent: null,
      };
    }

    if (this.fixtureGateway === null) {
      return {
        row: createInboundRow(
          row,
          INBOUND_ROW_STATUSES.FAILED,
          attempt,
          INBOUND_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          null,
        ),
        cdcEvent: null,
      };
    }

    let claim;

    try {
      claim = await readClaim(
        this.fixtureGateway,
        validation.claimNumber,
        actor,
      );
    } catch (error) {
      return {
        row: createInboundRow(
          row,
          INBOUND_ROW_STATUSES.FAILED,
          attempt,
          getErrorCode(error) ??
            INBOUND_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
          null,
        ),
        cdcEvent: null,
      };
    }

    if (claim === null || claim === undefined) {
      return {
        row: createInboundRow(
          row,
          INBOUND_ROW_STATUSES.FAILED,
          attempt,
          INBOUND_SERVICE_ERROR_CODES.CLAIM_NOT_FOUND,
          null,
        ),
        cdcEvent: null,
      };
    }

    if (claim.memberId !== validation.memberId) {
      return {
        row: createInboundRow(
          row,
          INBOUND_ROW_STATUSES.FAILED,
          attempt,
          INBOUND_SERVICE_ERROR_CODES.MEMBER_CLAIM_MISMATCH,
          null,
        ),
        cdcEvent: null,
      };
    }

    const field = row.values.field.trim().toLowerCase();
    const newValue = row.values.new_value.normalize('NFC').trim();
    const beforeValue = getBeforeValue(
      claim,
      field,
      this.fixtureGateway,
    );
    let mutationResult;

    try {
      mutationResult = await applyFixtureChange(
        this.fixtureGateway,
        claim,
        field,
        newValue,
        actor,
        {
          correlationId,
          feedType: INBOUND_FEED_TYPES.CHANGE_835,
          rowNumber: row.rowNumber,
        },
      );
    } catch (error) {
      return {
        row: createInboundRow(
          row,
          INBOUND_ROW_STATUSES.FAILED,
          attempt,
          getErrorCode(error) ??
            INBOUND_SERVICE_ERROR_CODES.ROW_VALIDATION_FAILED,
          null,
        ),
        cdcEvent: null,
      };
    }

    const cdcEventId = createCdcEventId(this.idGenerator);
    const cdcEvent = {
      cdcEventId,
      operation: 'UPDATE',
      entityType: 'CLAIM',
      entityId: validation.claimNumber,
      before: {
        field,
        value: beforeValue,
      },
      after: {
        field,
        value: newValue,
      },
      occurredAt: getCurrentTimestamp(this.clock),
      correlationId,
    };

    return {
      row: createInboundRow(
        row,
        INBOUND_ROW_STATUSES.APPLIED,
        attempt,
        null,
        getAppliedReference(mutationResult, cdcEventId),
      ),
      cdcEvent,
    };
  }

  async processRow(
    feedType,
    row,
    parentIdempotencyKey,
    attempt,
    actor,
    correlationId,
  ) {
    if (feedType === INBOUND_FEED_TYPES.AP_REPRINT) {
      return {
        row: await this.processApRow(
          row,
          parentIdempotencyKey,
          attempt,
          actor,
        ),
        cdcEvent: null,
      };
    }

    return this.process835Row(
      row,
      attempt,
      actor,
      correlationId,
    );
  }

  persistRunAndIdempotency({
    run,
    idempotencyKey,
    commandName,
    requestHash,
    result,
    cdcEvents,
    expectedRevision,
    createdAt,
  }) {
    return this.repository.transact(
      (draft) => {
        const existing =
          draft.idempotencyResults[idempotencyKey];

        if (existing !== undefined) {
          if (
            existing.commandName !== commandName ||
            existing.requestHash !== requestHash
          ) {
            throw new InboundServiceError(
              INBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              'The idempotency key was already used for another inbound operation.',
            );
          }

          return;
        }

        draft.inboundRuns[run.feedRunId] = cloneMutable(run);

        cdcEvents.forEach((event) => {
          draft.cdcEvents[event.cdcEventId] =
            cloneMutable(event);
        });

        draft.idempotencyResults[idempotencyKey] = {
          idempotencyKey,
          commandName,
          requestHash,
          result: cloneMutable(result),
          createdAt,
        };
      },
      {
        expectedRevision,
      },
    );
  }

  /**
   * Applies one approved AP reprint or 835 fixture.
   *
   * Arbitrary uploaded file content is not accepted. Supplied rows, when
   * present for contract compatibility, must exactly match an approved fixture.
   *
   * @param {string|Record<string, unknown>} command Inbound fixture command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async applyInboundRows(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const snapshot = this.repository.getSnapshot();
    const normalized = normalizeApplyCommand(command);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        INBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Inbound feed request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const input = normalized.value;
    const requestHash = hashCommand('applyInboundRows', {
      scenarioId: input.scenarioId ?? null,
      feedType: input.feedType,
      filename: input.filename ?? null,
      maskedApiKeyId: input.maskedApiKeyId ?? null,
      header: input.header ?? null,
      rows: input.rows ?? null,
    });
    const existing =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existing !== undefined) {
      if (
        existing.commandName !== 'applyInboundRows' ||
        existing.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          INBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another inbound operation.',
          correlationId,
          snapshot.revision,
        );
      }

      const run =
        snapshot.inboundRuns[
          existing.result.feedRunId
        ] ?? null;

      return createSuccess(
        200,
        {
          ...(run === null
            ? existing.result
            : createStoredResult(run)),
          replayed: true,
        },
        correlationId,
        snapshot.revision,
      );
    }

    let fixture;

    try {
      fixture = resolveApprovedFixture(this.parser, input);
    } catch (error) {
      return normalizeParserFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    const feedRunId = createFeedRunId(
      this.idGenerator,
      fixture.feedType,
    );
    const createdAt = getCurrentTimestamp(this.clock);

    if (fixture.headerValidation.valid !== true) {
      const run = {
        feedRunId,
        feedType: fixture.feedType,
        filename: fixture.filename,
        maskedApiKeyId: fixture.maskedApiKeyId,
        header: cloneMutable(fixture.header),
        status: INBOUND_RUN_STATUSES.FAILED,
        rows: [],
        createdAt,
      };
      const result = {
        ...createStoredResult(run),
        errorCode: INBOUND_SERVICE_ERROR_CODES.BAD_HEADER,
      };

      try {
        this.persistRunAndIdempotency({
          run,
          idempotencyKey: input.idempotencyKey,
          commandName: 'applyInboundRows',
          requestHash,
          result,
          cdcEvents: [],
          expectedRevision: snapshot.revision,
          createdAt,
        });
      } catch (error) {
        return normalizeRepositoryFailure(
          error,
          correlationId,
          snapshot.revision,
        );
      }

      return createFailure(
        422,
        INBOUND_SERVICE_ERROR_CODES.BAD_HEADER,
        'Inbound fixture header does not match the exact ordered feed schema.',
        correlationId,
        this.getRevision(),
        {
          details: {
            feedRunId,
            expectedHeader:
              fixture.headerValidation.expectedHeader,
            actualHeader: fixture.header,
          },
        },
      );
    }

    if (fixture.rows.length === 0) {
      return createFailure(
        422,
        INBOUND_SERVICE_ERROR_CODES.EMPTY_FILE,
        'The approved inbound fixture contains no data rows.',
        correlationId,
        snapshot.revision,
      );
    }

    if (
      fixture.rows.length >
      INBOUND_SERVICE_LIMITS.MAXIMUM_ROWS
    ) {
      return createFailure(
        413,
        INBOUND_SERVICE_ERROR_CODES.ROW_LIMIT_EXCEEDED,
        `Inbound fixture exceeds the ${INBOUND_SERVICE_LIMITS.MAXIMUM_ROWS}-row limit.`,
        correlationId,
        snapshot.revision,
      );
    }

    const processedRows = [];
    const cdcEvents = [];
    const warnings = [];

    for (const row of fixture.rows) {
      const processed = await this.processRow(
        fixture.feedType,
        row,
        input.idempotencyKey,
        1,
        actor,
        correlationId,
      );

      processedRows.push(processed.row);

      if (processed.cdcEvent !== null) {
        cdcEvents.push(processed.cdcEvent);
      }
    }

    const run = {
      feedRunId,
      feedType: fixture.feedType,
      filename: fixture.filename,
      maskedApiKeyId: fixture.maskedApiKeyId,
      header: cloneMutable(fixture.header),
      status: createRunStatus(processedRows),
      rows: processedRows,
      createdAt,
    };
    const result = createStoredResult(run);
    let storedEnvelope;

    try {
      storedEnvelope = this.persistRunAndIdempotency({
        run,
        idempotencyKey: input.idempotencyKey,
        commandName: 'applyInboundRows',
        requestHash,
        result,
        cdcEvents,
        expectedRevision: snapshot.revision,
        createdAt,
      });
    } catch (error) {
      return normalizeRepositoryFailure(
        error,
        correlationId,
        snapshot.revision,
      );
    }

    for (const row of processedRows) {
      const warning = await this.appendAudit({
        correlationId,
        actor,
        action:
          row.status === INBOUND_ROW_STATUSES.APPLIED
            ? INBOUND_AUDIT_ACTIONS.ROW_APPLIED
            : INBOUND_AUDIT_ACTIONS.ROW_FAILED,
        entityType: 'INBOUND_ROW',
        entityId: `${feedRunId}:${row.rowNumber}`,
        after: {
          feedRunId,
          feedType: fixture.feedType,
          rowNumber: row.rowNumber,
          status: row.status,
          attempt: row.attempt,
          errorCode: row.errorCode,
          resultReference: row.resultReference,
          maskedApiKeyId: fixture.maskedApiKeyId,
          localOnly: true,
          transmitted: false,
        },
      });

      if (warning !== null) {
        warnings.push(warning);
      }
    }

    for (const event of cdcEvents) {
      const warning = await this.appendAudit({
        correlationId,
        actor,
        action: INBOUND_AUDIT_ACTIONS.CDC_EVENT_CREATED,
        entityType: 'CDC_EVENT',
        entityId: event.cdcEventId,
        after: {
          cdcEventId: event.cdcEventId,
          operation: event.operation,
          entityType: event.entityType,
          entityId: event.entityId,
          transmitted: false,
        },
      });

      if (warning !== null) {
        warnings.push(warning);
      }
    }

    return createSuccess(
      201,
      {
        ...result,
        replayed: false,
      },
      correlationId,
      storedEnvelope.revision,
      warnings,
    );
  }

  /**
   * Retries one failed inbound row with corrected local fixture values.
   *
   * @param {Record<string, unknown>} command Retry command.
   * @param {Record<string, unknown>} [context] Actor context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Service result.
   */
  async retryInboundRow(command, context = undefined) {
    const actor = this.resolveContext(context);
    const correlationId = createCorrelationId(
      this.idGenerator,
      actor ?? context,
    );
    const snapshot = this.repository.getSnapshot();
    const normalized = normalizeRetryCommand(command);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        INBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Inbound row retry request validation failed.',
        correlationId,
        snapshot.revision,
        { fieldErrors: normalized.errors },
      );
    }

    const authorization = await this.authorize(
      actor,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const input = normalized.value;
    const requestHash = hashCommand('retryInboundRow', input);
    const existing =
      snapshot.idempotencyResults[input.idempotencyKey];

    if (existing !== undefined) {
      if (
        existing.commandName !== 'retryInboundRow' ||
        existing.requestHash !== requestHash
      ) {
        return createFailure(
          409,
          INBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'The idempotency key was already used for another inbound retry.',
          correlationId,
          snapshot.revision,
        );
      }

      return createSuccess(
        200,
        {
          ...existing.result,
          replayed: true,
        },
        correlationId,
        snapshot.revision,
      );
    }

    const run = snapshot.inboundRuns[input.feedRunId];

    if (run === undefined) {
      return createFailure(
        404,
        INBOUND_SERVICE_ERROR_CODES.FEED_RUN_NOT_FOUND,
        'The inbound feed run does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    const existingRow = run.rows.find(
      (row) => row.rowNumber === input.rowNumber,
    );

    if (existingRow === undefined) {
      return createFailure(
        404,
        INBOUND_SERVICE_ERROR_CODES.ROW_NOT_FOUND,
        'The inbound feed row does not exist.',
        correlationId,
        snapshot.revision,
      );
    }

    if (
      existingRow.status !== INBOUND_ROW_STATUSES.FAILED ||
      existingRow.attempt >=
        INBOUND_SERVICE_LIMITS.MAXIMUM_RETRY_ATTEMPTS
    ) {
      return createFailure(
        409,
        INBOUND_SERVICE_ERROR_CODES.RETRY_NOT_ALLOWED,
        'Only a failed inbound row below the retry limit may be retried.',
        correlationId,
        snapshot.revision,
        {
          details: {
            status: existingRow.status,
            attempt: existingRow.attempt,
            maximumAttempts:
              INBOUND_SERVICE_LIMITS.MAXIMUM_RETRY_ATTEMPTS,
          },
        },
      );
    }

    const attempt = existingRow.attempt + 1;
    const candidate = {
      rowNumber: existingRow.rowNumber,
      values: cloneMutable(input.correctedValues),
    };
    const processed = await this.processRow(
      run.feedType,
      candidate,
      input.idempotencyKey,
      attempt,
      actor,
      correlationId,
    );
    const updatedRows = run.rows.map((row) =>
      row.rowNumber === input.rowNumber
        ? processed.row
        : cloneMutable(row),
    );
    const updatedRun = {
      ...cloneMutable(run),
      status: createRunStatus(updatedRows),
      rows: updatedRows,
    };
    const result = {
      feedRunId: run.feedRunId,
      feedType: run.feedType,
      rowNumber: input.rowNumber,
      attempt,
      status: processed.row.status,
      errorCode: processed.row.errorCode,
      resultReference: processed.row.resultReference,
      ...(run.feedType === INBOUND_FEED_TYPES.AP_REPRINT
        ? { requestId: processed.row.resultReference }
        : { cdcEventId: processed.row.resultReference }),
      disclosure: CSV_FIXTURE_PARSER_DISCLOSURE,
      localOnly: true,
      transmitted: false,
    };
    const createdAt = getCurrentTimestamp(this.clock);
    let storedEnvelope;

    try {
      storedEnvelope = this.repository.transact(
        (draft) => {
          const currentRun = draft.inboundRuns[input.feedRunId];
          const committed =
            draft.idempotencyResults[input.idempotencyKey];

          if (committed !== undefined) {
            if (
              committed.commandName !== 'retryInboundRow' ||
              committed.requestHash !== requestHash
            ) {
              throw new InboundServiceError(
                INBOUND_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                'The idempotency key was already used for another inbound retry.',
              );
            }

            return;
          }

          if (currentRun === undefined) {
            throw new InboundServiceError(
              INBOUND_SERVICE_ERROR_CODES.FEED_RUN_NOT_FOUND,
              'The inbound feed run no longer exists.',
            );
          }

          const rowIndex = currentRun.rows.findIndex(
            (row) => row.rowNumber === input.rowNumber,
          );

          if (rowIndex < 0) {
            throw new InboundServiceError(
              INBOUND_SERVICE_ERROR_CODES.ROW_NOT_FOUND,
              'The inbound feed row no longer exists.',
            );
          }

          const currentRow = currentRun.rows[rowIndex];

          if (
            currentRow.status !==
              INBOUND_ROW_STATUSES.FAILED ||
            currentRow.attempt !== existingRow.attempt
          ) {
            throw new InboundServiceError(
              INBOUND_SERVICE_ERROR_CODES.RETRY_NOT_ALLOWED,
              'The inbound row changed before it could be retried.',
            );
          }

          currentRun.rows[rowIndex] =
            cloneMutable(processed.row);
          currentRun.status = createRunStatus(currentRun.rows);

          if (processed.cdcEvent !== null) {
            draft.cdcEvents[
              processed.cdcEvent.cdcEventId
            ] = cloneMutable(processed.cdcEvent);
          }

          draft.idempotencyResults[input.idempotencyKey] = {
            idempotencyKey: input.idempotencyKey,
            commandName: 'retryInboundRow',
            requestHash,
            result: cloneMutable(result),
            createdAt,
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

    const warnings = [];
    const warning = await this.appendAudit({
      correlationId,
      actor,
      action: INBOUND_AUDIT_ACTIONS.ROW_RETRIED,
      entityType: 'INBOUND_ROW',
      entityId: `${run.feedRunId}:${input.rowNumber}`,
      after: {
        feedRunId: run.feedRunId,
        feedType: run.feedType,
        rowNumber: input.rowNumber,
        attempt,
        status: processed.row.status,
        errorCode: processed.row.errorCode,
        resultReference: processed.row.resultReference,
        localOnly: true,
        transmitted: false,
      },
    });

    if (warning !== null) {
      warnings.push(warning);
    }

    return createSuccess(
      200,
      {
        ...result,
        replayed: false,
      },
      correlationId,
      storedEnvelope.revision,
      warnings,
    );
  }

  getInboundRunById(feedRunId) {
    if (
      typeof feedRunId !== 'string' ||
      feedRunId.trim().length === 0 ||
      feedRunId.trim().length > MAXIMUM_IDENTIFIER_LENGTH
    ) {
      throw new InboundServiceError(
        INBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Feed run ID must be a non-empty string of at most 100 characters.',
      );
    }

    return (
      this.repository.getSnapshot().inboundRuns[
        feedRunId.normalize('NFC').trim()
      ] ?? null
    );
  }

  getInboundRow(feedRunId, rowNumber) {
    const run = this.getInboundRunById(feedRunId);

    if (run === null) {
      return null;
    }

    if (!Number.isInteger(rowNumber) || rowNumber <= 1) {
      throw new InboundServiceError(
        INBOUND_SERVICE_ERROR_CODES.VALIDATION_ERROR,
        'Inbound row number must be an integer greater than one.',
      );
    }

    return (
      run.rows.find((row) => row.rowNumber === rowNumber) ??
      null
    );
  }

  apply(command, context = undefined) {
    return this.applyInboundRows(command, context);
  }

  process(command, context = undefined) {
    return this.applyInboundRows(command, context);
  }

  retry(command, context = undefined) {
    return this.retryInboundRow(command, context);
  }

  findInboundRunById(feedRunId) {
    return this.getInboundRunById(feedRunId);
  }
}

/**
 * Creates a browser-local inbound fixture service.
 *
 * @param {ConstructorParameters<typeof InboundService>[0]}
 * repositoryOrOptions Repository or service options.
 * @param {ConstructorParameters<typeof InboundService>[1]} [options]
 * Service options.
 * @returns {InboundService} Inbound service.
 */
export function createInboundService(
  repositoryOrOptions,
  options = {},
) {
  return new InboundService(repositoryOrOptions, options);
}

export const LocalInboundService = InboundService;
export const OperationsInboundService = InboundService;
export const createLocalInboundService = createInboundService;
export const createOperationsInboundService =
  createInboundService;

export default InboundService;