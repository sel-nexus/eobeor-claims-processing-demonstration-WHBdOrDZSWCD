import { CANONICAL_SEED_BUNDLE } from '../../fixtures/seedBundle.js';
import {
  ACTIONS,
} from '../contracts/capabilities.js';
import {
  calculateSnapshotChecksum,
  createSnapshotValidator,
  MAXIMUM_SNAPSHOT_BYTES,
  parseSnapshotJson,
  SNAPSHOT_NOTICE,
} from '../validation/snapshotValidator.js';
import {
  snapshotParticipantRegistry,
} from './snapshotParticipantRegistry.js';
import { browserClock } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';

export const SNAPSHOT_FACADE_SCHEMA_VERSION = 1;
export const SNAPSHOT_VALIDATION_TOKEN_TTL_MS = 5 * 60 * 1000;

export const SNAPSHOT_SCOPES = Object.freeze({
  ALL_DEMO_DATA: 'ALL_DEMO_DATA',
  PLATFORM_DIAGNOSTICS: 'PLATFORM_DIAGNOSTICS',
});

export const SNAPSHOT_FORMATS = Object.freeze({
  JSON: 'JSON',
});

export const SNAPSHOT_CONFIRMATIONS = Object.freeze({
  APPLY: 'REPLACE LOCAL DEMO DATA',
  RESTORE_SAMPLE: 'RESTORE SAMPLE DATA',
});

export const SNAPSHOT_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_FILE: 'INVALID_FILE',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
  SNAPSHOT_TOO_LARGE: 'SNAPSHOT_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  UNSUPPORTED_SCOPE: 'UNSUPPORTED_SCOPE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  VALIDATION_TOKEN_REQUIRED: 'VALIDATION_TOKEN_REQUIRED',
  VALIDATION_TOKEN_INVALID: 'VALIDATION_TOKEN_INVALID',
  VALIDATION_TOKEN_EXPIRED: 'VALIDATION_TOKEN_EXPIRED',
  VALIDATION_TOKEN_USED: 'VALIDATION_TOKEN_USED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  STAGING_FAILED: 'STAGING_FAILED',
  APPLY_FAILED: 'APPLY_FAILED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  LOCAL_STORAGE_QUOTA: 'LOCAL_STORAGE_QUOTA',
  READ_ONLY_RECOVERY: 'READ_ONLY_RECOVERY',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

export const SNAPSHOT_AUDIT_ACTIONS = Object.freeze({
  EXPORTED: 'SNAPSHOT_EXPORTED',
  VALIDATED: 'SNAPSHOT_VALIDATED',
  APPLIED: 'SNAPSHOT_APPLIED',
  SAMPLE_RESTORED: 'SAMPLE_DATA_RESTORED',
});

const SNAPSHOT_MEDIA_TYPE = 'application/json';
const SNAPSHOT_EXTENSION = '.json';
const TOKEN_PREFIX = 'val_';
const EXPORTABLE_SLICE_NAMES = Object.freeze([
  'users',
  'settings',
  'auditEvents',
  'uiPreferences',
  'monitoring',
  'operationsEnvelope',
  'membersClaims',
  'documents',
  'insights',
  'fixtureOverlays',
]);
const DIAGNOSTIC_SLICE_NAMES = Object.freeze([
  'settings',
  'auditEvents',
  'uiPreferences',
  'monitoring',
  'operationsEnvelope',
  'insights',
]);
const IMPORT_SLICE_ALIASES = Object.freeze({
  audit: 'auditEvents',
  ui: 'uiPreferences',
  preferences: 'uiPreferences',
  operations: 'operationsEnvelope',
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

function requirePlatformStore(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getSnapshot !== 'function' ||
    typeof value.execute !== 'function'
  ) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Snapshot facade requires a platform store with getSnapshot() and execute().',
    );
  }

  return value;
}

function requirePermissionService(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Snapshot facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function normalizeAuditService(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || typeof value.append !== 'function') {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Snapshot facade audit service must provide append().',
    );
  }

  return value;
}

function normalizeParticipantRegistry(value) {
  if (value === undefined || value === null) {
    return snapshotParticipantRegistry;
  }

  if (
    typeof value !== 'object' ||
    typeof value.stageRestore !== 'function' ||
    typeof value.commitRestore !== 'function'
  ) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Snapshot facade participant registry must provide stageRestore() and commitRestore().',
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

  throw new SnapshotFacadeError(
    SNAPSHOT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
    'Snapshot facade session provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function resolveConstructorArguments(platformStoreOrOptions, options) {
  if (
    isPlainObject(platformStoreOrOptions) &&
    (platformStoreOrOptions.platformStore !== undefined ||
      platformStoreOrOptions.store !== undefined)
  ) {
    return {
      platformStore:
        platformStoreOrOptions.platformStore ??
        platformStoreOrOptions.store,
      options: platformStoreOrOptions,
    };
  }

  return {
    platformStore: platformStoreOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function getCurrentDate(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Snapshot facade clock must provide now() or nowIso().',
    );
  }

  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Snapshot facade clock must provide a valid timestamp.',
    );
  }

  return date;
}

function createIdentifier(idGenerator, prefix) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Snapshot facade ID generator must return a non-empty string.',
    );
  }

  const normalized = value.normalize('NFC').trim();

  return normalized.startsWith(prefix)
    ? normalized
    : `${prefix}${normalized}`;
}

function createSuccess(status, data, correlationId, warnings = []) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      schemaVersion: SNAPSHOT_FACADE_SCHEMA_VERSION,
      warnings,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      correlationId,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
    },
  });
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizeFailure(
  error,
  fallbackCode,
  fallbackMessage,
  correlationId,
) {
  const code = getErrorCode(error);

  if (
    code === 'REVISION_CONFLICT' ||
    code === SNAPSHOT_FACADE_ERROR_CODES.REVISION_CONFLICT
  ) {
    return createFailure(
      409,
      SNAPSHOT_FACADE_ERROR_CODES.REVISION_CONFLICT,
      'Local demo data changed before the snapshot operation completed.',
      correlationId,
      { retryable: true },
    );
  }

  if (
    code === 'STORAGE_QUOTA_EXCEEDED' ||
    code === 'LOCAL_STORAGE_QUOTA'
  ) {
    return createFailure(
      507,
      SNAPSHOT_FACADE_ERROR_CODES.LOCAL_STORAGE_QUOTA,
      'Browser-local storage quota was exceeded.',
      correlationId,
      {
        recoveryAction: 'EXPORT_SNAPSHOT',
      },
    );
  }

  if (
    code === 'READ_ONLY_RECOVERY' ||
    code === SNAPSHOT_FACADE_ERROR_CODES.READ_ONLY_RECOVERY
  ) {
    return createFailure(
      409,
      SNAPSHOT_FACADE_ERROR_CODES.READ_ONLY_RECOVERY,
      'Local demo data is in read-only recovery mode.',
      correlationId,
    );
  }

  return createFailure(
    500,
    fallbackCode,
    fallbackMessage,
    correlationId,
    {
      details: {
        dependencyCode: code,
      },
    },
  );
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

function normalizeScope(value) {
  const scope =
    value === undefined || value === null
      ? SNAPSHOT_SCOPES.ALL_DEMO_DATA
      : typeof value === 'string'
        ? value.trim().toUpperCase()
        : value;

  return Object.values(SNAPSHOT_SCOPES).includes(scope)
    ? scope
    : null;
}

function normalizeFormat(value) {
  const format =
    value === undefined || value === null
      ? SNAPSHOT_FORMATS.JSON
      : typeof value === 'string'
        ? value.trim().toUpperCase()
        : value;

  return Object.values(SNAPSHOT_FORMATS).includes(format)
    ? format
    : null;
}

function formatExportTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function getSnapshotSlices(snapshot) {
  if (isPlainObject(snapshot.slices)) {
    return snapshot.slices;
  }

  return {};
}

function selectExportSlices(snapshot, scope, includeAudit) {
  const source = getSnapshotSlices(snapshot);
  const allowedNames =
    scope === SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS
      ? DIAGNOSTIC_SLICE_NAMES
      : EXPORTABLE_SLICE_NAMES;
  const slices = {};

  allowedNames.forEach((sliceName) => {
    if (
      sliceName === 'auditEvents' &&
      includeAudit === false
    ) {
      return;
    }

    if (source[sliceName] !== undefined) {
      slices[sliceName] = cloneMutable(source[sliceName]);
      return;
    }

    if (snapshot[sliceName] !== undefined) {
      slices[sliceName] = cloneMutable(snapshot[sliceName]);
    }
  });

  return slices;
}

function createExportEnvelope({
  snapshot,
  scope,
  includeAudit,
  exportedAt,
  referenceDate,
  fixtureVersion,
}) {
  const base = {
    formatVersion: 1,
    schemaVersion: snapshot.schemaVersion ?? '1.0.0',
    exportedAt,
    referenceDate,
    notice: SNAPSHOT_NOTICE,
    rootRevision:
      snapshot.persistedRootRevision ??
      snapshot.rootRevision ??
      0,
    fixtureVersion,
    metadata: {
      scope,
      includeAudit,
      sessionIncluded: false,
      representativeOnly: true,
      networkRequired: false,
    },
    slices: selectExportSlices(
      snapshot,
      scope,
      includeAudit,
    ),
  };
  const sha256 = calculateSnapshotChecksum(base, 'SHA-256');

  return deepFreeze({
    ...base,
    checksumAlgorithm: 'SHA-256',
    sha256,
  });
}

function createJsonBlob(text) {
  const BlobConstructor = globalThis.Blob;

  if (typeof BlobConstructor !== 'function') {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.EXPORT_FAILED,
      'Browser Blob APIs are unavailable.',
    );
  }

  return new BlobConstructor([text], {
    type: `${SNAPSHOT_MEDIA_TYPE};charset=utf-8`,
  });
}

function isSupportedSnapshotMediaType(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return true;
  }

  const normalized = value.toLowerCase();

  return (
    normalized === SNAPSHOT_MEDIA_TYPE ||
    normalized === 'text/json' ||
    normalized === 'application/json;charset=utf-8'
  );
}

function isJsonFilename(value) {
  return (
    value === undefined ||
    typeof value !== 'string' ||
    value.length === 0 ||
    value.toLowerCase().endsWith(SNAPSHOT_EXTENSION)
  );
}

function normalizeParsedSnapshot(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_SNAPSHOT,
      'Snapshot must be a safe JSON-compatible object.',
    );
  }

  return value;
}

async function readSnapshotInput(input, maximumBytes) {
  if (typeof input === 'string') {
    if (
      typeof globalThis.TextEncoder === 'function' &&
      new globalThis.TextEncoder().encode(input).length >
        maximumBytes
    ) {
      throw new SnapshotFacadeError(
        SNAPSHOT_FACADE_ERROR_CODES.SNAPSHOT_TOO_LARGE,
        `Snapshot must not exceed ${maximumBytes} bytes.`,
      );
    }

    return normalizeParsedSnapshot(parseSnapshotJson(input));
  }

  if (isPlainObject(input) && typeof input.text !== 'function') {
    return normalizeParsedSnapshot(input);
  }

  const BlobConstructor = globalThis.Blob;

  if (
    typeof BlobConstructor !== 'function' ||
    !(input instanceof BlobConstructor)
  ) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_FILE,
      'Snapshot input must be a JSON object, JSON string, File, or Blob.',
    );
  }

  if (input.size > maximumBytes) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.SNAPSHOT_TOO_LARGE,
      `Snapshot must not exceed ${maximumBytes} bytes.`,
      {
        maximumBytes,
        actualBytes: input.size,
      },
    );
  }

  if (
    !isSupportedSnapshotMediaType(input.type) ||
    !isJsonFilename(input.name)
  ) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      'Snapshot file must contain JSON.',
      {
        mediaType: input.type,
        filename: input.name ?? null,
      },
    );
  }

  let text;

  try {
    text = await input.text();
  } catch (error) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_FILE,
      'Snapshot file could not be read.',
      undefined,
      error,
    );
  }

  try {
    return normalizeParsedSnapshot(parseSnapshotJson(text));
  } catch (error) {
    throw new SnapshotFacadeError(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_JSON,
      'Snapshot contains invalid JSON.',
      {
        validationErrors:
          error !== null && typeof error === 'object'
            ? error.errors ?? []
            : [],
      },
      error,
    );
  }
}

function resolveSnapshotSlices(snapshot) {
  if (isPlainObject(snapshot.slices)) {
    return snapshot.slices;
  }

  if (isPlainObject(snapshot.data)) {
    return snapshot.data;
  }

  return {};
}

function normalizeReplacementSlices(snapshot, replacementSliceNames) {
  const source = resolveSnapshotSlices(snapshot);
  const replacements = {};

  replacementSliceNames.forEach((sourceName) => {
    if (sourceName === 'session') {
      return;
    }

    const targetName =
      IMPORT_SLICE_ALIASES[sourceName] ?? sourceName;
    let value = source[sourceName];

    if (
      sourceName === 'operations' &&
      isPlainObject(value) &&
      value.initialEnvelope !== undefined
    ) {
      value = value.initialEnvelope;
    }

    replacements[targetName] = cloneMutable(value);
  });

  return replacements;
}

function createSeedSlices(seedBundle) {
  const platform = isPlainObject(seedBundle.platform)
    ? seedBundle.platform
    : {};

  return {
    users: cloneMutable(platform.users ?? []),
    settings: cloneMutable(platform.settings ?? null),
    auditEvents: cloneMutable(seedBundle.auditEvents ?? []),
    uiPreferences: cloneMutable(seedBundle.preferences ?? null),
    monitoring: cloneMutable(platform.monitoring ?? null),
    operationsEnvelope: cloneMutable(
      seedBundle.operationsEnvelope ?? null,
    ),
    membersClaims: cloneMutable(seedBundle.membersClaims ?? null),
    documents: cloneMutable(seedBundle.documents ?? null),
    insights: cloneMutable(seedBundle.insights ?? null),
  };
}

function countSliceRecords(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isPlainObject(value)) {
    return Object.keys(value).length;
  }

  return value === null || value === undefined ? 0 : 1;
}

function createReplacementCounts(replacements) {
  return Object.fromEntries(
    Object.entries(replacements).map(([name, value]) => [
      name,
      countSliceRecords(value),
    ]),
  );
}

function getStoreRevision(store) {
  if (typeof store.getRootRevision === 'function') {
    return store.getRootRevision();
  }

  const snapshot = store.getSnapshot();

  return (
    snapshot.persistedRootRevision ??
    snapshot.rootRevision ??
    0
  );
}

function normalizeExpectedRevision(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function isSeededSessionValid(session, users) {
  if (!isPlainObject(session) || !Array.isArray(users)) {
    return false;
  }

  return users.some(
    (user) =>
      user.userId === session.userId &&
      user.active === true &&
      user.systemSeed === true &&
      user.role === session.role,
  );
}

/**
 * Error raised when snapshot facade input or configuration is invalid.
 */
export class SnapshotFacadeError extends Error {
  /**
   * @param {string} code Stable snapshot facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SnapshotFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Client-side snapshot export, validation, apply, and fixture restore facade.
 */
export class SnapshotFacade {
  /**
   * @param {object|Record<string, unknown>} platformStoreOrOptions Platform
   * store or facade options containing `platformStore` or `store`.
   * @param {{
   *   permissionService?: object,
   *   auditService?: object,
   *   participantRegistry?: object,
   *   sessionProvider?: object|Function,
   *   seedBundle?: Record<string, unknown>,
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   maximumSnapshotBytes?: number,
   *   validationTokenTtlMs?: number,
   *   referenceDate?: string,
   *   fixtureVersion?: string,
   *   commitParticipants?: boolean
   * }} [options] Facade options.
   */
  constructor(platformStoreOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      platformStoreOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.platformStore = requirePlatformStore(
      resolved.platformStore,
    );
    this.permissionService = requirePermissionService(
      normalizedOptions.permissionService,
    );
    this.auditService = normalizeAuditService(
      normalizedOptions.auditService,
    );
    this.participantRegistry = normalizeParticipantRegistry(
      normalizedOptions.participantRegistry,
    );
    this.sessionProvider = normalizeSessionProvider(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade,
    );
    this.seedBundle =
      normalizedOptions.seedBundle ?? CANONICAL_SEED_BUNDLE;
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;
    this.maximumSnapshotBytes =
      Number.isSafeInteger(normalizedOptions.maximumSnapshotBytes) &&
      normalizedOptions.maximumSnapshotBytes > 0
        ? normalizedOptions.maximumSnapshotBytes
        : MAXIMUM_SNAPSHOT_BYTES;
    this.validationTokenTtlMs =
      Number.isFinite(normalizedOptions.validationTokenTtlMs) &&
      normalizedOptions.validationTokenTtlMs > 0
        ? normalizedOptions.validationTokenTtlMs
        : SNAPSHOT_VALIDATION_TOKEN_TTL_MS;
    this.referenceDate =
      normalizedOptions.referenceDate ??
      this.seedBundle.referenceDate ??
      getCurrentDate(this.clock).toISOString().slice(0, 10);
    this.fixtureVersion = String(
      normalizedOptions.fixtureVersion ??
        this.seedBundle.fixtureVersion ??
        '1',
    );
    this.commitParticipants =
      normalizedOptions.commitParticipants !== false;
    this.validator = createSnapshotValidator({
      requireChecksum: true,
    });
    this.validationTokens = new Map();

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Snapshot facade ID generator must be a function.',
      );
    }
  }

  createCorrelationId() {
    return createIdentifier(this.idGenerator, 'corr_');
  }

  pruneValidationTokens(nowMs = getCurrentDate(this.clock).getTime()) {
    this.validationTokens.forEach((record, token) => {
      if (
        record.expiresAtMs <= nowMs ||
        record.used === true
      ) {
        this.validationTokens.delete(token);
      }
    });
  }

  async authorize(action, correlationId) {
    let decision;

    try {
      decision = await this.permissionService.evaluate({
        action,
      });
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          SNAPSHOT_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Snapshot permission evaluation could not be completed.',
          correlationId,
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        ),
      };
    }

    if (decision?.allowed === true) {
      return {
        allowed: true,
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
          ? SNAPSHOT_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
          : SNAPSHOT_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
        unauthenticated
          ? 'An active demo session is required.'
          : 'The current demo role cannot perform this snapshot operation.',
        correlationId,
      ),
    };
  }

  async appendAudit(action, entityId, after) {
    if (this.auditService === null) {
      return null;
    }

    let session;

    try {
      session = readSession(this.sessionProvider);
    } catch (error) {
      return {
        code: SNAPSHOT_FACADE_ERROR_CODES.AUDIT_FAILED,
        dependencyCode: getErrorCode(error),
      };
    }

    if (
      !isPlainObject(session) ||
      typeof session.userId !== 'string' ||
      typeof session.displayName !== 'string' ||
      typeof session.role !== 'string'
    ) {
      return {
        code: SNAPSHOT_FACADE_ERROR_CODES.AUDIT_FAILED,
        dependencyCode: 'SESSION_UNAVAILABLE',
      };
    }

    try {
      await this.auditService.append(
        {
          correlationId: createIdentifier(
            this.idGenerator,
            'corr_',
          ),
          actor: {
            userId: session.userId,
            displayName: session.displayName,
            role: session.role,
          },
          action,
          entity: {
            type: 'SNAPSHOT',
            id: entityId,
          },
        },
        {
          action,
          entity: {
            type: 'SNAPSHOT',
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
        code: SNAPSHOT_FACADE_ERROR_CODES.AUDIT_FAILED,
        dependencyCode: getErrorCode(error),
      };
    }
  }

  /**
   * Creates an immutable JSON snapshot and browser Blob.
   *
   * @param {Record<string, unknown>} [request] Export options.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Export result.
   */
  async exportSnapshot(request = {}) {
    const correlationId = this.createCorrelationId();
    const authorization = await this.authorize(
      ACTIONS.SNAPSHOT_EXPORT,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    if (!isPlainObject(request)) {
      return createFailure(
        400,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_REQUEST,
        'Snapshot export request must be an object.',
        correlationId,
      );
    }

    const scope = normalizeScope(request.scope);
    const format = normalizeFormat(request.format);

    if (scope === null) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.UNSUPPORTED_SCOPE,
        'Snapshot export scope is not supported.',
        correlationId,
        {
          fieldErrors: [
            {
              field: 'scope',
              code: 'UNSUPPORTED_SCOPE',
              message: `Scope must be one of: ${Object.values(
                SNAPSHOT_SCOPES,
              ).join(', ')}.`,
            },
          ],
        },
      );
    }

    if (format === null) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.UNSUPPORTED_FORMAT,
        'Snapshot export format is not supported.',
        correlationId,
      );
    }

    try {
      const now = getCurrentDate(this.clock);
      const snapshot = this.platformStore.getSnapshot();
      const envelope = createExportEnvelope({
        snapshot,
        scope,
        includeAudit: request.includeAudit !== false,
        exportedAt: now.toISOString(),
        referenceDate: this.referenceDate,
        fixtureVersion: this.fixtureVersion,
      });
      const text = `${JSON.stringify(envelope, null, 2)}\n`;
      const blob = createJsonBlob(text);
      const filename =
        `eob-eor-demo-snapshot-${formatExportTimestamp(now)}.json`;
      const auditWarning = await this.appendAudit(
        SNAPSHOT_AUDIT_ACTIONS.EXPORTED,
        envelope.sha256,
        {
          scope,
          includeAudit: request.includeAudit !== false,
          byteLength: blob.size,
          checksum: envelope.sha256,
          notice: SNAPSHOT_NOTICE,
        },
      );

      return createSuccess(
        200,
        {
          fileName: filename,
          filename,
          mimeType: SNAPSHOT_MEDIA_TYPE,
          byteLength: blob.size,
          sha256: envelope.sha256,
          checksumAlgorithm: 'SHA-256',
          notice: SNAPSHOT_NOTICE,
          downloadToken: 'blob:browser-local',
          blob,
          snapshot: envelope,
        },
        correlationId,
        auditWarning === null ? [] : [auditWarning],
      );
    } catch (error) {
      return normalizeFailure(
        error,
        SNAPSHOT_FACADE_ERROR_CODES.EXPORT_FAILED,
        'The browser-local snapshot could not be exported.',
        correlationId,
      );
    }
  }

  /**
   * Parses and validates a snapshot without mutating local data.
   *
   * @param {Blob|File|string|Record<string, unknown>} input Snapshot input.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Validation result.
   */
  async validateSnapshot(input) {
    const correlationId = this.createCorrelationId();
    const authorization = await this.authorize(
      ACTIONS.SNAPSHOT_VALIDATE,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let candidate;

    try {
      candidate = await readSnapshotInput(
        input,
        this.maximumSnapshotBytes,
      );
    } catch (error) {
      const code = getErrorCode(error);

      if (
        code === SNAPSHOT_FACADE_ERROR_CODES.SNAPSHOT_TOO_LARGE
      ) {
        return createFailure(
          413,
          code,
          error.message,
          correlationId,
          { details: error.details },
        );
      }

      if (
        code === SNAPSHOT_FACADE_ERROR_CODES.UNSUPPORTED_FILE_TYPE
      ) {
        return createFailure(
          422,
          code,
          error.message,
          correlationId,
          { details: error.details },
        );
      }

      if (code === SNAPSHOT_FACADE_ERROR_CODES.INVALID_JSON) {
        return createFailure(
          400,
          code,
          error.message,
          correlationId,
          { details: error.details },
        );
      }

      return createFailure(
        400,
        code ?? SNAPSHOT_FACADE_ERROR_CODES.INVALID_FILE,
        error instanceof Error
          ? error.message
          : 'Snapshot input could not be read.',
        correlationId,
      );
    }

    const validation = this.validator.validate(candidate);

    if (!validation.valid) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_SNAPSHOT,
        'Snapshot validation failed.',
        correlationId,
        {
          details: {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        },
      );
    }

    let participantValidation;

    try {
      if (
        typeof this.participantRegistry.validateAll === 'function'
      ) {
        participantValidation =
          await this.participantRegistry.validateAll(candidate, {
            platformStore: this.platformStore,
          });

        if (participantValidation.valid !== true) {
          return createFailure(
            422,
            SNAPSHOT_FACADE_ERROR_CODES.INVALID_SNAPSHOT,
            'A snapshot participant rejected the snapshot.',
            correlationId,
            {
              details: {
                errors: participantValidation.errors ?? [],
              },
            },
          );
        }
      }
    } catch (error) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_SNAPSHOT,
        'Snapshot participant validation could not be completed.',
        correlationId,
        {
          details: {
            participantCode: getErrorCode(error),
          },
        },
      );
    }

    const now = getCurrentDate(this.clock);
    const token = createIdentifier(this.idGenerator, TOKEN_PREFIX);
    const checksum =
      candidate.sha256 ??
      candidate.checksum ??
      calculateSnapshotChecksum(candidate, 'SHA-256');
    const currentRevision = getStoreRevision(this.platformStore);

    this.pruneValidationTokens(now.getTime());
    this.validationTokens.set(token, {
      token,
      snapshot: deepFreeze(candidate),
      validation,
      participantValidation: participantValidation ?? null,
      checksum,
      rootRevision: currentRevision,
      createdAtMs: now.getTime(),
      expiresAtMs:
        now.getTime() + this.validationTokenTtlMs,
      used: false,
    });

    const auditWarning = await this.appendAudit(
      SNAPSHOT_AUDIT_ACTIONS.VALIDATED,
      checksum,
      {
        valid: true,
        formatVersion: validation.formatVersion,
        replacementSlices: validation.replacementSlices,
        recordCounts: validation.recordCounts,
        checksum,
      },
    );

    return createSuccess(
      200,
      {
        valid: true,
        validationToken: token,
        expiresAt: new Date(
          now.getTime() + this.validationTokenTtlMs,
        ).toISOString(),
        formatVersion: validation.formatVersion,
        schemaVersion: validation.schemaVersion,
        recordCounts: validation.recordCounts,
        warnings: validation.warnings.map(
          (warning) => warning.message,
        ),
        warningDetails: validation.warnings,
        replacementSlices: validation.replacementSlices,
        checksum,
      },
      correlationId,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  resolveValidationToken(token, correlationId) {
    if (typeof token !== 'string' || token.trim().length === 0) {
      return {
        failure: createFailure(
          422,
          SNAPSHOT_FACADE_ERROR_CODES.VALIDATION_TOKEN_REQUIRED,
          'A snapshot validation token is required.',
          correlationId,
        ),
      };
    }

    const normalizedToken = token.normalize('NFC').trim();
    const record = this.validationTokens.get(normalizedToken);

    if (record === undefined) {
      return {
        failure: createFailure(
          422,
          SNAPSHOT_FACADE_ERROR_CODES.VALIDATION_TOKEN_INVALID,
          'Snapshot validation token is invalid.',
          correlationId,
        ),
      };
    }

    if (record.used === true) {
      return {
        failure: createFailure(
          409,
          SNAPSHOT_FACADE_ERROR_CODES.VALIDATION_TOKEN_USED,
          'Snapshot validation token has already been used.',
          correlationId,
        ),
      };
    }

    if (
      record.expiresAtMs <= getCurrentDate(this.clock).getTime()
    ) {
      this.validationTokens.delete(normalizedToken);

      return {
        failure: createFailure(
          422,
          SNAPSHOT_FACADE_ERROR_CODES.VALIDATION_TOKEN_EXPIRED,
          'Snapshot validation token has expired.',
          correlationId,
        ),
      };
    }

    return {
      token: normalizedToken,
      record,
    };
  }

  /**
   * Applies a previously validated snapshot.
   *
   * Supports `applySnapshot(token, request)` and
   * `applySnapshot({validationToken, confirmation, expectedRootRevision})`.
   *
   * @param {string|Record<string, unknown>} tokenOrRequest Token or request.
   * @param {Record<string, unknown>} [request] Apply request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Apply result.
   */
  async applySnapshot(tokenOrRequest, request = {}) {
    const correlationId = this.createCorrelationId();
    const authorization = await this.authorize(
      ACTIONS.SNAPSHOT_APPLY,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalizedRequest = isPlainObject(tokenOrRequest)
      ? tokenOrRequest
      : isPlainObject(request)
        ? {
            ...request,
            validationToken: tokenOrRequest,
          }
        : null;

    if (normalizedRequest === null) {
      return createFailure(
        400,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_REQUEST,
        'Snapshot apply request must be an object.',
        correlationId,
      );
    }

    if (
      normalizedRequest.confirmation !==
      SNAPSHOT_CONFIRMATIONS.APPLY
    ) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.CONFIRMATION_REQUIRED,
        `Snapshot replacement requires confirmation "${SNAPSHOT_CONFIRMATIONS.APPLY}".`,
        correlationId,
        {
          fieldErrors: [
            {
              field: 'confirmation',
              code: 'CONFIRMATION_REQUIRED',
              message: 'Snapshot replacement confirmation does not match.',
            },
          ],
        },
      );
    }

    const resolvedToken = this.resolveValidationToken(
      normalizedRequest.validationToken,
      correlationId,
    );

    if (resolvedToken.failure !== undefined) {
      return resolvedToken.failure;
    }

    const currentRevision = getStoreRevision(this.platformStore);
    const expectedRevision = normalizeExpectedRevision(
      normalizedRequest.expectedRootRevision,
      resolvedToken.record.rootRevision,
    );

    if (expectedRevision === null) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_REQUEST,
        'Expected root revision must be a non-negative safe integer.',
        correlationId,
      );
    }

    if (
      expectedRevision !== currentRevision ||
      resolvedToken.record.rootRevision !== currentRevision
    ) {
      return createFailure(
        409,
        SNAPSHOT_FACADE_ERROR_CODES.REVISION_CONFLICT,
        'Local demo data changed after snapshot validation.',
        correlationId,
        {
          retryable: false,
          details: {
            expectedRevision,
            validatedRevision:
              resolvedToken.record.rootRevision,
            actualRevision: currentRevision,
          },
        },
      );
    }

    const replacements = normalizeReplacementSlices(
      resolvedToken.record.snapshot,
      resolvedToken.record.validation.replacementSlices,
    );
    const replacementNames = Object.keys(replacements);

    if (replacementNames.length === 0) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_SNAPSHOT,
        'Snapshot contains no applicable replacement slices.',
        correlationId,
      );
    }

    let stagedRestore;

    try {
      stagedRestore =
        await this.participantRegistry.stageRestore(
          resolvedToken.record.snapshot,
          {
            platformStore: this.platformStore,
            expectedRootRevision: currentRevision,
            expectedOperationsRevision:
              this.platformStore.getSnapshot()
                .operationsEnvelope?.revision,
          },
        );
    } catch (error) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.STAGING_FAILED,
        'Snapshot replacement could not be staged.',
        correlationId,
        {
          details: {
            participantCode: getErrorCode(error),
          },
        },
      );
    }

    try {
      this.platformStore.execute(
        (draftSlices) => {
          replacementNames.forEach((sliceName) => {
            draftSlices[sliceName] = cloneMutable(
              replacements[sliceName],
            );
          });

          return {
            replacementSlices: replacementNames,
          };
        },
        {
          expectedRootRevision: currentRevision,
        },
      );

      if (
        this.commitParticipants &&
        stagedRestore.participantCount !== 0
      ) {
        await this.participantRegistry.commitRestore(
          stagedRestore,
          {
            platformStore: this.platformStore,
            expectedRootRevision: getStoreRevision(
              this.platformStore,
            ),
            expectedOperationsRevision:
              this.platformStore.getSnapshot()
                .operationsEnvelope?.revision,
          },
        );
      }
    } catch (error) {
      return normalizeFailure(
        error,
        SNAPSHOT_FACADE_ERROR_CODES.APPLY_FAILED,
        'Snapshot replacement could not be completed.',
        correlationId,
      );
    }

    resolvedToken.record.used = true;
    this.validationTokens.delete(resolvedToken.token);

    const resultingRevision = getStoreRevision(
      this.platformStore,
    );
    const recordCounts = createReplacementCounts(replacements);
    const auditWarning = await this.appendAudit(
      SNAPSHOT_AUDIT_ACTIONS.APPLIED,
      resolvedToken.record.checksum,
      {
        checksum: resolvedToken.record.checksum,
        replacementSlices: replacementNames,
        recordCounts,
        rootRevision: resultingRevision,
      },
    );

    return createSuccess(
      200,
      {
        applied: true,
        rootRevision: resultingRevision,
        replacementSlices: replacementNames,
        recordCounts,
        checksum: resolvedToken.record.checksum,
        reloadRequired: true,
      },
      correlationId,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  /**
   * Restores the canonical fictional sample data.
   *
   * @param {Record<string, unknown>} request Restore request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Restore result.
   */
  async restoreSample(request = {}) {
    const correlationId = this.createCorrelationId();
    const authorization = await this.authorize(
      ACTIONS.SNAPSHOT_RESTORE_SAMPLE,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    if (!isPlainObject(request)) {
      return createFailure(
        400,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_REQUEST,
        'Sample restore request must be an object.',
        correlationId,
      );
    }

    if (
      request.confirmation !==
      SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE
    ) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.CONFIRMATION_REQUIRED,
        `Sample restore requires confirmation "${SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE}".`,
        correlationId,
        {
          fieldErrors: [
            {
              field: 'confirmation',
              code: 'CONFIRMATION_REQUIRED',
              message: 'Sample restore confirmation does not match.',
            },
          ],
        },
      );
    }

    const currentRevision = getStoreRevision(
      this.platformStore,
    );
    const expectedRevision = normalizeExpectedRevision(
      request.expectedRootRevision,
      currentRevision,
    );

    if (expectedRevision === null) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.INVALID_REQUEST,
        'Expected root revision must be a non-negative safe integer.',
        correlationId,
      );
    }

    if (expectedRevision !== currentRevision) {
      return createFailure(
        409,
        SNAPSHOT_FACADE_ERROR_CODES.REVISION_CONFLICT,
        'Local demo data changed before sample restore.',
        correlationId,
        {
          details: {
            expectedRevision,
            actualRevision: currentRevision,
          },
        },
      );
    }

    const seedSlices = createSeedSlices(this.seedBundle);
    const seedSnapshot = {
      formatVersion: 1,
      schemaVersion:
        this.seedBundle.schemaVersion ?? '1.0.0',
      notice: SNAPSHOT_NOTICE,
      slices: seedSlices,
    };
    const currentSession = readSession(this.sessionProvider);
    const preserveSession = isSeededSessionValid(
      currentSession,
      seedSlices.users,
    );
    let stagedRestore;

    try {
      stagedRestore =
        await this.participantRegistry.stageRestore(
          seedSnapshot,
          {
            platformStore: this.platformStore,
            expectedRootRevision: currentRevision,
            expectedOperationsRevision:
              this.platformStore.getSnapshot()
                .operationsEnvelope?.revision,
          },
        );
    } catch (error) {
      return createFailure(
        422,
        SNAPSHOT_FACADE_ERROR_CODES.STAGING_FAILED,
        'Sample data restore could not be staged.',
        correlationId,
        {
          details: {
            participantCode: getErrorCode(error),
          },
        },
      );
    }

    try {
      this.platformStore.execute(
        (draftSlices) => {
          Object.entries(seedSlices).forEach(
            ([sliceName, value]) => {
              draftSlices[sliceName] = cloneMutable(value);
            },
          );

          if (!preserveSession) {
            draftSlices.session = null;
          }

          return {
            restored: true,
          };
        },
        {
          expectedRootRevision: currentRevision,
        },
      );

      if (
        this.commitParticipants &&
        stagedRestore.participantCount !== 0
      ) {
        await this.participantRegistry.commitRestore(
          stagedRestore,
          {
            platformStore: this.platformStore,
            expectedRootRevision: getStoreRevision(
              this.platformStore,
            ),
            expectedOperationsRevision:
              this.platformStore.getSnapshot()
                .operationsEnvelope?.revision,
          },
        );
      }
    } catch (error) {
      return normalizeFailure(
        error,
        SNAPSHOT_FACADE_ERROR_CODES.RESTORE_FAILED,
        'Canonical sample data could not be restored.',
        correlationId,
      );
    }

    this.validationTokens.clear();

    const resultingRevision = getStoreRevision(
      this.platformStore,
    );
    const auditWarning = await this.appendAudit(
      SNAPSHOT_AUDIT_ACTIONS.SAMPLE_RESTORED,
      `FIXTURE-${this.fixtureVersion}`,
      {
        seedVersion: this.fixtureVersion,
        rootRevision: resultingRevision,
        sessionPreserved: preserveSession,
        notice: SNAPSHOT_NOTICE,
      },
    );

    return createSuccess(
      200,
      {
        restored: true,
        seedVersion: this.fixtureVersion,
        rootRevision: resultingRevision,
        sessionPreserved: preserveSession,
        reloadRequired: true,
      },
      correlationId,
      auditWarning === null ? [] : [auditWarning],
    );
  }

  export(request = {}) {
    return this.exportSnapshot(request);
  }

  validate(input) {
    return this.validateSnapshot(input);
  }

  apply(tokenOrRequest, request = {}) {
    return this.applySnapshot(tokenOrRequest, request);
  }

  restore(request = {}) {
    return this.restoreSample(request);
  }

  clearValidationTokens() {
    const count = this.validationTokens.size;

    this.validationTokens.clear();
    return count;
  }
}

/**
 * Creates a client-side snapshot facade.
 *
 * @param {ConstructorParameters<typeof SnapshotFacade>[0]}
 * platformStoreOrOptions Platform store or facade options.
 * @param {ConstructorParameters<typeof SnapshotFacade>[1]} [options]
 * Facade options.
 * @returns {SnapshotFacade} Snapshot facade.
 */
export function createSnapshotFacade(
  platformStoreOrOptions,
  options = {},
) {
  return new SnapshotFacade(platformStoreOrOptions, options);
}

export const LocalSnapshotFacade = SnapshotFacade;
export const BrowserSnapshotFacade = SnapshotFacade;
export const createLocalSnapshotFacade = createSnapshotFacade;

export default SnapshotFacade;