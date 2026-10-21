import {
  CsvFixtureParserError,
  createCsvFixtureParser,
} from '../services/csvFixtureParser.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';

export const CSV_FIXTURE_WORKER_SCHEMA_VERSION = 1;

export const CSV_FIXTURE_WORKER_MESSAGE_TYPES = Object.freeze({
  PARSE_FIXTURE: 'PARSE_FIXTURE',
  VALIDATE_HEADER: 'VALIDATE_HEADER',
  LIST_APPROVED_FIXTURES: 'LIST_APPROVED_FIXTURES',
  IS_APPROVED_FILENAME: 'IS_APPROVED_FILENAME',
});

export const CSV_FIXTURE_WORKER_RESPONSE_TYPE =
  'CSV_FIXTURE_WORKER_RESULT';

export const CSV_FIXTURE_WORKER_ERROR_CODES = Object.freeze({
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  POST_MESSAGE_UNAVAILABLE: 'POST_MESSAGE_UNAVAILABLE',
});

const MESSAGE_TYPE_ALIASES = Object.freeze({
  PARSE: CSV_FIXTURE_WORKER_MESSAGE_TYPES.PARSE_FIXTURE,
  PARSE_CSV_FIXTURE:
    CSV_FIXTURE_WORKER_MESSAGE_TYPES.PARSE_FIXTURE,
  RESOLVE_FIXTURE:
    CSV_FIXTURE_WORKER_MESSAGE_TYPES.PARSE_FIXTURE,
  VALIDATE_CSV_HEADER:
    CSV_FIXTURE_WORKER_MESSAGE_TYPES.VALIDATE_HEADER,
  LIST_FIXTURES:
    CSV_FIXTURE_WORKER_MESSAGE_TYPES.LIST_APPROVED_FIXTURES,
  GET_APPROVED_FIXTURES:
    CSV_FIXTURE_WORKER_MESSAGE_TYPES.LIST_APPROVED_FIXTURES,
  CHECK_FILENAME:
    CSV_FIXTURE_WORKER_MESSAGE_TYPES.IS_APPROVED_FILENAME,
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

function normalizeMessageType(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CsvFixtureWorkerError(
      CSV_FIXTURE_WORKER_ERROR_CODES.INVALID_MESSAGE,
      'CSV fixture worker message type must be a non-empty string.',
    );
  }

  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();

  return MESSAGE_TYPE_ALIASES[normalized] ?? normalized;
}

function requireMessage(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new CsvFixtureWorkerError(
      CSV_FIXTURE_WORKER_ERROR_CODES.INVALID_MESSAGE,
      'CSV fixture worker message must be a safe JSON-compatible object.',
    );
  }

  return value;
}

function resolvePayload(message) {
  if (message.payload === undefined) {
    return {};
  }

  if (!isPlainObject(message.payload)) {
    throw new CsvFixtureWorkerError(
      CSV_FIXTURE_WORKER_ERROR_CODES.INVALID_MESSAGE,
      'CSV fixture worker payload must be a plain object.',
    );
  }

  return message.payload;
}

function resolveParserOptions(message, payload) {
  const options =
    payload.parserOptions ??
    message.parserOptions ??
    message.options;

  if (options === undefined) {
    return {};
  }

  if (!isPlainObject(options) || !isJsonCompatible(options)) {
    throw new CsvFixtureWorkerError(
      CSV_FIXTURE_WORKER_ERROR_CODES.INVALID_MESSAGE,
      'CSV fixture worker parser options must be a safe plain object.',
    );
  }

  return options;
}

function resolveParseControl(message, payload) {
  const control =
    payload.control ??
    payload.selection ??
    message.control ??
    message.selection;

  if (control !== undefined) {
    return control;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'scenarioId') ||
    Object.prototype.hasOwnProperty.call(payload, 'filename')
  ) {
    return payload;
  }

  throw new CsvFixtureWorkerError(
    CSV_FIXTURE_WORKER_ERROR_CODES.INVALID_MESSAGE,
    'CSV fixture worker parse messages require approved fixture controls.',
  );
}

function resolveFeedType(message, payload) {
  return payload.feedType ?? message.feedType ?? null;
}

function executeOperation(message) {
  const type = normalizeMessageType(
    message.type ?? message.operation ?? message.action,
  );
  const payload = resolvePayload(message);
  const parser = createCsvFixtureParser(
    resolveParserOptions(message, payload),
  );

  switch (type) {
    case CSV_FIXTURE_WORKER_MESSAGE_TYPES.PARSE_FIXTURE:
      return {
        operation: type,
        data: parser.parse(resolveParseControl(message, payload)),
      };

    case CSV_FIXTURE_WORKER_MESSAGE_TYPES.VALIDATE_HEADER:
      return {
        operation: type,
        data: parser.validateHeader(
          resolveFeedType(message, payload),
          payload.header ?? message.header,
        ),
      };

    case CSV_FIXTURE_WORKER_MESSAGE_TYPES.LIST_APPROVED_FIXTURES:
      return {
        operation: type,
        data: parser.listApprovedFixtures(
          resolveFeedType(message, payload),
        ),
      };

    case CSV_FIXTURE_WORKER_MESSAGE_TYPES.IS_APPROVED_FILENAME:
      return {
        operation: type,
        data: {
          approved: parser.isApprovedFilename(
            payload.filename ?? message.filename,
            resolveFeedType(message, payload),
          ),
        },
      };

    default:
      throw new CsvFixtureWorkerError(
        CSV_FIXTURE_WORKER_ERROR_CODES.UNSUPPORTED_OPERATION,
        'CSV fixture worker operation is not supported.',
        {
          operation: type,
          acceptedOperations: Object.values(
            CSV_FIXTURE_WORKER_MESSAGE_TYPES,
          ),
        },
      );
  }
}

function createResponseMetadata(message) {
  const metadata = {};

  ['id', 'requestId', 'correlationId'].forEach((field) => {
    const value = message?.[field];

    if (
      typeof value === 'string' ||
      typeof value === 'number'
    ) {
      metadata[field] = value;
    }
  });

  return metadata;
}

function normalizeError(error) {
  const knownError =
    error instanceof CsvFixtureParserError ||
    error instanceof CsvFixtureWorkerError;
  const details =
    knownError &&
    error.details !== undefined &&
    isJsonCompatible(error.details)
      ? error.details
      : undefined;

  return {
    code: knownError
      ? error.code
      : CSV_FIXTURE_WORKER_ERROR_CODES.PROCESSING_FAILED,
    message: knownError
      ? error.message
      : 'The local CSV fixture operation could not be completed.',
    ...(details === undefined ? {} : { details }),
  };
}

/**
 * Error raised for invalid CSV fixture worker messages.
 */
export class CsvFixtureWorkerError extends Error {
  /**
   * @param {string} code Stable worker error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CsvFixtureWorkerError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Processes one structured worker message without network or file access.
 *
 * @param {unknown} value Worker message data.
 * @returns {Readonly<Record<string, unknown>>} Structured worker response.
 */
export function processCsvFixtureWorkerMessage(value) {
  let message;

  try {
    message = requireMessage(value);

    const result = executeOperation(message);

    return deepFreeze({
      schemaVersion: CSV_FIXTURE_WORKER_SCHEMA_VERSION,
      type: CSV_FIXTURE_WORKER_RESPONSE_TYPE,
      operation: result.operation,
      ok: true,
      data: result.data,
      ...createResponseMetadata(message),
    });
  } catch (error) {
    return deepFreeze({
      schemaVersion: CSV_FIXTURE_WORKER_SCHEMA_VERSION,
      type: CSV_FIXTURE_WORKER_RESPONSE_TYPE,
      operation:
        typeof value?.type === 'string'
          ? value.type.trim().toUpperCase()
          : null,
      ok: false,
      error: normalizeError(error),
      ...createResponseMetadata(
        isPlainObject(value) ? value : {},
      ),
    });
  }
}

/**
 * Creates a worker message listener for an injected worker-like scope.
 *
 * @param {{postMessage: (message: unknown) => void}} scope Worker scope.
 * @returns {(event: MessageEvent|Record<string, unknown>) => void} Listener.
 */
export function createCsvFixtureWorkerMessageHandler(scope) {
  if (
    scope === null ||
    typeof scope !== 'object' ||
    typeof scope.postMessage !== 'function'
  ) {
    throw new CsvFixtureWorkerError(
      CSV_FIXTURE_WORKER_ERROR_CODES.POST_MESSAGE_UNAVAILABLE,
      'CSV fixture worker scope must provide postMessage().',
    );
  }

  return (event) => {
    const message =
      event !== null &&
      typeof event === 'object' &&
      Object.prototype.hasOwnProperty.call(event, 'data')
        ? event.data
        : event;
    const response = processCsvFixtureWorkerMessage(message);

    scope.postMessage(response);
  };
}

const workerScope = globalThis;
const isWorkerScope =
  typeof workerScope.document === 'undefined' &&
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function';

if (isWorkerScope) {
  workerScope.addEventListener(
    'message',
    createCsvFixtureWorkerMessageHandler(workerScope),
  );
}