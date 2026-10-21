import { COMPLIANCE_STATUS_FIXTURE } from '../../fixtures/insights.js';
import { ACTIONS } from '../contracts/capabilities.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';

export const COMPLIANCE_FACADE_SCHEMA_VERSION = 1;

export const COMPLIANCE_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  STATUS_FAILED: 'STATUS_FAILED',
  INVALID_STATUS: 'INVALID_STATUS',
  CERTIFICATION_CLAIMED: 'CERTIFICATION_CLAIMED',
});

export const COMPLIANCE_SECTIONS = Object.freeze({
  IMPLEMENTED_DEMO_BEHAVIOR: 'implementedDemoBehavior',
  PRODUCTION_ONLY_NOT_PROVIDED: 'productionOnlyNotProvided',
});

export const COMPLIANCE_DISCLOSURE =
  'This static demonstration does not provide production authorization, certification, secure server storage, or disaster recovery.';

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

function isComplianceRepository(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof value.getComplianceStatus === 'function' ||
      typeof value.getCompliance === 'function')
  );
}

function requirePermissionService(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.evaluate !== 'function'
  ) {
    throw new ComplianceFacadeError(
      COMPLIANCE_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Compliance facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.insightsRepository !== undefined ||
      repositoryOrOptions.permissionService !== undefined) &&
    !isComplianceRepository(repositoryOrOptions)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.insightsRepository ??
        null,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions ?? null,
    options: isPlainObject(options) ? options : {},
  };
}

function createCorrelationId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Compliance facade ID generator must return a non-empty string.',
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
      schemaVersion: COMPLIANCE_FACADE_SCHEMA_VERSION,
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
      fieldErrors: [],
      retryable: options.retryable === true,
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
    },
  });
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
      ? COMPLIANCE_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : COMPLIANCE_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : 'Compliance status is available to signed-in internal demo roles.',
    correlationId,
    {
      details: {
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function isNonEmptyStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'string' && item.trim().length > 0,
    )
  );
}

/**
 * Determines whether a value satisfies the honest compliance-status contract.
 *
 * Certification claims are prohibited. The contract requires an explicit
 * distinction between implemented demonstration behavior and production-only
 * controls that are not provided.
 *
 * @param {unknown} value Candidate compliance status.
 * @returns {boolean} Whether the status satisfies the contract.
 */
export function isComplianceStatus(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isNonEmptyStringArray(value.implementedDemoBehavior) &&
    isNonEmptyStringArray(value.productionOnlyNotProvided) &&
    isNonEmptyStringArray(value.identityContext) &&
    Array.isArray(value.certificationsClaimed) &&
    value.certificationsClaimed.length === 0 &&
    typeof value.disclosure === 'string' &&
    value.disclosure.trim().length > 0
  );
}

function normalizeComplianceStatus(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new ComplianceFacadeError(
      COMPLIANCE_FACADE_ERROR_CODES.INVALID_STATUS,
      'Compliance status must be safe JSON-compatible data.',
    );
  }

  if (
    !Array.isArray(value.certificationsClaimed) ||
    value.certificationsClaimed.length > 0
  ) {
    throw new ComplianceFacadeError(
      COMPLIANCE_FACADE_ERROR_CODES.CERTIFICATION_CLAIMED,
      'The static demonstration must not claim certifications.',
    );
  }

  if (!isComplianceStatus(value)) {
    throw new ComplianceFacadeError(
      COMPLIANCE_FACADE_ERROR_CODES.INVALID_STATUS,
      'Compliance status does not satisfy the demonstration disclosure contract.',
    );
  }

  return deepFreeze({
    implementedDemoBehavior: value.implementedDemoBehavior,
    productionOnlyNotProvided:
      value.productionOnlyNotProvided,
    identityContext: value.identityContext,
    certificationsClaimed: [],
    disclosure: value.disclosure,
  });
}

function readComplianceStatus(repository) {
  if (repository === null) {
    return COMPLIANCE_STATUS_FIXTURE;
  }

  if (typeof repository.getComplianceStatus === 'function') {
    return repository.getComplianceStatus();
  }

  return repository.getCompliance();
}

function normalizeStatusFailure(error, correlationId) {
  const dependencyCode = getErrorCode(error);

  if (
    dependencyCode ===
    COMPLIANCE_FACADE_ERROR_CODES.CERTIFICATION_CLAIMED
  ) {
    return createFailure(
      500,
      COMPLIANCE_FACADE_ERROR_CODES.CERTIFICATION_CLAIMED,
      'The compliance fixture contains a prohibited certification claim.',
      correlationId,
    );
  }

  if (
    dependencyCode ===
    COMPLIANCE_FACADE_ERROR_CODES.INVALID_STATUS
  ) {
    return createFailure(
      500,
      COMPLIANCE_FACADE_ERROR_CODES.INVALID_STATUS,
      'The compliance status fixture is invalid.',
      correlationId,
    );
  }

  return createFailure(
    500,
    COMPLIANCE_FACADE_ERROR_CODES.STATUS_FAILED,
    'Compliance status could not be loaded.',
    correlationId,
    {
      details: {
        dependencyCode,
      },
    },
  );
}

/**
 * Error raised when compliance facade configuration or data is invalid.
 */
export class ComplianceFacadeError extends Error {
  /**
   * @param {string} code Stable facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ComplianceFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Permission-checked read facade for honest static compliance disclosures.
 *
 * The facade exposes implemented demonstration behaviors separately from
 * production-only controls that are not provided. It rejects any non-empty
 * certification claim.
 */
export class ComplianceFacade {
  /**
   * @param {object|Record<string, unknown>|null} repositoryOrOptions Insights
   * repository or facade options containing repository dependencies.
   * @param {{
   *   permissionService?: object,
   *   idGenerator?: () => string
   * }} [options] Facade options.
   */
  constructor(repositoryOrOptions = null, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );

    if (
      resolved.repository !== null &&
      !isComplianceRepository(resolved.repository)
    ) {
      throw new ComplianceFacadeError(
        COMPLIANCE_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Compliance facade repository must provide getComplianceStatus() or getCompliance().',
      );
    }

    this.repository = resolved.repository;
    this.permissionService = requirePermissionService(
      resolved.options.permissionService,
    );
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Compliance facade ID generator must be a function.',
      );
    }
  }

  async authorize(correlationId) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action: ACTIONS.COMPLIANCE_STATUS_VIEW,
          resource: {
            type: 'COMPLIANCE_STATUS',
            id: 'demo',
          },
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          COMPLIANCE_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Compliance permission evaluation could not be completed.',
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
   * Returns explicit implemented-demo and production-only compliance concepts.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getStatus() {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(correlationId);

    if (!authorization.allowed) {
      return authorization.failure;
    }

    try {
      const status = await readComplianceStatus(this.repository);
      const data = normalizeComplianceStatus(status);

      return createSuccess(200, data, correlationId);
    } catch (error) {
      return normalizeStatusFailure(error, correlationId);
    }
  }

  getComplianceStatus() {
    return this.getStatus();
  }

  getCompliance() {
    return this.getStatus();
  }

  read() {
    return this.getStatus();
  }
}

/**
 * Creates a permission-checked compliance status facade.
 *
 * @param {ConstructorParameters<typeof ComplianceFacade>[0]}
 * repositoryOrOptions Repository or facade options.
 * @param {ConstructorParameters<typeof ComplianceFacade>[1]} [options]
 * Facade options.
 * @returns {ComplianceFacade} Compliance facade.
 */
export function createComplianceFacade(
  repositoryOrOptions = null,
  options = {},
) {
  return new ComplianceFacade(repositoryOrOptions, options);
}

export const LocalComplianceFacade = ComplianceFacade;
export const HonestComplianceFacade = ComplianceFacade;
export const createLocalComplianceFacade =
  createComplianceFacade;
export const createHonestComplianceFacade =
  createComplianceFacade;
export const isComplianceStatusFixture = isComplianceStatus;

export default ComplianceFacade;