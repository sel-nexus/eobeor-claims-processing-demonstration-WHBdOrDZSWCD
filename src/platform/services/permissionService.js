import {
  ACTIONS,
  ACTION_VALUES,
  ROUTE_CAPABILITIES,
  ROUTE_CAPABILITY_VALUES,
  isPermissionAction,
  isRouteCapability,
} from '../contracts/capabilities.js';
import { browserClock } from '../time/clock.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

export const PERMISSION_POLICY_VERSION = '1.0';

export const ACCESS_DECISION_REASONS = Object.freeze({
  ROLE_ALLOWED: 'ROLE_ALLOWED',
  OWNERSHIP_CONFIRMED: 'OWNERSHIP_CONFIRMED',
  PUBLIC_ROUTE: 'PUBLIC_ROUTE',
  NO_ACTIVE_SESSION: 'NO_ACTIVE_SESSION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  UNKNOWN_ROUTE_CAPABILITY: 'UNKNOWN_ROUTE_CAPABILITY',
  ROLE_NOT_ALLOWED: 'ROLE_NOT_ALLOWED',
  OWNERSHIP_MISMATCH: 'OWNERSHIP_MISMATCH',
  RESTRICTED_MEMBER: 'RESTRICTED_MEMBER',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
});

export const PERMISSION_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_SESSION_PROVIDER: 'INVALID_SESSION_PROVIDER',
  INVALID_RELATIONSHIP_PROVIDER: 'INVALID_RELATIONSHIP_PROVIDER',
  INVALID_ROUTE_DEFINITIONS: 'INVALID_ROUTE_DEFINITIONS',
  ACCESS_DENIED: 'ACCESS_DENIED',
});

const ALL_ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

const INTERNAL_ROLES = Object.freeze([
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

const CLAIM_SUPPORT_ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
]);

const ADMIN_ROLES = Object.freeze(['ADMIN']);
const ADMIN_AND_ITS_ROLES = Object.freeze(['ADMIN', 'ITS']);
const BOS_AND_ADMIN_ROLES = Object.freeze(['BOS', 'ADMIN']);
const CSR_AND_ADMIN_ROLES = Object.freeze(['CSR', 'ADMIN']);

function createPolicy(roles, options = {}) {
  return Object.freeze({
    roles: Object.freeze([...roles]),
    ownershipRoles: Object.freeze([
      ...(options.ownershipRoles ?? []),
    ]),
    restrictedMemberRoles: Object.freeze([
      ...(options.restrictedMemberRoles ?? []),
    ]),
  });
}

export const PERMISSION_POLICIES = Object.freeze({
  [ACTIONS.USER_LIST]: createPolicy(ADMIN_ROLES),
  [ACTIONS.USER_CREATE]: createPolicy(ADMIN_ROLES),
  [ACTIONS.USER_UPDATE]: createPolicy(ADMIN_ROLES),
  [ACTIONS.USER_DELETE]: createPolicy(ADMIN_ROLES),

  [ACTIONS.SETTINGS_VIEW]: createPolicy(ADMIN_AND_ITS_ROLES),
  [ACTIONS.SETTINGS_UPDATE]: createPolicy(ADMIN_AND_ITS_ROLES),
  [ACTIONS.SETTINGS_RESTORE]: createPolicy(ADMIN_ROLES),

  [ACTIONS.SNAPSHOT_EXPORT]: createPolicy(ADMIN_AND_ITS_ROLES),
  [ACTIONS.SNAPSHOT_VALIDATE]: createPolicy(ADMIN_ROLES),
  [ACTIONS.SNAPSHOT_APPLY]: createPolicy(ADMIN_ROLES),
  [ACTIONS.SNAPSHOT_RESTORE_SAMPLE]: createPolicy(ADMIN_ROLES),

  [ACTIONS.AUDIT_VIEW]: createPolicy(ADMIN_AND_ITS_ROLES),
  [ACTIONS.AUDIT_EXPORT]: createPolicy(ADMIN_AND_ITS_ROLES),

  [ACTIONS.MONITORING_VIEW]: createPolicy(ADMIN_AND_ITS_ROLES),
  [ACTIONS.MONITORING_PREFERENCE_UPDATE]: createPolicy(
    ADMIN_AND_ITS_ROLES,
  ),

  [ACTIONS.INTEGRATION_INVENTORY_VIEW]: createPolicy(
    ADMIN_AND_ITS_ROLES,
  ),

  [ACTIONS.ASSISTANT_RESPOND]: createPolicy(CSR_AND_ADMIN_ROLES),
  [ACTIONS.ASSISTANT_ATTACH_RESPONSE]: createPolicy(
    CSR_AND_ADMIN_ROLES,
  ),

  [ACTIONS.EXECUTIVE_INSIGHTS_VIEW]: createPolicy(
    BOS_AND_ADMIN_ROLES,
  ),
  [ACTIONS.PRODUCTIVITY_INSIGHTS_VIEW]: createPolicy(
    BOS_AND_ADMIN_ROLES,
  ),

  [ACTIONS.COMPLIANCE_STATUS_VIEW]: createPolicy(INTERNAL_ROLES),

  [ACTIONS.PLATFORM_ACCESS_CONTEXT_VIEW]: createPolicy(ALL_ROLES),
  [ACTIONS.PLATFORM_AUDIT_SUMMARY_VIEW]: createPolicy(
    ADMIN_AND_ITS_ROLES,
  ),
  [ACTIONS.PLATFORM_SETTINGS_VIEW]: createPolicy(
    ADMIN_AND_ITS_ROLES,
  ),

  [ACTIONS.CLAIM_VIEW]: createPolicy(CLAIM_SUPPORT_ROLES, {
    ownershipRoles: ['MEMBER'],
    restrictedMemberRoles: ['CSR'],
  }),
  [ACTIONS.DOCUMENT_VIEW]: createPolicy(CLAIM_SUPPORT_ROLES, {
    ownershipRoles: ['MEMBER'],
    restrictedMemberRoles: ['CSR'],
  }),
  [ACTIONS.DOCUMENT_DOWNLOAD]: createPolicy(CLAIM_SUPPORT_ROLES, {
    ownershipRoles: ['MEMBER'],
    restrictedMemberRoles: ['CSR'],
  }),
  [ACTIONS.REPRINT_REQUEST]: createPolicy(CLAIM_SUPPORT_ROLES, {
    ownershipRoles: ['MEMBER'],
    restrictedMemberRoles: ['CSR'],
  }),
  [ACTIONS.REPRINT_APPROVE]: createPolicy(BOS_AND_ADMIN_ROLES),
  [ACTIONS.REPRINT_REJECT]: createPolicy(BOS_AND_ADMIN_ROLES),
  [ACTIONS.OPERATIONAL_SUMMARY_VIEW]: createPolicy([
    'CSR',
    'BOS',
    'ITS',
    'ADMIN',
  ]),
});

export const ROUTE_PERMISSION_POLICIES = Object.freeze({
  [ROUTE_CAPABILITIES.PUBLIC]: Object.freeze([]),
  [ROUTE_CAPABILITIES.AUTHENTICATED]: ALL_ROLES,
  [ROUTE_CAPABILITIES.MEMBER_CLAIMS]: CLAIM_SUPPORT_ROLES,
  [ROUTE_CAPABILITIES.CSR_OPERATIONS]: CSR_AND_ADMIN_ROLES,
  [ROUTE_CAPABILITIES.BOS_OPERATIONS]: BOS_AND_ADMIN_ROLES,
  [ROUTE_CAPABILITIES.USER_ADMINISTRATION]: ADMIN_ROLES,
  [ROUTE_CAPABILITIES.SETTINGS_ADMINISTRATION]:
    ADMIN_AND_ITS_ROLES,
  [ROUTE_CAPABILITIES.SNAPSHOT_MANAGEMENT]: ADMIN_ROLES,
  [ROUTE_CAPABILITIES.AUDIT_HISTORY]: ADMIN_AND_ITS_ROLES,
  [ROUTE_CAPABILITIES.MONITORING_DASHBOARD]:
    ADMIN_AND_ITS_ROLES,
  [ROUTE_CAPABILITIES.INTEGRATION_INVENTORY]:
    ADMIN_AND_ITS_ROLES,
  [ROUTE_CAPABILITIES.CSR_ASSISTANT]: CSR_AND_ADMIN_ROLES,
  [ROUTE_CAPABILITIES.EXECUTIVE_INSIGHTS]:
    BOS_AND_ADMIN_ROLES,
  [ROUTE_CAPABILITIES.PRODUCTIVITY_INSIGHTS]:
    BOS_AND_ADMIN_ROLES,
  [ROUTE_CAPABILITIES.COMPLIANCE_STATUS]: INTERNAL_ROLES,
});

const ACTION_VALUE_SET = new Set(ACTION_VALUES);
const ROUTE_CAPABILITY_VALUE_SET = new Set(
  ROUTE_CAPABILITY_VALUES,
);

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
    throw new PermissionServiceError(
      PERMISSION_SERVICE_ERROR_CODES.INVALID_OPTIONS,
      'Permission service options must be a plain object.',
    );
  }

  return value;
}

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function normalizeSession(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const role = normalizeRole(value.role);

  if (
    role === null ||
    typeof value.userId !== 'string' ||
    value.userId.trim().length === 0
  ) {
    return null;
  }

  return Object.freeze({
    ...value,
    userId: value.userId.normalize('NFC').trim(),
    role,
    memberId:
      typeof value.memberId === 'string' &&
      value.memberId.trim().length > 0
        ? value.memberId.normalize('NFC').trim()
        : null,
  });
}

function resolveSessionProvider(value) {
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

  throw new PermissionServiceError(
    PERMISSION_SERVICE_ERROR_CODES.INVALID_SESSION_PROVIDER,
    'Permission service session provider must expose getSession(), getSnapshot(), or getState().',
  );
}

function resolveRelationshipProvider(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object') {
    throw new PermissionServiceError(
      PERMISSION_SERVICE_ERROR_CODES.INVALID_RELATIONSHIP_PROVIDER,
      'Permission service relationship provider must be an object.',
    );
  }

  const supportedMethods = [
    'isClaimOwnedByMember',
    'isDocumentOwnedByMember',
    'isResourceOwnedByMember',
    'isOwnedByMember',
    'isOwned',
  ];

  if (
    !supportedMethods.some(
      (method) => typeof value[method] === 'function',
    )
  ) {
    throw new PermissionServiceError(
      PERMISSION_SERVICE_ERROR_CODES.INVALID_RELATIONSHIP_PROVIDER,
      'Permission service relationship provider does not expose an ownership method.',
    );
  }

  return value;
}

function normalizeRouteDefinitions(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    !Array.isArray(value) ||
    value.some((route) => !isPlainObject(route))
  ) {
    throw new PermissionServiceError(
      PERMISSION_SERVICE_ERROR_CODES.INVALID_ROUTE_DEFINITIONS,
      'Permission service route definitions must be an array of plain objects.',
    );
  }

  return Object.freeze([...value]);
}

function getCurrentTime(clock) {
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
      'Permission service clock must provide now() or nowIso().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Permission service clock must provide a valid timestamp.',
    );
  }

  return date.getTime();
}

function isSessionExpired(session, clock) {
  return (
    typeof session.expiresAt === 'string' &&
    Number.isFinite(Date.parse(session.expiresAt)) &&
    Date.parse(session.expiresAt) <= getCurrentTime(clock)
  );
}

function readSessionFromProvider(provider) {
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

function normalizeEvaluationInput(
  inputOrAction,
  resource,
  context,
) {
  if (typeof inputOrAction === 'string') {
    return {
      action: inputOrAction.trim().toUpperCase(),
      resource:
        resource === undefined || resource === null
          ? null
          : resource,
      context: isPlainObject(context) ? context : {},
      session: isPlainObject(context) ? context.session : undefined,
    };
  }

  if (!isPlainObject(inputOrAction)) {
    return null;
  }

  return {
    action:
      typeof inputOrAction.action === 'string'
        ? inputOrAction.action.trim().toUpperCase()
        : inputOrAction.action,
    resource:
      inputOrAction.resource === undefined ||
      inputOrAction.resource === null
        ? null
        : inputOrAction.resource,
    context: isPlainObject(inputOrAction.context)
      ? inputOrAction.context
      : {},
    session:
      inputOrAction.session ??
      inputOrAction.context?.session,
  };
}

function createDecision({
  allowed,
  reasonCode,
  action = null,
  role = null,
  details,
}) {
  return deepFreeze({
    allowed,
    reasonCode,
    policyVersion: PERMISSION_POLICY_VERSION,
    action,
    role,
    ...(details === undefined ? {} : { details }),
  });
}

function createDeniedDecision(reasonCode, action, role, details) {
  return createDecision({
    allowed: false,
    reasonCode,
    action,
    role,
    details,
  });
}

function resolveRestrictionList(resource) {
  if (!isPlainObject(resource)) {
    return [];
  }

  if (Array.isArray(resource.restrictions)) {
    return resource.restrictions;
  }

  if (isPlainObject(resource.restriction)) {
    return [resource.restriction];
  }

  return [];
}

function isResourceRestricted(resource, role, action) {
  if (!isPlainObject(resource)) {
    return false;
  }

  if (
    resource.restricted === true ||
    resource.memberRestricted === true ||
    resource.accessRestricted === true ||
    resource.member?.restricted === true
  ) {
    return true;
  }

  return resolveRestrictionList(resource).some((restriction) => {
    if (!isPlainObject(restriction) || restriction.active === false) {
      return false;
    }

    const allowedRoles = Array.isArray(restriction.allowedRoles)
      ? restriction.allowedRoles.map((item) =>
          typeof item === 'string'
            ? item.trim().toUpperCase()
            : item,
        )
      : [];

    if (allowedRoles.includes(role)) {
      return false;
    }

    const blockedActions = Array.isArray(
      restriction.blockedActions,
    )
      ? restriction.blockedActions.map((item) =>
          typeof item === 'string'
            ? item.trim().toUpperCase()
            : item,
        )
      : [];

    return (
      blockedActions.length === 0 ||
      blockedActions.includes(action)
    );
  });
}

function resolveDirectOwnership(session, resource) {
  if (!isPlainObject(resource)) {
    return null;
  }

  if (typeof resource.owned === 'boolean') {
    return resource.owned;
  }

  if (typeof resource.isOwned === 'boolean') {
    return resource.isOwned;
  }

  const ownerUserId =
    resource.ownerUserId ?? resource.userIdOwner;

  if (
    typeof ownerUserId === 'string' &&
    ownerUserId.trim().length > 0
  ) {
    return ownerUserId.trim() === session.userId;
  }

  const ownerMemberId =
    resource.ownerMemberId ??
    resource.memberId ??
    resource.member?.memberId;

  if (
    typeof ownerMemberId === 'string' &&
    ownerMemberId.trim().length > 0 &&
    session.memberId !== null
  ) {
    return ownerMemberId.trim() === session.memberId;
  }

  return null;
}

function resolveResourceType(resource) {
  if (!isPlainObject(resource)) {
    return null;
  }

  const value =
    resource.type ??
    resource.resourceType ??
    resource.kind;

  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : null;
}

function resolveOwnershipMethod(provider, resource) {
  const resourceType = resolveResourceType(resource);

  if (
    resourceType === 'CLAIM' &&
    typeof provider.isClaimOwnedByMember === 'function'
  ) {
    return provider.isClaimOwnedByMember.bind(provider);
  }

  if (
    resourceType === 'DOCUMENT' &&
    typeof provider.isDocumentOwnedByMember === 'function'
  ) {
    return provider.isDocumentOwnedByMember.bind(provider);
  }

  const fallbackNames = [
    'isResourceOwnedByMember',
    'isOwnedByMember',
    'isOwned',
  ];

  const methodName = fallbackNames.find(
    (name) => typeof provider[name] === 'function',
  );

  return methodName === undefined
    ? null
    : provider[methodName].bind(provider);
}

function normalizeOwnershipResult(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (isPlainObject(value) && typeof value.owned === 'boolean') {
    return value.owned;
  }

  if (isPlainObject(value) && typeof value.allowed === 'boolean') {
    return value.allowed;
  }

  return false;
}

function getRouteCapability(route) {
  if (!isPlainObject(route)) {
    return null;
  }

  const capability =
    route.capability ??
    route.routeCapability ??
    route.handle?.capability ??
    route.meta?.capability;

  return typeof capability === 'string'
    ? capability.trim().toUpperCase()
    : null;
}

function isRoleAllowedForCapability(role, capability) {
  if (capability === ROUTE_CAPABILITIES.PUBLIC) {
    return true;
  }

  if (role === null || !isRouteCapability(capability)) {
    return false;
  }

  return ROUTE_PERMISSION_POLICIES[capability]?.includes(role) === true;
}

/**
 * Error raised when permission service configuration is invalid.
 */
export class PermissionServiceError extends Error {
  /**
   * @param {string} code Stable permission service error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PermissionServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Error raised when an evaluated permission is denied.
 */
export class AccessDeniedError extends PermissionServiceError {
  /**
   * @param {Readonly<Record<string, unknown>>} decision Denial decision.
   */
  constructor(decision) {
    super(
      PERMISSION_SERVICE_ERROR_CODES.ACCESS_DENIED,
      'The requested action is not permitted.',
      { decision },
    );
    this.name = 'AccessDeniedError';
    this.decision = decision;
  }
}

/**
 * Central browser-local permission policy service.
 */
export class PermissionService {
  /**
   * @param {{
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   relationshipProvider?: object,
   *   seededRelationshipProvider?: object,
   *   routes?: readonly Record<string, unknown>[],
   *   routeDefinitions?: readonly Record<string, unknown>[],
   *   clock?: object|Function
   * }} [options] Permission service options.
   */
  constructor(options = {}) {
    const normalizedOptions = normalizeOptions(options);

    this.sessionProvider = resolveSessionProvider(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade,
    );
    this.relationshipProvider = resolveRelationshipProvider(
      normalizedOptions.relationshipProvider ??
        normalizedOptions.seededRelationshipProvider,
    );
    this.routeDefinitions = normalizeRouteDefinitions(
      normalizedOptions.routeDefinitions ??
        normalizedOptions.routes,
    );
    this.clock = normalizedOptions.clock ?? browserClock;
  }

  /**
   * Returns the current permission policy version.
   *
   * @returns {string} Policy version.
   */
  getPolicyVersion() {
    return PERMISSION_POLICY_VERSION;
  }

  /**
   * Evaluates an action against the active session and resource policy.
   *
   * @param {string|Record<string, unknown>} inputOrAction Evaluation input or
   * action.
   * @param {Record<string, unknown>|null} [resource] Optional resource.
   * @param {Record<string, unknown>} [context] Optional context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Access decision.
   */
  async evaluate(inputOrAction, resource = null, context = {}) {
    const input = normalizeEvaluationInput(
      inputOrAction,
      resource,
      context,
    );

    if (input === null || typeof input.action !== 'string') {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.INVALID_REQUEST,
        null,
        null,
      );
    }

    const action = input.action;

    if (
      !ACTION_VALUE_SET.has(action) ||
      !isPermissionAction(action) ||
      PERMISSION_POLICIES[action] === undefined
    ) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.UNKNOWN_ACTION,
        action,
        null,
      );
    }

    let sessionValue = input.session;

    if (sessionValue === undefined) {
      try {
        sessionValue = readSessionFromProvider(
          this.sessionProvider,
        );
      } catch {
        return createDeniedDecision(
          ACCESS_DECISION_REASONS.DEPENDENCY_UNAVAILABLE,
          action,
          null,
          { dependency: 'SESSION_PROVIDER' },
        );
      }
    }

    const session = normalizeSession(sessionValue);

    if (session === null) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.NO_ACTIVE_SESSION,
        action,
        null,
      );
    }

    if (isSessionExpired(session, this.clock)) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.SESSION_EXPIRED,
        action,
        session.role,
      );
    }

    const policy = PERMISSION_POLICIES[action];

    if (!policy.roles.includes(session.role)) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.ROLE_NOT_ALLOWED,
        action,
        session.role,
      );
    }

    if (
      policy.restrictedMemberRoles.includes(session.role) &&
      isResourceRestricted(
        input.resource,
        session.role,
        action,
      )
    ) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.RESTRICTED_MEMBER,
        action,
        session.role,
      );
    }

    if (!policy.ownershipRoles.includes(session.role)) {
      return createDecision({
        allowed: true,
        reasonCode: ACCESS_DECISION_REASONS.ROLE_ALLOWED,
        action,
        role: session.role,
      });
    }

    const directOwnership = resolveDirectOwnership(
      session,
      input.resource,
    );

    if (directOwnership !== null) {
      return directOwnership
        ? createDecision({
            allowed: true,
            reasonCode:
              ACCESS_DECISION_REASONS.OWNERSHIP_CONFIRMED,
            action,
            role: session.role,
          })
        : createDeniedDecision(
            ACCESS_DECISION_REASONS.OWNERSHIP_MISMATCH,
            action,
            session.role,
          );
    }

    if (this.relationshipProvider === null) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.DEPENDENCY_UNAVAILABLE,
        action,
        session.role,
        { dependency: 'SEEDED_RELATIONSHIP_PROVIDER' },
      );
    }

    const ownershipMethod = resolveOwnershipMethod(
      this.relationshipProvider,
      input.resource,
    );

    if (ownershipMethod === null) {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.DEPENDENCY_UNAVAILABLE,
        action,
        session.role,
        { dependency: 'OWNERSHIP_OPERATION' },
      );
    }

    let owned;

    try {
      const identity = session.memberId ?? session.userId;
      const result = await ownershipMethod(
        identity,
        input.resource,
        {
          action,
          session,
          context: input.context,
        },
      );

      owned = normalizeOwnershipResult(result);
    } catch {
      return createDeniedDecision(
        ACCESS_DECISION_REASONS.DEPENDENCY_UNAVAILABLE,
        action,
        session.role,
        { dependency: 'OWNERSHIP_OPERATION' },
      );
    }

    return owned
      ? createDecision({
          allowed: true,
          reasonCode:
            ACCESS_DECISION_REASONS.OWNERSHIP_CONFIRMED,
          action,
          role: session.role,
        })
      : createDeniedDecision(
          ACCESS_DECISION_REASONS.OWNERSHIP_MISMATCH,
          action,
          session.role,
        );
  }

  /**
   * Requires an action to be allowed or throws AccessDeniedError.
   *
   * @param {string|Record<string, unknown>} inputOrAction Evaluation input or
   * action.
   * @param {Record<string, unknown>|null} [resource] Optional resource.
   * @param {Record<string, unknown>} [context] Optional context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Allowed decision.
   */
  async require(inputOrAction, resource = null, context = {}) {
    const decision = await this.evaluate(
      inputOrAction,
      resource,
      context,
    );

    if (!decision.allowed) {
      throw new AccessDeniedError(decision);
    }

    return decision;
  }

  /**
   * Returns route definitions or capability names visible to a session.
   *
   * @param {Record<string, unknown>|null} session Session value.
   * @param {readonly Record<string, unknown>[]} [routes] Route definitions.
   * @returns {readonly unknown[]} Visible routes or capabilities.
   */
  visibleRoutes(session, routes = this.routeDefinitions) {
    const normalizedSession = normalizeSession(session);
    const role =
      normalizedSession !== null &&
      !isSessionExpired(normalizedSession, this.clock)
        ? normalizedSession.role
        : null;

    if (routes === null || routes === undefined) {
      return Object.freeze(
        ROUTE_CAPABILITY_VALUES.filter((capability) =>
          isRoleAllowedForCapability(role, capability),
        ),
      );
    }

    if (!Array.isArray(routes)) {
      throw new PermissionServiceError(
        PERMISSION_SERVICE_ERROR_CODES.INVALID_ROUTE_DEFINITIONS,
        'Visible route input must be an array.',
      );
    }

    return Object.freeze(
      routes.filter((route) => {
        const capability = getRouteCapability(route);

        return (
          capability !== null &&
          ROUTE_CAPABILITY_VALUE_SET.has(capability) &&
          isRoleAllowedForCapability(role, capability)
        );
      }),
    );
  }
}

/**
 * Creates a central permission service.
 *
 * @param {ConstructorParameters<typeof PermissionService>[0]} [options]
 * Service options.
 * @returns {PermissionService} Permission service.
 */
export function createPermissionService(options = {}) {
  return new PermissionService(options);
}

export const permissionService = createPermissionService();

/**
 * Evaluates a permission using the default permission service.
 *
 * @param {string|Record<string, unknown>} inputOrAction Input or action.
 * @param {Record<string, unknown>|null} [resource] Resource.
 * @param {Record<string, unknown>} [context] Context.
 * @returns {Promise<Readonly<Record<string, unknown>>>} Access decision.
 */
export function evaluate(
  inputOrAction,
  resource = null,
  context = {},
) {
  return permissionService.evaluate(
    inputOrAction,
    resource,
    context,
  );
}

/**
 * Requires a permission using the default permission service.
 *
 * @param {string|Record<string, unknown>} inputOrAction Input or action.
 * @param {Record<string, unknown>|null} [resource] Resource.
 * @param {Record<string, unknown>} [context] Context.
 * @returns {Promise<Readonly<Record<string, unknown>>>} Allowed decision.
 */
export function require(
  inputOrAction,
  resource = null,
  context = {},
) {
  return permissionService.require(
    inputOrAction,
    resource,
    context,
  );
}

/**
 * Returns routes visible to a session using the default service.
 *
 * @param {Record<string, unknown>|null} session Session.
 * @param {readonly Record<string, unknown>[]|null} [routes] Routes.
 * @returns {readonly unknown[]} Visible routes or capabilities.
 */
export function visibleRoutes(session, routes = null) {
  return permissionService.visibleRoutes(session, routes);
}

/**
 * Returns the current permission policy version.
 *
 * @returns {string} Policy version.
 */
export function getPolicyVersion() {
  return PERMISSION_POLICY_VERSION;
}

export const AccessPolicyService = PermissionService;
export const LocalPermissionService = PermissionService;
export const createAccessPolicyService = createPermissionService;
export const evaluatePermission = evaluate;
export const requirePermission = require;
export const getVisibleRoutes = visibleRoutes;

export default PermissionService;