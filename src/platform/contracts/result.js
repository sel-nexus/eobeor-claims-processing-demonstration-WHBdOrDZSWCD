export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  OPERATION_UNAVAILABLE: 'OPERATION_UNAVAILABLE',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
});

export const EXPECTED_ERROR_CODES = ERROR_CODES;

export const EXPECTED_ERROR_CODE_VALUES = Object.freeze(
  Object.values(EXPECTED_ERROR_CODES),
);

const expectedErrorCodeValues = new Set(EXPECTED_ERROR_CODE_VALUES);

/**
 * Determines whether a value is a normalized command error code.
 *
 * @param {unknown} value Candidate error code.
 * @returns {boolean} Whether the value is a known error code.
 */
export function isExpectedErrorCode(value) {
  return typeof value === 'string' && expectedErrorCodeValues.has(value);
}

/**
 * Creates a successful command result.
 *
 * @template T
 * @param {T} value Successful result value.
 * @returns {{ok: true, value: T}} Discriminated success result.
 */
export function success(value) {
  return Object.freeze({
    ok: true,
    value,
  });
}

/**
 * Creates a failed command result for an expected error.
 *
 * @param {string} code Normalized expected-error code.
 * @param {string} message Human-readable error message.
 * @param {unknown} [details] Optional structured error details.
 * @returns {{ok: false, error: {code: string, message: string, details?: unknown}}}
 * Discriminated failure result.
 */
export function failure(code, message, details) {
  if (!isExpectedErrorCode(code)) {
    throw new TypeError(`Unknown command error code: ${String(code)}`);
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new TypeError('Command error message must be a non-empty string.');
  }

  const error =
    details === undefined
      ? { code, message: message.trim() }
      : { code, message: message.trim(), details };

  return Object.freeze({
    ok: false,
    error: Object.freeze(error),
  });
}

/**
 * Determines whether a value is a successful command result.
 *
 * @param {unknown} value Candidate result.
 * @returns {boolean} Whether the value is a success result.
 */
export function isSuccess(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.ok === true &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  );
}

/**
 * Determines whether a value is a failed command result.
 *
 * @param {unknown} value Candidate result.
 * @returns {boolean} Whether the value is a failure result.
 */
export function isFailure(value) {
  if (value === null || typeof value !== 'object' || value.ok !== false) {
    return false;
  }

  const error = value.error;

  return (
    error !== null &&
    typeof error === 'object' &&
    isExpectedErrorCode(error.code) &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  );
}

/**
 * Determines whether a value satisfies the command result contract.
 *
 * @param {unknown} value Candidate result.
 * @returns {boolean} Whether the value is a success or failure result.
 */
export function isResult(value) {
  return isSuccess(value) || isFailure(value);
}

export const ok = success;
export const err = failure;
export const createSuccessResult = success;
export const createFailureResult = failure;