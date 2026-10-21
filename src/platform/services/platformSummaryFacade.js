import { ACTIONS } from '../contracts/capabilities.js';
import { SIBLING_CONTRACT_VERSION } from '../contracts/siblingContracts.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

export const PLATFORM_SUMMARY_FACADE_SCHEMA_VERSION = 1;

export const PLATFORM_SUMMARY_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  ACCESS_CONTEXT_FAILED: 'ACCESS_CONTEXT_FAILED',
  SETTINGS_NOT_FOUND: 'SETTINGS_NOT_FOUND',
  SETTINGS_FAILED: 'SETTINGS_FAILED',
  AUDIT_SUMMARY_FAILED: 'AUDIT_SUMMARY_FAILED',
  INVALID_REPOSITORY_RESULT: 'INVALID_REPOSITORY_RESULT',
});

const AUDIT_PAGE_LIMIT = 100;
const MAXIMUM_AUDIT_EVENTS = 10000;

const ITS_ENTITY_TYPES = new Set([
  'AUDIT',
  'INTEGRATION',
  'MONITORING',
  'PLATFORM',
  'SETTINGS',
  'SNAPSHOT',
  'STORAGE',
]);

const ITS_ACTION_PREFIXES = Object.freeze([
  'AUDIT_',
  'INTEGRATION_',
  'MONITORING_',
  'PLATFORM_',
  'SETTINGS_',
  'SNAPSHOT_',
  'STORAGE_',
]);

const AUDIT_FILTER_FIELDS = new Set([
  'action',
  'actions',
  'outcome',
  'outcomes',
  'actorRole',
  'role',
  'entityType',
  'from',
  'to',
  'direction',
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

function requirePermissionService(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Platform summary facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function requireSessionProvider(value) {
  if (
    typeof value === 'function' ||
    (value !== null &&
      typeof value === 'object' &&
      (typeof value.getSession === 'function' ||
        typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function'))
  ) {
    return value;
  }

  throw new PlatformSummaryFacadeError(
    PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
    'Platform summary facade requires a session provider.',
  );
}

function requireSettingsRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.get !== 'function' &&
      typeof value.getSettings !== 'function' &&
      typeof value.getSnapshot !== 'function' &&
      typeof value.read !== 'function' &&
      typeof value.load !== 'function')
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Platform summary facade requires a readable settings repository.',
    );
  }

  return value;
}

function requireAuditRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.query !== 'function' &&
      typeof value.list !== 'function' &&
      typeof value.find !== 'function')
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Platform summary facade requires a queryable audit repository.',
    );
  }

  return value;
}

function resolveConstructorArguments(optionsOrPermissionService, options) {
  if (
    isPlainObject(optionsOrPermissionService) &&
    (optionsOrPermissionService.permissionService !== undefined ||
      optionsOrPermissionService.settingsRepository !== undefined ||
      optionsOrPermissionService.auditRepository !== undefined)
  ) {
    return optionsOrPermissionService;
  }

  return {
    ...(isPlainObject(options) ? options : {}),
    permissionService: optionsOrPermissionService,
  };
}

function readSession(provider) {
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

function normalizeSession(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const role =
    typeof value.role === 'string'
      ? value.role.trim().toUpperCase()
      : value.role;

  if (
    typeof value.userId !== 'string' ||
    value.userId.trim().length === 0 ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    !isPlatformRole(role)
  ) {
    return null;
  }

  return deepFreeze({
    userId: value.userId.normalize('NFC').trim(),
    displayName: value.displayName.normalize('NFC').trim(),
    role,
    memberId:
      typeof value.memberId === 'string' &&
      value.memberId.trim().length > 0
        ? value.memberId.normalize('NFC').trim()
        : null,
    expiresAt:
      typeof value.expiresAt === 'string' &&
      Number.isFinite(Date.parse(value.expiresAt))
        ? new Date(value.expiresAt).toISOString()
        : null,
  });
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function getDependencyCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function createVersionedDto(value) {
  return deepFreeze({
    ...value,
    contractVersion: SIBLING_CONTRACT_VERSION,
    schemaVersion: PLATFORM_SUMMARY_FACADE_SCHEMA_VERSION,
  });
}

function readSettings(repository) {
  if (typeof repository.get === 'function') {
    return repository.get();
  }

  if (typeof repository.getSettings === 'function') {
    return repository.getSettings();
  }

  const value =
    typeof repository.getSnapshot === 'function'
      ? repository.getSnapshot()
      : typeof repository.read === 'function'
        ? repository.read()
        : repository.load();

  return value?.settings ?? value;
}

function selectPlatformSettings(value) {
  if (
    !isPlainObject(value) ||
    !Number.isInteger(value.retentionYears) ||
    typeof value.autoApproveAmount !== 'number' ||
    !Number.isFinite(value.autoApproveAmount) ||
    !Number.isInteger(value.sessionTimeoutMinutes) ||
    !Number.isInteger(value.revision)
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REPOSITORY_RESULT,
      'Settings repository returned invalid platform settings.',
    );
  }

  return createVersionedDto({
    retentionYears: value.retentionYears,
    autoApproveAmount: value.autoApproveAmount,
    sessionTimeoutMinutes: value.sessionTimeoutMinutes,
    revision: value.revision,
    updatedAt:
      typeof value.updatedAt === 'string' &&
      Number.isFinite(Date.parse(value.updatedAt))
        ? new Date(value.updatedAt).toISOString()
        : null,
  });
}

function normalizeStringCollection(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const source = Array.isArray(value) ? value : [value];

  if (
    source.length === 0 ||
    source.some(
      (item) =>
        typeof item !== 'string' ||
        item.trim().length === 0 ||
        item.trim().length > 100,
    )
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
      `${name} must contain non-empty strings of at most 100 characters.`,
    );
  }

  return [
    ...new Set(
      source.map((item) =>
        item.normalize('NFC').trim().toUpperCase(),
      ),
    ),
  ];
}

function normalizeOptionalString(value, name) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
      `${name} must be a non-empty string of at most 200 characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function normalizeDateBoundary(value, name) {
  const normalized = normalizeOptionalString(value, name);

  if (
    normalized !== undefined &&
    !Number.isFinite(Date.parse(normalized))
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
      `${name} must be a valid ISO timestamp or date.`,
    );
  }

  return normalized;
}

function normalizeAuditFilters(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Audit summary filters must be a safe plain object.',
    );
  }

  Object.keys(value).forEach((field) => {
    if (!AUDIT_FILTER_FIELDS.has(field)) {
      throw new PlatformSummaryFacadeError(
        PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
        `Audit summary filter field ${field} is not supported.`,
        { field },
      );
    }
  });

  const actions = normalizeStringCollection(
    value.actions ?? value.action,
    'Audit actions',
  );
  const outcomes = normalizeStringCollection(
    value.outcomes ?? value.outcome,
    'Audit outcomes',
  );
  const actorRole = normalizeOptionalString(
    value.actorRole ?? value.role,
    'Audit actor role',
  );
  const entityType = normalizeOptionalString(
    value.entityType,
    'Audit entity type',
  );
  const from = normalizeDateBoundary(value.from, 'Audit from date');
  const to = normalizeDateBoundary(value.to, 'Audit to date');
  const direction =
    value.direction === undefined
      ? 'DESC'
      : typeof value.direction === 'string'
        ? value.direction.trim().toUpperCase()
        : value.direction;

  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Audit summary direction must be ASC or DESC.',
    );
  }

  if (
    from !== undefined &&
    to !== undefined &&
    Date.parse(from) > Date.parse(to)
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Audit summary from date must not be after the to date.',
    );
  }

  return {
    ...(actions === undefined ? {} : { actions }),
    ...(outcomes === undefined ? {} : { outcomes }),
    ...(actorRole === undefined
      ? {}
      : { actorRole: actorRole.toUpperCase() }),
    ...(entityType === undefined
      ? {}
      : { entityType: entityType.toUpperCase() }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    direction,
  };
}

function queryAuditRepository(repository, filters) {
  if (typeof repository.query === 'function') {
    return repository.query(filters);
  }

  if (typeof repository.list === 'function') {
    return repository.list(filters);
  }

  return repository.find(filters);
}

function isAuditEventVisible(event, role) {
  if (role === 'ADMIN') {
    return true;
  }

  if (role !== 'ITS') {
    return false;
  }

  const entityType =
    typeof event.entity?.type === 'string'
      ? event.entity.type.toUpperCase()
      : '';
  const action =
    typeof event.action === 'string'
      ? event.action.toUpperCase()
      : '';

  return (
    ITS_ENTITY_TYPES.has(entityType) ||
    ITS_ACTION_PREFIXES.some((prefix) =>
      action.startsWith(prefix),
    )
  );
}

function incrementCount(counts, value) {
  const key =
    typeof value === 'string' && value.trim().length > 0
      ? value.trim().toUpperCase()
      : 'UNKNOWN';

  counts[key] = (counts[key] ?? 0) + 1;
}

function validateAuditQueryResult(value) {
  if (
    !isPlainObject(value) ||
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.totalPages) ||
    value.totalPages < 0
  ) {
    throw new PlatformSummaryFacadeError(
      PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_REPOSITORY_RESULT,
      'Audit repository returned an invalid query result.',
    );
  }

  return value;
}

/**
 * Error raised when platform summary data cannot be read safely.
 */
export class PlatformSummaryFacadeError extends Error {
  /**
   * @param {string} code Stable facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PlatformSummaryFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Read-only cross-cluster facade for access, settings, and audit summaries.
 */
export class PlatformSummaryFacade {
  /**
   * @param {{
   *   permissionService: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   settingsRepository: object,
   *   auditRepository: object
   * }|object} optionsOrPermissionService Facade options or permission service.
   * @param {Record<string, unknown>} [options] Remaining facade options.
   */
  constructor(optionsOrPermissionService, options = {}) {
    const resolved = resolveConstructorArguments(
      optionsOrPermissionService,
      options,
    );

    this.permissionService = requirePermissionService(
      resolved.permissionService,
    );
    this.sessionProvider = requireSessionProvider(
      resolved.sessionProvider ??
        resolved.authFacade ??
        this.permissionService.sessionProvider,
    );
    this.settingsRepository = requireSettingsRepository(
      resolved.settingsRepository ?? resolved.settings,
    );
    this.auditRepository = requireAuditRepository(
      resolved.auditRepository ?? resolved.audit,
    );
  }

  getSession() {
    try {
      return normalizeSession(readSession(this.sessionProvider));
    } catch (error) {
      throw new PlatformSummaryFacadeError(
        PLATFORM_SUMMARY_FACADE_ERROR_CODES.ACCESS_CONTEXT_FAILED,
        'Platform access context could not be read.',
        {
          dependencyCode: getDependencyCode(error),
        },
        error,
      );
    }
  }

  async authorize(action, session) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action,
          session,
        }),
      );
    } catch (error) {
      throw new PlatformSummaryFacadeError(
        PLATFORM_SUMMARY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Platform summary permission evaluation could not be completed.',
        {
          action,
          dependencyCode: getDependencyCode(error),
        },
        error,
      );
    }

    if (decision?.allowed === true) {
      return decision;
    }

    const unauthenticated =
      decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
      decision?.reasonCode === 'SESSION_EXPIRED' ||
      session === null;

    throw new PlatformSummaryFacadeError(
      unauthenticated
        ? PLATFORM_SUMMARY_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
        : PLATFORM_SUMMARY_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
      unauthenticated
        ? 'An active demo session is required.'
        : 'The current demo role cannot read this platform summary.',
      {
        action,
        reasonCode: decision?.reasonCode ?? null,
      },
    );
  }

  /**
   * Returns the current permission-filtered access context.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Access context DTO.
   */
  async getAccessContext() {
    const session = this.getSession();

    await this.authorize(
      ACTIONS.PLATFORM_ACCESS_CONTEXT_VIEW,
      session,
    );

    return createVersionedDto({
      authenticated: true,
      userId: session.userId,
      displayName: session.displayName,
      role: session.role,
      memberId: session.memberId,
      expiresAt: session.expiresAt,
      policyVersion:
        typeof this.permissionService.getPolicyVersion === 'function'
          ? this.permissionService.getPolicyVersion()
          : null,
    });
  }

  /**
   * Returns the operationally relevant platform settings.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Settings DTO.
   */
  async getPlatformSettings() {
    const session = this.getSession();

    await this.authorize(
      ACTIONS.PLATFORM_SETTINGS_VIEW,
      session,
    );

    try {
      const settings = await readSettings(
        this.settingsRepository,
      );

      if (settings === null || settings === undefined) {
        throw new PlatformSummaryFacadeError(
          PLATFORM_SUMMARY_FACADE_ERROR_CODES.SETTINGS_NOT_FOUND,
          'Platform settings were not found.',
        );
      }

      return selectPlatformSettings(settings);
    } catch (error) {
      if (error instanceof PlatformSummaryFacadeError) {
        throw error;
      }

      throw new PlatformSummaryFacadeError(
        PLATFORM_SUMMARY_FACADE_ERROR_CODES.SETTINGS_FAILED,
        'Platform settings could not be read.',
        {
          dependencyCode: getDependencyCode(error),
        },
        error,
      );
    }
  }

  /**
   * Returns an aggregate, masked audit summary without exposing event details.
   *
   * @param {Record<string, unknown>} [input] Audit summary filters.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Audit summary DTO.
   */
  async getAuditSummary(input = {}) {
    const filters = normalizeAuditFilters(input);
    const session = this.getSession();

    await this.authorize(
      ACTIONS.PLATFORM_AUDIT_SUMMARY_VIEW,
      session,
    );

    const byAction = {};
    const byOutcome = {};
    const byEntityType = {};
    const byActorRole = {};
    let latestOccurredAt = null;
    let oldestOccurredAt = null;
    let page = 1;
    let totalPages = 1;
    let repositoryRevision = 0;
    let scannedCount = 0;
    let visibleCount = 0;

    try {
      while (
        page <= totalPages &&
        scannedCount < MAXIMUM_AUDIT_EVENTS
      ) {
        const result = validateAuditQueryResult(
          await queryAuditRepository(this.auditRepository, {
            ...filters,
            page,
            limit: AUDIT_PAGE_LIMIT,
          }),
        );

        if (
          Number.isSafeInteger(result.revision) &&
          result.revision >= 0
        ) {
          repositoryRevision = result.revision;
        }

        totalPages = result.totalPages;

        for (const event of result.items) {
          if (scannedCount >= MAXIMUM_AUDIT_EVENTS) {
            break;
          }

          scannedCount += 1;

          if (
            !isPlainObject(event) ||
            !isAuditEventVisible(event, session.role)
          ) {
            continue;
          }

          visibleCount += 1;
          incrementCount(byAction, event.action);
          incrementCount(byOutcome, event.outcome);
          incrementCount(byEntityType, event.entity?.type);
          incrementCount(byActorRole, event.actor?.role);

          if (
            typeof event.occurredAt === 'string' &&
            Number.isFinite(Date.parse(event.occurredAt))
          ) {
            const timestamp = new Date(event.occurredAt).toISOString();

            if (
              latestOccurredAt === null ||
              Date.parse(timestamp) > Date.parse(latestOccurredAt)
            ) {
              latestOccurredAt = timestamp;
            }

            if (
              oldestOccurredAt === null ||
              Date.parse(timestamp) < Date.parse(oldestOccurredAt)
            ) {
              oldestOccurredAt = timestamp;
            }
          }
        }

        page += 1;
      }

      return createVersionedDto({
        total: visibleCount,
        scannedCount,
        byAction,
        byOutcome,
        byEntityType,
        byActorRole,
        oldestOccurredAt,
        latestOccurredAt,
        revision: repositoryRevision,
        masked: true,
        detailsIncluded: false,
        truncated:
          scannedCount >= MAXIMUM_AUDIT_EVENTS &&
          page <= totalPages,
      });
    } catch (error) {
      if (error instanceof PlatformSummaryFacadeError) {
        throw error;
      }

      throw new PlatformSummaryFacadeError(
        PLATFORM_SUMMARY_FACADE_ERROR_CODES.AUDIT_SUMMARY_FAILED,
        'Platform audit summary could not be read.',
        {
          dependencyCode: getDependencyCode(error),
        },
        error,
      );
    }
  }

  /**
   * Returns all platform summary sections available to the current role.
   *
   * Sections denied by policy are omitted rather than weakening their
   * individual authorization requirements.
   *
   * @param {Record<string, unknown>} [auditInput] Audit summary filters.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Aggregate DTO.
   */
  async getPlatformSummary(auditInput = {}) {
    const accessContext = await this.getAccessContext();
    let settings = null;
    let auditSummary = null;

    try {
      settings = await this.getPlatformSettings();
    } catch (error) {
      if (
        !(error instanceof PlatformSummaryFacadeError) ||
        error.code !==
          PLATFORM_SUMMARY_FACADE_ERROR_CODES.ACTION_FORBIDDEN
      ) {
        throw error;
      }
    }

    try {
      auditSummary = await this.getAuditSummary(auditInput);
    } catch (error) {
      if (
        !(error instanceof PlatformSummaryFacadeError) ||
        error.code !==
          PLATFORM_SUMMARY_FACADE_ERROR_CODES.ACTION_FORBIDDEN
      ) {
        throw error;
      }
    }

    return createVersionedDto({
      accessContext,
      settings,
      auditSummary,
    });
  }

  getSettings() {
    return this.getPlatformSettings();
  }

  getAudit(input = {}) {
    return this.getAuditSummary(input);
  }

  getSummary(input = {}) {
    return this.getPlatformSummary(input);
  }
}

/**
 * Creates a read-only platform summary facade.
 *
 * @param {ConstructorParameters<typeof PlatformSummaryFacade>[0]}
 * optionsOrPermissionService Facade options or permission service.
 * @param {ConstructorParameters<typeof PlatformSummaryFacade>[1]} [options]
 * Remaining facade options.
 * @returns {PlatformSummaryFacade} Platform summary facade.
 */
export function createPlatformSummaryFacade(
  optionsOrPermissionService,
  options = {},
) {
  return new PlatformSummaryFacade(
    optionsOrPermissionService,
    options,
  );
}

export const LocalPlatformSummaryFacade = PlatformSummaryFacade;
export const OperationsPlatformSummaryFacade =
  PlatformSummaryFacade;
export const createLocalPlatformSummaryFacade =
  createPlatformSummaryFacade;
export const createOperationsPlatformSummaryFacade =
  createPlatformSummaryFacade;

export default PlatformSummaryFacade;