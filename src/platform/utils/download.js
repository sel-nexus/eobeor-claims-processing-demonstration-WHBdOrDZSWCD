import {
  formatCsv,
  sanitizeFilename,
} from './formatters.js';

export const DOWNLOAD_MEDIA_TYPES = Object.freeze({
  CSV: 'text/csv;charset=utf-8',
  JSON: 'application/json;charset=utf-8',
  TEXT: 'text/plain;charset=utf-8',
});

const SAFE_STATIC_PROTOCOLS = new Set(['http:', 'https:']);
const OBJECT_URL_PREFIX = 'blob:';

function resolveOptions(options) {
  return options !== null && typeof options === 'object' ? options : {};
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }

  return value.trim();
}

function getDocument() {
  const documentValue = globalThis.document;

  if (
    documentValue === undefined ||
    typeof documentValue.createElement !== 'function' ||
    documentValue.body === null
  ) {
    throw new Error('Browser document APIs are unavailable.');
  }

  return documentValue;
}

function getUrlApi() {
  const urlApi = globalThis.URL;

  if (urlApi === undefined) {
    throw new Error('Browser URL APIs are unavailable.');
  }

  return urlApi;
}

function getApplicationOrigin() {
  const locationValue = globalThis.location;

  if (
    locationValue !== undefined &&
    typeof locationValue.origin === 'string' &&
    locationValue.origin.length > 0 &&
    locationValue.origin !== 'null'
  ) {
    return locationValue.origin;
  }

  return 'http://localhost';
}

function normalizeFilename(filename, options) {
  const normalizedOptions = resolveOptions(options);

  return sanitizeFilename(filename, {
    fallback: normalizedOptions.fallbackFilename,
    maximumLength: normalizedOptions.maximumFilenameLength,
  });
}

function normalizeCleanupDelay(value) {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      'Object URL cleanup delay must be a non-negative finite number.',
    );
  }

  return value;
}

function isBlobValue(value) {
  const BlobConstructor = globalThis.Blob;

  return (
    typeof BlobConstructor === 'function' &&
    value instanceof BlobConstructor
  );
}

function resolveStaticArtifact(artifactOrUrl, filenameOrOptions, options) {
  if (
    artifactOrUrl !== null &&
    typeof artifactOrUrl === 'object' &&
    !Array.isArray(artifactOrUrl)
  ) {
    const artifact = artifactOrUrl;
    const normalizedOptions = resolveOptions(filenameOrOptions);

    return {
      url: artifact.assetUrl ?? artifact.url ?? artifact.href,
      filename:
        normalizedOptions.filename ??
        artifact.filename ??
        artifact.downloadFilename,
      options: normalizedOptions,
    };
  }

  if (
    filenameOrOptions !== null &&
    typeof filenameOrOptions === 'object' &&
    !Array.isArray(filenameOrOptions)
  ) {
    const normalizedOptions = resolveOptions(filenameOrOptions);

    return {
      url: artifactOrUrl,
      filename: normalizedOptions.filename,
      options: normalizedOptions,
    };
  }

  return {
    url: artifactOrUrl,
    filename: filenameOrOptions,
    options: resolveOptions(options),
  };
}

/**
 * Determines whether a URL identifies a same-origin HTTP or HTTPS resource.
 *
 * @param {unknown} value Candidate static asset URL.
 * @returns {boolean} Whether the URL is safe for a local static download.
 */
export function isSafeStaticDownloadUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  const source = value.trim();

  if (source.startsWith('//') || source.includes('\\')) {
    return false;
  }

  try {
    const origin = getApplicationOrigin();
    const url = new URL(source, `${origin}/`);

    return (
      SAFE_STATIC_PROTOCOLS.has(url.protocol) &&
      url.origin === origin &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * Resolves a same-origin static URL to an absolute URL.
 *
 * @param {string} value Static asset URL.
 * @returns {string} Absolute same-origin URL.
 */
export function resolveStaticDownloadUrl(value) {
  const source = requireNonEmptyString(value, 'Static download URL');

  if (!isSafeStaticDownloadUrl(source)) {
    throw new TypeError(
      'Static download URL must reference a same-origin HTTP or HTTPS asset.',
    );
  }

  return new URL(source, `${getApplicationOrigin()}/`).href;
}

/**
 * Programmatically activates a browser download link.
 *
 * @param {string} url Download URL.
 * @param {string} filename Suggested filename.
 * @param {{
 *   openInNewTab?: boolean,
 *   fallbackFilename?: string,
 *   maximumFilenameLength?: number
 * }} [options] Link options.
 * @returns {Readonly<{url: string, filename: string}>} Download metadata.
 */
export function triggerDownload(url, filename, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const downloadUrl = requireNonEmptyString(url, 'Download URL');
  const safeFilename = normalizeFilename(filename, normalizedOptions);
  const documentValue = getDocument();
  const anchor = documentValue.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = safeFilename;
  anchor.rel = 'noopener noreferrer';
  anchor.setAttribute('aria-hidden', 'true');

  if (normalizedOptions.openInNewTab === true) {
    anchor.target = '_blank';
  }

  anchor.hidden = true;
  documentValue.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
  }

  return Object.freeze({
    url: downloadUrl,
    filename: safeFilename,
  });
}

/**
 * Downloads an approved same-origin static artifact.
 *
 * The artifact may be supplied as a URL and filename or as an object containing
 * `assetUrl` and `filename` properties.
 *
 * @param {string|Record<string, unknown>} artifactOrUrl Artifact or URL.
 * @param {string|Record<string, unknown>} [filenameOrOptions] Filename or
 * options.
 * @param {Record<string, unknown>} [options] Download options.
 * @returns {Readonly<{url: string, filename: string}>} Download metadata.
 */
export function downloadStaticAsset(
  artifactOrUrl,
  filenameOrOptions,
  options = {},
) {
  const resolved = resolveStaticArtifact(
    artifactOrUrl,
    filenameOrOptions,
    options,
  );
  const url = resolveStaticDownloadUrl(resolved.url);
  const filename = requireNonEmptyString(
    resolved.filename,
    'Static download filename',
  );

  return triggerDownload(url, filename, resolved.options);
}

/**
 * Creates a browser object URL for a Blob.
 *
 * @param {Blob} blob Blob to expose through an object URL.
 * @returns {string} Browser object URL.
 */
export function createObjectUrl(blob) {
  if (!isBlobValue(blob)) {
    throw new TypeError('Object URL source must be a Blob.');
  }

  const urlApi = getUrlApi();

  if (typeof urlApi.createObjectURL !== 'function') {
    throw new Error('Browser object URL creation is unavailable.');
  }

  return urlApi.createObjectURL(blob);
}

/**
 * Revokes a browser object URL.
 *
 * @param {string} objectUrl Object URL to revoke.
 * @returns {boolean} Whether the URL was revoked.
 */
export function revokeObjectUrl(objectUrl) {
  const url = requireNonEmptyString(objectUrl, 'Object URL');

  if (!url.startsWith(OBJECT_URL_PREFIX)) {
    throw new TypeError('Only Blob object URLs can be revoked.');
  }

  const urlApi = getUrlApi();

  if (typeof urlApi.revokeObjectURL !== 'function') {
    throw new Error('Browser object URL cleanup is unavailable.');
  }

  urlApi.revokeObjectURL(url);
  return true;
}

/**
 * Revokes an object URL immediately or after a configured delay.
 *
 * @param {string} objectUrl Object URL to clean up.
 * @param {number} [delayMs] Cleanup delay in milliseconds.
 * @returns {null|ReturnType<typeof setTimeout>} Scheduled timer, or null when
 * cleanup occurred immediately.
 */
export function cleanupObjectUrl(objectUrl, delayMs = 0) {
  const delay = normalizeCleanupDelay(delayMs);

  if (delay === 0) {
    revokeObjectUrl(objectUrl);
    return null;
  }

  return globalThis.setTimeout(() => {
    revokeObjectUrl(objectUrl);
  }, delay);
}

/**
 * Downloads a Blob and revokes its temporary object URL.
 *
 * @param {Blob} blob Blob to download.
 * @param {string} filename Suggested filename.
 * @param {{
 *   cleanupDelayMs?: number,
 *   openInNewTab?: boolean,
 *   fallbackFilename?: string,
 *   maximumFilenameLength?: number
 * }} [options] Download and cleanup options.
 * @returns {Readonly<{url: string, filename: string}>} Download metadata.
 */
export function downloadBlob(blob, filename, options = {}) {
  if (!isBlobValue(blob)) {
    throw new TypeError('Download source must be a Blob.');
  }

  const normalizedOptions = resolveOptions(options);
  const cleanupDelay = normalizeCleanupDelay(
    normalizedOptions.cleanupDelayMs,
  );
  const objectUrl = createObjectUrl(blob);
  let result;

  try {
    result = triggerDownload(objectUrl, filename, normalizedOptions);
  } catch (error) {
    revokeObjectUrl(objectUrl);
    throw error;
  }

  cleanupObjectUrl(objectUrl, cleanupDelay);
  return result;
}

/**
 * Creates and downloads a UTF-8 text Blob.
 *
 * @param {string} text Text content.
 * @param {string} filename Suggested filename.
 * @param {{mimeType?: string, cleanupDelayMs?: number}} [options] Download
 * options.
 * @returns {Readonly<{url: string, filename: string}>} Download metadata.
 */
export function downloadText(text, filename, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('Text download content must be a string.');
  }

  const normalizedOptions = resolveOptions(options);
  const mimeType =
    typeof normalizedOptions.mimeType === 'string' &&
    normalizedOptions.mimeType.trim().length > 0
      ? normalizedOptions.mimeType.trim()
      : DOWNLOAD_MEDIA_TYPES.TEXT;
  const blob = new Blob([text], { type: mimeType });

  return downloadBlob(blob, filename, normalizedOptions);
}

/**
 * Serializes and downloads JSON-compatible data.
 *
 * @param {unknown} value Value to serialize.
 * @param {string} filename Suggested filename.
 * @param {{
 *   indentation?: number,
 *   trailingNewline?: boolean,
 *   mimeType?: string,
 *   cleanupDelayMs?: number
 * }} [options] JSON and download options.
 * @returns {Readonly<{url: string, filename: string}>} Download metadata.
 */
export function downloadJson(value, filename, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const indentation =
    Number.isInteger(normalizedOptions.indentation) &&
    normalizedOptions.indentation >= 0 &&
    normalizedOptions.indentation <= 10
      ? normalizedOptions.indentation
      : 2;

  let json;

  try {
    json = JSON.stringify(value, null, indentation);
  } catch (error) {
    throw new TypeError(
      `JSON download content could not be serialized: ${error.message}`,
    );
  }

  if (json === undefined) {
    throw new TypeError(
      'JSON download content must be JSON-serializable.',
    );
  }

  const content =
    normalizedOptions.trailingNewline === true ? `${json}\n` : json;

  return downloadText(content, filename, {
    ...normalizedOptions,
    mimeType:
      normalizedOptions.mimeType ?? DOWNLOAD_MEDIA_TYPES.JSON,
  });
}

/**
 * Formats and downloads CSV rows or downloads preformatted CSV text.
 *
 * @param {unknown[][]|string} rowsOrText CSV rows or preformatted CSV text.
 * @param {string} filename Suggested filename.
 * @param {{
 *   formulaPrefix?: string,
 *   formulaSafe?: boolean,
 *   lineEnding?: string,
 *   includeBom?: boolean,
 *   trailingNewline?: boolean,
 *   mimeType?: string,
 *   cleanupDelayMs?: number
 * }} [options] CSV and download options.
 * @returns {Readonly<{url: string, filename: string}>} Download metadata.
 */
export function downloadCsv(rowsOrText, filename, options = {}) {
  const normalizedOptions = resolveOptions(options);
  let csv;

  if (typeof rowsOrText === 'string') {
    csv = rowsOrText;
  } else if (
    Array.isArray(rowsOrText) &&
    rowsOrText.every(Array.isArray)
  ) {
    csv = formatCsv(rowsOrText, normalizedOptions);
  } else {
    throw new TypeError(
      'CSV download content must be a string or an array of row arrays.',
    );
  }

  const lineEnding =
    typeof normalizedOptions.lineEnding === 'string'
      ? normalizedOptions.lineEnding
      : '\r\n';
  const withTrailingNewline =
    normalizedOptions.trailingNewline === true &&
    !csv.endsWith(lineEnding)
      ? `${csv}${lineEnding}`
      : csv;
  const content =
    normalizedOptions.includeBom === true
      ? `\uFEFF${withTrailingNewline}`
      : withTrailingNewline;

  return downloadText(content, filename, {
    ...normalizedOptions,
    mimeType:
      normalizedOptions.mimeType ?? DOWNLOAD_MEDIA_TYPES.CSV,
  });
}

export const downloadArtifact = downloadStaticAsset;
export const downloadApprovedArtifact = downloadStaticAsset;
export const downloadStaticFile = downloadStaticAsset;
export const downloadFile = downloadBlob;
export const downloadJsonFile = downloadJson;
export const downloadCsvFile = downloadCsv;
export const downloadTextFile = downloadText;
export const createDownloadObjectUrl = createObjectUrl;
export const revokeDownloadObjectUrl = revokeObjectUrl;
export const cleanupDownloadUrl = cleanupObjectUrl;