import { DISPLAY_CONSTANTS } from '../config/constants.js';
import { toDate } from '../time/clock.js';

export const EMPTY_DISPLAY_VALUE = '—';
export const CSV_FORMULA_PREFIX = "'";
export const DEFAULT_FILENAME = 'download';
export const DEFAULT_MASK_CHARACTER = '*';

const FORMULA_PREFIX_PATTERN = /^[\t\r\n ]*[=+\-@]/;
const FILENAME_UNSAFE_PATTERN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const FILENAME_TRAILING_PATTERN = /[. ]+$/;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const STATUS_SEPARATOR_PATTERN = /[_-]+/g;
const ACRONYMS = new Set([
  'API',
  'CDC',
  'CRM',
  'CSV',
  'EOB',
  'EOR',
  'HIPAA',
  'ID',
  'IXIT',
  'MFA',
  'NPI',
  'PDF',
  'PHI',
  'ROI',
  'SLA',
  'SSO',
  'USD',
]);

function resolveOptions(options) {
  return options !== null && typeof options === 'object' ? options : {};
}

function resolveFallback(options) {
  const { fallback = EMPTY_DISPLAY_VALUE } = resolveOptions(options);
  return typeof fallback === 'string' ? fallback : EMPTY_DISPLAY_VALUE;
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

function normalizeMaximumLength(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringifySafely(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function formatDateValue(value, includeTime, options) {
  const normalizedOptions = resolveOptions(options);
  const fallback = resolveFallback(normalizedOptions);
  const {
    locale = DISPLAY_CONSTANTS.locale,
    timeZone = 'UTC',
  } = normalizedOptions;

  if (!isPresent(value)) {
    return fallback;
  }

  try {
    const date = toDate(value);
    const formatterOptions = includeTime
      ? {
          ...DISPLAY_CONSTANTS.dateFormat,
          hour: 'numeric',
          minute: '2-digit',
          timeZone,
        }
      : {
          ...DISPLAY_CONSTANTS.dateFormat,
          timeZone,
        };

    return new Intl.DateTimeFormat(locale, formatterOptions).format(date);
  } catch {
    return fallback;
  }
}

/**
 * Formats a supported date value for presentation using UTC by default.
 *
 * @param {Date|string|number|null|undefined} value Date value.
 * @param {{locale?: string, timeZone?: string, fallback?: string}} [options]
 * Formatting options.
 * @returns {string} Formatted date or the configured fallback.
 */
export function formatDate(value, options = {}) {
  return formatDateValue(value, false, options);
}

/**
 * Formats a supported date and time value for presentation.
 *
 * @param {Date|string|number|null|undefined} value Date value.
 * @param {{locale?: string, timeZone?: string, fallback?: string}} [options]
 * Formatting options.
 * @returns {string} Formatted date and time or the configured fallback.
 */
export function formatDateTime(value, options = {}) {
  return formatDateValue(value, true, options);
}

/**
 * Formats a finite monetary amount.
 *
 * @param {number|null|undefined} value Monetary amount in major currency units.
 * @param {{
 *   currency?: string,
 *   locale?: string,
 *   minimumFractionDigits?: number,
 *   maximumFractionDigits?: number,
 *   fallback?: string
 * }} [options] Currency formatting options.
 * @returns {string} Formatted currency or the configured fallback.
 */
export function formatCurrency(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const fallback = resolveFallback(normalizedOptions);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const {
    currency = DISPLAY_CONSTANTS.currency,
    locale = DISPLAY_CONSTANTS.locale,
    minimumFractionDigits = DISPLAY_CONSTANTS.currencyDecimalPlaces,
    maximumFractionDigits = DISPLAY_CONSTANTS.currencyDecimalPlaces,
  } = normalizedOptions;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return fallback;
  }
}

/**
 * Formats an integer number of cents as currency.
 *
 * @param {number|null|undefined} value Amount in cents.
 * @param {Parameters<typeof formatCurrency>[1]} [options] Currency options.
 * @returns {string} Formatted currency or the configured fallback.
 */
export function formatCurrencyFromCents(value, options = {}) {
  if (!Number.isSafeInteger(value)) {
    return resolveFallback(options);
  }

  return formatCurrency(value / 100, options);
}

/**
 * Formats a finite number for display.
 *
 * @param {number|null|undefined} value Numeric value.
 * @param {{
 *   locale?: string,
 *   minimumFractionDigits?: number,
 *   maximumFractionDigits?: number,
 *   fallback?: string
 * }} [options] Number formatting options.
 * @returns {string} Formatted number or the configured fallback.
 */
export function formatNumber(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const fallback = resolveFallback(normalizedOptions);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const {
    locale = DISPLAY_CONSTANTS.locale,
    minimumFractionDigits,
    maximumFractionDigits,
  } = normalizedOptions;

  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return fallback;
  }
}

/**
 * Formats a duration supplied in milliseconds as a compact human-readable
 * value.
 *
 * @param {number|null|undefined} milliseconds Duration in milliseconds.
 * @param {{fallback?: string, maximumParts?: number}} [options] Formatting
 * options.
 * @returns {string} Compact duration or the configured fallback.
 */
export function formatDuration(milliseconds, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const fallback = resolveFallback(normalizedOptions);

  if (
    typeof milliseconds !== 'number' ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  ) {
    return fallback;
  }

  const maximumParts = normalizeMaximumLength(
    normalizedOptions.maximumParts,
    2,
  );
  const roundedMilliseconds = Math.round(milliseconds);

  if (roundedMilliseconds < 1000) {
    return `${roundedMilliseconds}ms`;
  }

  const units = [
    { label: 'd', milliseconds: 86400000 },
    { label: 'h', milliseconds: 3600000 },
    { label: 'm', milliseconds: 60000 },
    { label: 's', milliseconds: 1000 },
  ];

  let remaining = roundedMilliseconds;
  const parts = [];

  for (const unit of units) {
    const amount = Math.floor(remaining / unit.milliseconds);

    if (amount > 0) {
      parts.push(`${amount}${unit.label}`);
      remaining %= unit.milliseconds;
    }

    if (parts.length >= maximumParts) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(' ') : '0ms';
}

/**
 * Formats a minute value by converting it to milliseconds.
 *
 * @param {number|null|undefined} minutes Duration in minutes.
 * @param {{fallback?: string, maximumParts?: number}} [options] Formatting
 * options.
 * @returns {string} Compact duration or the configured fallback.
 */
export function formatDurationMinutes(minutes, options = {}) {
  if (
    typeof minutes !== 'number' ||
    !Number.isFinite(minutes) ||
    minutes < 0
  ) {
    return resolveFallback(options);
  }

  return formatDuration(minutes * 60000, options);
}

/**
 * Converts a machine-readable status into a human-readable label.
 *
 * @param {unknown} value Status value.
 * @param {{fallback?: string, labels?: Record<string, string>}} [options]
 * Formatting options and optional canonical label map.
 * @returns {string} Human-readable status label.
 */
export function formatStatus(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const fallback = resolveFallback(normalizedOptions);

  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const status = value.trim();
  const labels = normalizedOptions.labels;

  if (
    labels !== null &&
    typeof labels === 'object' &&
    typeof labels[status] === 'string'
  ) {
    return labels[status];
  }

  const words = status
    .replace(STATUS_SEPARATOR_PATTERN, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word, index) => {
      const uppercaseWord = word.toUpperCase();

      if (ACRONYMS.has(uppercaseWord)) {
        return uppercaseWord;
      }

      const lowercaseWord = word.toLowerCase();

      return index === 0
        ? `${lowercaseWord.charAt(0).toUpperCase()}${lowercaseWord.slice(1)}`
        : lowercaseWord;
    })
    .join(' ');
}

/**
 * Produces a safe filename suitable for browser downloads.
 *
 * @param {unknown} value Candidate filename.
 * @param {{fallback?: string, maximumLength?: number}} [options] Filename
 * options.
 * @returns {string} Sanitized filename.
 */
export function sanitizeFilename(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const fallback =
    typeof normalizedOptions.fallback === 'string' &&
    normalizedOptions.fallback.trim().length > 0
      ? normalizedOptions.fallback.trim()
      : DEFAULT_FILENAME;
  const maximumLength = normalizeMaximumLength(
    normalizedOptions.maximumLength,
    255,
  );

  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback.slice(0, maximumLength);
  }

  let filename = value
    .normalize('NFKC')
    .trim()
    .replace(FILENAME_UNSAFE_PATTERN, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(FILENAME_TRAILING_PATTERN, '');

  while (filename.startsWith('.')) {
    filename = filename.slice(1);
  }

  filename = filename.trim();

  if (
    filename.length === 0 ||
    filename === '.' ||
    filename === '..'
  ) {
    filename = fallback;
  }

  if (WINDOWS_RESERVED_NAME_PATTERN.test(filename)) {
    filename = `_${filename}`;
  }

  if (filename.length <= maximumLength) {
    return filename;
  }

  const extensionIndex = filename.lastIndexOf('.');
  const hasExtension =
    extensionIndex > 0 && extensionIndex < filename.length - 1;

  if (!hasExtension) {
    return filename.slice(0, maximumLength);
  }

  const extension = filename.slice(extensionIndex);
  const availableBaseLength = maximumLength - extension.length;

  if (availableBaseLength < 1) {
    return filename.slice(0, maximumLength);
  }

  return `${filename.slice(0, availableBaseLength)}${extension}`;
}

/**
 * Masks a value while leaving a configurable number of trailing characters
 * visible.
 *
 * @param {unknown} value Value to mask.
 * @param {{
 *   visibleEnd?: number,
 *   maskCharacter?: string,
 *   fallback?: string,
 *   preserveLength?: boolean
 * }} [options] Masking options.
 * @returns {string} Masked display value.
 */
export function formatMaskedValue(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const fallback = resolveFallback(normalizedOptions);

  if (!isPresent(value)) {
    return fallback;
  }

  const text = String(value);
  const visibleEnd =
    Number.isInteger(normalizedOptions.visibleEnd) &&
    normalizedOptions.visibleEnd >= 0
      ? normalizedOptions.visibleEnd
      : 4;
  const maskCharacter =
    typeof normalizedOptions.maskCharacter === 'string' &&
    normalizedOptions.maskCharacter.length === 1
      ? normalizedOptions.maskCharacter
      : DEFAULT_MASK_CHARACTER;
  const preserveLength = normalizedOptions.preserveLength !== false;

  if (visibleEnd === 0) {
    return maskCharacter.repeat(preserveLength ? text.length : 4);
  }

  if (text.length <= visibleEnd) {
    return maskCharacter.repeat(preserveLength ? text.length : 4);
  }

  const maskLength = preserveLength
    ? text.length - visibleEnd
    : Math.max(4, text.length - visibleEnd);

  return `${maskCharacter.repeat(maskLength)}${text.slice(-visibleEnd)}`;
}

/**
 * Neutralizes spreadsheet formula prefixes in export values.
 *
 * @param {unknown} value Candidate export value.
 * @param {{formulaPrefix?: string}} [options] Formula-safety options.
 * @returns {string} Formula-safe string.
 */
export function makeFormulaSafe(value, options = {}) {
  const text = stringifySafely(value);
  const normalizedOptions = resolveOptions(options);
  const formulaPrefix =
    typeof normalizedOptions.formulaPrefix === 'string'
      ? normalizedOptions.formulaPrefix
      : CSV_FORMULA_PREFIX;

  return FORMULA_PREFIX_PATTERN.test(text)
    ? `${formulaPrefix}${text}`
    : text;
}

/**
 * Escapes a value as a formula-safe RFC 4180 CSV field.
 *
 * @param {unknown} value Field value.
 * @param {{formulaPrefix?: string, formulaSafe?: boolean}} [options] CSV
 * formatting options.
 * @returns {string} Escaped CSV field.
 */
export function formatCsvValue(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const text =
    normalizedOptions.formulaSafe === false
      ? stringifySafely(value)
      : makeFormulaSafe(value, normalizedOptions);
  const escaped = text.replace(/"/g, '""');

  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

/**
 * Formats an array of values as one CSV row.
 *
 * @param {unknown[]} values Row values.
 * @param {{formulaPrefix?: string, formulaSafe?: boolean}} [options] CSV
 * formatting options.
 * @returns {string} CSV row without a trailing line break.
 */
export function formatCsvRow(values, options = {}) {
  if (!Array.isArray(values)) {
    throw new TypeError('CSV row values must be an array.');
  }

  return values
    .map((value) => formatCsvValue(value, options))
    .join(',');
}

/**
 * Formats a collection of rows as CSV text.
 *
 * @param {unknown[][]} rows CSV rows.
 * @param {{
 *   formulaPrefix?: string,
 *   formulaSafe?: boolean,
 *   lineEnding?: string
 * }} [options] CSV formatting options.
 * @returns {string} CSV document text.
 */
export function formatCsv(rows, options = {}) {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) {
    throw new TypeError('CSV data must be an array of row arrays.');
  }

  const normalizedOptions = resolveOptions(options);
  const lineEnding =
    typeof normalizedOptions.lineEnding === 'string'
      ? normalizedOptions.lineEnding
      : '\r\n';

  return rows
    .map((row) => formatCsvRow(row, normalizedOptions))
    .join(lineEnding);
}

export const formatDisplayDate = formatDate;
export const formatDisplayDateTime = formatDateTime;
export const formatMoney = formatCurrency;
export const formatCents = formatCurrencyFromCents;
export const formatMilliseconds = formatDuration;
export const formatStatusLabel = formatStatus;
export const safeFilename = sanitizeFilename;
export const maskValue = formatMaskedValue;
export const formatMemberId = formatMaskedValue;
export const formulaSafeValue = makeFormulaSafe;
export const escapeCsvValue = formatCsvValue;
export const formatCsvCell = formatCsvValue;
export const createCsvRow = formatCsvRow;
export const createCsv = formatCsv;