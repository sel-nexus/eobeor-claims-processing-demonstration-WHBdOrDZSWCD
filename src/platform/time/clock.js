import { REFERENCE_DATE } from '../config/constants.js';
import { isIsoDateTime } from '../validation/schemas.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const REFERENCE_TIMESTAMP = `${REFERENCE_DATE}T00:00:00.000Z`;

function isValidDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function requireFiniteMilliseconds(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number of milliseconds.`);
  }

  return value;
}

/**
 * Converts a supported date value to a new valid Date instance.
 *
 * @param {Date|string|number} value Date, ISO timestamp, date-only string, or
 * epoch milliseconds.
 * @returns {Date} A new Date instance.
 */
export function toDate(value) {
  if (isValidDate(value)) {
    return new Date(value.getTime());
  }

  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    const date = new Date(value);

    if (isValidDate(date)) {
      return date;
    }
  }

  if (isIsoDateTime(value)) {
    return new Date(value);
  }

  if (isDateOnly(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  throw new TypeError(
    'Date value must be a valid Date, epoch milliseconds, ISO timestamp, or YYYY-MM-DD string.',
  );
}

/**
 * Converts a supported date value to a canonical UTC ISO timestamp.
 *
 * @param {Date|string|number} value Supported date value.
 * @returns {string} Canonical ISO timestamp.
 */
export function toIsoTimestamp(value) {
  return toDate(value).toISOString();
}

/**
 * Converts a supported date value to a UTC YYYY-MM-DD value.
 *
 * @param {Date|string|number} value Supported date value.
 * @returns {string} UTC date-only value.
 */
export function toIsoDate(value) {
  return toIsoTimestamp(value).slice(0, 10);
}

/**
 * Determines whether a value is a valid canonical ISO timestamp.
 *
 * @param {unknown} value Candidate timestamp.
 * @returns {boolean} Whether the value is a valid timestamp.
 */
export function isIsoTimestamp(value) {
  return isIsoDateTime(value);
}

/**
 * Determines whether a value is a valid YYYY-MM-DD date.
 *
 * @param {unknown} value Candidate date.
 * @returns {boolean} Whether the value is a valid date-only value.
 */
export function isIsoDate(value) {
  return isDateOnly(value);
}

/**
 * Creates a clock backed by a date-producing function.
 *
 * @param {() => Date|string|number} readNow Function returning the current
 * clock value.
 * @returns {Readonly<{
 *   now: () => Date,
 *   nowIso: () => string,
 *   today: () => string,
 *   epochMilliseconds: () => number
 * }>} Clock abstraction.
 */
export function createClock(readNow) {
  if (typeof readNow !== 'function') {
    throw new TypeError('Clock reader must be a function.');
  }

  const readDate = () => toDate(readNow());

  return Object.freeze({
    now: () => readDate(),
    nowIso: () => readDate().toISOString(),
    today: () => readDate().toISOString().slice(0, 10),
    epochMilliseconds: () => readDate().getTime(),
  });
}

/**
 * Creates a clock backed by the browser or JavaScript runtime.
 *
 * @returns {ReturnType<typeof createClock>} Runtime clock.
 */
export function createBrowserClock() {
  return createClock(() => new Date());
}

/**
 * Creates an immutable clock fixed at a single instant.
 *
 * @param {Date|string|number} [instant] Fixed clock instant.
 * @returns {ReturnType<typeof createClock>} Fixed clock.
 */
export function createReferenceClock(instant = REFERENCE_TIMESTAMP) {
  const timestamp = toIsoTimestamp(instant);

  return createClock(() => timestamp);
}

/**
 * Creates a controllable deterministic clock for tests and simulations.
 *
 * @param {Date|string|number} [initialInstant] Initial clock instant.
 * @returns {Readonly<{
 *   now: () => Date,
 *   nowIso: () => string,
 *   today: () => string,
 *   epochMilliseconds: () => number,
 *   set: (value: Date|string|number) => string,
 *   setNow: (value: Date|string|number) => string,
 *   advance: (milliseconds: number) => string,
 *   advanceBy: (milliseconds: number) => string,
 *   advanceDays: (days: number) => string,
 *   reset: () => string
 * }>} Controllable clock.
 */
export function createTestClock(initialInstant = REFERENCE_TIMESTAMP) {
  const initialMilliseconds = toDate(initialInstant).getTime();
  let currentMilliseconds = initialMilliseconds;

  const now = () => new Date(currentMilliseconds);
  const nowIso = () => now().toISOString();
  const today = () => nowIso().slice(0, 10);
  const epochMilliseconds = () => currentMilliseconds;

  const set = (value) => {
    currentMilliseconds = toDate(value).getTime();
    return nowIso();
  };

  const advance = (milliseconds) => {
    currentMilliseconds += requireFiniteMilliseconds(
      milliseconds,
      'Clock advance',
    );
    return nowIso();
  };

  const advanceDays = (days) =>
    advance(
      requireFiniteMilliseconds(days, 'Clock day advance') *
        MILLISECONDS_PER_DAY,
    );

  const reset = () => {
    currentMilliseconds = initialMilliseconds;
    return nowIso();
  };

  return Object.freeze({
    now,
    nowIso,
    today,
    epochMilliseconds,
    set,
    setNow: set,
    advance,
    advanceBy: advance,
    advanceDays,
    reset,
  });
}

/**
 * Reads a canonical timestamp from a clock.
 *
 * @param {{nowIso?: () => string, now?: () => Date|string|number}} clock Clock
 * implementation.
 * @returns {string} Current canonical ISO timestamp.
 */
export function getCurrentIsoTimestamp(clock) {
  if (clock === null || typeof clock !== 'object') {
    throw new TypeError('Clock must be an object.');
  }

  if (typeof clock.nowIso === 'function') {
    return toIsoTimestamp(clock.nowIso());
  }

  if (typeof clock.now === 'function') {
    return toIsoTimestamp(clock.now());
  }

  throw new TypeError('Clock must provide nowIso() or now().');
}

/**
 * Reads the current UTC date from a clock.
 *
 * @param {{nowIso?: () => string, now?: () => Date|string|number}} clock Clock
 * implementation.
 * @returns {string} Current YYYY-MM-DD value.
 */
export function getCurrentIsoDate(clock) {
  return getCurrentIsoTimestamp(clock).slice(0, 10);
}

/**
 * Preserves an existing historical timestamp or supplies the current clock
 * timestamp when no value exists.
 *
 * @param {string|null|undefined} existingTimestamp Existing timestamp.
 * @param {{nowIso?: () => string, now?: () => Date|string|number}} [clock]
 * Fallback clock.
 * @returns {string} Existing or fallback canonical timestamp.
 */
export function preserveHistoricalTimestamp(
  existingTimestamp,
  clock = browserClock,
) {
  if (existingTimestamp === null || existingTimestamp === undefined) {
    return getCurrentIsoTimestamp(clock);
  }

  if (!isIsoDateTime(existingTimestamp)) {
    throw new TypeError(
      'Historical timestamp must be a valid UTC ISO timestamp.',
    );
  }

  return existingTimestamp;
}

/**
 * Preserves an existing historical date or supplies the current clock date
 * when no value exists.
 *
 * @param {string|null|undefined} existingDate Existing YYYY-MM-DD value.
 * @param {{nowIso?: () => string, now?: () => Date|string|number}} [clock]
 * Fallback clock.
 * @returns {string} Existing or fallback date.
 */
export function preserveHistoricalDate(
  existingDate,
  clock = browserClock,
) {
  if (existingDate === null || existingDate === undefined) {
    return getCurrentIsoDate(clock);
  }

  if (!isDateOnly(existingDate)) {
    throw new TypeError(
      'Historical date must be a valid YYYY-MM-DD value.',
    );
  }

  return existingDate;
}

export const browserClock = createBrowserClock();
export const referenceClock = createReferenceClock();

export const systemClock = browserClock;
export const fixedReferenceClock = referenceClock;
export const createDeterministicClock = createTestClock;
export const createFixedClock = createReferenceClock;
export const nowIso = () => browserClock.nowIso();
export const referenceNowIso = () => referenceClock.nowIso();

export default browserClock;