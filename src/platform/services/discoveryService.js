import { TIMING_DEFAULTS } from '../config/constants.js';
import { redactForRole } from '../security/maskingPolicy.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

export const DISCOVERY_SERVICE_SCHEMA_VERSION = 1;

export const DISCOVERY_ENTITY_TYPES = Object.freeze({
  MEMBER: 'MEMBER',
  CLAIM: 'CLAIM',
});

export const DISCOVERY_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_REPOSITORY: 'INVALID_REPOSITORY',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
  SERVICE_DESTROYED: 'SERVICE_DESTROYED',
});

export const DISCOVERY_DEFAULTS = Object.freeze({
  minimumAutocompleteCharacters: 2,
  autocompleteLimit: 8,
  debounceMs: TIMING_DEFAULTS.searchDebounceMs,
});

const DISCOVERY_ENTITY_TYPE_VALUES = new Set(
  Object.values(DISCOVERY_ENTITY_TYPES),
);
const CLAIM_ACTION_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;
const MAXIMUM_QUERY_LENGTH = 200;
const MAXIMUM_RESULT_LIMIT = 100;

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

function requireRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.searchMembers !== 'function' ||
    typeof value.searchClaims !== 'function' ||
    typeof value.getMemberById !== 'function' ||
    typeof value.getClaimByNumber !== 'function'
  ) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'Discovery service requires a fixture repository with member and claim search operations.',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.fixtureRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.fixtureRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function requirePositiveInteger(value, fallback, name, maximum) {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_OPTIONS,
      `${name} is outside the supported range.`,
      {
        value,
        maximum: maximum ?? null,
      },
    );
  }

  return value;
}

function requireNonNegativeNumber(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_OPTIONS,
      `${name} must be a non-negative finite number.`,
      { value },
    );
  }

  return value;
}

function requireQuery(value, options = {}) {
  if (value === undefined || value === null) {
    return options.allowEmpty === true ? '' : null;
  }

  if (typeof value !== 'string') {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
      'Discovery query must be a string.',
    );
  }

  const query = value.normalize('NFKC').trim();

  if (query.length === 0) {
    return options.allowEmpty === true ? '' : null;
  }

  if (query.length > MAXIMUM_QUERY_LENGTH) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
      `Discovery query must not exceed ${MAXIMUM_QUERY_LENGTH} characters.`,
    );
  }

  return query;
}

function requireIdentifier(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > MAXIMUM_QUERY_LENGTH
  ) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_IDENTIFIER,
      `${name} must be a non-empty string of at most ${MAXIMUM_QUERY_LENGTH} characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function normalizeAccessContext(value) {
  if (!isPlainObject(value)) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_CONTEXT,
      'Discovery access context must be a plain object.',
    );
  }

  const source =
    isPlainObject(value.session)
      ? value.session
      : isPlainObject(value.actor)
        ? value.actor
        : value;
  const role = normalizeRole(source.role);

  if (role === null) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_CONTEXT,
      'Discovery access context must contain a supported platform role.',
      { role: source.role ?? null },
    );
  }

  const memberId =
    source.memberId === undefined || source.memberId === null
      ? null
      : requireIdentifier(source.memberId, 'Context member ID');

  if (role === 'MEMBER' && memberId === null) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_CONTEXT,
      'Member discovery context must include a member ID.',
    );
  }

  return deepFreeze({
    role,
    memberId,
    userId:
      typeof source.userId === 'string' &&
      source.userId.trim().length > 0
        ? source.userId.normalize('NFC').trim()
        : null,
  });
}

function readContextProvider(provider) {
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

  return snapshot?.session ?? snapshot?.actor ?? snapshot;
}

function normalizeContextProvider(value) {
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

  throw new DiscoveryServiceError(
    DISCOVERY_SERVICE_ERROR_CODES.INVALID_OPTIONS,
    'Discovery context provider must be a function or expose getSession(), getSnapshot(), or getState().',
  );
}

function normalizeDirection(value) {
  if (value === undefined || value === null) {
    return 'ASC';
  }

  const direction =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
      'Discovery sort direction must be ASC or DESC.',
    );
  }

  return direction;
}

function normalizeSearchInput(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value === 'string') {
    return { query: value };
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
      'Discovery search input must be a safe plain object or query string.',
    );
  }

  return value;
}

function normalizeMemberSearchInput(value) {
  const input = normalizeSearchInput(value);

  return {
    query: requireQuery(
      input.query ?? input.q ?? input.search,
      { allowEmpty: true },
    ),
    page: requirePositiveInteger(
      input.page,
      1,
      'Member search page',
    ),
    limit: requirePositiveInteger(
      input.limit,
      25,
      'Member search limit',
      MAXIMUM_RESULT_LIMIT,
    ),
    direction: normalizeDirection(input.direction),
  };
}

function normalizeClaimSearchInput(value) {
  const input = normalizeSearchInput(value);
  const normalized = {
    query: requireQuery(
      input.query ?? input.q ?? input.search,
      { allowEmpty: true },
    ),
    page: requirePositiveInteger(
      input.page,
      1,
      'Claim search page',
    ),
    limit: requirePositiveInteger(
      input.limit,
      25,
      'Claim search limit',
      MAXIMUM_RESULT_LIMIT,
    ),
    direction: normalizeDirection(input.direction),
  };

  [
    'status',
    'memberId',
    'providerId',
    'coverageId',
  ].forEach((field) => {
    if (
      input[field] !== undefined &&
      input[field] !== null &&
      input[field] !== ''
    ) {
      normalized[field] = requireIdentifier(
        input[field],
        `Claim search ${field}`,
      );
    }
  });

  if (input.eligibleForReprint !== undefined) {
    if (typeof input.eligibleForReprint !== 'boolean') {
      throw new DiscoveryServiceError(
        DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
        'Claim reprint eligibility filter must be a boolean.',
      );
    }

    normalized.eligibleForReprint = input.eligibleForReprint;
  }

  return normalized;
}

function normalizeEntityTypes(value) {
  if (value === undefined || value === null) {
    return Object.freeze([
      DISCOVERY_ENTITY_TYPES.MEMBER,
      DISCOVERY_ENTITY_TYPES.CLAIM,
    ]);
  }

  const source = Array.isArray(value) ? value : [value];
  const types = source.map((item) =>
    typeof item === 'string' ? item.trim().toUpperCase() : item,
  );

  if (
    types.length === 0 ||
    types.some((type) => !DISCOVERY_ENTITY_TYPE_VALUES.has(type)) ||
    new Set(types).size !== types.length
  ) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
      'Autocomplete entity types must contain unique supported values.',
      {
        acceptedValues: [...DISCOVERY_ENTITY_TYPE_VALUES],
      },
    );
  }

  return Object.freeze(types);
}

function normalizeAutocompleteInput(value, defaults) {
  const input = normalizeSearchInput(value);
  const query = requireQuery(
    input.query ?? input.q ?? input.search,
    { allowEmpty: true },
  );

  return {
    query,
    entityTypes: normalizeEntityTypes(
      input.entityTypes ?? input.entityType ?? input.types,
    ),
    limit: requirePositiveInteger(
      input.limit,
      defaults.autocompleteLimit,
      'Autocomplete result limit',
      MAXIMUM_RESULT_LIMIT,
    ),
    minimumCharacters: requirePositiveInteger(
      input.minimumCharacters,
      defaults.minimumAutocompleteCharacters,
      'Autocomplete minimum characters',
      MAXIMUM_QUERY_LENGTH,
    ),
  };
}

function normalizeClaimAction(value) {
  if (value === undefined || value === null) {
    return 'CLAIM_VIEW';
  }

  if (
    typeof value !== 'string' ||
    !CLAIM_ACTION_PATTERN.test(value.trim().toUpperCase())
  ) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_QUERY,
      'Claim lookup action must be an uppercase action identifier.',
    );
  }

  return value.trim().toUpperCase();
}

function isOwnedByContext(memberId, context) {
  return (
    context.role === 'MEMBER' &&
    context.memberId !== null &&
    context.memberId === memberId
  );
}

/**
 * Creates a role-filtered member lookup DTO.
 *
 * @param {Record<string, unknown>} member Member fixture.
 * @param {Record<string, unknown>} context Normalized access context.
 * @returns {Readonly<Record<string, unknown>>} Member lookup DTO.
 */
export function createMemberLookupDto(member, context) {
  if (!isPlainObject(member)) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.LOOKUP_FAILED,
      'Member lookup data must be a plain object.',
    );
  }

  const access = normalizeAccessContext(context);
  const dto = {
    entityType: DISCOVERY_ENTITY_TYPES.MEMBER,
    memberId: member.memberId,
    displayName: member.displayName,
    active: member.active,
    restricted: member.restricted === true,
  };

  return redactForRole(dto, access.role, {
    owned: isOwnedByContext(member.memberId, access),
  });
}

/**
 * Creates a role-filtered claim lookup DTO.
 *
 * @param {Record<string, unknown>} claim Claim fixture.
 * @param {Record<string, unknown>} context Normalized access context.
 * @param {Record<string, unknown>|null} [member] Associated member.
 * @param {Record<string, unknown>|null} [provider] Associated provider.
 * @returns {Readonly<Record<string, unknown>>} Claim lookup DTO.
 */
export function createClaimLookupDto(
  claim,
  context,
  member = null,
  provider = null,
) {
  if (!isPlainObject(claim)) {
    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.LOOKUP_FAILED,
      'Claim lookup data must be a plain object.',
    );
  }

  const access = normalizeAccessContext(context);
  const dto = {
    entityType: DISCOVERY_ENTITY_TYPES.CLAIM,
    claimNumber: claim.claimNumber,
    memberId: claim.memberId,
    memberName: member?.displayName ?? null,
    providerId: claim.providerId,
    providerName: provider?.name ?? null,
    claimType: claim.claimType,
    status: claim.status,
    serviceDateFrom: claim.serviceDateFrom,
    serviceDateTo: claim.serviceDateTo,
    billedAmount: claim.billedAmount,
    allowedAmount: claim.allowedAmount,
    planPaidAmount: claim.planPaidAmount,
    memberResponsibilityAmount:
      claim.memberResponsibilityAmount,
    eligibleForReprint: claim.eligibleForReprint,
    documentTypes: Array.isArray(claim.documentTypes)
      ? claim.documentTypes
      : [],
  };

  return redactForRole(dto, access.role, {
    owned: isOwnedByContext(claim.memberId, access),
  });
}

function createPagedResult(result, items, entityType) {
  return deepFreeze({
    schemaVersion: DISCOVERY_SERVICE_SCHEMA_VERSION,
    entityType,
    items,
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
    revision: result.revision,
  });
}

function createAutocompleteItem(dto) {
  if (dto.entityType === DISCOVERY_ENTITY_TYPES.MEMBER) {
    return deepFreeze({
      entityType: dto.entityType,
      value: dto.memberId,
      label: dto.displayName,
      description: `Member ${dto.memberId}`,
      data: dto,
    });
  }

  return deepFreeze({
    entityType: dto.entityType,
    value: dto.claimNumber,
    label: dto.claimNumber,
    description: [
      dto.memberName,
      dto.providerName,
      dto.status,
    ]
      .filter(
        (item) =>
          typeof item === 'string' && item.trim().length > 0,
      )
      .join(' · '),
    data: dto,
  });
}

function createEmptyAutocompleteResult(query, minimumCharacters, cancelled) {
  return deepFreeze({
    schemaVersion: DISCOVERY_SERVICE_SCHEMA_VERSION,
    query,
    minimumCharacters,
    eligible: query.length >= minimumCharacters,
    cancelled: cancelled === true,
    items: [],
    memberCount: 0,
    claimCount: 0,
  });
}

function normalizeLookupFailure(error, operation) {
  if (error instanceof DiscoveryServiceError) {
    return error;
  }

  return new DiscoveryServiceError(
    DISCOVERY_SERVICE_ERROR_CODES.LOOKUP_FAILED,
    `${operation} could not be completed.`,
    {
      repositoryCode:
        error !== null && typeof error === 'object'
          ? error.code ?? null
          : null,
    },
    error,
  );
}

/**
 * Error raised when local member or claim discovery cannot be completed.
 */
export class DiscoveryServiceError extends Error {
  /**
   * @param {string} code Stable discovery error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DiscoveryServiceError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Local ownership-aware member and claim discovery service.
 */
export class DiscoveryService {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Fixture
   * repository or service options containing `repository` or
   * `fixtureRepository`.
   * @param {{
   *   contextProvider?: object|Function,
   *   defaultContext?: Record<string, unknown>,
   *   minimumAutocompleteCharacters?: number,
   *   autocompleteLimit?: number,
   *   debounceMs?: number
   * }} [options] Service options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    if (!isPlainObject(normalizedOptions)) {
      throw new DiscoveryServiceError(
        DISCOVERY_SERVICE_ERROR_CODES.INVALID_OPTIONS,
        'Discovery service options must be a plain object.',
      );
    }

    this.repository = requireRepository(resolved.repository);
    this.contextProvider = normalizeContextProvider(
      normalizedOptions.contextProvider ??
        normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade,
    );
    this.defaultContext =
      normalizedOptions.defaultContext === undefined
        ? null
        : normalizeAccessContext(normalizedOptions.defaultContext);
    this.defaults = deepFreeze({
      minimumAutocompleteCharacters: requirePositiveInteger(
        normalizedOptions.minimumAutocompleteCharacters,
        DISCOVERY_DEFAULTS.minimumAutocompleteCharacters,
        'Autocomplete minimum characters',
        MAXIMUM_QUERY_LENGTH,
      ),
      autocompleteLimit: requirePositiveInteger(
        normalizedOptions.autocompleteLimit,
        DISCOVERY_DEFAULTS.autocompleteLimit,
        'Autocomplete result limit',
        MAXIMUM_RESULT_LIMIT,
      ),
      debounceMs: requireNonNegativeNumber(
        normalizedOptions.debounceMs,
        DISCOVERY_DEFAULTS.debounceMs,
        'Autocomplete debounce delay',
      ),
    });
    this.autocompleteSources = new Set();
    this.destroyed = false;
  }

  ensureActive() {
    if (this.destroyed) {
      throw new DiscoveryServiceError(
        DISCOVERY_SERVICE_ERROR_CODES.SERVICE_DESTROYED,
        'Discovery service has been destroyed.',
      );
    }
  }

  resolveContext(context) {
    if (context !== undefined && context !== null) {
      return normalizeAccessContext(context);
    }

    let providedContext;

    try {
      providedContext = readContextProvider(this.contextProvider);
    } catch (error) {
      throw new DiscoveryServiceError(
        DISCOVERY_SERVICE_ERROR_CODES.INVALID_CONTEXT,
        'Discovery access context could not be read.',
        undefined,
        error,
      );
    }

    if (providedContext !== null && providedContext !== undefined) {
      return normalizeAccessContext(providedContext);
    }

    if (this.defaultContext !== null) {
      return this.defaultContext;
    }

    throw new DiscoveryServiceError(
      DISCOVERY_SERVICE_ERROR_CODES.INVALID_CONTEXT,
      'Discovery requires an active access context.',
    );
  }

  createMemberDto(member, context) {
    return createMemberLookupDto(member, context);
  }

  createClaimDto(claim, context) {
    let member = null;
    let provider = null;

    try {
      member = this.repository.getMemberById(
        claim.memberId,
        context,
      );

      if (typeof this.repository.getProviderById === 'function') {
        provider = this.repository.getProviderById(
          claim.providerId,
          context,
        );
      }
    } catch (error) {
      throw normalizeLookupFailure(
        error,
        'Claim lookup enrichment',
      );
    }

    return createClaimLookupDto(
      claim,
      context,
      member,
      provider,
    );
  }

  /**
   * Searches locally accessible members.
   *
   * @param {string|Record<string, unknown>} [input] Search input.
   * @param {Record<string, unknown>} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Paged member DTOs.
   */
  searchMembers(input = {}, context = undefined) {
    this.ensureActive();
    const normalizedInput = normalizeMemberSearchInput(input);
    const access = this.resolveContext(
      context ?? (isPlainObject(input) ? input.context : undefined),
    );

    try {
      const result = this.repository.searchMembers(
        normalizedInput,
        access,
      );
      const items = result.items.map((member) =>
        this.createMemberDto(member, access),
      );

      return createPagedResult(
        result,
        items,
        DISCOVERY_ENTITY_TYPES.MEMBER,
      );
    } catch (error) {
      throw normalizeLookupFailure(error, 'Member search');
    }
  }

  /**
   * Searches locally accessible claims.
   *
   * @param {string|Record<string, unknown>} [input] Search input.
   * @param {Record<string, unknown>} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Paged claim DTOs.
   */
  searchClaims(input = {}, context = undefined) {
    this.ensureActive();
    const normalizedInput = normalizeClaimSearchInput(input);
    const access = this.resolveContext(
      context ?? (isPlainObject(input) ? input.context : undefined),
    );

    try {
      const result = this.repository.searchClaims(
        normalizedInput,
        access,
      );
      const items = result.items.map((claim) =>
        this.createClaimDto(claim, access),
      );

      return createPagedResult(
        result,
        items,
        DISCOVERY_ENTITY_TYPES.CLAIM,
      );
    } catch (error) {
      throw normalizeLookupFailure(error, 'Claim search');
    }
  }

  /**
   * Resolves one accessible member to a role-filtered DTO.
   *
   * @param {string} memberId Member identifier.
   * @param {Record<string, unknown>} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>|null} Member DTO or null.
   */
  resolveMember(memberId, context = undefined) {
    this.ensureActive();
    const identifier = requireIdentifier(memberId, 'Member ID');
    const access = this.resolveContext(context);

    try {
      const member = this.repository.getMemberById(
        identifier,
        access,
      );

      return member === null
        ? null
        : this.createMemberDto(member, access);
    } catch (error) {
      throw normalizeLookupFailure(error, 'Member resolution');
    }
  }

  /**
   * Resolves one accessible claim to a role-filtered DTO.
   *
   * @param {string} claimNumber Claim identifier.
   * @param {Record<string, unknown>} [context] Access context.
   * @param {string} [action] Requested claim action.
   * @returns {Readonly<Record<string, unknown>>|null} Claim DTO or null.
   */
  resolveClaim(
    claimNumber,
    context = undefined,
    action = 'CLAIM_VIEW',
  ) {
    this.ensureActive();
    const identifier = requireIdentifier(
      claimNumber,
      'Claim number',
    );
    const access = this.resolveContext(context);
    const normalizedAction = normalizeClaimAction(action);

    try {
      const claim = this.repository.getClaimByNumber(
        identifier,
        access,
        normalizedAction,
      );

      return claim === null
        ? null
        : this.createClaimDto(claim, access);
    } catch (error) {
      throw normalizeLookupFailure(error, 'Claim resolution');
    }
  }

  /**
   * Returns local member and claim autocomplete suggestions.
   *
   * @param {string|Record<string, unknown>} input Autocomplete input.
   * @param {Record<string, unknown>} [context] Access context.
   * @returns {Readonly<Record<string, unknown>>} Autocomplete result.
   */
  autocomplete(input, context = undefined) {
    this.ensureActive();
    const normalizedInput = normalizeAutocompleteInput(
      input,
      this.defaults,
    );
    const access = this.resolveContext(
      context ?? (isPlainObject(input) ? input.context : undefined),
    );

    if (
      normalizedInput.query.length <
      normalizedInput.minimumCharacters
    ) {
      return createEmptyAutocompleteResult(
        normalizedInput.query,
        normalizedInput.minimumCharacters,
        false,
      );
    }

    const memberResult = normalizedInput.entityTypes.includes(
      DISCOVERY_ENTITY_TYPES.MEMBER,
    )
      ? this.searchMembers(
          {
            query: normalizedInput.query,
            page: 1,
            limit: normalizedInput.limit,
          },
          access,
        )
      : null;
    const claimResult = normalizedInput.entityTypes.includes(
      DISCOVERY_ENTITY_TYPES.CLAIM,
    )
      ? this.searchClaims(
          {
            query: normalizedInput.query,
            page: 1,
            limit: normalizedInput.limit,
          },
          access,
        )
      : null;
    const memberItems =
      memberResult?.items.map(createAutocompleteItem) ?? [];
    const claimItems =
      claimResult?.items.map(createAutocompleteItem) ?? [];
    const items = [...memberItems, ...claimItems]
      .sort((left, right) => {
        const labelComparison = left.label.localeCompare(
          right.label,
          'en-US',
          { sensitivity: 'base' },
        );

        return labelComparison !== 0
          ? labelComparison
          : left.entityType.localeCompare(
              right.entityType,
              'en-US',
            );
      })
      .slice(0, normalizedInput.limit);

    return deepFreeze({
      schemaVersion: DISCOVERY_SERVICE_SCHEMA_VERSION,
      query: normalizedInput.query,
      minimumCharacters: normalizedInput.minimumCharacters,
      eligible: true,
      cancelled: false,
      items,
      memberCount: memberItems.length,
      claimCount: claimItems.length,
    });
  }

  /**
   * Creates a debounced autocomplete function.
   *
   * Superseded calls resolve with an empty result marked as cancelled so every
   * returned promise settles without producing stale suggestions.
   *
   * @param {{delayMs?: number, context?: Record<string, unknown>}} [options]
   * Source options.
   * @returns {Function} Debounced autocomplete source.
   */
  createAutocompleteSource(options = {}) {
    this.ensureActive();

    if (!isPlainObject(options)) {
      throw new DiscoveryServiceError(
        DISCOVERY_SERVICE_ERROR_CODES.INVALID_OPTIONS,
        'Autocomplete source options must be a plain object.',
      );
    }

    const delayMs = requireNonNegativeNumber(
      options.delayMs,
      this.defaults.debounceMs,
      'Autocomplete debounce delay',
    );
    const defaultContext = options.context;
    let timer = null;
    let pendingResolve = null;
    let pendingInput = null;
    let disposed = false;

    const cancelPending = () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
      }

      if (pendingResolve !== null) {
        const normalized = normalizeAutocompleteInput(
          pendingInput,
          this.defaults,
        );

        pendingResolve(
          createEmptyAutocompleteResult(
            normalized.query,
            normalized.minimumCharacters,
            true,
          ),
        );
      }

      pendingResolve = null;
      pendingInput = null;
    };

    const source = (input, context = defaultContext) => {
      if (disposed || this.destroyed) {
        return Promise.reject(
          new DiscoveryServiceError(
            DISCOVERY_SERVICE_ERROR_CODES.SERVICE_DESTROYED,
            'Autocomplete source is no longer active.',
          ),
        );
      }

      cancelPending();
      pendingInput = input;

      return new Promise((resolve, reject) => {
        pendingResolve = resolve;
        timer = globalThis.setTimeout(() => {
          timer = null;
          pendingResolve = null;
          pendingInput = null;

          try {
            resolve(this.autocomplete(input, context));
          } catch (error) {
            reject(
              normalizeLookupFailure(error, 'Autocomplete search'),
            );
          }
        }, delayMs);
      });
    };

    source.cancel = () => {
      const hadPending = timer !== null || pendingResolve !== null;
      cancelPending();
      return hadPending;
    };

    source.dispose = () => {
      if (disposed) {
        return;
      }

      disposed = true;
      cancelPending();
      this.autocompleteSources.delete(source);
    };

    this.autocompleteSources.add(source);
    return source;
  }

  getMemberById(memberId, context = undefined) {
    return this.resolveMember(memberId, context);
  }

  getClaimByNumber(
    claimNumber,
    context = undefined,
    action = 'CLAIM_VIEW',
  ) {
    return this.resolveClaim(claimNumber, context, action);
  }

  findMember(memberId, context = undefined) {
    return this.resolveMember(memberId, context);
  }

  findClaim(
    claimNumber,
    context = undefined,
    action = 'CLAIM_VIEW',
  ) {
    return this.resolveClaim(claimNumber, context, action);
  }

  suggest(input, context = undefined) {
    return this.autocomplete(input, context);
  }

  createDebouncedAutocompleteSource(options = {}) {
    return this.createAutocompleteSource(options);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    [...this.autocompleteSources].forEach((source) => {
      source.dispose();
    });
    this.autocompleteSources.clear();
    this.destroyed = true;
  }
}

/**
 * Creates a local member and claim discovery service.
 *
 * @param {ConstructorParameters<typeof DiscoveryService>[0]}
 * repositoryOrOptions Fixture repository or service options.
 * @param {ConstructorParameters<typeof DiscoveryService>[1]} [options]
 * Service options.
 * @returns {DiscoveryService} Discovery service.
 */
export function createDiscoveryService(
  repositoryOrOptions,
  options = {},
) {
  return new DiscoveryService(repositoryOrOptions, options);
}

export const MemberClaimDiscoveryService = DiscoveryService;
export const LocalDiscoveryService = DiscoveryService;
export const createMemberClaimDiscoveryService =
  createDiscoveryService;
export const createLocalDiscoveryService = createDiscoveryService;

export default DiscoveryService;