const DIAGNOSTIC_LEVELS = Object.freeze([
  'debug',
  'info',
  'warn',
  'error',
]);

const DIAGNOSTIC_FIELDS = Object.freeze([
  'level',
  'code',
  'correlationId',
  'route',
]);

const diagnosticLevelValues = new Set(DIAGNOSTIC_LEVELS);
const diagnosticFieldValues = new Set(DIAGNOSTIC_FIELDS);

const SENSITIVE_KEY_PARTS = Object.freeze([
  'accountnumber',
  'address',
  'apikey',
  'authorization',
  'bearer',
  'cardnumber',
  'claimnumber',
  'cookie',
  'credential',
  'dateofbirth',
  'diagnosis',
  'dob',
  'email',
  'memberid',
  'mfacode',
  'name',
  'password',
  'patient',
  'payment',
  'phone',
  'pin',
  'procedure',
  'refreshtoken',
  'routingnumber',
  'secret',
  'sessionid',
  'ssn',
  'token',
]);

const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAXIMUM_ROUTE_LENGTH = 300;

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function normalizeKey(value) {
  return typeof value === 'string'
    ? value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    : '';
}

function isSensitiveKey(value) {
  const normalized = normalizeKey(value);

  return SENSITIVE_KEY_PARTS.some(
    (part) => normalized === part || normalized.includes(part),
  );
}

function requireOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TypeError('Safe logger options must be a plain object.');
  }

  return value;
}

function requireContext(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TypeError(
      'Diagnostic context must be a plain object.',
    );
  }

  return value;
}

function requireAllowedFields(value, allowedFields, subject) {
  Object.keys(value).forEach((key) => {
    if (isSensitiveKey(key)) {
      throw new TypeError(
        `${subject} contains a prohibited sensitive key: ${key}.`,
      );
    }

    if (!allowedFields.has(key)) {
      throw new TypeError(
        `${subject} contains an unsupported field: ${key}.`,
      );
    }
  });
}

function requireLevel(value) {
  if (
    typeof value !== 'string' ||
    !diagnosticLevelValues.has(value.toLowerCase())
  ) {
    throw new TypeError(
      `Diagnostic level must be one of: ${DIAGNOSTIC_LEVELS.join(', ')}.`,
    );
  }

  return value.toLowerCase();
}

function requireCode(value) {
  if (
    typeof value !== 'string' ||
    !DIAGNOSTIC_CODE_PATTERN.test(value)
  ) {
    throw new TypeError(
      'Diagnostic code must use uppercase letters, numbers, and underscores.',
    );
  }

  return value;
}

function normalizeCorrelationId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    !CORRELATION_ID_PATTERN.test(value)
  ) {
    throw new TypeError(
      'Diagnostic correlation ID contains unsupported characters.',
    );
  }

  return value;
}

function normalizeRoute(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_ROUTE_LENGTH ||
    !value.startsWith('/') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(
      'Diagnostic route must be a query-free application path.',
    );
  }

  return value;
}

function createDiagnosticEvent(level, code, context = {}) {
  const normalizedContext = requireContext(context);
  const contextFields = new Set(['correlationId', 'route']);

  requireAllowedFields(
    normalizedContext,
    contextFields,
    'Diagnostic context',
  );

  return Object.freeze({
    level: requireLevel(level),
    code: requireCode(code),
    correlationId: normalizeCorrelationId(
      normalizedContext.correlationId,
    ),
    route: normalizeRoute(normalizedContext.route),
  });
}

function normalizeDiagnosticEvent(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'Diagnostic event must be a plain object.',
    );
  }

  requireAllowedFields(
    value,
    diagnosticFieldValues,
    'Diagnostic event',
  );

  return createDiagnosticEvent(value.level, value.code, {
    correlationId: value.correlationId,
    route: value.route,
  });
}

function createBrowserSink() {
  return (event) => {
    const runtimeConsole = globalThis['console'];
    const method = runtimeConsole?.[event.level];

    if (typeof method === 'function') {
      method.call(runtimeConsole, event);
    }
  };
}

function resolveSink(value) {
  if (value === undefined) {
    return createBrowserSink();
  }

  if (typeof value !== 'function') {
    throw new TypeError('Safe logger sink must be a function.');
  }

  return value;
}

function isDevelopmentBuild() {
  return import.meta.env.DEV === true && import.meta.env.PROD !== true;
}

/**
 * Privacy-safe structured diagnostic logger.
 *
 * Only level, code, correlationId, and route are accepted. Diagnostics are
 * disabled in production builds regardless of logger options.
 */
export class SafeLogger {
  /**
   * @param {{
   *   enabled?: boolean,
   *   sink?: (event: Readonly<Record<string, unknown>>) => void
   * }} [options] Logger configuration.
   */
  constructor(options = {}) {
    const normalizedOptions = requireOptions(options);
    const allowedOptionFields = new Set(['enabled', 'sink']);

    requireAllowedFields(
      normalizedOptions,
      allowedOptionFields,
      'Safe logger options',
    );

    if (
      normalizedOptions.enabled !== undefined &&
      typeof normalizedOptions.enabled !== 'boolean'
    ) {
      throw new TypeError(
        'Safe logger enabled option must be a boolean.',
      );
    }

    this.enabled =
      isDevelopmentBuild() && normalizedOptions.enabled !== false;
    this.sink = resolveSink(normalizedOptions.sink);
  }

  /**
   * Emits an allowlisted diagnostic event.
   *
   * @param {Readonly<Record<string, unknown>>} event Diagnostic event.
   * @returns {boolean} Whether the event was emitted.
   */
  log(event) {
    const normalizedEvent = normalizeDiagnosticEvent(event);

    if (!this.enabled) {
      return false;
    }

    this.sink(normalizedEvent);
    return true;
  }

  /**
   * Emits a debug diagnostic.
   *
   * @param {string} code Stable diagnostic code.
   * @param {{correlationId?: string, route?: string}} [context] Context.
   * @returns {boolean} Whether the event was emitted.
   */
  debug(code, context = {}) {
    return this.log(createDiagnosticEvent('debug', code, context));
  }

  /**
   * Emits an informational diagnostic.
   *
   * @param {string} code Stable diagnostic code.
   * @param {{correlationId?: string, route?: string}} [context] Context.
   * @returns {boolean} Whether the event was emitted.
   */
  info(code, context = {}) {
    return this.log(createDiagnosticEvent('info', code, context));
  }

  /**
   * Emits a warning diagnostic.
   *
   * @param {string} code Stable diagnostic code.
   * @param {{correlationId?: string, route?: string}} [context] Context.
   * @returns {boolean} Whether the event was emitted.
   */
  warn(code, context = {}) {
    return this.log(createDiagnosticEvent('warn', code, context));
  }

  /**
   * Emits an error diagnostic without accepting an Error object or message.
   *
   * @param {string} code Stable diagnostic code.
   * @param {{correlationId?: string, route?: string}} [context] Context.
   * @returns {boolean} Whether the event was emitted.
   */
  error(code, context = {}) {
    return this.log(createDiagnosticEvent('error', code, context));
  }
}

/**
 * Creates a privacy-safe diagnostic logger.
 *
 * @param {ConstructorParameters<typeof SafeLogger>[0]} [options] Options.
 * @returns {SafeLogger} Safe logger instance.
 */
export function createSafeLogger(options = {}) {
  return new SafeLogger(options);
}

/**
 * Determines whether an object is a valid allowlisted diagnostic event.
 *
 * @param {unknown} value Candidate event.
 * @returns {boolean} Whether the event is valid.
 */
export function isSafeDiagnosticEvent(value) {
  try {
    normalizeDiagnosticEvent(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines whether a property name is prohibited in diagnostics.
 *
 * @param {unknown} value Candidate property name.
 * @returns {boolean} Whether the key is sensitive.
 */
export function isSensitiveDiagnosticKey(value) {
  return isSensitiveKey(value);
}

export {
  DIAGNOSTIC_FIELDS,
  DIAGNOSTIC_LEVELS,
};

export const safeLogger = createSafeLogger();
export const logger = safeLogger;
export const createLogger = createSafeLogger;

export default safeLogger;