import {
  AP_REPRINT_HEADER,
  AP_REPRINT_SCENARIOS,
  CHANGE_835_HEADER,
  CHANGE_835_SCENARIOS,
} from '../../../fixtures/operations.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';
import { INBOUND_FEED_TYPES } from '../domain/operationsSchemas.js';

export const CSV_FIXTURE_PARSER_SCHEMA_VERSION = 1;

export const CSV_FIXTURE_PARSER_LIMITS = Object.freeze({
  MAXIMUM_ROWS: 5000,
  MAXIMUM_BYTES: 2 * 1024 * 1024,
  MAXIMUM_FILENAME_LENGTH: 255,
  MAXIMUM_HEADER_COLUMNS: 50,
  MAXIMUM_HEADER_COLUMN_LENGTH: 100,
});

export const CSV_FIXTURE_PARSER_DISCLOSURE =
  'No file leaves this browser';

export const CSV_FIXTURE_PARSER_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_FIXTURE: 'INVALID_FIXTURE',
  INVALID_FILENAME: 'INVALID_FILENAME',
  INVALID_HEADER: 'INVALID_HEADER',
  UNSUPPORTED_FEED_TYPE: 'UNSUPPORTED_FEED_TYPE',
  UNAPPROVED_FILENAME: 'UNAPPROVED_FILENAME',
  SCENARIO_NOT_FOUND: 'SCENARIO_NOT_FOUND',
  FIXTURE_CONTROL_MISMATCH: 'FIXTURE_CONTROL_MISMATCH',
  BAD_HEADER: 'BAD_HEADER',
  EMPTY_FILE: 'EMPTY_FILE',
  ROW_LIMIT_EXCEEDED: 'ROW_LIMIT_EXCEEDED',
  FIXTURE_TOO_LARGE: 'FIXTURE_TOO_LARGE',
  ARBITRARY_CONTENT_NOT_ALLOWED: 'ARBITRARY_CONTENT_NOT_ALLOWED',
  SENSITIVE_CONTENT_REFUSED: 'SENSITIVE_CONTENT_REFUSED',
});

const FEED_TYPE_VALUES = new Set(Object.values(INBOUND_FEED_TYPES));
const ALLOWED_CONTROL_FIELDS = new Set([
  'scenarioId',
  'feedType',
  'filename',
  'header',
  'maskedApiKeyId',
]);
const ARBITRARY_CONTENT_FIELDS = new Set([
  'blob',
  'bytes',
  'content',
  'csv',
  'data',
  'file',
  'fileHandle',
  'raw',
  'rows',
  'stream',
  'text',
]);
const MASKED_API_KEY_PATTERN = /^\*{4}[A-Z0-9]{4}$/;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/i;

const EXPECTED_HEADERS = Object.freeze({
  [INBOUND_FEED_TYPES.AP_REPRINT]: AP_REPRINT_HEADER,
  [INBOUND_FEED_TYPES.CHANGE_835]: CHANGE_835_HEADER,
});

const FIXTURE_SCENARIOS = Object.freeze([
  ...AP_REPRINT_SCENARIOS.map((scenario) =>
    Object.freeze({
      feedType: INBOUND_FEED_TYPES.AP_REPRINT,
      scenario,
    }),
  ),
  ...CHANGE_835_SCENARIOS.map((scenario) =>
    Object.freeze({
      feedType: INBOUND_FEED_TYPES.CHANGE_835,
      scenario,
    }),
  ),
]);

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

function normalizeOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_OPTIONS,
      'CSV fixture parser options must be a plain object.',
    );
  }

  const allowedFields = new Set(['maximumRows', 'maximumBytes']);
  const unsupportedFields = Object.keys(value).filter(
    (field) => !allowedFields.has(field),
  );

  if (unsupportedFields.length > 0) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_OPTIONS,
      'CSV fixture parser options contain unsupported fields.',
      { fields: unsupportedFields },
    );
  }

  return value;
}

function normalizeLimit(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_OPTIONS,
      `${name} must be a positive safe integer.`,
    );
  }

  return value;
}

function normalizeFeedType(value, required = true) {
  if (
    (value === undefined || value === null || value === '') &&
    required !== true
  ) {
    return null;
  }

  const normalized =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  if (!FEED_TYPE_VALUES.has(normalized)) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.UNSUPPORTED_FEED_TYPE,
      'CSV fixture feed type must be AP_REPRINT or CHANGE_835.',
      {
        acceptedFeedTypes: [...FEED_TYPE_VALUES],
      },
    );
  }

  return normalized;
}

function normalizeFilename(value, required = true) {
  if (
    (value === undefined || value === null || value === '') &&
    required !== true
  ) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length >
      CSV_FIXTURE_PARSER_LIMITS.MAXIMUM_FILENAME_LENGTH
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_FILENAME,
      'CSV fixture filename must be a non-empty CSV filename of at most 255 characters.',
    );
  }

  const filename = value.normalize('NFC').trim();

  if (
    !SAFE_FILENAME_PATTERN.test(filename) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..')
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_FILENAME,
      'CSV fixture filename must be a safe basename ending in .csv.',
    );
  }

  return filename;
}

function normalizeScenarioId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 100
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_REQUEST,
      'CSV fixture scenario ID must be a non-empty string of at most 100 characters.',
    );
  }

  return value.normalize('NFC').trim().toUpperCase();
}

function normalizeHeader(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length >
      CSV_FIXTURE_PARSER_LIMITS.MAXIMUM_HEADER_COLUMNS
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_HEADER,
      'CSV fixture header must contain between 1 and 50 columns.',
    );
  }

  const normalized = value.map((column) => {
    if (
      typeof column !== 'string' ||
      column.length === 0 ||
      column.length >
        CSV_FIXTURE_PARSER_LIMITS.MAXIMUM_HEADER_COLUMN_LENGTH ||
      column.trim() !== column
    ) {
      throw new CsvFixtureParserError(
        CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_HEADER,
        'CSV fixture header columns must be exact non-empty strings of at most 100 characters.',
      );
    }

    return column;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_HEADER,
      'CSV fixture header columns must be unique.',
    );
  }

  return normalized;
}

function normalizeMaskedApiKeyId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (
    typeof value !== 'string' ||
    !MASKED_API_KEY_PATTERN.test(value.trim().toUpperCase())
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.SENSITIVE_CONTENT_REFUSED,
      'Only the predefined masked API key identifier may be selected.',
    );
  }

  return value.trim().toUpperCase();
}

function headersMatch(left, right) {
  return (
    left.length === right.length &&
    left.every((column, index) => column === right[index])
  );
}

function getByteLength(value) {
  const serialized = JSON.stringify(value);

  if (typeof globalThis.TextEncoder === 'function') {
    return new globalThis.TextEncoder().encode(serialized).length;
  }

  return encodeURIComponent(serialized).replace(
    /%[0-9A-F]{2}|./g,
    'x',
  ).length;
}

function requireSafeControl(value) {
  if (typeof value === 'string') {
    return {
      filename: value,
    };
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_REQUEST,
      'CSV fixture selection must be a safe JSON-compatible object or approved filename.',
    );
  }

  const suppliedFields = Object.keys(value);
  const arbitraryFields = suppliedFields.filter((field) =>
    ARBITRARY_CONTENT_FIELDS.has(field),
  );

  if (arbitraryFields.length > 0) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.ARBITRARY_CONTENT_NOT_ALLOWED,
      'Arbitrary CSV content, rows, files, and streams are not accepted. Select a predefined local fixture.',
      { fields: arbitraryFields },
    );
  }

  const unsupportedFields = suppliedFields.filter(
    (field) => !ALLOWED_CONTROL_FIELDS.has(field),
  );

  if (unsupportedFields.length > 0) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_REQUEST,
      'CSV fixture selection contains unsupported control fields.',
      { fields: unsupportedFields },
    );
  }

  return value;
}

function findFixture(control) {
  const scenarioId = normalizeScenarioId(control.scenarioId);
  const filename = normalizeFilename(
    control.filename,
    scenarioId === null,
  );
  const feedType = normalizeFeedType(control.feedType, false);

  const matches = FIXTURE_SCENARIOS.filter((entry) => {
    if (
      scenarioId !== null &&
      entry.scenario.scenarioId.toUpperCase() !== scenarioId
    ) {
      return false;
    }

    if (
      filename !== null &&
      entry.scenario.filename !== filename
    ) {
      return false;
    }

    if (feedType !== null && entry.feedType !== feedType) {
      return false;
    }

    return true;
  });

  if (matches.length === 0) {
    const code =
      scenarioId !== null && filename === null
        ? CSV_FIXTURE_PARSER_ERROR_CODES.SCENARIO_NOT_FOUND
        : CSV_FIXTURE_PARSER_ERROR_CODES.UNAPPROVED_FILENAME;

    throw new CsvFixtureParserError(
      code,
      'The selected CSV fixture is not an approved local scenario.',
    );
  }

  if (matches.length > 1) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_REQUEST,
      'CSV fixture selection is ambiguous. Supply an approved feed type or scenario ID.',
    );
  }

  return matches[0];
}

function validateFixtureEntry(entry) {
  const { feedType, scenario } = entry;

  if (
    !FEED_TYPE_VALUES.has(feedType) ||
    !isPlainObject(scenario) ||
    !isJsonCompatible(scenario) ||
    typeof scenario.scenarioId !== 'string' ||
    scenario.scenarioId.trim().length === 0 ||
    typeof scenario.filename !== 'string' ||
    !SAFE_FILENAME_PATTERN.test(scenario.filename) ||
    typeof scenario.maskedApiKeyId !== 'string' ||
    !MASKED_API_KEY_PATTERN.test(scenario.maskedApiKeyId) ||
    !Array.isArray(scenario.header) ||
    !Array.isArray(scenario.rows)
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.INVALID_FIXTURE,
      'The selected predefined CSV fixture is invalid.',
    );
  }

  return scenario;
}

function validateSelectedControls(control, entry) {
  const scenario = entry.scenario;

  if (control.header !== undefined) {
    const suppliedHeader = normalizeHeader(control.header);

    if (!headersMatch(suppliedHeader, scenario.header)) {
      throw new CsvFixtureParserError(
        CSV_FIXTURE_PARSER_ERROR_CODES.FIXTURE_CONTROL_MISMATCH,
        'The selected header does not match the approved fixture scenario.',
      );
    }
  }

  const maskedApiKeyId = normalizeMaskedApiKeyId(
    control.maskedApiKeyId,
  );

  if (
    maskedApiKeyId !== null &&
    maskedApiKeyId !== scenario.maskedApiKeyId
  ) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.FIXTURE_CONTROL_MISMATCH,
      'The selected masked API key identifier does not match the approved fixture scenario.',
    );
  }
}

function createHeaderValidation(feedType, header) {
  const normalizedFeedType = normalizeFeedType(feedType);
  const normalizedHeader = normalizeHeader(header);
  const expectedHeader = EXPECTED_HEADERS[normalizedFeedType];
  const valid = headersMatch(normalizedHeader, expectedHeader);

  return deepFreeze({
    valid,
    code: valid
      ? null
      : CSV_FIXTURE_PARSER_ERROR_CODES.BAD_HEADER,
    feedType: normalizedFeedType,
    expectedHeader,
    actualColumnCount: normalizedHeader.length,
  });
}

function createParsedFixture(entry, maximumRows, maximumBytes) {
  const scenario = validateFixtureEntry(entry);
  const rowCount = scenario.rows.length;

  if (rowCount > maximumRows) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      `The predefined CSV fixture exceeds the ${maximumRows}-row limit.`,
      {
        maximumRows,
        rowCount,
      },
    );
  }

  const byteLength = getByteLength({
    feedType: entry.feedType,
    filename: scenario.filename,
    header: scenario.header,
    rows: scenario.rows,
  });

  if (byteLength > maximumBytes) {
    throw new CsvFixtureParserError(
      CSV_FIXTURE_PARSER_ERROR_CODES.FIXTURE_TOO_LARGE,
      `The predefined CSV fixture exceeds the ${maximumBytes}-byte limit.`,
      {
        maximumBytes,
        byteLength,
      },
    );
  }

  const headerValidation = createHeaderValidation(
    entry.feedType,
    scenario.header,
  );

  return deepFreeze({
    schemaVersion: CSV_FIXTURE_PARSER_SCHEMA_VERSION,
    scenarioId: scenario.scenarioId,
    feedType: entry.feedType,
    filename: scenario.filename,
    maskedApiKeyId: scenario.maskedApiKeyId,
    header: scenario.header,
    rows: scenario.rows,
    rowCount,
    byteLength,
    headerValidation,
    parseStatus: headerValidation.valid
      ? 'READY'
      : 'REJECTED',
    expectedStatus: scenario.expectedStatus,
    expectedCode:
      scenario.expectedCode ??
      headerValidation.code ??
      null,
    expectedAccepted: scenario.expectedAccepted ?? null,
    expectedFailed: scenario.expectedFailed ?? null,
    expectedCdcOperation:
      scenario.expectedCdcOperation ?? null,
    localOnly: true,
    transmitted: false,
    disclosure: CSV_FIXTURE_PARSER_DISCLOSURE,
  });
}

/**
 * Error raised when a CSV fixture selection is unsafe or unsupported.
 */
export class CsvFixtureParserError extends Error {
  /**
   * @param {string} code Stable parser error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CsvFixtureParserError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Resolves approved AP reprint and 835 controls to bundled local scenarios.
 *
 * Arbitrary CSV text, uploaded files, supplied rows, and unmasked API keys are
 * intentionally refused.
 */
export class CsvFixtureParser {
  /**
   * @param {{maximumRows?: number, maximumBytes?: number}} [options]
   * Parser limits.
   */
  constructor(options = {}) {
    const normalizedOptions = normalizeOptions(options);

    this.maximumRows = normalizeLimit(
      normalizedOptions.maximumRows,
      CSV_FIXTURE_PARSER_LIMITS.MAXIMUM_ROWS,
      'Maximum CSV fixture rows',
    );
    this.maximumBytes = normalizeLimit(
      normalizedOptions.maximumBytes,
      CSV_FIXTURE_PARSER_LIMITS.MAXIMUM_BYTES,
      'Maximum CSV fixture bytes',
    );
  }

  /**
   * Resolves one approved fixture selection.
   *
   * @param {string|Record<string, unknown>} control Approved fixture controls.
   * @returns {Readonly<Record<string, unknown>>} Parsed local fixture.
   */
  parse(control) {
    const normalizedControl = requireSafeControl(control);
    const entry = findFixture(normalizedControl);

    validateSelectedControls(normalizedControl, entry);

    return createParsedFixture(
      entry,
      this.maximumRows,
      this.maximumBytes,
    );
  }

  /**
   * Validates an exact ordered header for a supported feed type.
   *
   * @param {string} feedType Inbound feed type.
   * @param {string[]} header Header columns.
   * @returns {Readonly<Record<string, unknown>>} Header validation result.
   */
  validateHeader(feedType, header) {
    return createHeaderValidation(feedType, header);
  }

  /**
   * Returns approved fixture metadata without exposing row values.
   *
   * @param {string|null} [feedType] Optional feed type.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Fixture controls.
   */
  listApprovedFixtures(feedType = null) {
    const normalizedFeedType =
      feedType === null || feedType === undefined
        ? null
        : normalizeFeedType(feedType);

    return deepFreeze(
      FIXTURE_SCENARIOS.filter(
        (entry) =>
          normalizedFeedType === null ||
          entry.feedType === normalizedFeedType,
      ).map((entry) => ({
        scenarioId: entry.scenario.scenarioId,
        feedType: entry.feedType,
        filename: entry.scenario.filename,
        maskedApiKeyId: entry.scenario.maskedApiKeyId,
        header: entry.scenario.header,
        expectedStatus: entry.scenario.expectedStatus,
        localOnly: true,
        disclosure: CSV_FIXTURE_PARSER_DISCLOSURE,
      })),
    );
  }

  /**
   * Determines whether a filename belongs to an approved local fixture.
   *
   * @param {unknown} filename Candidate filename.
   * @param {string|null} [feedType] Optional feed type.
   * @returns {boolean} Whether the filename is approved.
   */
  isApprovedFilename(filename, feedType = null) {
    try {
      const normalizedFilename = normalizeFilename(filename);
      const normalizedFeedType =
        feedType === null || feedType === undefined
          ? null
          : normalizeFeedType(feedType);

      return FIXTURE_SCENARIOS.some(
        (entry) =>
          entry.scenario.filename === normalizedFilename &&
          (normalizedFeedType === null ||
            entry.feedType === normalizedFeedType),
      );
    } catch {
      return false;
    }
  }

  parseFixture(control) {
    return this.parse(control);
  }

  resolve(control) {
    return this.parse(control);
  }

  getApprovedFixtures(feedType = null) {
    return this.listApprovedFixtures(feedType);
  }
}

/**
 * Creates an approved local CSV fixture parser.
 *
 * @param {ConstructorParameters<typeof CsvFixtureParser>[0]} [options]
 * Parser options.
 * @returns {CsvFixtureParser} CSV fixture parser.
 */
export function createCsvFixtureParser(options = {}) {
  return new CsvFixtureParser(options);
}

export function parseCsvFixture(control, options = {}) {
  return createCsvFixtureParser(options).parse(control);
}

export function validateCsvFixtureHeader(feedType, header) {
  return createHeaderValidation(feedType, header);
}

export const ApprovedCsvFixtureParser = CsvFixtureParser;
export const LocalCsvFixtureParser = CsvFixtureParser;
export const createApprovedCsvFixtureParser =
  createCsvFixtureParser;
export const createLocalCsvFixtureParser =
  createCsvFixtureParser;
export const parseApprovedCsvFixture = parseCsvFixture;

export default CsvFixtureParser;