import { ACTIONS } from '../contracts/capabilities.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';

export const INSIGHTS_FACADE_SCHEMA_VERSION = 1;

export const INSIGHTS_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  CSR_DASHBOARD_FAILED: 'CSR_DASHBOARD_FAILED',
  EXECUTIVE_INSIGHTS_FAILED: 'EXECUTIVE_INSIGHTS_FAILED',
  PRODUCTIVITY_INSIGHTS_FAILED: 'PRODUCTIVITY_INSIGHTS_FAILED',
  INVALID_CSR_DASHBOARD: 'INVALID_CSR_DASHBOARD',
  INVALID_EXECUTIVE_INSIGHTS: 'INVALID_EXECUTIVE_INSIGHTS',
  INVALID_PRODUCTIVITY_INSIGHTS: 'INVALID_PRODUCTIVITY_INSIGHTS',
});

export const INSIGHTS_RESOURCE_TYPES = Object.freeze({
  CSR_DASHBOARD: 'CSR_DASHBOARD',
  EXECUTIVE_INSIGHTS: 'EXECUTIVE_INSIGHTS',
  PRODUCTIVITY_INSIGHTS: 'PRODUCTIVITY_INSIGHTS',
});

const PUBLISHED_CASE_SOURCE = 'PUBLISHED_DISPLAY_FIXTURE';
const MONTHLY_TREND_SOURCE = 'PRESENTATION_FIXTURE';
const EXECUTIVE_DISCLOSURE_PREFIX = 'Published display fixtures';
const PRODUCTIVITY_DISCLOSURE_PREFIX =
  'Published productivity fixtures';

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

function isInsightsRepository(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof value.getCsrDashboard === 'function' ||
      typeof value.getCsrInsights === 'function') &&
    (typeof value.getExecutiveInsights === 'function' ||
      typeof value.getExecutive === 'function') &&
    (typeof value.getProductivityInsights === 'function' ||
      typeof value.getProductivity === 'function')
  );
}

function requireInsightsRepository(value) {
  if (!isInsightsRepository(value)) {
    throw new InsightsFacadeError(
      INSIGHTS_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Insights facade requires a repository with CSR, executive, and productivity fixture operations.',
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
    throw new InsightsFacadeError(
      INSIGHTS_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Insights facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.insightsRepository !== undefined) &&
    !isInsightsRepository(repositoryOrOptions)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.insightsRepository,
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
      'Insights facade ID generator must return a non-empty string.',
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
      schemaVersion: INSIGHTS_FACADE_SCHEMA_VERSION,
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

function createAuthorizationFailure(
  decision,
  correlationId,
  forbiddenMessage,
) {
  const unauthenticated =
    decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
    decision?.reasonCode === 'SESSION_EXPIRED';

  return createFailure(
    unauthenticated ? 401 : 403,
    unauthenticated
      ? INSIGHTS_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : INSIGHTS_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : forbiddenMessage,
    correlationId,
    {
      details: {
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isJsonObject(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value)
  );
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString)
  );
}

function isChartPointCollection(value) {
  return (
    Array.isArray(value) &&
    value.every(isJsonObject)
  );
}

function isCsrKpis(value) {
  return (
    isJsonObject(value) &&
    isNonNegativeInteger(value.openRequests) &&
    isNonNegativeInteger(value.urgentRequests) &&
    isNonNegativeInteger(value.completedToday) &&
    isNonNegativeInteger(value.failedRequests) &&
    isFiniteNonNegativeNumber(value.averageProcessingMinutes) &&
    isFiniteNonNegativeNumber(value.targetProcessingMinutes) &&
    isNonNegativeInteger(value.representativeDownloads) &&
    value.simulated === true &&
    isNonEmptyString(value.asOf)
  );
}

function isCsrRequest(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.displayId) &&
    isNonEmptyString(value.claimNumber) &&
    isNonEmptyString(value.memberIdMasked) &&
    isNonEmptyString(value.memberName) &&
    isNonEmptyString(value.requestType) &&
    isNonEmptyString(value.priority) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.currentStep) &&
    isNonEmptyString(value.createdAt) &&
    value.representativeOnly === true
  );
}

function isCsrAlert(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.alertId) &&
    isNonEmptyString(value.severity) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.message) &&
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.createdAt) &&
    typeof value.acknowledged === 'boolean' &&
    value.simulated === true
  );
}

function isCsrRequestChart(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.xAxisLabel) &&
    isNonEmptyString(value.yAxisLabel) &&
    isStringArray(value.legends) &&
    isChartPointCollection(value.points) &&
    value.simulated === true
  );
}

/**
 * Determines whether a value satisfies the representative CSR dashboard
 * fixture contract.
 *
 * @param {unknown} value Candidate CSR dashboard.
 * @returns {boolean} Whether the dashboard is valid.
 */
export function isCsrDashboardFixture(value) {
  return (
    isJsonObject(value) &&
    value.simulated === true &&
    isNonEmptyString(value.asOf) &&
    isNonEmptyString(value.disclosure) &&
    isCsrKpis(value.kpis) &&
    Array.isArray(value.recentRequests) &&
    value.recentRequests.every(isCsrRequest) &&
    Array.isArray(value.alerts) &&
    value.alerts.every(isCsrAlert) &&
    isCsrRequestChart(value.requestChart)
  );
}

function isPublishedCaseA(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.caseId) &&
    value.label === 'Published Case A' &&
    value.leadTimeRange === '2–3 days' &&
    value.leadTimePoint === '2.5 days' &&
    value.target === '15 minutes' &&
    value.sourceType === PUBLISHED_CASE_SOURCE &&
    value.calculatedFromClaims === false
  );
}

function isErrorComparison(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.comparisonId) &&
    isNonEmptyString(value.label) &&
    isFiniteNonNegativeNumber(value.beforePercent) &&
    isFiniteNonNegativeNumber(value.afterPercent)
  );
}

function isPublishedCaseB(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.caseId) &&
    value.label === 'Published Case B' &&
    value.roiPercent === 1333 &&
    value.paybackMonths === 0.8 &&
    value.annualSavingsUsd === 10700000 &&
    value.speedMultiplier === 15.5 &&
    value.minutesBefore === 240 &&
    value.minutesAfter === 15.5 &&
    value.staffBefore === 25 &&
    value.staffAfter === 5 &&
    Array.isArray(value.errorComparisons) &&
    value.errorComparisons.length === 2 &&
    value.errorComparisons.every(isErrorComparison) &&
    value.sourceType === PUBLISHED_CASE_SOURCE &&
    value.calculatedFromClaims === false
  );
}

function isMonthlyTrendPoint(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.month) &&
    isFiniteNonNegativeNumber(value.volume) &&
    isFiniteNonNegativeNumber(value.savings)
  );
}

function isMonthlyTrend(value) {
  return (
    isJsonObject(value) &&
    Array.isArray(value.legends) &&
    value.legends.length === 2 &&
    value.legends[0] === 'Volume (k)' &&
    value.legends[1] === 'Savings ($M)' &&
    Array.isArray(value.points) &&
    value.points.length === 12 &&
    value.points.every(isMonthlyTrendPoint) &&
    value.sourceType === MONTHLY_TREND_SOURCE
  );
}

/**
 * Determines whether a value satisfies the immutable published executive
 * fixture contract.
 *
 * @param {unknown} value Candidate executive fixture.
 * @returns {boolean} Whether the fixture is valid.
 */
export function isExecutiveInsightsFixture(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.fixtureVersion) &&
    isPublishedCaseA(value.caseA) &&
    isPublishedCaseB(value.caseB) &&
    isMonthlyTrend(value.monthlyTrend) &&
    isNonEmptyString(value.disclosure) &&
    value.disclosure.startsWith(EXECUTIVE_DISCLOSURE_PREFIX)
  );
}

function isProductivityStep(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.step) &&
    isNonEmptyString(value.label) &&
    isFiniteNonNegativeNumber(value.printedMinutes)
  );
}

function isProductivityPhase(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.label) &&
    isFiniteNonNegativeNumber(value.totalMinutes) &&
    isNonNegativeInteger(value.staffCount) &&
    Array.isArray(value.steps) &&
    value.steps.length > 0 &&
    value.steps.every(isProductivityStep)
  );
}

function isProductivityErrorPoint(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.label) &&
    isFiniteNonNegativeNumber(value.beforePercent) &&
    isFiniteNonNegativeNumber(value.afterPercent)
  );
}

function isProductivityCallout(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.calloutId) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.before) &&
    isNonEmptyString(value.after) &&
    isNonEmptyString(value.change)
  );
}

/**
 * Determines whether a value satisfies the immutable published productivity
 * fixture contract.
 *
 * Published values are validated as supplied and are never recomputed from
 * claims or operational records.
 *
 * @param {unknown} value Candidate productivity fixture.
 * @returns {boolean} Whether the fixture is valid.
 */
export function isProductivityInsightsFixture(value) {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.fixtureVersion) &&
    isProductivityPhase(value.before) &&
    value.before.totalMinutes === 240 &&
    value.before.staffCount === 25 &&
    isProductivityPhase(value.after) &&
    value.after.totalMinutes === 15.5 &&
    value.after.staffCount === 5 &&
    value.printedMinuteTotal === 15.5 &&
    isJsonObject(value.footer) &&
    value.footer.annualSavingsUsd === 10700000 &&
    value.footer.roiPercent === 1333 &&
    value.footer.paybackMonths === 0.8 &&
    value.footer.speedMultiplier === 15.5 &&
    Array.isArray(value.errorPoints) &&
    value.errorPoints.length === 2 &&
    value.errorPoints.every(isProductivityErrorPoint) &&
    Array.isArray(value.comparisonCallouts) &&
    value.comparisonCallouts.length > 0 &&
    value.comparisonCallouts.every(isProductivityCallout) &&
    isNonEmptyString(value.disclosure) &&
    value.disclosure.startsWith(PRODUCTIVITY_DISCLOSURE_PREFIX)
  );
}

function normalizeCsrDashboard(value) {
  if (!isCsrDashboardFixture(value)) {
    throw new InsightsFacadeError(
      INSIGHTS_FACADE_ERROR_CODES.INVALID_CSR_DASHBOARD,
      'CSR dashboard data does not satisfy the representative fixture contract.',
    );
  }

  return deepFreeze(value);
}

function normalizeExecutiveInsights(value) {
  if (!isExecutiveInsightsFixture(value)) {
    throw new InsightsFacadeError(
      INSIGHTS_FACADE_ERROR_CODES.INVALID_EXECUTIVE_INSIGHTS,
      'Executive insight data does not satisfy the published fixture contract.',
    );
  }

  return deepFreeze(value);
}

function normalizeProductivityInsights(value) {
  if (!isProductivityInsightsFixture(value)) {
    throw new InsightsFacadeError(
      INSIGHTS_FACADE_ERROR_CODES.INVALID_PRODUCTIVITY_INSIGHTS,
      'Productivity insight data does not satisfy the published fixture contract.',
    );
  }

  return deepFreeze(value);
}

function readCsrDashboard(repository) {
  return typeof repository.getCsrDashboard === 'function'
    ? repository.getCsrDashboard()
    : repository.getCsrInsights();
}

function readExecutiveInsights(repository) {
  return typeof repository.getExecutiveInsights === 'function'
    ? repository.getExecutiveInsights()
    : repository.getExecutive();
}

function readProductivityInsights(repository) {
  return typeof repository.getProductivityInsights === 'function'
    ? repository.getProductivityInsights()
    : repository.getProductivity();
}

function normalizeReadFailure(
  error,
  invalidCode,
  failedCode,
  invalidMessage,
  failedMessage,
  correlationId,
) {
  const dependencyCode = getErrorCode(error);

  if (dependencyCode === invalidCode) {
    return createFailure(
      500,
      invalidCode,
      invalidMessage,
      correlationId,
    );
  }

  return createFailure(
    500,
    failedCode,
    failedMessage,
    correlationId,
    {
      details: {
        dependencyCode,
      },
    },
  );
}

/**
 * Error raised when insights facade configuration or fixture data is invalid.
 */
export class InsightsFacadeError extends Error {
  /**
   * @param {string} code Stable facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'InsightsFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Permission-checked read facade for representative CSR and immutable
 * published insight fixtures.
 *
 * Executive and productivity values are returned exactly as supplied by the
 * fixture repository. No claim or operational record is used to derive them.
 */
export class InsightsFacade {
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

    this.repository = requireInsightsRepository(
      resolved.repository,
    );
    this.permissionService = requirePermissionService(
      resolved.options.permissionService,
    );
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Insights facade ID generator must be a function.',
      );
    }
  }

  async authorize(
    action,
    resourceType,
    resourceId,
    correlationId,
    forbiddenMessage,
  ) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action,
          resource: {
            type: resourceType,
            id: resourceId,
          },
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          INSIGHTS_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Insights permission evaluation could not be completed.',
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
        forbiddenMessage,
      ),
    };
  }

  async readExecutive(correlationId) {
    const authorization = await this.authorize(
      ACTIONS.EXECUTIVE_INSIGHTS_VIEW,
      INSIGHTS_RESOURCE_TYPES.EXECUTIVE_INSIGHTS,
      'published',
      correlationId,
      'Executive insights are available to BOS and Admin demo roles.',
    );

    if (!authorization.allowed) {
      return {
        failure: authorization.failure,
      };
    }

    try {
      const value = await readExecutiveInsights(this.repository);

      return {
        data: normalizeExecutiveInsights(value),
      };
    } catch (error) {
      return {
        failure: normalizeReadFailure(
          error,
          INSIGHTS_FACADE_ERROR_CODES.INVALID_EXECUTIVE_INSIGHTS,
          INSIGHTS_FACADE_ERROR_CODES.EXECUTIVE_INSIGHTS_FAILED,
          'The published executive fixture is invalid.',
          'Published executive insights could not be loaded.',
          correlationId,
        ),
      };
    }
  }

  /**
   * Returns the representative CSR dashboard fixture.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getCsrDashboard() {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.OPERATIONAL_SUMMARY_VIEW,
      INSIGHTS_RESOURCE_TYPES.CSR_DASHBOARD,
      'representative',
      correlationId,
      'The representative operational summary is unavailable to the current demo role.',
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    try {
      const dashboard = normalizeCsrDashboard(
        await readCsrDashboard(this.repository),
      );

      return createSuccess(200, dashboard, correlationId);
    } catch (error) {
      return normalizeReadFailure(
        error,
        INSIGHTS_FACADE_ERROR_CODES.INVALID_CSR_DASHBOARD,
        INSIGHTS_FACADE_ERROR_CODES.CSR_DASHBOARD_FAILED,
        'The representative CSR dashboard fixture is invalid.',
        'The representative CSR dashboard could not be loaded.',
        correlationId,
      );
    }
  }

  /**
   * Returns all immutable published executive fixtures.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getExecutive() {
    const correlationId = createCorrelationId(this.idGenerator);
    const result = await this.readExecutive(correlationId);

    if (result.failure !== undefined) {
      return result.failure;
    }

    return createSuccess(200, result.data, correlationId);
  }

  /**
   * Returns published Case A without deriving values from claims.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getCaseA() {
    const correlationId = createCorrelationId(this.idGenerator);
    const result = await this.readExecutive(correlationId);

    if (result.failure !== undefined) {
      return result.failure;
    }

    return createSuccess(
      200,
      {
        caseA: result.data.caseA,
        fixtureVersion: result.data.fixtureVersion,
        disclosure: result.data.disclosure,
      },
      correlationId,
    );
  }

  /**
   * Returns published Case B without deriving values from claims.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getCaseB() {
    const correlationId = createCorrelationId(this.idGenerator);
    const result = await this.readExecutive(correlationId);

    if (result.failure !== undefined) {
      return result.failure;
    }

    return createSuccess(
      200,
      {
        caseB: result.data.caseB,
        fixtureVersion: result.data.fixtureVersion,
        disclosure: result.data.disclosure,
      },
      correlationId,
    );
  }

  /**
   * Returns both separately labeled published cases.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getPublishedCases() {
    const correlationId = createCorrelationId(this.idGenerator);
    const result = await this.readExecutive(correlationId);

    if (result.failure !== undefined) {
      return result.failure;
    }

    return createSuccess(
      200,
      {
        caseA: result.data.caseA,
        caseB: result.data.caseB,
        fixtureVersion: result.data.fixtureVersion,
        disclosure: result.data.disclosure,
      },
      correlationId,
    );
  }

  /**
   * Returns the immutable presentation-only monthly trend.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getMonthlyTrend() {
    const correlationId = createCorrelationId(this.idGenerator);
    const result = await this.readExecutive(correlationId);

    if (result.failure !== undefined) {
      return result.failure;
    }

    return createSuccess(
      200,
      {
        monthlyTrend: result.data.monthlyTrend,
        fixtureVersion: result.data.fixtureVersion,
        disclosure: result.data.disclosure,
      },
      correlationId,
    );
  }

  /**
   * Returns immutable published productivity fixtures.
   *
   * Values are passed through from the repository and are not recomputed from
   * claims, requests, pipeline runs, or other operational records.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getProductivity() {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.PRODUCTIVITY_INSIGHTS_VIEW,
      INSIGHTS_RESOURCE_TYPES.PRODUCTIVITY_INSIGHTS,
      'published',
      correlationId,
      'Productivity insights are available to BOS and Admin demo roles.',
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    try {
      const productivity = normalizeProductivityInsights(
        await readProductivityInsights(this.repository),
      );

      return createSuccess(200, productivity, correlationId);
    } catch (error) {
      return normalizeReadFailure(
        error,
        INSIGHTS_FACADE_ERROR_CODES.INVALID_PRODUCTIVITY_INSIGHTS,
        INSIGHTS_FACADE_ERROR_CODES.PRODUCTIVITY_INSIGHTS_FAILED,
        'The published productivity fixture is invalid.',
        'Published productivity insights could not be loaded.',
        correlationId,
      );
    }
  }

  getCsrInsights() {
    return this.getCsrDashboard();
  }

  getDashboard() {
    return this.getCsrDashboard();
  }

  getExecutiveInsights() {
    return this.getExecutive();
  }

  getExecutiveCaseA() {
    return this.getCaseA();
  }

  getExecutiveCaseB() {
    return this.getCaseB();
  }

  getExecutiveMonthlyTrend() {
    return this.getMonthlyTrend();
  }

  getProductivityInsights() {
    return this.getProductivity();
  }
}

/**
 * Creates a permission-checked insights facade.
 *
 * @param {ConstructorParameters<typeof InsightsFacade>[0]}
 * repositoryOrOptions Repository or facade options.
 * @param {ConstructorParameters<typeof InsightsFacade>[1]} [options]
 * Facade options.
 * @returns {InsightsFacade} Insights facade.
 */
export function createInsightsFacade(
  repositoryOrOptions,
  options = {},
) {
  return new InsightsFacade(repositoryOrOptions, options);
}

export const LocalInsightsFacade = InsightsFacade;
export const PublishedInsightsFacade = InsightsFacade;
export const createLocalInsightsFacade = createInsightsFacade;
export const createPublishedInsightsFacade =
  createInsightsFacade;
export const isCsrInsightsFixture = isCsrDashboardFixture;
export const isPublishedExecutiveInsights =
  isExecutiveInsightsFixture;
export const isPublishedProductivityInsights =
  isProductivityInsightsFixture;

export default InsightsFacade;