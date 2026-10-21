const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_NAMESPACE_PATTERN = /^[0-9a-f]{8}$/i;
const DISPLAY_PREFIX_PATTERN = /^[A-Z][A-Z0-9_]*$/i;

const DEFAULT_DISPLAY_PREFIX = 'REQ';
const DEFAULT_DISPLAY_WIDTH = 6;
const MAX_DISPLAY_WIDTH = 12;
const MAX_UUID_SEQUENCE = 0xffffffffffff;

function requireNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }

  return value;
}

function requireDisplayWidth(value) {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_DISPLAY_WIDTH
  ) {
    throw new RangeError(
      `Display width must be an integer between 1 and ${MAX_DISPLAY_WIDTH}.`,
    );
  }

  return value;
}

function normalizeNamespace(namespace) {
  if (typeof namespace === 'string') {
    if (!HEX_NAMESPACE_PATTERN.test(namespace)) {
      throw new TypeError(
        'Deterministic UUID namespace must contain exactly eight hexadecimal characters.',
      );
    }

    return namespace.toLowerCase();
  }

  requireNonNegativeSafeInteger(
    namespace,
    'Deterministic UUID namespace',
  );

  if (namespace > 0xffffffff) {
    throw new RangeError(
      'Deterministic UUID namespace must not exceed 32 bits.',
    );
  }

  return namespace.toString(16).padStart(8, '0');
}

function resolveCryptoProvider(cryptoProvider) {
  const provider = cryptoProvider ?? globalThis.crypto;

  if (provider === null || typeof provider !== 'object') {
    throw new Error(
      'Web Crypto is unavailable; a secure identifier cannot be generated.',
    );
  }

  return provider;
}

function bytesToUuid(bytes) {
  const hexadecimal = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join('-');
}

/**
 * Determines whether a value is an RFC 4122-compatible UUID.
 *
 * @param {unknown} value Candidate UUID.
 * @returns {boolean} Whether the value is a UUID.
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Generates a version 4 UUID using Web Crypto.
 *
 * @param {Crypto} [cryptoProvider] Optional Web Crypto implementation.
 * @returns {string} Secure, canonical UUID.
 */
export function generateUuid(cryptoProvider) {
  const provider = resolveCryptoProvider(cryptoProvider);

  if (typeof provider.randomUUID === 'function') {
    const uuid = provider.randomUUID();

    if (!isUuid(uuid)) {
      throw new Error('Web Crypto returned an invalid UUID.');
    }

    return uuid.toLowerCase();
  }

  if (typeof provider.getRandomValues !== 'function') {
    throw new Error(
      'Web Crypto does not provide randomUUID() or getRandomValues().',
    );
  }

  const bytes = new Uint8Array(16);
  provider.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

/**
 * Creates a stable UUID-shaped identifier for deterministic tests.
 *
 * @param {number} sequence Non-negative sequence value.
 * @param {number|string} [namespace] Numeric 32-bit namespace or eight-digit
 * hexadecimal namespace.
 * @returns {string} Deterministic version 4 UUID.
 */
export function createDeterministicTestId(sequence, namespace = 0) {
  requireNonNegativeSafeInteger(sequence, 'Deterministic UUID sequence');

  if (sequence > MAX_UUID_SEQUENCE) {
    throw new RangeError(
      'Deterministic UUID sequence must fit within twelve hexadecimal characters.',
    );
  }

  const namespaceValue = normalizeNamespace(namespace);
  const sequenceValue = sequence.toString(16).padStart(12, '0');

  return `${namespaceValue}-0000-4000-8000-${sequenceValue}`;
}

/**
 * Creates a stable UUID using an explicit namespace followed by a sequence.
 *
 * @param {number|string} namespace Numeric or hexadecimal namespace.
 * @param {number} sequence Non-negative sequence value.
 * @returns {string} Deterministic version 4 UUID.
 */
export function createNamespacedDeterministicUuid(namespace, sequence) {
  return createDeterministicTestId(sequence, namespace);
}

/**
 * Formats a non-negative integer as a zero-padded display sequence.
 *
 * @param {number} sequence Sequence to format.
 * @param {number} [width] Output width.
 * @returns {string} Zero-padded sequence.
 */
export function formatDisplaySequence(
  sequence,
  width = DEFAULT_DISPLAY_WIDTH,
) {
  requireNonNegativeSafeInteger(sequence, 'Display sequence');
  const normalizedWidth = requireDisplayWidth(width);
  const formatted = String(sequence);

  if (formatted.length > normalizedWidth) {
    throw new RangeError(
      `Display sequence exceeds the configured width of ${normalizedWidth}.`,
    );
  }

  return formatted.padStart(normalizedWidth, '0');
}

/**
 * Formats a sequence as a human-readable prefixed identifier.
 *
 * @param {number} sequence Sequence to format.
 * @param {string} [prefix] Display prefix.
 * @param {number} [width] Sequence width.
 * @returns {string} Prefixed display identifier.
 */
export function formatDisplayId(
  sequence,
  prefix = DEFAULT_DISPLAY_PREFIX,
  width = DEFAULT_DISPLAY_WIDTH,
) {
  if (
    typeof prefix !== 'string' ||
    !DISPLAY_PREFIX_PATTERN.test(prefix)
  ) {
    throw new TypeError(
      'Display prefix must begin with a letter and contain only letters, numbers, or underscores.',
    );
  }

  return `${prefix.toUpperCase()}-${formatDisplaySequence(sequence, width)}`;
}

/**
 * Generates an operation identifier using Web Crypto.
 *
 * @param {Crypto} [cryptoProvider] Optional Web Crypto implementation.
 * @returns {string} Operation UUID.
 */
export function createOperationId(cryptoProvider) {
  return generateUuid(cryptoProvider);
}

/**
 * Generates an idempotency key using Web Crypto.
 *
 * @param {Crypto} [cryptoProvider] Optional Web Crypto implementation.
 * @returns {string} Idempotency UUID.
 */
export function createIdempotencyKey(cryptoProvider) {
  return generateUuid(cryptoProvider);
}

export const createUuid = generateUuid;
export const createOperationKey = createOperationId;
export const generateOperationId = createOperationId;
export const generateIdempotencyKey = createIdempotencyKey;
export const createDeterministicUuid = createDeterministicTestId;
export const createDeterministicId = createDeterministicTestId;
export const formatRequestDisplayId = formatDisplayId;