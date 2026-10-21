import { ACTIONS } from '../contracts/capabilities.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';

export const INTEGRATION_INVENTORY_FACADE_SCHEMA_VERSION = 1;

export const INTEGRATION_INVENTORY_FACADE_ERROR_CODES =
  Object.freeze({
    INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
    INVALID_REQUEST: 'INVALID_REQUEST',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
    ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
    INVENTORY_FAILED: 'INVENTORY_FAILED',
    INVALID_INVENTORY: 'INVALID_INVENTORY',
    UNSUPPORTED_LIVE_INTEGRATION:
      'UNSUPPORTED_LIVE_INTEGRATION',
  });

export const INTEGRATION_INVENTORY_DISCLOSURE =
  'No live connectivity is configured.';

const ALLOWED_QUERY_FIELDS = new Set([
  'layer',
  'connectionType',
  'query',
  'q',
  'search',
  'page',
  'limit',
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

function requireInventoryRepository(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (typeof value.listIntegrations !== 'function' &&
      typeof value.getIntegrationInventory !== 'function')
  ) {
    throw new IntegrationInventoryFacadeError(
      INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Integration inventory facade requires a repository with listIntegrations() or getIntegrationInventory().',
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
    throw new IntegrationInventoryFacadeError(
      INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Integration inventory facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.insightsRepository !== undefined ||
      repositoryOrOptions.integrationRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.insightsRepository ??
        repositoryOrOptions.integrationRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function createCorrelationId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Integration inventory facade ID generator must return a non-empty string.',
    );
  }

  return value.normalize('NFC').trim();
}

function createSuccess(status, data, correlationId) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      schemaVersion:
        INTEGRATION_INVENTORY_FACADE_SCHEMA_VERSION,
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
    },
  });
}

function createFieldError(field, code, message) {
  return {
    field,
    code,
    message,
  };
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function createAuthorizationFailure(decision, correlationId) {
  const unauthenticated =
    decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
    decision?.reasonCode === 'SESSION_EXPIRED';

  return createFailure(
    unauthenticated ? 401 : 403,
    unauthenticated
      ? INTEGRATION_INVENTORY_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : INTEGRATION_INVENTORY_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : 'Integration inventory is available to ITS and Admin demo roles.',
    correlationId,
    {
      details: {
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function normalizeQuery(input) {
  if (!isPlainObject(input) || !isJsonCompatible(input)) {
    return {
      value: null,
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Integration inventory query must be a safe object.',
        ),
      ],
    };
  }

  const errors = Object.keys(input)
    .filter((field) => !ALLOWED_QUERY_FIELDS.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Integration inventory query field ${field} is not supported.`,
      ),
    );
  const normalized = {};

  if (
    input.layer !== undefined &&
    input.layer !== null &&
    input.layer !== ''
  ) {
    if (
      typeof input.layer !== 'string' ||
      input.layer.trim().length === 0
    ) {
      errors.push(
        createFieldError(
          'layer',
          'INVALID_FILTER',
          'Integration layer must be a non-empty string.',
        ),
      );
    } else {
      normalized.layer = input.layer.trim().toUpperCase();
    }
  }

  if (
    input.connectionType !== undefined &&
    input.connectionType !== null &&
    input.connectionType !== ''
  ) {
    if (
      typeof input.connectionType !== 'string' ||
      input.connectionType.trim().length === 0
    ) {
      errors.push(
        createFieldError(
          'connectionType',
          'INVALID_FILTER',
          'Integration connection type must be a non-empty string.',
        ),
      );
    } else {
      normalized.connectionType = input.connectionType
        .trim()
        .toUpperCase();
    }
  }

  const searchValue = input.query ?? input.q ?? input.search;

  if (
    searchValue !== undefined &&
    searchValue !== null &&
    searchValue !== ''
  ) {
    if (
      typeof searchValue !== 'string' ||
      searchValue.trim().length === 0 ||
      searchValue.trim().length > 200
    ) {
      errors.push(
        createFieldError(
          'query',
          'INVALID_FILTER',
          'Integration search query must contain at most 200 characters.',
        ),
      );
    } else {
      normalized.query = searchValue.normalize('NFKC').trim();
    }
  }

  if (input.page !== undefined) {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      errors.push(
        createFieldError(
          'page',
          'OUT_OF_RANGE',
          'Integration inventory page must be a positive safe integer.',
        ),
      );
    } else {
      normalized.page = input.page;
    }
  }

  if (input.limit !== undefined) {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      errors.push(
        createFieldError(
          'limit',
          'OUT_OF_RANGE',
          'Integration inventory limit must be an integer between 1 and 100.',
        ),
      );
    } else {
      normalized.limit = input.limit;
    }
  }

  return {
    value: normalized,
    errors,
  };
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' && item.trim().length > 0,
    )
  );
}

function isIntegrationRecord(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    typeof value.integrationId === 'string' &&
    value.integrationId.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.layer === 'string' &&
    value.layer.trim().length > 0 &&
    isStringArray(value.connectionTypes) &&
    typeof value.status === 'string' &&
    value.status.includes('Simulated') &&
    value.networkEnabled === false &&
    typeof value.description === 'string' &&
    value.description.trim().length > 0
  );
}

function normalizeInventoryResult(value) {
  if (
    !isPlainObject(value) ||
    !isJsonCompatible(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isIntegrationRecord) ||
    !isStringArray(value.layers) ||
    !isStringArray(value.connectionTypes) ||
    value.disclosure !== INTEGRATION_INVENTORY_DISCLOSURE ||
    value.simulated !== true
  ) {
    throw new IntegrationInventoryFacadeError(
      INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVALID_INVENTORY,
      'Integration inventory data does not satisfy the simulated inventory contract.',
    );
  }

  const integrationIds = value.items.map(
    (item) => item.integrationId,
  );

  if (
    new Set(integrationIds).size !== integrationIds.length ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    !Number.isSafeInteger(value.totalPages) ||
    value.totalPages < 0
  ) {
    throw new IntegrationInventoryFacadeError(
      INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVALID_INVENTORY,
      'Integration inventory pagination or identifiers are invalid.',
    );
  }

  return deepFreeze({
    ...value,
    disclosure: INTEGRATION_INVENTORY_DISCLOSURE,
    simulated: true,
  });
}

function listInventory(repository, input) {
  if (typeof repository.listIntegrations === 'function') {
    return repository.listIntegrations(input);
  }

  return repository.getIntegrationInventory(input);
}

function normalizeRepositoryFailure(error, correlationId) {
  const code = getErrorCode(error);

  switch (code) {
    case 'INVALID_QUERY':
    case 'INVALID_IDENTIFIER':
      return createFailure(
        422,
        INTEGRATION_INVENTORY_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Integration inventory query validation failed.',
        correlationId,
        {
          details: {
            dependencyCode: code,
            dependencyDetails:
              error !== null && typeof error === 'object'
                ? error.details ?? null
                : null,
          },
        },
      );
    case 'UNSUPPORTED_LIVE_INTEGRATION':
      return createFailure(
        422,
        INTEGRATION_INVENTORY_FACADE_ERROR_CODES.UNSUPPORTED_LIVE_INTEGRATION,
        'Live integration operations are not available in this static demonstration.',
        correlationId,
      );
    case 'INVALID_INVENTORY':
      return createFailure(
        500,
        INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVALID_INVENTORY,
        'The simulated integration inventory is unavailable.',
        correlationId,
      );
    default:
      return createFailure(
        500,
        INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVENTORY_FAILED,
        'The simulated integration inventory could not be loaded.',
        correlationId,
        {
          details: {
            dependencyCode: code,
          },
        },
      );
  }
}

/**
 * Error raised when integration inventory facade configuration or data is
 * invalid.
 */
export class IntegrationInventoryFacadeError extends Error {
  /**
   * @param {string} code Stable facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'IntegrationInventoryFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Permission-checked read facade for the exact simulated integration
 * inventory and architecture layers.
 */
export class IntegrationInventoryFacade {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Insights
   * repository or facade options containing repository dependencies.
   * @param {{
   *   permissionService?: object,
   *   idGenerator?: () => string
   * }} [options] Facade options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );

    this.repository = requireInventoryRepository(
      resolved.repository,
    );
    this.permissionService = requirePermissionService(
      resolved.options.permissionService,
    );
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Integration inventory facade ID generator must be a function.',
      );
    }
  }

  async authorize(correlationId) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action: ACTIONS.INTEGRATION_INVENTORY_VIEW,
          resource: {
            type: 'INTEGRATION_INVENTORY',
            id: 'simulated',
          },
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          INTEGRATION_INVENTORY_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Integration inventory permission evaluation could not be completed.',
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

    return {
      allowed: false,
      failure: createAuthorizationFailure(
        decision,
        correlationId,
      ),
    };
  }

  /**
   * Returns a filtered page of exact simulated integration records.
   *
   * @param {Record<string, unknown>} [input] Inventory filters.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async list(input = {}) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(correlationId);

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeQuery(input);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        INTEGRATION_INVENTORY_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Integration inventory query validation failed.',
        correlationId,
        {
          fieldErrors: normalized.errors,
        },
      );
    }

    try {
      const inventory = await listInventory(
        this.repository,
        normalized.value,
      );
      const data = normalizeInventoryResult(inventory);

      return createSuccess(200, data, correlationId);
    } catch (error) {
      return normalizeRepositoryFailure(error, correlationId);
    }
  }

  /**
   * Rejects attempts to establish live connectivity.
   *
   * @returns {never}
   */
  connect() {
    throw new IntegrationInventoryFacadeError(
      INTEGRATION_INVENTORY_FACADE_ERROR_CODES.UNSUPPORTED_LIVE_INTEGRATION,
      'Live integration operations are not available in this static demonstration.',
    );
  }

  getInventory(input = {}) {
    return this.list(input);
  }

  getIntegrationInventory(input = {}) {
    return this.list(input);
  }

  listIntegrations(input = {}) {
    return this.list(input);
  }
}

/**
 * Creates a permission-checked simulated integration inventory facade.
 *
 * @param {ConstructorParameters<typeof IntegrationInventoryFacade>[0]}
 * repositoryOrOptions Repository or facade options.
 * @param {ConstructorParameters<typeof IntegrationInventoryFacade>[1]}
 * [options] Facade options.
 * @returns {IntegrationInventoryFacade} Integration inventory facade.
 */
export function createIntegrationInventoryFacade(
  repositoryOrOptions,
  options = {},
) {
  return new IntegrationInventoryFacade(
    repositoryOrOptions,
    options,
  );
}

export const LocalIntegrationInventoryFacade =
  IntegrationInventoryFacade;
export const SimulatedIntegrationInventoryFacade =
  IntegrationInventoryFacade;
export const createLocalIntegrationInventoryFacade =
  createIntegrationInventoryFacade;
export const createSimulatedIntegrationInventoryFacade =
  createIntegrationInventoryFacade;

export default IntegrationInventoryFacade;