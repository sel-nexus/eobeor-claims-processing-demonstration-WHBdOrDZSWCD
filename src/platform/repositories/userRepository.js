import {
  isPlainObject,
  isUser,
  isUserCollection,
} from '../validation/schemas.js';
import { browserClock } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';

export const USER_REPOSITORY_SCHEMA_VERSION = 1;
export const USER_REPOSITORY_SLICE = 'users';
export const DEFAULT_USER_PAGE = 1;
export const DEFAULT_USER_LIMIT = 25;
export const MAXIMUM_USER_LIMIT = 100;

export const USER_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_USER: 'INVALID_USER',
  INVALID_USER_COLLECTION: 'INVALID_USER_COLLECTION',
  INVALID_USER_ID: 'INVALID_USER_ID',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_UPDATE: 'INVALID_UPDATE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USERNAME_EXISTS: 'USERNAME_EXISTS',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  INVALID_REVISION: 'INVALID_REVISION',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IMMUTABLE_FIELD: 'IMMUTABLE_FIELD',
  SYSTEM_USER_PROTECTED: 'SYSTEM_USER_PROTECTED',
});

const USER_UPDATE_FIELDS = new Set([
  'username',
  'displayName',
  'role',
  'memberId',
  'active',
]);

const IMMUTABLE_USER_FIELDS = new Set([
  'userId',
  'systemSeed',
  'createdAt',
  'revision',
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

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'User repository requires a storage gateway with read() and commit().',
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
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_USER_ID,
      `${name} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function requireRevision(value, name = 'Expected revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_REVISION,
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
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'User query pagination values are outside the supported range.',
      {
        value,
        maximum: maximum ?? null,
      },
    );
  }

  return value;
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : value;
}

function normalizeUsername(value) {
  return typeof value === 'string'
    ? normalizeText(value).toLowerCase()
    : value;
}

function normalizeUser(value) {
  if (!isPlainObject(value)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_USER,
      'User must be a plain object.',
    );
  }

  const normalized = {
    ...value,
    userId: normalizeText(value.userId),
    username: normalizeUsername(value.username),
    displayName: normalizeText(value.displayName),
    role:
      typeof value.role === 'string'
        ? value.role.trim().toUpperCase()
        : value.role,
    memberId:
      typeof value.memberId === 'string'
        ? normalizeText(value.memberId)
        : value.memberId,
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
  };

  if (!isUser(normalized)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_USER,
      'User does not satisfy its schema.',
    );
  }

  return deepFreeze(normalized);
}

function normalizeUserCollection(value) {
  if (!Array.isArray(value)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_USER_COLLECTION,
      'User collection must be an array.',
    );
  }

  const users = value.map(normalizeUser);

  if (!isUserCollection(users)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_USER_COLLECTION,
      'User collection does not satisfy its schema or contains duplicate identifiers.',
    );
  }

  return users;
}

function readUsers(envelope, sliceName) {
  if (envelope === null) {
    return Object.freeze([]);
  }

  const users = isPlainObject(envelope.slices)
    ? envelope.slices[sliceName]
    : undefined;

  if (users === undefined) {
    return Object.freeze([]);
  }

  if (!isUserCollection(users)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_USER_COLLECTION,
      'Persisted users do not satisfy their schema.',
      { sliceName },
    );
  }

  return deepFreeze(users);
}

function buildNextState(envelope, sliceName, users) {
  const currentSlices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...currentSlices,
      [sliceName]: users,
    },
  };
}

function findUserIndex(users, userId) {
  return users.findIndex((user) => user.userId === userId);
}

function findUsernameOwner(users, username, excludedUserId = null) {
  const normalizedUsername = normalizeUsername(username);

  return users.find(
    (user) =>
      user.userId !== excludedUserId &&
      user.username.toLowerCase() === normalizedUsername,
  );
}

function requireUniqueUsername(
  users,
  username,
  excludedUserId = null,
) {
  const owner = findUsernameOwner(
    users,
    username,
    excludedUserId,
  );

  if (owner !== undefined) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.USERNAME_EXISTS,
      'A user with this username already exists.',
      {
        username: normalizeUsername(username),
        userId: owner.userId,
      },
    );
  }
}

function requireExpectedEntityRevision(options) {
  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'User mutation options must be an object or revision.',
    );
  }

  if (
    options.expectedRevision === undefined ||
    options.expectedRevision === null
  ) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
      'Expected user revision is required.',
    );
  }

  return requireRevision(options.expectedRevision);
}

function resolveExpectedRootRevision(options, currentRevision) {
  if (!isPlainObject(options)) {
    return currentRevision;
  }

  const expectedRootRevision =
    options.expectedRootRevision ??
    options.rootRevision;

  if (
    expectedRootRevision === undefined ||
    expectedRootRevision === null
  ) {
    return currentRevision;
  }

  const normalized = requireRevision(
    expectedRootRevision,
    'Expected root revision',
  );

  if (normalized !== currentRevision) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted users changed before the mutation.',
      {
        expectedRevision: normalized,
        actualRevision: currentRevision,
      },
    );
  }

  return normalized;
}

function assertEntityRevision(user, expectedRevision) {
  if (user.revision !== expectedRevision) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'User changed before the mutation.',
      {
        userId: user.userId,
        expectedRevision,
        actualRevision: user.revision,
      },
    );
  }
}

function normalizeUpdate(changes) {
  if (!isPlainObject(changes)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'User changes must be a plain object.',
    );
  }

  const keys = Object.keys(changes);

  if (keys.length === 0) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'User changes must include at least one editable field.',
    );
  }

  keys.forEach((key) => {
    if (IMMUTABLE_USER_FIELDS.has(key)) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.IMMUTABLE_FIELD,
        `User field ${key} is immutable.`,
        { field: key },
      );
    }

    if (!USER_UPDATE_FIELDS.has(key)) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
        `User field ${key} cannot be updated.`,
        { field: key },
      );
    }
  });

  const normalized = { ...changes };

  if (Object.prototype.hasOwnProperty.call(normalized, 'username')) {
    normalized.username = normalizeUsername(normalized.username);
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'displayName')) {
    normalized.displayName = normalizeText(normalized.displayName);
  }

  if (
    Object.prototype.hasOwnProperty.call(normalized, 'role') &&
    typeof normalized.role === 'string'
  ) {
    normalized.role = normalized.role.trim().toUpperCase();
  }

  if (
    Object.prototype.hasOwnProperty.call(normalized, 'memberId') &&
    typeof normalized.memberId === 'string'
  ) {
    normalized.memberId = normalizeText(normalized.memberId);
  }

  return normalized;
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
    'User repository clock must provide a valid current timestamp.',
  );
}

function createUserId(idGenerator) {
  const generated = idGenerator();

  if (typeof generated !== 'string' || generated.trim().length === 0) {
    throw new TypeError(
      'User repository ID generator must return a non-empty string.',
    );
  }

  return generated.startsWith('usr_')
    ? generated
    : `usr_${generated}`;
}

function normalizeQuery(filters) {
  if (!isPlainObject(filters)) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'User query filters must be an object.',
    );
  }

  const page = requirePositiveInteger(
    filters.page,
    DEFAULT_USER_PAGE,
  );
  const limit = requirePositiveInteger(
    filters.limit,
    DEFAULT_USER_LIMIT,
    MAXIMUM_USER_LIMIT,
  );
  const role =
    filters.role === undefined ||
    filters.role === null ||
    filters.role === ''
      ? null
      : String(filters.role).trim().toUpperCase();
  const active =
    filters.active === undefined || filters.active === null
      ? null
      : filters.active;
  const searchValue = filters.query ?? filters.q ?? filters.search;
  const search =
    searchValue === undefined ||
    searchValue === null ||
    searchValue === ''
      ? null
      : normalizeText(searchValue).toLocaleLowerCase('en-US');

  if (
    active !== null &&
    typeof active !== 'boolean'
  ) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'User active filter must be a boolean.',
    );
  }

  if (search !== null && search.length === 0) {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'User search query must be a non-empty string.',
    );
  }

  const direction =
    typeof filters.direction === 'string'
      ? filters.direction.trim().toUpperCase()
      : 'ASC';

  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new UserRepositoryError(
      USER_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'User query direction must be ASC or DESC.',
    );
  }

  return {
    page,
    limit,
    role,
    active,
    search,
    direction,
  };
}

/**
 * Error raised when user repository data or operations are invalid.
 */
export class UserRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'UserRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Revision-safe repository for fictional browser-local users.
 */
export class UserRepository {
  /**
   * @param {object|Record<string, unknown>} gatewayOrOptions Storage gateway
   * or repository options containing `gateway` or `storageGateway`.
   * @param {{
   *   sliceName?: string,
   *   clock?: object|Function,
   *   idGenerator?: () => string
   * }} [options] Repository options.
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
        : USER_REPOSITORY_SLICE;
    this.clock = normalizedOptions.clock ?? browserClock;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'User repository ID generator must be a function.',
      );
    }
  }

  /**
   * Returns the current committed root revision.
   *
   * @returns {number} Root revision, or zero before the first commit.
   */
  getRevision() {
    return this.gateway.read()?.rootRevision ?? 0;
  }

  /**
   * Returns all users in persisted order.
   *
   * @returns {readonly Readonly<Record<string, unknown>>[]} Users.
   */
  getAll() {
    return readUsers(this.gateway.read(), this.sliceName);
  }

  /**
   * Returns a user by ID.
   *
   * @param {string} userId User identifier.
   * @returns {Readonly<Record<string, unknown>>|null} User or null.
   */
  getById(userId) {
    const normalizedId = requireNonEmptyString(userId, 'User ID');

    return (
      this.getAll().find((user) => user.userId === normalizedId) ??
      null
    );
  }

  /**
   * Returns a user by case-insensitive username.
   *
   * @param {string} username Username.
   * @returns {Readonly<Record<string, unknown>>|null} User or null.
   */
  getByUsername(username) {
    const normalizedUsername = normalizeUsername(
      requireNonEmptyString(username, 'Username'),
    );

    return (
      this.getAll().find(
        (user) =>
          user.username.toLowerCase() === normalizedUsername,
      ) ?? null
    );
  }

  /**
   * Returns a versioned repository snapshot.
   *
   * @returns {Readonly<Record<string, unknown>>} User snapshot.
   */
  getSnapshot() {
    const envelope = this.gateway.read();

    return deepFreeze({
      schemaVersion: USER_REPOSITORY_SCHEMA_VERSION,
      revision: envelope?.rootRevision ?? 0,
      users: readUsers(envelope, this.sliceName),
    });
  }

  /**
   * Queries users with case-insensitive search and bounded pagination.
   *
   * @param {{
   *   role?: string,
   *   active?: boolean,
   *   query?: string,
   *   page?: number,
   *   limit?: number,
   *   direction?: 'ASC'|'DESC'
   * }} [filters] Query filters.
   * @returns {Readonly<Record<string, unknown>>} Paged users.
   */
  query(filters = {}) {
    const query = normalizeQuery(filters);
    const envelope = this.gateway.read();
    const users = readUsers(envelope, this.sliceName)
      .filter((user) => {
        if (query.role !== null && user.role !== query.role) {
          return false;
        }

        if (
          query.active !== null &&
          user.active !== query.active
        ) {
          return false;
        }

        if (query.search !== null) {
          const searchable = [
            user.username,
            user.displayName,
            user.role,
            user.memberId ?? '',
          ]
            .join(' ')
            .toLocaleLowerCase('en-US');

          if (!searchable.includes(query.search)) {
            return false;
          }
        }

        return true;
      })
      .sort((left, right) => {
        const comparison = left.displayName.localeCompare(
          right.displayName,
          'en-US',
          { sensitivity: 'base' },
        );

        if (comparison !== 0) {
          return query.direction === 'ASC'
            ? comparison
            : -comparison;
        }

        const usernameComparison = left.username.localeCompare(
          right.username,
          'en-US',
          { sensitivity: 'base' },
        );

        return query.direction === 'ASC'
          ? usernameComparison
          : -usernameComparison;
      });
    const start = (query.page - 1) * query.limit;
    const items = users.slice(start, start + query.limit);

    return deepFreeze({
      items,
      page: query.page,
      limit: query.limit,
      total: users.length,
      totalPages:
        users.length === 0
          ? 0
          : Math.ceil(users.length / query.limit),
      revision: envelope?.rootRevision ?? 0,
    });
  }

  /**
   * Creates a fictional local user.
   *
   * Missing identifiers and timestamps are generated locally. CRUD-created
   * users cannot mark themselves as immutable seeded accounts.
   *
   * @param {Record<string, unknown>} value User data.
   * @param {{expectedRootRevision?: number}} [options] Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored user.
   */
  create(value, options = {}) {
    if (!isPlainObject(value)) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.INVALID_USER,
        'User must be a plain object.',
      );
    }

    if (value.systemSeed === true) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.SYSTEM_USER_PROTECTED,
        'Seeded users can only be installed through collection replacement.',
      );
    }

    const envelope = this.gateway.read();
    const currentRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      currentRevision,
    );
    const users = readUsers(envelope, this.sliceName);
    const timestamp = getCurrentTimestamp(this.clock);
    const user = normalizeUser({
      ...value,
      userId:
        value.userId === undefined
          ? createUserId(this.idGenerator)
          : value.userId,
      systemSeed: false,
      createdAt: value.createdAt ?? timestamp,
      updatedAt: value.updatedAt ?? timestamp,
      revision: 1,
    });

    if (findUserIndex(users, user.userId) !== -1) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.INVALID_USER,
        'A user with this identifier already exists.',
        { userId: user.userId },
      );
    }

    requireUniqueUsername(users, user.username);

    const nextUsers = [...users, user];
    const nextState = buildNextState(
      envelope,
      this.sliceName,
      nextUsers,
    );

    this.gateway.commit(
      expectedRootRevision,
      nextState,
      {},
    );

    return user;
  }

  /**
   * Updates editable user fields using entity and root revision validation.
   *
   * @param {string} userId User identifier.
   * @param {Record<string, unknown>} changes Editable changes.
   * @param {number|{expectedRevision: number, expectedRootRevision?: number}}
   * options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Updated user.
   */
  update(userId, changes, options = {}) {
    const normalizedId = requireNonEmptyString(userId, 'User ID');
    const expectedRevision = requireExpectedEntityRevision(options);
    const normalizedChanges = normalizeUpdate(changes);
    const envelope = this.gateway.read();
    const currentRootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      currentRootRevision,
    );
    const users = readUsers(envelope, this.sliceName);
    const index = findUserIndex(users, normalizedId);

    if (index === -1) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.USER_NOT_FOUND,
        'User was not found.',
        { userId: normalizedId },
      );
    }

    const current = users[index];

    assertEntityRevision(current, expectedRevision);

    if (normalizedChanges.username !== undefined) {
      requireUniqueUsername(
        users,
        normalizedChanges.username,
        current.userId,
      );
    }

    const updated = normalizeUser({
      ...current,
      ...normalizedChanges,
      userId: current.userId,
      systemSeed: current.systemSeed,
      createdAt: current.createdAt,
      updatedAt: getCurrentTimestamp(this.clock),
      revision: current.revision + 1,
    });
    const nextUsers = [...users];

    nextUsers[index] = updated;

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, nextUsers),
      {},
    );

    return updated;
  }

  /**
   * Deletes a non-seeded user using revision validation.
   *
   * @param {string} userId User identifier.
   * @param {number|{expectedRevision: number, expectedRootRevision?: number}}
   * options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Deleted-user metadata.
   */
  delete(userId, options = {}) {
    const normalizedId = requireNonEmptyString(userId, 'User ID');
    const expectedRevision = requireExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const currentRootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      currentRootRevision,
    );
    const users = readUsers(envelope, this.sliceName);
    const index = findUserIndex(users, normalizedId);

    if (index === -1) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.USER_NOT_FOUND,
        'User was not found.',
        { userId: normalizedId },
      );
    }

    const user = users[index];

    assertEntityRevision(user, expectedRevision);

    if (user.systemSeed) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.SYSTEM_USER_PROTECTED,
        'Seeded system users cannot be deleted.',
        { userId: user.userId },
      );
    }

    const nextUsers = users.filter(
      (candidate) => candidate.userId !== normalizedId,
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, nextUsers),
      {},
    );

    return deepFreeze({
      deletedUserId: user.userId,
      deletedRevision: user.revision,
    });
  }

  /**
   * Replaces all users using root revision validation.
   *
   * This operation is intended for validated fixture restore and snapshot
   * application workflows.
   *
   * @param {number|unknown[]} expectedRevisionOrUsers Root revision or users.
   * @param {unknown[]|{expectedRootRevision?: number}} [usersOrOptions] Users
   * or options.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Stored users.
   */
  replace(expectedRevisionOrUsers, usersOrOptions) {
    let expectedRootRevision;
    let replacementUsers;

    if (Array.isArray(expectedRevisionOrUsers)) {
      replacementUsers = expectedRevisionOrUsers;

      if (
        !isPlainObject(usersOrOptions) ||
        usersOrOptions.expectedRootRevision === undefined
      ) {
        throw new UserRepositoryError(
          USER_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
          'Expected root revision is required when replacing users.',
        );
      }

      expectedRootRevision = requireRevision(
        usersOrOptions.expectedRootRevision,
        'Expected root revision',
      );
    } else {
      expectedRootRevision = requireRevision(
        expectedRevisionOrUsers,
        'Expected root revision',
      );
      replacementUsers = usersOrOptions;
    }

    const users = normalizeUserCollection(replacementUsers);
    const envelope = this.gateway.read();
    const currentRevision = envelope?.rootRevision ?? 0;

    if (expectedRootRevision !== currentRevision) {
      throw new UserRepositoryError(
        USER_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
        'Persisted users changed before replacement.',
        {
          expectedRevision: expectedRootRevision,
          actualRevision: currentRevision,
        },
      );
    }

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, users),
      {},
    );

    return deepFreeze(users);
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
        'User repository listener must be a function.',
      );
    }

    if (typeof this.gateway.subscribe !== 'function') {
      return () => {};
    }

    return this.gateway.subscribe(listener);
  }

  list(filters = {}) {
    return this.query(filters);
  }

  findById(userId) {
    return this.getById(userId);
  }

  findByUsername(username) {
    return this.getByUsername(username);
  }

  createUser(value, options = {}) {
    return this.create(value, options);
  }

  updateUser(userId, changes, options = {}) {
    return this.update(userId, changes, options);
  }

  deleteUser(userId, options = {}) {
    return this.delete(userId, options);
  }

  replaceAll(expectedRevisionOrUsers, usersOrOptions) {
    return this.replace(
      expectedRevisionOrUsers,
      usersOrOptions,
    );
  }

  load() {
    return this.getSnapshot();
  }
}

/**
 * Creates a user repository.
 *
 * @param {ConstructorParameters<typeof UserRepository>[0]} gatewayOrOptions
 * Gateway or repository options.
 * @param {ConstructorParameters<typeof UserRepository>[1]} [options]
 * Repository options.
 * @returns {UserRepository} User repository.
 */
export function createUserRepository(
  gatewayOrOptions,
  options = {},
) {
  return new UserRepository(gatewayOrOptions, options);
}

export const LocalUserRepository = UserRepository;
export const PlatformUserRepository = UserRepository;
export const createLocalUserRepository = createUserRepository;

export default UserRepository;