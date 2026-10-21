import {
  CLAIMS,
  COVERAGES,
  MEMBERS,
  PROVIDERS,
  REASON_CODES,
  RESTRICTIONS,
  SERVICE_LINES,
} from '../../fixtures/membersClaims.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';
import { browserClock } from '../time/clock.js';

export const FIXTURE_REPOSITORY_SCHEMA_VERSION = 1;
export const FIXTURE_REPOSITORY_SLICE = 'fixtureOverlays';

export const FIXTURE_ENTITY_TYPES = Object.freeze({
  MEMBER: 'MEMBER',
  CLAIM: 'CLAIM',
  COVERAGE: 'COVERAGE',
  PROVIDER: 'PROVIDER',
});

export const FIXTURE_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_ENTITY: 'INVALID_ENTITY',
  INVALID_UPDATE: 'INVALID_UPDATE',
  INVALID_REVISION: 'INVALID_REVISION',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  IMMUTABLE_FIELD: 'IMMUTABLE_FIELD',
});

const COLLECTION_DEFINITIONS = Object.freeze({
  [FIXTURE_ENTITY_TYPES.MEMBER]: Object.freeze({
    overlayField: 'members',
    key: 'memberId',
    source: MEMBERS,
  }),
  [FIXTURE_ENTITY_TYPES.CLAIM]: Object.freeze({
    overlayField: 'claims',
    key: 'claimNumber',
    source: CLAIMS,
  }),
  [FIXTURE_ENTITY_TYPES.COVERAGE]: Object.freeze({
    overlayField: 'coverages',
    key: 'coverageId',
    source: COVERAGES,
  }),
  [FIXTURE_ENTITY_TYPES.PROVIDER]: Object.freeze({
    overlayField: 'providers',
    key: 'providerId',
    source: PROVIDERS,
  }),
});

const ENTITY_TYPE_VALUES = new Set(Object.values(FIXTURE_ENTITY_TYPES));
const PRIVILEGED_ROLES = new Set(['ADMIN', 'BOS']);
const CLAIM_DISCOVERY_ROLES = new Set(['ADMIN', 'BOS', 'CSR', 'MEMBER']);
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAXIMUM_LIMIT = 100;

const IMMUTABLE_FIELDS = Object.freeze({
  [FIXTURE_ENTITY_TYPES.MEMBER]: new Set(['memberId']),
  [FIXTURE_ENTITY_TYPES.CLAIM]: new Set([
    'claimNumber',
    'memberId',
    'coverageId',
    'providerId',
    'serviceLineIds',
  ]),
  [FIXTURE_ENTITY_TYPES.COVERAGE]: new Set([
    'coverageId',
    'memberId',
  ]),
  [FIXTURE_ENTITY_TYPES.PROVIDER]: new Set(['providerId']),
});

const DEFAULT_OVERLAYS = deepFreeze({
  schemaVersion: FIXTURE_REPOSITORY_SCHEMA_VERSION,
  revision: 0,
  updatedAt: null,
  updatedBy: null,
  members: {},
  claims: {},
  coverages: {},
  providers: {},
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

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'Fixture repository requires a storage gateway with read() and commit().',
    );
  }

  return value;
}

function resolveConstructorArguments(gatewayOrOptions, options) {
  if (
    isPlainObject(gatewayOrOptions) &&
    (gatewayOrOptions.gateway !== undefined ||
      gatewayOrOptions.storageGateway !== undefined)
  ) {
    return {
      gateway:
        gatewayOrOptions.gateway ??
        gatewayOrOptions.storageGateway,
      options: gatewayOrOptions,
    };
  }

  return {
    gateway: gatewayOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      `${name} must be a non-empty string.`,
    );
  }

  return value.normalize('NFC').trim();
}

function requireRevision(value, name = 'Expected revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function requirePositiveInteger(value, fallback, maximum) {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Fixture query pagination values are outside the supported range.',
      {
        value,
        maximum: maximum ?? null,
      },
    );
  }

  return value;
}

function getCurrentTimestamp(clock) {
  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    return clock.nowIso();
  }

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    const value = clock.now();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  if (typeof clock === 'function') {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }

  throw new TypeError(
    'Fixture repository clock must provide a valid current timestamp.',
  );
}

function normalizeSearchText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function createSearchTokens(values) {
  const text = normalizeSearchText(
    values
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          typeof value !== 'object',
      )
      .join(' '),
  );

  return Object.freeze(
    [...new Set(text.split(/\s+/).filter(Boolean))],
  );
}

function isValidDateOnly(value) {
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

function isValidOverlayMap(value) {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([identifier, patch]) =>
        identifier.trim().length > 0 &&
        isPlainObject(patch) &&
        isJsonCompatible(patch),
    )
  );
}

function isFixtureOverlays(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    value.schemaVersion === FIXTURE_REPOSITORY_SCHEMA_VERSION &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    (value.updatedAt === null ||
      (typeof value.updatedAt === 'string' &&
        Number.isFinite(Date.parse(value.updatedAt)))) &&
    (value.updatedBy === null ||
      (typeof value.updatedBy === 'string' &&
        value.updatedBy.trim().length > 0)) &&
    isValidOverlayMap(value.members) &&
    isValidOverlayMap(value.claims) &&
    isValidOverlayMap(value.coverages) &&
    isValidOverlayMap(value.providers)
  );
}

function readOverlays(envelope, sliceName) {
  if (envelope === null || !isPlainObject(envelope.slices)) {
    return DEFAULT_OVERLAYS;
  }

  const value = envelope.slices[sliceName];

  if (value === undefined || value === null) {
    return DEFAULT_OVERLAYS;
  }

  if (!isFixtureOverlays(value)) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
      'Persisted fixture overlays do not satisfy their schema.',
      { sliceName },
    );
  }

  return deepFreeze(value);
}

function buildNextState(envelope, sliceName, overlays) {
  const slices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...slices,
      [sliceName]: overlays,
    },
  };
}

function mergeCollection(definition, overlays) {
  return definition.source.map((entity) => {
    const identifier = entity[definition.key];
    const patch = overlays[definition.overlayField][identifier];

    return patch === undefined
      ? deepFreeze(entity)
      : deepFreeze({
          ...entity,
          ...patch,
          [definition.key]: identifier,
        });
  });
}

function createIndex(values, key) {
  return deepFreeze(
    Object.fromEntries(values.map((value) => [value[key], value])),
  );
}

function normalizeContext(context) {
  if (context === undefined || context === null) {
    return deepFreeze({
      role: 'ADMIN',
      memberId: null,
      userId: null,
      unrestricted: true,
    });
  }

  if (!isPlainObject(context)) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_CONTEXT,
      'Fixture access context must be a plain object.',
    );
  }

  const role =
    typeof context.role === 'string'
      ? context.role.trim().toUpperCase()
      : context.role;

  if (!isPlatformRole(role)) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_CONTEXT,
      'Fixture access context must contain a supported platform role.',
      { role: context.role },
    );
  }

  const memberId =
    context.memberId === undefined || context.memberId === null
      ? null
      : requireNonEmptyString(context.memberId, 'Context member ID');

  if (role === 'MEMBER' && memberId === null) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_CONTEXT,
      'Member access context must include a member ID.',
    );
  }

  return deepFreeze({
    role,
    memberId,
    userId:
      typeof context.userId === 'string' &&
      context.userId.trim().length > 0
        ? context.userId.trim()
        : null,
    unrestricted: false,
  });
}

function getActiveRestrictions(claimNumber) {
  return RESTRICTIONS.filter(
    (restriction) =>
      restriction.active === true &&
      restriction.claimNumber === claimNumber,
  );
}

function isClaimAccessible(claim, context, action = 'CLAIM_VIEW') {
  if (context.unrestricted) {
    return true;
  }

  if (!CLAIM_DISCOVERY_ROLES.has(context.role)) {
    return false;
  }

  if (
    context.role === 'MEMBER' &&
    claim.memberId !== context.memberId
  ) {
    return false;
  }

  return getActiveRestrictions(claim.claimNumber).every(
    (restriction) =>
      !restriction.blockedActions.includes(action) ||
      restriction.allowedRoles.includes(context.role),
  );
}

function canViewMember(memberId, context) {
  if (context.unrestricted || PRIVILEGED_ROLES.has(context.role)) {
    return true;
  }

  if (context.role === 'MEMBER') {
    return context.memberId === memberId;
  }

  return context.role === 'CSR';
}

function normalizeEntityType(value) {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : value;

  if (!ENTITY_TYPE_VALUES.has(normalized)) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_ENTITY,
      'Fixture entity type is not supported.',
      { entityType: value },
    );
  }

  return normalized;
}

function resolveExpectedEntityRevision(options) {
  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'Fixture mutation options must be an object or revision.',
    );
  }

  if (
    options.expectedRevision === undefined ||
    options.expectedRevision === null
  ) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
      'Expected fixture overlay revision is required.',
    );
  }

  return requireRevision(options.expectedRevision);
}

function resolveExpectedRootRevision(options, currentRevision) {
  if (!isPlainObject(options)) {
    return currentRevision;
  }

  const expected =
    options.expectedRootRevision ?? options.rootRevision;

  if (expected === undefined || expected === null) {
    return currentRevision;
  }

  const normalized = requireRevision(
    expected,
    'Expected root revision',
  );

  if (normalized !== currentRevision) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted fixture data changed before the mutation.',
      {
        expectedRevision: normalized,
        actualRevision: currentRevision,
      },
    );
  }

  return normalized;
}

function normalizeActor(options) {
  if (!isPlainObject(options)) {
    return 'system';
  }

  const actor = options.updatedBy ?? options.actorId ?? 'system';

  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Fixture updater must be a non-empty string.',
    );
  }

  return actor.normalize('NFC').trim();
}

function normalizeUpdate(entityType, changes) {
  if (
    !isPlainObject(changes) ||
    !isJsonCompatible(changes) ||
    Object.keys(changes).length === 0
  ) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Fixture changes must be a non-empty, safe plain object.',
    );
  }

  Object.keys(changes).forEach((field) => {
    if (IMMUTABLE_FIELDS[entityType].has(field)) {
      throw new FixtureRepositoryError(
        FIXTURE_REPOSITORY_ERROR_CODES.IMMUTABLE_FIELD,
        `Fixture field ${field} is immutable.`,
        { entityType, field },
      );
    }
  });

  return { ...changes };
}

function findSourceEntity(entityType, identifier) {
  const definition = COLLECTION_DEFINITIONS[entityType];

  return (
    definition.source.find(
      (entity) => entity[definition.key] === identifier,
    ) ?? null
  );
}

function validateMergedEntity(entityType, entity) {
  if (!isPlainObject(entity) || !isJsonCompatible(entity)) {
    return false;
  }

  switch (entityType) {
    case FIXTURE_ENTITY_TYPES.MEMBER:
      return (
        typeof entity.memberId === 'string' &&
        entity.memberId.length > 0 &&
        typeof entity.displayName === 'string' &&
        entity.displayName.trim().length > 0 &&
        typeof entity.active === 'boolean'
      );
    case FIXTURE_ENTITY_TYPES.CLAIM:
      return (
        typeof entity.claimNumber === 'string' &&
        entity.claimNumber.length > 0 &&
        typeof entity.memberId === 'string' &&
        typeof entity.status === 'string' &&
        isValidDateOnly(entity.serviceDateFrom) &&
        isValidDateOnly(entity.serviceDateTo) &&
        typeof entity.billedAmount === 'number' &&
        Number.isFinite(entity.billedAmount)
      );
    case FIXTURE_ENTITY_TYPES.COVERAGE:
      return (
        typeof entity.coverageId === 'string' &&
        entity.coverageId.length > 0 &&
        typeof entity.memberId === 'string' &&
        typeof entity.status === 'string' &&
        isValidDateOnly(entity.effectiveDate)
      );
    case FIXTURE_ENTITY_TYPES.PROVIDER:
      return (
        typeof entity.providerId === 'string' &&
        entity.providerId.length > 0 &&
        typeof entity.name === 'string' &&
        entity.name.trim().length > 0
      );
    default:
      return false;
  }
}

function normalizeQuery(filters) {
  if (!isPlainObject(filters)) {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Fixture query filters must be an object.',
    );
  }

  const page = requirePositiveInteger(filters.page, DEFAULT_PAGE);
  const limit = requirePositiveInteger(
    filters.limit,
    DEFAULT_LIMIT,
    MAXIMUM_LIMIT,
  );
  const searchValue = filters.query ?? filters.q ?? filters.search;
  const search =
    searchValue === undefined ||
    searchValue === null ||
    searchValue === ''
      ? null
      : normalizeSearchText(
          requireNonEmptyString(searchValue, 'Search query'),
        );
  const direction =
    typeof filters.direction === 'string'
      ? filters.direction.trim().toUpperCase()
      : 'ASC';

  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new FixtureRepositoryError(
      FIXTURE_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Fixture query direction must be ASC or DESC.',
    );
  }

  return {
    page,
    limit,
    search,
    direction,
    status:
      typeof filters.status === 'string' &&
      filters.status.trim().length > 0
        ? filters.status.trim().toUpperCase()
        : null,
    memberId:
      typeof filters.memberId === 'string' &&
      filters.memberId.trim().length > 0
        ? filters.memberId.trim()
        : null,
    providerId:
      typeof filters.providerId === 'string' &&
      filters.providerId.trim().length > 0
        ? filters.providerId.trim()
        : null,
    coverageId:
      typeof filters.coverageId === 'string' &&
      filters.coverageId.trim().length > 0
        ? filters.coverageId.trim()
        : null,
    eligibleForReprint:
      typeof filters.eligibleForReprint === 'boolean'
        ? filters.eligibleForReprint
        : null,
  };
}

function paginate(values, query, revision) {
  const start = (query.page - 1) * query.limit;
  const items = values.slice(start, start + query.limit);

  return deepFreeze({
    items,
    page: query.page,
    limit: query.limit,
    total: values.length,
    totalPages:
      values.length === 0
        ? 0
        : Math.ceil(values.length / query.limit),
    revision,
  });
}

function buildNormalizedIndexes(collections) {
  const members = Object.fromEntries(
    collections.members.map((member) => [
      member.memberId,
      {
        id: member.memberId,
        text: normalizeSearchText(
          [
            member.memberId,
            member.displayName,
            member.firstName,
            member.lastName,
          ].join(' '),
        ),
        tokens: createSearchTokens([
          member.memberId,
          member.displayName,
          member.firstName,
          member.lastName,
        ]),
      },
    ]),
  );
  const providers = Object.fromEntries(
    collections.providers.map((provider) => [
      provider.providerId,
      {
        id: provider.providerId,
        text: normalizeSearchText(
          [
            provider.providerId,
            provider.name,
            provider.npi,
            provider.providerType,
            provider.networkStatus,
          ].join(' '),
        ),
        tokens: createSearchTokens([
          provider.providerId,
          provider.name,
          provider.npi,
          provider.providerType,
          provider.networkStatus,
        ]),
      },
    ]),
  );
  const claims = Object.fromEntries(
    collections.claims.map((claim) => {
      const member = collections.membersById[claim.memberId];
      const provider = collections.providersById[claim.providerId];

      return [
        claim.claimNumber,
        {
          id: claim.claimNumber,
          text: normalizeSearchText(
            [
              claim.claimNumber,
              claim.memberId,
              member?.displayName,
              claim.providerId,
              provider?.name,
              claim.status,
              claim.claimType,
              claim.serviceDateFrom,
              claim.serviceDateTo,
            ].join(' '),
          ),
          tokens: createSearchTokens([
            claim.claimNumber,
            claim.memberId,
            member?.displayName,
            claim.providerId,
            provider?.name,
            claim.status,
            claim.claimType,
          ]),
        },
      ];
    }),
  );

  return deepFreeze({
    members,
    claims,
    providers,
  });
}

/**
 * Error raised when fixture repository data or operations are invalid.
 */
export class FixtureRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'FixtureRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Ownership-aware repository for bundled member and claim fixtures.
 */
export class FixtureRepository {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or repository options containing `gateway` or `storageGateway`.
   * @param {{sliceName?: string, clock?: object|Function}} [options]
   * Repository options.
   */
  constructor(gatewayOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      gatewayOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.gateway = requireGateway(resolved.gateway);
    this.sliceName =
      typeof normalizedOptions.sliceName === 'string' &&
      normalizedOptions.sliceName.trim().length > 0
        ? normalizedOptions.sliceName.trim()
        : FIXTURE_REPOSITORY_SLICE;
    this.clock = normalizedOptions.clock ?? browserClock;
  }

  /**
   * Returns the current storage root revision.
   *
   * @returns {number} Root revision.
   */
  getRevision() {
    return this.gateway.read()?.rootRevision ?? 0;
  }

  /**
   * Returns the current mutable overlay revision.
   *
   * @returns {number} Overlay revision.
   */
  getOverlayRevision() {
    const envelope = this.gateway.read();

    return readOverlays(envelope, this.sliceName).revision;
  }

  /**
   * Returns merged fixture collections and indexes.
   *
   * @returns {Readonly<Record<string, unknown>>} Merged fixture data.
   */
  getSnapshot() {
    const envelope = this.gateway.read();
    const overlays = readOverlays(envelope, this.sliceName);
    const members = mergeCollection(
      COLLECTION_DEFINITIONS.MEMBER,
      overlays,
    );
    const claims = mergeCollection(
      COLLECTION_DEFINITIONS.CLAIM,
      overlays,
    );
    const coverages = mergeCollection(
      COLLECTION_DEFINITIONS.COVERAGE,
      overlays,
    );
    const providers = mergeCollection(
      COLLECTION_DEFINITIONS.PROVIDER,
      overlays,
    );
    const membersById = createIndex(members, 'memberId');
    const claimsByNumber = createIndex(claims, 'claimNumber');
    const coveragesById = createIndex(coverages, 'coverageId');
    const providersById = createIndex(providers, 'providerId');
    const collections = {
      members,
      claims,
      coverages,
      providers,
      membersById,
      claimsByNumber,
      coveragesById,
      providersById,
    };

    return deepFreeze({
      schemaVersion: FIXTURE_REPOSITORY_SCHEMA_VERSION,
      revision: envelope?.rootRevision ?? 0,
      overlayRevision: overlays.revision,
      overlays,
      ...collections,
      serviceLines: SERVICE_LINES,
      reasonCodes: REASON_CODES,
      restrictions: RESTRICTIONS,
      serviceLinesByClaim: Object.fromEntries(
        claims.map((claim) => [
          claim.claimNumber,
          SERVICE_LINES.filter(
            (line) => line.claimNumber === claim.claimNumber,
          ),
        ]),
      ),
      searchIndexes: buildNormalizedIndexes(collections),
    });
  }

  /**
   * Returns members visible to the supplied access context.
   *
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Members.
   */
  getMembers(context = null) {
    const access = normalizeContext(context);

    return deepFreeze(
      this.getSnapshot().members.filter((member) =>
        canViewMember(member.memberId, access),
      ),
    );
  }

  /**
   * Returns one visible member.
   *
   * @param {string} memberId Member identifier.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>|null} Member or null.
   */
  getMemberById(memberId, context = null) {
    const identifier = requireNonEmptyString(memberId, 'Member ID');
    const access = normalizeContext(context);

    if (!canViewMember(identifier, access)) {
      return null;
    }

    return this.getSnapshot().membersById[identifier] ?? null;
  }

  /**
   * Returns claims visible to the supplied access context.
   *
   * @param {Record<string, unknown>|null} [context] Access context.
   * @param {string} [action] Requested claim action.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Claims.
   */
  getClaims(context = null, action = 'CLAIM_VIEW') {
    const access = normalizeContext(context);

    return deepFreeze(
      this.getSnapshot().claims.filter((claim) =>
        isClaimAccessible(claim, access, action),
      ),
    );
  }

  /**
   * Returns one visible claim.
   *
   * @param {string} claimNumber Claim number.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @param {string} [action] Requested claim action.
   * @returns {Readonly<Record<string, unknown>>|null} Claim or null.
   */
  getClaimByNumber(
    claimNumber,
    context = null,
    action = 'CLAIM_VIEW',
  ) {
    const identifier = requireNonEmptyString(
      claimNumber,
      'Claim number',
    );
    const claim = this.getSnapshot().claimsByNumber[identifier];

    if (
      claim === undefined ||
      !isClaimAccessible(claim, normalizeContext(context), action)
    ) {
      return null;
    }

    return claim;
  }

  /**
   * Returns whether the supplied context may perform an action on a claim.
   *
   * @param {string} claimNumber Claim number.
   * @param {Record<string, unknown>|null} context Access context.
   * @param {string} [action] Requested action.
   * @returns {boolean} Whether access is allowed.
   */
  canAccessClaim(
    claimNumber,
    context,
    action = 'CLAIM_VIEW',
  ) {
    return this.getClaimByNumber(claimNumber, context, action) !== null;
  }

  /**
   * Returns coverages visible to the supplied access context.
   *
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Coverages.
   */
  getCoverages(context = null) {
    const access = normalizeContext(context);
    const snapshot = this.getSnapshot();

    return deepFreeze(
      snapshot.coverages.filter((coverage) =>
        canViewMember(coverage.memberId, access),
      ),
    );
  }

  /**
   * Returns one visible coverage.
   *
   * @param {string} coverageId Coverage identifier.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>|null} Coverage or null.
   */
  getCoverageById(coverageId, context = null) {
    const identifier = requireNonEmptyString(
      coverageId,
      'Coverage ID',
    );
    const coverage = this.getSnapshot().coveragesById[identifier];

    if (
      coverage === undefined ||
      !canViewMember(coverage.memberId, normalizeContext(context))
    ) {
      return null;
    }

    return coverage;
  }

  /**
   * Returns all providers available to claim-discovery roles.
   *
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Providers.
   */
  getProviders(context = null) {
    const access = normalizeContext(context);

    if (
      !access.unrestricted &&
      !CLAIM_DISCOVERY_ROLES.has(access.role)
    ) {
      return Object.freeze([]);
    }

    if (access.role !== 'MEMBER') {
      return this.getSnapshot().providers;
    }

    const providerIds = new Set(
      this.getClaims(access).map((claim) => claim.providerId),
    );

    return deepFreeze(
      this.getSnapshot().providers.filter((provider) =>
        providerIds.has(provider.providerId),
      ),
    );
  }

  /**
   * Returns one provider visible through the supplied context.
   *
   * @param {string} providerId Provider identifier.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>|null} Provider or null.
   */
  getProviderById(providerId, context = null) {
    const identifier = requireNonEmptyString(
      providerId,
      'Provider ID',
    );

    return (
      this.getProviders(context).find(
        (provider) => provider.providerId === identifier,
      ) ?? null
    );
  }

  /**
   * Returns service lines for a visible claim.
   *
   * @param {string} claimNumber Claim number.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Service lines.
   */
  getServiceLinesByClaim(claimNumber, context = null) {
    const claim = this.getClaimByNumber(claimNumber, context);

    if (claim === null) {
      return Object.freeze([]);
    }

    return (
      this.getSnapshot().serviceLinesByClaim[claim.claimNumber] ??
      Object.freeze([])
    );
  }

  /**
   * Returns reason-code records referenced by a visible claim.
   *
   * @param {string} claimNumber Claim number.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Reason codes.
   */
  getReasonCodesByClaim(claimNumber, context = null) {
    const reasonCodeIds = new Set(
      this.getServiceLinesByClaim(claimNumber, context).flatMap(
        (line) => line.reasonCodeIds,
      ),
    );

    return deepFreeze(
      REASON_CODES.filter((reason) =>
        reasonCodeIds.has(reason.reasonCodeId),
      ),
    );
  }

  /**
   * Searches accessible claims using normalized local indexes.
   *
   * @param {Record<string, unknown>} [filters] Search filters.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Paged claims.
   */
  searchClaims(filters = {}, context = null) {
    const query = normalizeQuery(filters);
    const snapshot = this.getSnapshot();
    const access = normalizeContext(context);
    const claims = snapshot.claims
      .filter((claim) => isClaimAccessible(claim, access))
      .filter((claim) => {
        if (query.status !== null && claim.status !== query.status) {
          return false;
        }

        if (
          query.memberId !== null &&
          claim.memberId !== query.memberId
        ) {
          return false;
        }

        if (
          query.providerId !== null &&
          claim.providerId !== query.providerId
        ) {
          return false;
        }

        if (
          query.coverageId !== null &&
          claim.coverageId !== query.coverageId
        ) {
          return false;
        }

        if (
          query.eligibleForReprint !== null &&
          claim.eligibleForReprint !== query.eligibleForReprint
        ) {
          return false;
        }

        return (
          query.search === null ||
          snapshot.searchIndexes.claims[
            claim.claimNumber
          ].text.includes(query.search)
        );
      })
      .sort((left, right) => {
        const comparison = left.claimNumber.localeCompare(
          right.claimNumber,
          'en-US',
        );

        return query.direction === 'ASC'
          ? comparison
          : -comparison;
      });

    return paginate(claims, query, snapshot.revision);
  }

  /**
   * Searches visible members using normalized local indexes.
   *
   * @param {Record<string, unknown>} [filters] Search filters.
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Paged members.
   */
  searchMembers(filters = {}, context = null) {
    const query = normalizeQuery(filters);
    const snapshot = this.getSnapshot();
    const visibleIds = new Set(
      this.getMembers(context).map((member) => member.memberId),
    );
    const members = snapshot.members
      .filter((member) => visibleIds.has(member.memberId))
      .filter(
        (member) =>
          query.search === null ||
          snapshot.searchIndexes.members[
            member.memberId
          ].text.includes(query.search),
      )
      .sort((left, right) => {
        const comparison = left.displayName.localeCompare(
          right.displayName,
          'en-US',
          { sensitivity: 'base' },
        );

        return query.direction === 'ASC'
          ? comparison
          : -comparison;
      });

    return paginate(members, query, snapshot.revision);
  }

  /**
   * Returns the merged local data-lake view.
   *
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Data-lake view.
   */
  getDataLakeView(context = null) {
    const access = normalizeContext(context);
    const claims = this.getClaims(access);
    const claimNumbers = new Set(
      claims.map((claim) => claim.claimNumber),
    );

    return deepFreeze({
      source: 'LOCAL_DATA_LAKE',
      simulated: true,
      members: this.getMembers(access),
      coverages: this.getCoverages(access),
      providers: this.getProviders(access),
      claims,
      serviceLines: SERVICE_LINES.filter((line) =>
        claimNumbers.has(line.claimNumber),
      ),
      reasonCodes: REASON_CODES,
      restrictions:
        access.unrestricted || PRIVILEGED_ROLES.has(access.role)
          ? RESTRICTIONS
          : [],
    });
  }

  /**
   * Returns the merged local replica view.
   *
   * @param {Record<string, unknown>|null} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Replica view.
   */
  getReplicaView(context = null) {
    const claims = this.getClaims(context).filter(
      (claim) => claim.sourceSystem === 'CLAIMS_REPLICA',
    );
    const claimNumbers = new Set(
      claims.map((claim) => claim.claimNumber),
    );

    return deepFreeze({
      source: 'LOCAL_CLAIMS_REPLICA',
      simulated: true,
      replicationStatus: 'CURRENT',
      claims,
      serviceLines: SERVICE_LINES.filter((line) =>
        claimNumbers.has(line.claimNumber),
      ),
    });
  }

  /**
   * Updates a mutable overlay for an existing fixture entity.
   *
   * @param {string} entityType Fixture entity type.
   * @param {string} identifier Entity identifier.
   * @param {Record<string, unknown>} changes Overlay changes.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Merged entity.
   */
  updateEntity(entityType, identifier, changes, options = {}) {
    const type = normalizeEntityType(entityType);
    const normalizedIdentifier = requireNonEmptyString(
      identifier,
      'Fixture entity identifier',
    );
    const expectedRevision = resolveExpectedEntityRevision(options);
    const normalizedChanges = normalizeUpdate(type, changes);
    const source = findSourceEntity(type, normalizedIdentifier);

    if (source === null) {
      throw new FixtureRepositoryError(
        FIXTURE_REPOSITORY_ERROR_CODES.NOT_FOUND,
        'Fixture entity was not found.',
        {
          entityType: type,
          identifier: normalizedIdentifier,
        },
      );
    }

    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const overlays = readOverlays(envelope, this.sliceName);

    if (overlays.revision !== expectedRevision) {
      throw new FixtureRepositoryError(
        FIXTURE_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
        'Fixture overlays changed before the mutation.',
        {
          expectedRevision,
          actualRevision: overlays.revision,
        },
      );
    }

    const definition = COLLECTION_DEFINITIONS[type];
    const currentPatch =
      overlays[definition.overlayField][normalizedIdentifier] ?? {};
    const patch = {
      ...currentPatch,
      ...normalizedChanges,
    };
    const merged = {
      ...source,
      ...patch,
      [definition.key]: normalizedIdentifier,
    };

    if (!validateMergedEntity(type, merged)) {
      throw new FixtureRepositoryError(
        FIXTURE_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
        'Fixture changes produce an invalid entity.',
        {
          entityType: type,
          identifier: normalizedIdentifier,
        },
      );
    }

    const nextOverlays = deepFreeze({
      ...overlays,
      revision: overlays.revision + 1,
      updatedAt: getCurrentTimestamp(this.clock),
      updatedBy: normalizeActor(options),
      [definition.overlayField]: {
        ...overlays[definition.overlayField],
        [normalizedIdentifier]: patch,
      },
    });

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, nextOverlays),
      {},
    );

    return deepFreeze(merged);
  }

  updateMember(memberId, changes, options = {}) {
    return this.updateEntity(
      FIXTURE_ENTITY_TYPES.MEMBER,
      memberId,
      changes,
      options,
    );
  }

  updateClaim(claimNumber, changes, options = {}) {
    return this.updateEntity(
      FIXTURE_ENTITY_TYPES.CLAIM,
      claimNumber,
      changes,
      options,
    );
  }

  updateCoverage(coverageId, changes, options = {}) {
    return this.updateEntity(
      FIXTURE_ENTITY_TYPES.COVERAGE,
      coverageId,
      changes,
      options,
    );
  }

  updateProvider(providerId, changes, options = {}) {
    return this.updateEntity(
      FIXTURE_ENTITY_TYPES.PROVIDER,
      providerId,
      changes,
      options,
    );
  }

  /**
   * Clears all mutable overlays using optimistic revision validation.
   *
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Empty overlays.
   */
  clearOverlays(options = {}) {
    const expectedRevision = resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readOverlays(envelope, this.sliceName);

    if (current.revision !== expectedRevision) {
      throw new FixtureRepositoryError(
        FIXTURE_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
        'Fixture overlays changed before they could be cleared.',
        {
          expectedRevision,
          actualRevision: current.revision,
        },
      );
    }

    const overlays = deepFreeze({
      ...DEFAULT_OVERLAYS,
      revision: current.revision + 1,
      updatedAt: getCurrentTimestamp(this.clock),
      updatedBy: normalizeActor(options),
    });

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, overlays),
      {},
    );

    return overlays;
  }

  /**
   * Subscribes to storage invalidation events.
   *
   * @param {(event: Readonly<Record<string, unknown>>) => void} listener
   * Repository listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Fixture repository listener must be a function.',
      );
    }

    if (typeof this.gateway.subscribe !== 'function') {
      return () => {};
    }

    return this.gateway.subscribe(listener);
  }

  load() {
    return this.getSnapshot();
  }

  listMembers(context = null) {
    return this.getMembers(context);
  }

  listClaims(context = null) {
    return this.getClaims(context);
  }

  findMemberById(memberId, context = null) {
    return this.getMemberById(memberId, context);
  }

  findClaimByNumber(claimNumber, context = null) {
    return this.getClaimByNumber(claimNumber, context);
  }

  getLocalDataLake(context = null) {
    return this.getDataLakeView(context);
  }

  getLocalReplica(context = null) {
    return this.getReplicaView(context);
  }

  getSearchIndexes() {
    return this.getSnapshot().searchIndexes;
  }

  reset(options = {}) {
    return this.clearOverlays(options);
  }
}

/**
 * Creates a member and claim fixture repository.
 *
 * @param {ConstructorParameters<typeof FixtureRepository>[0]}
 * gatewayOrOptions Gateway or repository options.
 * @param {ConstructorParameters<typeof FixtureRepository>[1]} [options]
 * Repository options.
 * @returns {FixtureRepository} Fixture repository.
 */
export function createFixtureRepository(
  gatewayOrOptions,
  options = {},
) {
  return new FixtureRepository(gatewayOrOptions, options);
}

export const MemberClaimFixtureRepository = FixtureRepository;
export const LocalFixtureRepository = FixtureRepository;
export const createMemberClaimFixtureRepository =
  createFixtureRepository;
export const createLocalFixtureRepository =
  createFixtureRepository;
export const normalizeFixtureSearchText = normalizeSearchText;
export const isFixtureOverlayState = isFixtureOverlays;

export default FixtureRepository;