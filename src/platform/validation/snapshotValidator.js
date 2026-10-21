import { SCHEMA_VERSION } from '../config/constants.js';
import {
  isAuditEventCollection,
  isJsonCompatible,
  isMonitoringState,
  isPlainObject,
  isRootCommitJournal,
  isSettings,
  isSupportedSchemaVersion,
  isUserCollection,
} from './schemas.js';
import { isOperationsEnvelope } from '../../features/operations/domain/operationsSchemas.js';

export const CURRENT_SNAPSHOT_FORMAT_VERSION = 1;
export const SNAPSHOT_NOTICE = 'Fictional demo data';
export const MAXIMUM_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export const SNAPSHOT_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
  INVALID_JSON: 'INVALID_JSON',
  SNAPSHOT_TOO_LARGE: 'SNAPSHOT_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  MISSING_FORMAT_VERSION: 'MISSING_FORMAT_VERSION',
  INVALID_FORMAT_VERSION: 'INVALID_FORMAT_VERSION',
  UNSUPPORTED_SNAPSHOT_VERSION: 'UNSUPPORTED_SNAPSHOT_VERSION',
  UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
  MISSING_NOTICE: 'MISSING_NOTICE',
  INVALID_NOTICE: 'INVALID_NOTICE',
  MISSING_SLICES: 'MISSING_SLICES',
  UNKNOWN_SNAPSHOT_FIELD: 'UNKNOWN_SNAPSHOT_FIELD',
  UNKNOWN_SNAPSHOT_SLICE: 'UNKNOWN_SNAPSHOT_SLICE',
  DANGEROUS_PROPERTY: 'DANGEROUS_PROPERTY',
  INVALID_SLICE: 'INVALID_SLICE',
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  MISSING_CHECKSUM: 'MISSING_CHECKSUM',
  UNSUPPORTED_CHECKSUM: 'UNSUPPORTED_CHECKSUM',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  REPLACEMENT_NOT_ALLOWED: 'REPLACEMENT_NOT_ALLOWED',
});

export const SNAPSHOT_WARNING_CODES = Object.freeze({
  SESSION_NOT_IMPORTED: 'SESSION_NOT_IMPORTED',
  EMPTY_SNAPSHOT: 'EMPTY_SNAPSHOT',
  PREVIOUS_FORMAT_VERSION: 'PREVIOUS_FORMAT_VERSION',
});

export const SNAPSHOT_SLICE_NAMES = Object.freeze([
  'users',
  'settings',
  'audit',
  'auditEvents',
  'ui',
  'uiPreferences',
  'monitoring',
  'assistant',
  'preferences',
  'platform',
  'operations',
  'operationsEnvelope',
  'membersClaims',
  'documents',
  'insights',
  'session',
]);

const TOP_LEVEL_FIELDS = new Set([
  'formatVersion',
  'schemaVersion',
  'exportedAt',
  'referenceDate',
  'notice',
  'checksum',
  'checksumAlgorithm',
  'sha256',
  'slices',
  'data',
  'rootRevision',
  'fixtureVersion',
  'seedVersion',
  'snapshotId',
  'metadata',
]);

const SNAPSHOT_SLICE_NAME_SET = new Set(SNAPSHOT_SLICE_NAMES);
const DANGEROUS_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const FNV1A32_PATTERN = /^fnv1a32-[0-9a-f]{8}$/i;
const JSON_MEDIA_TYPES = new Set([
  '',
  'application/json',
  'application/json;charset=utf-8',
  'text/json',
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

function createIssue(code, message, path, details) {
  const issue = { code, message, path };

  if (details !== undefined) {
    issue.details = details;
  }

  return issue;
}

function addError(errors, code, message, path, details) {
  errors.push(createIssue(code, message, path, details));
}

function addWarning(warnings, code, message, path, details) {
  warnings.push(createIssue(code, message, path, details));
}

function resolveOptions(options) {
  return isPlainObject(options) ? options : {};
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
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

function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      value,
    )
  );
}

function normalizeFormatVersion(value) {
  if (
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }

  if (
    typeof value === 'string' &&
    /^(?:0|[1-9]\d*)$/.test(value.trim())
  ) {
    const parsed = Number(value.trim());

    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
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

function createChecksumSource(snapshot) {
  const source = {};

  Object.entries(snapshot).forEach(([key, value]) => {
    if (
      key !== 'checksum' &&
      key !== 'checksumAlgorithm' &&
      key !== 'sha256'
    ) {
      source[key] = value;
    }
  });

  return source;
}

function hashFnv1a32(text) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function rotateRight(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function encodeUtf8(value) {
  if (typeof globalThis.TextEncoder === 'function') {
    return new globalThis.TextEncoder().encode(value);
  }

  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);

  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }

  return bytes;
}

function hashSha256(text) {
  const constants = [];
  const initialHash = [];
  let candidate = 2;

  while (constants.length < 64) {
    let prime = true;

    for (
      let divisor = 2;
      divisor * divisor <= candidate;
      divisor += 1
    ) {
      if (candidate % divisor === 0) {
        prime = false;
        break;
      }
    }

    if (prime) {
      if (initialHash.length < 8) {
        initialHash.push(
          (Math.sqrt(candidate) * 0x100000000) | 0,
        );
      }

      constants.push(
        (Math.cbrt(candidate) * 0x100000000) | 0,
      );
    }

    candidate += 1;
  }

  const bytes = Array.from(encodeUtf8(text));
  const bitLength = bytes.length * 8;

  bytes.push(0x80);

  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }

  const highLength = Math.floor(bitLength / 0x100000000);
  const lowLength = bitLength >>> 0;

  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((highLength >>> shift) & 0xff);
  }

  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((lowLength >>> shift) & 0xff);
  }

  const hash = [...initialHash];
  const words = new Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;

      words[index] =
        (bytes[wordOffset] << 24) |
        (bytes[wordOffset + 1] << 16) |
        (bytes[wordOffset + 2] << 8) |
        bytes[wordOffset + 3];
    }

    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);

      words[index] =
        (words[index - 16] +
          sigma0 +
          words[index - 7] +
          sigma1) |
        0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const sum1 =
        rotateRight(e, 6) ^
        rotateRight(e, 11) ^
        rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sum1 +
          choice +
          constants[index] +
          words[index]) |
        0;
      const sum0 =
        rotateRight(a, 2) ^
        rotateRight(a, 13) ^
        rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  return hash
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function inspectDangerousProperties(value, path, errors, ancestors) {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (ancestors.has(value)) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
      'Snapshot data must not contain circular references.',
      path,
    );
    return;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  Object.keys(value).forEach((key) => {
    const childPath = Array.isArray(value)
      ? `${path}[${key}]`
      : `${path}.${key}`;

    if (DANGEROUS_PROPERTY_NAMES.has(key)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.DANGEROUS_PROPERTY,
        `Snapshot data contains a prohibited property: ${key}.`,
        childPath,
      );
      return;
    }

    inspectDangerousProperties(
      value[key],
      childPath,
      errors,
      nextAncestors,
    );
  });
}

function resolveSlices(snapshot) {
  if (isPlainObject(snapshot.slices)) {
    return snapshot.slices;
  }

  if (isPlainObject(snapshot.data)) {
    return snapshot.data;
  }

  return null;
}

function validateTopLevelFields(snapshot, errors) {
  Object.keys(snapshot).forEach((field) => {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.UNKNOWN_SNAPSHOT_FIELD,
        `Snapshot contains an unknown top-level field: ${field}.`,
        field,
        { field },
      );
    }
  });
}

function validateMetadata(snapshot, errors, warnings, options) {
  if (snapshot.formatVersion === undefined) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.MISSING_FORMAT_VERSION,
      'Snapshot format version is required.',
      'formatVersion',
    );
  } else {
    const formatVersion = normalizeFormatVersion(
      snapshot.formatVersion,
    );

    if (formatVersion === null) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_FORMAT_VERSION,
        'Snapshot format version must be a non-negative integer.',
        'formatVersion',
      );
    } else if (formatVersion > CURRENT_SNAPSHOT_FORMAT_VERSION) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_SNAPSHOT_VERSION,
        `Snapshot format version ${formatVersion} is newer than supported version ${CURRENT_SNAPSHOT_FORMAT_VERSION}.`,
        'formatVersion',
        {
          formatVersion,
          supportedVersion: CURRENT_SNAPSHOT_FORMAT_VERSION,
        },
      );
    } else if (
      formatVersion <
      Math.max(0, CURRENT_SNAPSHOT_FORMAT_VERSION - 1)
    ) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_SNAPSHOT_VERSION,
        `Snapshot format version ${formatVersion} is no longer supported.`,
        'formatVersion',
        {
          formatVersion,
          supportedVersion: CURRENT_SNAPSHOT_FORMAT_VERSION,
        },
      );
    } else if (formatVersion < CURRENT_SNAPSHOT_FORMAT_VERSION) {
      addWarning(
        warnings,
        SNAPSHOT_WARNING_CODES.PREVIOUS_FORMAT_VERSION,
        'Snapshot uses the previous supported format and must be migrated before staging.',
        'formatVersion',
      );
    }
  }

  if (
    snapshot.schemaVersion !== undefined &&
    !isSupportedSchemaVersion(snapshot.schemaVersion)
  ) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      `Snapshot schema version ${String(snapshot.schemaVersion)} is not supported.`,
      'schemaVersion',
      {
        schemaVersion: snapshot.schemaVersion,
        supportedVersion: SCHEMA_VERSION,
      },
    );
  }

  if (snapshot.exportedAt !== undefined && !isIsoTimestamp(snapshot.exportedAt)) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
      'Snapshot exportedAt must be a valid UTC ISO timestamp.',
      'exportedAt',
    );
  }

  if (
    snapshot.referenceDate !== undefined &&
    !isValidDateOnly(snapshot.referenceDate)
  ) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
      'Snapshot referenceDate must be a valid YYYY-MM-DD date.',
      'referenceDate',
    );
  }

  if (snapshot.notice === undefined) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.MISSING_NOTICE,
      'Snapshot must include the fictional-data notice.',
      'notice',
    );
  } else if (
    typeof snapshot.notice !== 'string' ||
    !snapshot.notice
      .toLocaleLowerCase('en-US')
      .includes(SNAPSHOT_NOTICE.toLocaleLowerCase('en-US'))
  ) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_NOTICE,
      `Snapshot notice must include "${SNAPSHOT_NOTICE}".`,
      'notice',
    );
  }

  if (
    snapshot.rootRevision !== undefined &&
    (!Number.isSafeInteger(snapshot.rootRevision) ||
      snapshot.rootRevision < 0)
  ) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
      'Snapshot root revision must be a non-negative safe integer.',
      'rootRevision',
    );
  }

  if (
    options.expectedRootRevision !== undefined &&
    options.expectedRootRevision !== null &&
    snapshot.rootRevision !== undefined &&
    snapshot.rootRevision !== options.expectedRootRevision
  ) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.REVISION_CONFLICT,
      'Snapshot root revision does not match the expected revision.',
      'rootRevision',
      {
        expectedRevision: options.expectedRootRevision,
        actualRevision: snapshot.rootRevision,
      },
    );
  }
}

function validateSliceSchema(name, value) {
  switch (name) {
    case 'users':
      return isUserCollection(value);
    case 'settings':
      return isSettings(value);
    case 'audit':
    case 'auditEvents':
      return isAuditEventCollection(value);
    case 'monitoring':
      return isMonitoringState(value);
    case 'platform':
      return (
        isPlainObject(value) &&
        isJsonCompatible(value) &&
        (value.rootCommitJournal === undefined ||
          isRootCommitJournal(value.rootCommitJournal)) &&
        (value.users === undefined || isUserCollection(value.users)) &&
        (value.settings === undefined || isSettings(value.settings)) &&
        (value.monitoring === undefined ||
          isMonitoringState(value.monitoring))
      );
    case 'operations':
      return (
        isOperationsEnvelope(value) ||
        (isPlainObject(value) &&
          isJsonCompatible(value) &&
          (value.initialEnvelope === undefined ||
            isOperationsEnvelope(value.initialEnvelope)))
      );
    case 'operationsEnvelope':
      return isOperationsEnvelope(value);
    case 'session':
      return value === null || isPlainObject(value);
    default:
      return isJsonCompatible(value);
  }
}

function normalizeAllowedSlices(options) {
  if (options.allowedSlices === undefined) {
    return SNAPSHOT_SLICE_NAME_SET;
  }

  if (!Array.isArray(options.allowedSlices)) {
    return new Set();
  }

  return new Set(options.allowedSlices);
}

function validateSlices(
  slices,
  errors,
  warnings,
  replacementSlices,
  options,
) {
  const allowedSlices = normalizeAllowedSlices(options);
  const sliceNames = Object.keys(slices);

  if (sliceNames.length === 0) {
    addWarning(
      warnings,
      SNAPSHOT_WARNING_CODES.EMPTY_SNAPSHOT,
      'Snapshot contains no replacement slices.',
      'slices',
    );
  }

  sliceNames.forEach((name) => {
    const path = `slices.${name}`;

    if (!SNAPSHOT_SLICE_NAME_SET.has(name)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.UNKNOWN_SNAPSHOT_SLICE,
        `Snapshot contains an unknown replacement slice: ${name}.`,
        path,
        { slice: name },
      );
      return;
    }

    if (!allowedSlices.has(name)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.REPLACEMENT_NOT_ALLOWED,
        `Replacement of snapshot slice ${name} is not allowed.`,
        path,
        { slice: name },
      );
      return;
    }

    if (name === 'session') {
      addWarning(
        warnings,
        SNAPSHOT_WARNING_CODES.SESSION_NOT_IMPORTED,
        'Active session will not be imported.',
        path,
      );
      return;
    }

    replacementSlices.push(name);

    if (!validateSliceSchema(name, slices[name])) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SLICE,
        `Snapshot slice ${name} does not satisfy its schema.`,
        path,
        { slice: name },
      );
    }
  });
}

function validateOperationsReferences(envelope, errors, path) {
  if (!isOperationsEnvelope(envelope)) {
    return;
  }

  const requestIds = new Set(Object.keys(envelope.requests));
  const documentIds = new Set(Object.keys(envelope.documents));

  Object.entries(envelope.pipelineRuns).forEach(([runId, run]) => {
    if (!requestIds.has(run.requestId)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
        'Pipeline run references a request outside the snapshot.',
        `${path}.pipelineRuns.${runId}.requestId`,
        { requestId: run.requestId },
      );
    }
  });

  Object.entries(envelope.documents).forEach(
    ([documentId, document]) => {
      if (!requestIds.has(document.requestId)) {
        addError(
          errors,
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          'Document references a request outside the snapshot.',
          `${path}.documents.${documentId}.requestId`,
          { requestId: document.requestId },
        );
      }
    },
  );

  Object.entries(envelope.reviews).forEach(([reviewId, review]) => {
    if (!requestIds.has(review.requestId)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
        'Manual review references a request outside the snapshot.',
        `${path}.reviews.${reviewId}.requestId`,
        { requestId: review.requestId },
      );
    }
  });

  Object.entries(envelope.errorReports).forEach(
    ([reportId, report]) => {
      if (
        report.requestId !== null &&
        !requestIds.has(report.requestId)
      ) {
        addError(
          errors,
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          'Error report references a request outside the snapshot.',
          `${path}.errorReports.${reportId}.requestId`,
          { requestId: report.requestId },
        );
      }
    },
  );

  Object.entries(envelope.outboundRecords).forEach(
    ([outboundId, record]) => {
      if (!documentIds.has(record.documentId)) {
        addError(
          errors,
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          'Outbound record references a document outside the snapshot.',
          `${path}.outboundRecords.${outboundId}.documentId`,
          { documentId: record.documentId },
        );
      }
    },
  );

  Object.entries(envelope.requests).forEach(([requestId, request]) => {
    request.documentReferences.forEach((documentId) => {
      if (!documentIds.has(documentId)) {
        addError(
          errors,
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          'Request references a document outside the snapshot.',
          `${path}.requests.${requestId}.documentReferences`,
          { documentId },
        );
      }
    });
  });
}

function validateReferences(slices, errors) {
  if (isOperationsEnvelope(slices.operationsEnvelope)) {
    validateOperationsReferences(
      slices.operationsEnvelope,
      errors,
      'slices.operationsEnvelope',
    );
  }

  if (isOperationsEnvelope(slices.operations)) {
    validateOperationsReferences(
      slices.operations,
      errors,
      'slices.operations',
    );
  }

  if (isOperationsEnvelope(slices.operations?.initialEnvelope)) {
    validateOperationsReferences(
      slices.operations.initialEnvelope,
      errors,
      'slices.operations.initialEnvelope',
    );
  }
}

function resolveDeclaredChecksum(snapshot) {
  if (
    typeof snapshot.sha256 === 'string' &&
    snapshot.sha256.trim().length > 0
  ) {
    return {
      algorithm: 'SHA-256',
      value: snapshot.sha256.trim().toLowerCase(),
    };
  }

  if (
    typeof snapshot.checksum === 'string' &&
    snapshot.checksum.trim().length > 0
  ) {
    const value = snapshot.checksum.trim().toLowerCase();
    const declaredAlgorithm =
      typeof snapshot.checksumAlgorithm === 'string'
        ? snapshot.checksumAlgorithm
            .trim()
            .replace(/_/g, '-')
            .toUpperCase()
        : null;
    const algorithm =
      declaredAlgorithm ??
      (FNV1A32_PATTERN.test(value) ? 'FNV1A32' : 'SHA-256');

    return { algorithm, value };
  }

  if (
    isPlainObject(snapshot.checksum) &&
    typeof snapshot.checksum.value === 'string'
  ) {
    return {
      algorithm: String(
        snapshot.checksum.algorithm ?? 'SHA-256',
      )
        .trim()
        .replace(/_/g, '-')
        .toUpperCase(),
      value: snapshot.checksum.value.trim().toLowerCase(),
    };
  }

  return null;
}

function calculateChecksumCandidates(snapshot, algorithm) {
  const source = createChecksumSource(snapshot);
  const canonical = canonicalize(source);
  const serialized = JSON.stringify(source);

  if (algorithm === 'FNV1A32' || algorithm === 'FNV-1A-32') {
    return new Set([
      hashFnv1a32(canonical),
      hashFnv1a32(serialized),
    ]);
  }

  if (algorithm === 'SHA-256' || algorithm === 'SHA256') {
    return new Set([
      hashSha256(canonical),
      hashSha256(serialized),
    ]);
  }

  return null;
}

function validateChecksum(snapshot, errors, options) {
  const declared = resolveDeclaredChecksum(snapshot);

  if (declared === null) {
    if (options.requireChecksum !== false) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.MISSING_CHECKSUM,
        'Snapshot checksum is required.',
        'checksum',
      );
    }

    return;
  }

  const candidates = calculateChecksumCandidates(
    snapshot,
    declared.algorithm,
  );

  if (candidates === null) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_CHECKSUM,
      `Snapshot checksum algorithm ${declared.algorithm} is not supported.`,
      'checksumAlgorithm',
      { algorithm: declared.algorithm },
    );
    return;
  }

  const formatIsValid =
    declared.algorithm.startsWith('FNV')
      ? FNV1A32_PATTERN.test(declared.value)
      : SHA256_PATTERN.test(declared.value);

  if (!formatIsValid || !candidates.has(declared.value)) {
    addError(
      errors,
      SNAPSHOT_VALIDATION_ERROR_CODES.CHECKSUM_MISMATCH,
      'Snapshot checksum does not match its content.',
      'checksum',
      {
        algorithm: declared.algorithm,
      },
    );
  }
}

function countRecords(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isPlainObject(value)) {
    return Object.keys(value).length;
  }

  return value === null || value === undefined ? 0 : 1;
}

function createRecordCounts(slices, replacementSlices) {
  return Object.fromEntries(
    replacementSlices.map((sliceName) => [
      sliceName,
      countRecords(slices[sliceName]),
    ]),
  );
}

function createValidationReport(
  errors,
  warnings,
  replacementSlices,
  recordCounts,
  snapshot,
) {
  const report = {
    valid: errors.length === 0,
    errors,
    warnings,
    formatVersion:
      normalizeFormatVersion(snapshot?.formatVersion) ?? null,
    schemaVersion: snapshot?.schemaVersion ?? null,
    replacementSlices,
    recordCounts,
  };

  return deepFreeze(report);
}

/**
 * Error raised when a namespace snapshot fails validation.
 */
export class SnapshotValidationError extends Error {
  /**
   * @param {string} message Human-readable error message.
   * @param {readonly Record<string, unknown>[]} errors Validation errors.
   */
  constructor(message, errors) {
    super(message);
    this.name = 'SnapshotValidationError';
    this.code = 'INVALID_SNAPSHOT';
    this.errors = deepFreeze([...errors]);
  }
}

/**
 * Validates imported namespace snapshots before replacement staging.
 */
export class SnapshotValidator {
  /**
   * @param {{
   *   requireChecksum?: boolean,
   *   allowedSlices?: string[],
   *   expectedRootRevision?: number
   * }} [options] Default validation options.
   */
  constructor(options = {}) {
    this.options = deepFreeze(resolveOptions(options));
  }

  /**
   * Validates a parsed snapshot value without mutating it.
   *
   * @param {unknown} value Candidate snapshot.
   * @param {Record<string, unknown>} [options] Validation options.
   * @returns {Readonly<Record<string, unknown>>} Validation report.
   */
  validate(value, options = {}) {
    const normalizedOptions = {
      ...this.options,
      ...resolveOptions(options),
    };
    const errors = [];
    const warnings = [];
    const replacementSlices = [];

    if (!isPlainObject(value)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
        'Snapshot must be a plain JSON object.',
        '$',
      );

      return createValidationReport(
        errors,
        warnings,
        replacementSlices,
        {},
        null,
      );
    }

    inspectDangerousProperties(value, '$', errors, new Set());

    if (!isJsonCompatible(value)) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
        'Snapshot must contain only safe JSON-compatible data.',
        '$',
      );
    }

    validateTopLevelFields(value, errors);
    validateMetadata(value, errors, warnings, normalizedOptions);

    const slices = resolveSlices(value);

    if (slices === null) {
      addError(
        errors,
        SNAPSHOT_VALIDATION_ERROR_CODES.MISSING_SLICES,
        'Snapshot must contain a slices object.',
        'slices',
      );
    } else {
      validateSlices(
        slices,
        errors,
        warnings,
        replacementSlices,
        normalizedOptions,
      );
      validateReferences(slices, errors);
    }

    validateChecksum(value, errors, normalizedOptions);

    const recordCounts =
      slices === null
        ? {}
        : createRecordCounts(slices, replacementSlices);

    return createValidationReport(
      errors,
      warnings,
      replacementSlices,
      recordCounts,
      value,
    );
  }

  /**
   * Validates a snapshot and throws when it is invalid.
   *
   * @param {unknown} value Candidate snapshot.
   * @param {Record<string, unknown>} [options] Validation options.
   * @returns {Readonly<Record<string, unknown>>} Valid report.
   */
  assertValid(value, options = {}) {
    const report = this.validate(value, options);

    if (!report.valid) {
      throw new SnapshotValidationError(
        `Snapshot validation failed with ${report.errors.length} error(s).`,
        report.errors,
      );
    }

    return report;
  }
}

/**
 * Calculates a supported checksum for a snapshot value.
 *
 * @param {Record<string, unknown>} snapshot Snapshot without a checksum.
 * @param {'SHA-256'|'FNV1A32'} [algorithm] Checksum algorithm.
 * @returns {string} Snapshot checksum.
 */
export function calculateSnapshotChecksum(
  snapshot,
  algorithm = 'SHA-256',
) {
  if (!isPlainObject(snapshot) || !isJsonCompatible(snapshot)) {
    throw new TypeError(
      'Snapshot checksum source must be a safe JSON-compatible object.',
    );
  }

  const normalizedAlgorithm = String(algorithm)
    .trim()
    .replace(/_/g, '-')
    .toUpperCase();
  const source = canonicalize(createChecksumSource(snapshot));

  if (
    normalizedAlgorithm === 'SHA-256' ||
    normalizedAlgorithm === 'SHA256'
  ) {
    return hashSha256(source);
  }

  if (
    normalizedAlgorithm === 'FNV1A32' ||
    normalizedAlgorithm === 'FNV-1A-32'
  ) {
    return hashFnv1a32(source);
  }

  throw new TypeError(
    `Unsupported snapshot checksum algorithm: ${algorithm}`,
  );
}

/**
 * Parses snapshot JSON without performing replacement staging.
 *
 * @param {string} text Snapshot JSON text.
 * @returns {unknown} Parsed snapshot value.
 */
export function parseSnapshotJson(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Snapshot JSON content must be a string.');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SnapshotValidationError(
      'Snapshot contains invalid JSON.',
      [
        createIssue(
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_JSON,
          'Snapshot contains invalid JSON.',
          '$',
          {
            cause:
              error instanceof Error
                ? error.message
                : 'JSON parsing failed.',
          },
        ),
      ],
    );
  }
}

/**
 * Creates a namespace snapshot validator.
 *
 * @param {ConstructorParameters<typeof SnapshotValidator>[0]} [options]
 * Validator options.
 * @returns {SnapshotValidator} Snapshot validator.
 */
export function createSnapshotValidator(options = {}) {
  return new SnapshotValidator(options);
}

/**
 * Validates a parsed namespace snapshot.
 *
 * @param {unknown} value Candidate snapshot.
 * @param {Record<string, unknown>} [options] Validation options.
 * @returns {Readonly<Record<string, unknown>>} Validation report.
 */
export function validateSnapshot(value, options = {}) {
  return createSnapshotValidator(options).validate(value);
}

/**
 * Validates a parsed snapshot and throws when invalid.
 *
 * @param {unknown} value Candidate snapshot.
 * @param {Record<string, unknown>} [options] Validation options.
 * @returns {Readonly<Record<string, unknown>>} Valid report.
 */
export function assertSnapshotValid(value, options = {}) {
  return createSnapshotValidator(options).assertValid(value);
}

/**
 * Parses and validates snapshot JSON.
 *
 * @param {string} text Snapshot JSON text.
 * @param {Record<string, unknown>} [options] Validation options.
 * @returns {Readonly<Record<string, unknown>>} Validation report.
 */
export function validateSnapshotJson(text, options = {}) {
  try {
    return validateSnapshot(parseSnapshotJson(text), options);
  } catch (error) {
    if (error instanceof SnapshotValidationError) {
      return createValidationReport(
        [...error.errors],
        [],
        [],
        {},
        null,
      );
    }

    return createValidationReport(
      [
        createIssue(
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_JSON,
          'Snapshot JSON could not be parsed.',
          '$',
        ),
      ],
      [],
      [],
      {},
      null,
    );
  }
}

/**
 * Reads and validates a browser File or Blob containing snapshot JSON.
 *
 * @param {Blob|File} file Snapshot file.
 * @param {Record<string, unknown>} [options] Validation options.
 * @returns {Promise<Readonly<Record<string, unknown>>>} Validation report.
 */
export async function validateSnapshotFile(file, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const maximumBytes =
    Number.isSafeInteger(normalizedOptions.maximumBytes) &&
    normalizedOptions.maximumBytes > 0
      ? normalizedOptions.maximumBytes
      : MAXIMUM_SNAPSHOT_BYTES;
  const BlobConstructor = globalThis.Blob;

  if (
    typeof BlobConstructor !== 'function' ||
    !(file instanceof BlobConstructor)
  ) {
    return createValidationReport(
      [
        createIssue(
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_SNAPSHOT,
          'Snapshot input must be a browser File or Blob.',
          '$',
        ),
      ],
      [],
      [],
      {},
      null,
    );
  }

  if (file.size > maximumBytes) {
    return createValidationReport(
      [
        createIssue(
          SNAPSHOT_VALIDATION_ERROR_CODES.SNAPSHOT_TOO_LARGE,
          `Snapshot must not exceed ${maximumBytes} bytes.`,
          '$',
          {
            maximumBytes,
            actualBytes: file.size,
          },
        ),
      ],
      [],
      [],
      {},
      null,
    );
  }

  const mediaType =
    typeof file.type === 'string' ? file.type.toLowerCase() : '';

  if (mediaType.length > 0 && !JSON_MEDIA_TYPES.has(mediaType)) {
    return createValidationReport(
      [
        createIssue(
          SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
          'Snapshot file must contain JSON.',
          '$',
          { mediaType },
        ),
      ],
      [],
      [],
      {},
      null,
    );
  }

  try {
    const text = await file.text();
    return validateSnapshotJson(text, normalizedOptions);
  } catch {
    return createValidationReport(
      [
        createIssue(
          SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_JSON,
          'Snapshot file could not be read or parsed.',
          '$',
        ),
      ],
      [],
      [],
      {},
      null,
    );
  }
}

export const validateNamespaceSnapshot = validateSnapshot;
export const assertNamespaceSnapshotValid = assertSnapshotValid;
export const validateImportedSnapshot = validateSnapshot;
export const validateImportedSnapshotFile = validateSnapshotFile;
export const SnapshotSchemaValidator = SnapshotValidator;
export const SnapshotFormatError = SnapshotValidationError;

export default SnapshotValidator;