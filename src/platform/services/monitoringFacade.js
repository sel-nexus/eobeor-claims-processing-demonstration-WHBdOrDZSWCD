import { ACTIONS } from '../contracts/capabilities.js';
import { timerRegistry } from './timerRegistry.js';
import { browserClock } from '../time/clock.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isMonitoringState,
  isPlainObject,
} from '../validation/schemas.js';

export const MONITORING_FACADE_SCHEMA_VERSION = 1;
export const MONITORING_REFRESH_INTERVAL_MS = 30_000;
export const MONITORING_DISCLOSURE =
  'Simulated fixture — no monitoring service is connected';

export const MONITORING_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  DASHBOARD_FAILED: 'DASHBOARD_FAILED',
  INVALID_DASHBOARD: 'INVALID_DASHBOARD',
  REFRESH_FAILED: 'REFRESH_FAILED',
  INVALID_REFRESH_INTERVAL: 'INVALID_REFRESH_INTERVAL',
  REFRESH_ALREADY_STOPPED: 'REFRESH_ALREADY_STOPPED',
  PREFERENCE_FAILED: 'PREFERENCE_FAILED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  LOCAL_STORAGE_QUOTA: 'LOCAL_STORAGE_QUOTA',
  READ_ONLY_RECOVERY: 'READ_ONLY_RECOVERY',
  FACADE_DESTROYED: 'FACADE_DESTROYED',
});

export const MONITORING_RESOURCE_STATUSES = Object.freeze({
  HEALTHY: 'HEALTHY',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
});

export const MONITORING_THRESHOLDS = Object.freeze({
  QUEUE_WARNING: 50,
  QUEUE_CRITICAL: 80,
  ERROR_RATE_WARNING_PERCENT: 1,
  ERROR_RATE_CRITICAL_PERCENT: 2,
});

const MAXIMUM_MONITORING_EVENTS = 500;
const MAXIMUM_MONITORING_ALERTS = 200;
const MAXIMUM_CHART_POINTS = 60;
const DEFAULT_TIMER_KEY = 'monitoring-facade-refresh';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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

function isMonitoringRepository(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof value.getMonitoringDashboard === 'function' ||
      typeof value.getMonitoring === 'function') &&
    (typeof value.updateMonitoring === 'function' ||
      typeof value.replaceMonitoring === 'function')
  );
}

function requireMonitoringRepository(value) {
  if (!isMonitoringRepository(value)) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Monitoring facade requires a repository with monitoring read and update operations.',
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
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Monitoring facade requires a permission service with evaluate().',
    );
  }

  return value;
}

function normalizePreferenceRepository(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const canRead =
    typeof value.get === 'function' ||
    typeof value.getPreferences === 'function' ||
    typeof value.getSnapshot === 'function';
  const canUpdate =
    typeof value.setMonitoringDarkMode === 'function' ||
    typeof value.update === 'function' ||
    typeof value.updatePreferences === 'function';

  if (
    value === null ||
    typeof value !== 'object' ||
    !canRead ||
    !canUpdate
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Monitoring facade UI preference repository must provide read and update operations.',
    );
  }

  return value;
}

function requireTimerRegistry(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.registerInterval !== 'function'
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      'Monitoring facade requires a timer registry with registerInterval().',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.insightsRepository !== undefined ||
      repositoryOrOptions.monitoringRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.insightsRepository ??
        repositoryOrOptions.monitoringRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function getCurrentDate(clock, value = undefined) {
  if (value !== undefined && value !== null) {
    const supplied =
      value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    if (!Number.isFinite(supplied.getTime())) {
      throw new MonitoringFacadeError(
        MONITORING_FACADE_ERROR_CODES.INVALID_REQUEST,
        'Monitoring evaluation time must be a valid date or timestamp.',
      );
    }

    return supplied;
  }

  let current;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    current = clock.now();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    current = clock.nowIso();
  } else if (typeof clock === 'function') {
    current = clock();
  } else {
    throw new TypeError(
      'Monitoring facade clock must provide now() or nowIso().',
    );
  }

  const date =
    current instanceof Date
      ? new Date(current.getTime())
      : new Date(current);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Monitoring facade clock must provide a valid timestamp.',
    );
  }

  return date;
}

function createCorrelationId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Monitoring facade ID generator must return a non-empty string.',
    );
  }

  return value.normalize('NFC').trim();
}

function createSuccess(
  status,
  data,
  correlationId,
  warnings = [],
) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      schemaVersion: MONITORING_FACADE_SCHEMA_VERSION,
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

function normalizePermissionDecision(value) {
  return isPlainObject(value?.data) ? value.data : value;
}

function createAuthorizationFailure(
  decision,
  correlationId,
  action,
) {
  const unauthenticated =
    decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
    decision?.reasonCode === 'SESSION_EXPIRED';

  return createFailure(
    unauthenticated ? 401 : 403,
    unauthenticated
      ? MONITORING_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : MONITORING_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : action === ACTIONS.MONITORING_PREFERENCE_UPDATE
        ? 'Monitoring preferences are available to ITS and Admin demo roles.'
        : 'Monitoring is available to ITS and Admin demo roles.',
    correlationId,
    {
      details: {
        action,
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function normalizeOperationFailure(
  error,
  fallbackCode,
  fallbackMessage,
  correlationId,
) {
  const code = getErrorCode(error);

  switch (code) {
    case 'REVISION_CONFLICT':
      return createFailure(
        409,
        MONITORING_FACADE_ERROR_CODES.REVISION_CONFLICT,
        'Local monitoring data changed before the operation completed.',
        correlationId,
        { retryable: true },
      );
    case 'STORAGE_QUOTA_EXCEEDED':
    case 'LOCAL_STORAGE_QUOTA':
      return createFailure(
        507,
        MONITORING_FACADE_ERROR_CODES.LOCAL_STORAGE_QUOTA,
        'Browser-local storage quota was exceeded.',
        correlationId,
        {
          recoveryAction: 'EXPORT_SNAPSHOT',
        },
      );
    case 'READ_ONLY_RECOVERY':
      return createFailure(
        409,
        MONITORING_FACADE_ERROR_CODES.READ_ONLY_RECOVERY,
        'Local demonstration data is in read-only recovery mode.',
        correlationId,
      );
    case 'INVALID_UPDATE':
    case 'INVALID_STATE':
    case 'INVALID_REVISION':
    case 'EXPECTED_REVISION_REQUIRED':
      return createFailure(
        422,
        MONITORING_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Monitoring data validation failed.',
        correlationId,
        {
          details: {
            dependencyCode: code,
          },
        },
      );
    default:
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
}

function normalizeDashboard(value) {
  if (
    !isMonitoringState(value) ||
    value.disclosure !== MONITORING_DISCLOSURE ||
    !isPlainObject(value.kpis) ||
    value.kpis.cdcStatusLabel !== 'CDC Healthy' ||
    !Array.isArray(value.syncLatency?.points) ||
    !Array.isArray(value.throughput?.bars) ||
    !Array.isArray(value.resourceGauges) ||
    !Array.isArray(value.diskTimeline)
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_DASHBOARD,
      'Monitoring data does not satisfy the simulated dashboard contract.',
    );
  }

  return deepFreeze(value);
}

function readMonitoring(repository) {
  return typeof repository.getMonitoringDashboard === 'function'
    ? repository.getMonitoringDashboard()
    : repository.getMonitoring();
}

function resolveMonitoringRevision(repository, dashboard) {
  if (typeof repository.getStateRevision === 'function') {
    const revision = repository.getStateRevision();

    if (Number.isSafeInteger(revision) && revision >= 0) {
      return revision;
    }
  }

  if (typeof repository.getSnapshot === 'function') {
    const snapshot = repository.getSnapshot();

    if (
      Number.isSafeInteger(snapshot?.stateRevision) &&
      snapshot.stateRevision >= 0
    ) {
      return snapshot.stateRevision;
    }

    if (
      Number.isSafeInteger(snapshot?.mutableState?.revision) &&
      snapshot.mutableState.revision >= 0
    ) {
      return snapshot.mutableState.revision;
    }
  }

  if (
    Number.isSafeInteger(dashboard?.revision) &&
    dashboard.revision >= 0
  ) {
    return dashboard.revision;
  }

  throw new MonitoringFacadeError(
    MONITORING_FACADE_ERROR_CODES.INVALID_DASHBOARD,
    'Monitoring repository revision is unavailable.',
  );
}

function updateMonitoring(
  repository,
  dashboard,
  expectedRevision,
  actorId,
) {
  const options = {
    expectedRevision,
    updatedBy: actorId ?? 'system',
  };

  return typeof repository.updateMonitoring === 'function'
    ? repository.updateMonitoring(dashboard, options)
    : repository.replaceMonitoring(dashboard, options);
}

function readPreferences(repository) {
  if (repository === null) {
    return null;
  }

  if (typeof repository.get === 'function') {
    return repository.get();
  }

  if (typeof repository.getPreferences === 'function') {
    return repository.getPreferences();
  }

  const snapshot = repository.getSnapshot();

  return snapshot?.preferences ?? snapshot;
}

function updateDarkModePreference(
  repository,
  enabled,
  options,
) {
  if (typeof repository.setMonitoringDarkMode === 'function') {
    return repository.setMonitoringDarkMode(enabled, options);
  }

  if (typeof repository.update === 'function') {
    return repository.update(
      { monitoringDarkMode: enabled },
      options,
    );
  }

  return repository.updatePreferences(
    { monitoringDarkMode: enabled },
    options,
  );
}

function normalizeDarkModeRequest(value) {
  if (typeof value === 'boolean') {
    return {
      enabled: value,
      expectedRevision: undefined,
      expectedRootRevision: undefined,
    };
  }

  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return null;
  }

  if (typeof value.enabled !== 'boolean') {
    return null;
  }

  if (
    value.expectedRevision !== undefined &&
    (!Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0)
  ) {
    return null;
  }

  if (
    value.expectedRootRevision !== undefined &&
    (!Number.isSafeInteger(value.expectedRootRevision) ||
      value.expectedRootRevision < 0)
  ) {
    return null;
  }

  return {
    enabled: value.enabled,
    expectedRevision: value.expectedRevision,
    expectedRootRevision: value.expectedRootRevision,
  };
}

function getDayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  return Math.floor((current - start) / MILLISECONDS_PER_DAY) + 1;
}

function createMulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;

    let value = state;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, decimalPlaces = 0) {
  const multiplier = 10 ** decimalPlaces;

  return Math.round(value * multiplier) / multiplier;
}

function randomInteger(random, minimum, maximum) {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function formatFixtureTime(date) {
  return [
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ].join(':');
}

function formatChartTime(date) {
  return [
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
  ].join(':');
}

function resolveResourceStatus(
  value,
  warningThreshold,
  criticalThreshold,
) {
  if (value >= criticalThreshold) {
    return MONITORING_RESOURCE_STATUSES.CRITICAL;
  }

  if (value >= warningThreshold) {
    return MONITORING_RESOURCE_STATUSES.WARNING;
  }

  return MONITORING_RESOURCE_STATUSES.HEALTHY;
}

function createPlaybackEvent(tick, date, kpis) {
  return {
    eventId: `MON-PLAYBACK-${String(tick).padStart(6, '0')}`,
    occurredAt: date.toISOString(),
    category: 'MONITORING',
    severity: 'INFO',
    title: 'Simulated monitoring interval advanced',
    message:
      `Local fixture tick ${tick} completed with queue depth ${kpis.queueDepth}.`,
    source: 'LOCAL_MONITORING_PLAYBACK',
    simulated: true,
  };
}

function createThresholdAlerts({
  tick,
  date,
  kpis,
  resourceGauges,
}) {
  const alerts = [];

  if (kpis.queueDepth >= MONITORING_THRESHOLDS.QUEUE_WARNING) {
    const critical =
      kpis.queueDepth >= MONITORING_THRESHOLDS.QUEUE_CRITICAL;

    alerts.push({
      alertId: `MON-PLAYBACK-QUEUE-${String(tick).padStart(6, '0')}`,
      createdAt: date.toISOString(),
      severity: critical ? 'ERROR' : 'WARNING',
      title: 'Simulated queue threshold reached',
      message:
        'The local demonstration queue crossed its fixture threshold.',
      metric: 'queueDepth',
      value: kpis.queueDepth,
      threshold: critical
        ? MONITORING_THRESHOLDS.QUEUE_CRITICAL
        : MONITORING_THRESHOLDS.QUEUE_WARNING,
      acknowledged: false,
      simulated: true,
    });
  }

  if (
    kpis.errorRatePercent >=
    MONITORING_THRESHOLDS.ERROR_RATE_WARNING_PERCENT
  ) {
    const critical =
      kpis.errorRatePercent >=
      MONITORING_THRESHOLDS.ERROR_RATE_CRITICAL_PERCENT;

    alerts.push({
      alertId: `MON-PLAYBACK-ERROR-RATE-${String(tick).padStart(6, '0')}`,
      createdAt: date.toISOString(),
      severity: critical ? 'ERROR' : 'WARNING',
      title: 'Simulated error-rate threshold reached',
      message:
        'The local fixture error rate crossed its demonstration threshold.',
      metric: 'errorRatePercent',
      value: kpis.errorRatePercent,
      threshold: critical
        ? MONITORING_THRESHOLDS.ERROR_RATE_CRITICAL_PERCENT
        : MONITORING_THRESHOLDS.ERROR_RATE_WARNING_PERCENT,
      acknowledged: false,
      simulated: true,
    });
  }

  resourceGauges.forEach((resource) => {
    if (
      resource.status === MONITORING_RESOURCE_STATUSES.HEALTHY
    ) {
      return;
    }

    alerts.push({
      alertId:
        `MON-PLAYBACK-${resource.resource.toUpperCase()}-${String(tick).padStart(6, '0')}`,
      createdAt: date.toISOString(),
      severity:
        resource.status === MONITORING_RESOURCE_STATUSES.CRITICAL
          ? 'ERROR'
          : 'WARNING',
      title: `${resource.resource} fixture threshold reached`,
      message:
        `Simulated ${resource.resource.toLowerCase()} usage crossed its demonstration threshold.`,
      metric: `${resource.resource.toLowerCase()}Percent`,
      value: resource.valuePercent,
      threshold:
        resource.status === MONITORING_RESOURCE_STATUSES.CRITICAL
          ? resource.criticalThresholdPercent
          : resource.warningThresholdPercent,
      acknowledged: false,
      simulated: true,
    });
  });

  return alerts;
}

function createNextDashboard(current, date) {
  const tick = current.tick + 1;
  const random = createMulberry32(getDayOfYear(date) + tick);
  const previousKpis = current.kpis;
  const kpis = {
    ...cloneMutable(previousKpis),
    cdcStatus: 'HEALTHY',
    cdcStatusLabel: 'CDC Healthy',
    uptimePercent: round(
      clamp(
        previousKpis.uptimePercent +
          (random() - 0.5) * 0.04,
        99.5,
        100,
      ),
      2,
    ),
    activeConnections: clamp(
      previousKpis.activeConnections +
        randomInteger(random, -18, 18),
      1000,
      1500,
    ),
    queueDepth: clamp(
      previousKpis.queueDepth +
        randomInteger(random, -5, 5),
      0,
      100,
    ),
    errorRatePercent: round(
      clamp(
        previousKpis.errorRatePercent +
          (random() - 0.5) * 0.2,
        0,
        2.5,
      ),
      1,
    ),
    fixtureTime: formatFixtureTime(date),
  };
  const pointTime = formatChartTime(date);
  const latencyValue = clamp(
    Math.round(
      current.syncLatency.points.at(-1)?.milliseconds +
        randomInteger(random, -18, 18),
    ),
    80,
    250,
  );
  const throughputValue = clamp(
    Math.round(
      current.throughput.bars.at(-1)?.records +
        randomInteger(random, -90, 90),
    ),
    650,
    1400,
  );
  const resourceGauges = current.resourceGauges.map(
    (resource) => {
      const valuePercent = clamp(
        resource.valuePercent +
          randomInteger(random, -3, 3),
        5,
        98,
      );

      return {
        ...cloneMutable(resource),
        valuePercent,
        status: resolveResourceStatus(
          valuePercent,
          resource.warningThresholdPercent,
          resource.criticalThresholdPercent,
        ),
      };
    },
  );
  const diskGauge = resourceGauges.find(
    (resource) => resource.resource === 'Disk',
  );
  const event = createPlaybackEvent(tick, date, kpis);
  const thresholdAlerts = createThresholdAlerts({
    tick,
    date,
    kpis,
    resourceGauges,
  });

  const next = {
    ...cloneMutable(current),
    simulated: true,
    tick,
    revision: current.revision + 1,
    asOf: date.toISOString(),
    disclosure: MONITORING_DISCLOSURE,
    kpis,
    syncLatency: {
      ...cloneMutable(current.syncLatency),
      points: [
        ...cloneMutable(current.syncLatency.points),
        {
          time: pointTime,
          milliseconds: latencyValue,
        },
      ].slice(-MAXIMUM_CHART_POINTS),
    },
    throughput: {
      ...cloneMutable(current.throughput),
      bars: [
        ...cloneMutable(current.throughput.bars),
        {
          interval: pointTime,
          records: throughputValue,
        },
      ].slice(-MAXIMUM_CHART_POINTS),
    },
    resourceGauges,
    diskTimeline: [
      ...cloneMutable(current.diskTimeline),
      {
        time: pointTime,
        usedPercent: diskGauge?.valuePercent ?? 0,
      },
    ].slice(-MAXIMUM_CHART_POINTS),
    events: [
      ...cloneMutable(current.events),
      event,
    ].slice(-MAXIMUM_MONITORING_EVENTS),
    alerts: [
      ...cloneMutable(current.alerts),
      ...thresholdAlerts,
    ].slice(-MAXIMUM_MONITORING_ALERTS),
  };

  return normalizeDashboard(next);
}

function normalizeRefreshOptions(value, minimumIntervalMs) {
  if (value === undefined) {
    return {
      intervalMs: MONITORING_REFRESH_INTERVAL_MS,
      timerKey: DEFAULT_TIMER_KEY,
      onTick: null,
      immediate: false,
    };
  }

  if (!isPlainObject(value)) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Monitoring refresh options must be a plain object.',
    );
  }

  const intervalMs =
    value.intervalMs ?? MONITORING_REFRESH_INTERVAL_MS;

  if (
    !Number.isFinite(intervalMs) ||
    intervalMs < minimumIntervalMs
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_REFRESH_INTERVAL,
      `Monitoring refresh interval must be at least ${minimumIntervalMs} milliseconds.`,
      {
        intervalMs,
        minimumIntervalMs,
      },
    );
  }

  const timerKey =
    value.timerKey === undefined
      ? DEFAULT_TIMER_KEY
      : value.timerKey;

  if (
    typeof timerKey !== 'string' ||
    timerKey.trim().length === 0 ||
    timerKey.trim().length > 200
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Monitoring refresh timer key must be a non-empty string of at most 200 characters.',
    );
  }

  if (
    value.onTick !== undefined &&
    typeof value.onTick !== 'function'
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Monitoring refresh onTick callback must be a function.',
    );
  }

  if (
    value.immediate !== undefined &&
    typeof value.immediate !== 'boolean'
  ) {
    throw new MonitoringFacadeError(
      MONITORING_FACADE_ERROR_CODES.INVALID_REQUEST,
      'Monitoring refresh immediate option must be a boolean.',
    );
  }

  return {
    intervalMs,
    timerKey: timerKey.normalize('NFC').trim(),
    onTick: value.onTick ?? null,
    immediate: value.immediate === true,
  };
}

/**
 * Error raised when monitoring facade configuration or data is invalid.
 */
export class MonitoringFacadeError extends Error {
  /**
   * @param {string} code Stable monitoring facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MonitoringFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Permission-checked deterministic local monitoring playback facade.
 */
export class MonitoringFacade {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Monitoring
   * repository or facade options containing repository dependencies.
   * @param {{
   *   permissionService?: object,
   *   preferenceRepository?: object,
   *   uiPreferenceRepository?: object,
   *   timerRegistry?: object,
   *   clock?: object|Function,
   *   idGenerator?: () => string,
   *   minimumRefreshIntervalMs?: number
   * }} [options] Facade options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );

    this.repository = requireMonitoringRepository(
      resolved.repository,
    );
    this.permissionService = requirePermissionService(
      resolved.options.permissionService,
    );
    this.preferenceRepository = normalizePreferenceRepository(
      resolved.options.preferenceRepository ??
        resolved.options.uiPreferenceRepository ??
        resolved.options.preferences,
    );
    this.timerRegistry = requireTimerRegistry(
      resolved.options.timerRegistry ?? timerRegistry,
    );
    this.clock = resolved.options.clock ?? browserClock;
    this.idGenerator =
      resolved.options.idGenerator ?? generateUuid;
    this.minimumRefreshIntervalMs =
      Number.isFinite(
        resolved.options.minimumRefreshIntervalMs,
      ) &&
      resolved.options.minimumRefreshIntervalMs >= 0
        ? resolved.options.minimumRefreshIntervalMs
        : MONITORING_REFRESH_INTERVAL_MS;
    this.refreshCancellation = null;
    this.refreshTimerKey = null;
    this.destroyed = false;

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Monitoring facade ID generator must be a function.',
      );
    }
  }

  ensureActive() {
    if (this.destroyed) {
      throw new MonitoringFacadeError(
        MONITORING_FACADE_ERROR_CODES.FACADE_DESTROYED,
        'Monitoring facade has been destroyed.',
      );
    }
  }

  async authorize(action, correlationId) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action,
          resource: {
            type: 'MONITORING_DASHBOARD',
            id: 'simulated',
          },
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          MONITORING_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Monitoring permission evaluation could not be completed.',
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
        action,
      ),
    };
  }

  /**
   * Returns the current simulated monitoring dashboard.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getDashboard() {
    this.ensureActive();

    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.MONITORING_VIEW,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    try {
      const dashboard = normalizeDashboard(
        await readMonitoring(this.repository),
      );
      const preferences = readPreferences(
        this.preferenceRepository,
      );
      const monitoringDarkMode =
        preferences?.monitoringDarkMode === true ||
        preferences?.monitoring?.monitoringDarkMode === true;

      return createSuccess(
        200,
        {
          ...dashboard,
          monitoringDarkMode,
        },
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        MONITORING_FACADE_ERROR_CODES.DASHBOARD_FAILED,
        'The simulated monitoring dashboard could not be loaded.',
        correlationId,
      );
    }
  }

  /**
   * Advances deterministic monitoring playback by one interval.
   *
   * @param {Date|string|number} [now] Optional playback timestamp.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async refreshOnce(now = undefined) {
    this.ensureActive();

    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.MONITORING_VIEW,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    try {
      const current = normalizeDashboard(
        await readMonitoring(this.repository),
      );
      const expectedRevision = resolveMonitoringRevision(
        this.repository,
        current,
      );
      const next = createNextDashboard(
        current,
        getCurrentDate(this.clock, now),
      );
      const stored = await updateMonitoring(
        this.repository,
        next,
        expectedRevision,
        authorization.decision?.userId ?? null,
      );
      const dashboard = normalizeDashboard(stored ?? next);

      return createSuccess(
        200,
        {
          dashboard,
          tick: dashboard.tick,
          appendedEvent:
            dashboard.events.at(-1) ?? null,
          newAlerts: dashboard.alerts.filter(
            (alert) =>
              alert.alertId.endsWith(
                String(dashboard.tick).padStart(6, '0'),
              ),
          ),
        },
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        MONITORING_FACADE_ERROR_CODES.REFRESH_FAILED,
        'The simulated monitoring interval could not be advanced.',
        correlationId,
      );
    }
  }

  /**
   * Starts one deterministic local monitoring refresh interval.
   *
   * @param {{
   *   intervalMs?: number,
   *   timerKey?: string,
   *   onTick?: Function,
   *   immediate?: boolean
   * }} [options] Refresh options.
   * @returns {() => boolean} Stop function.
   */
  startRefresh(options = undefined) {
    this.ensureActive();

    const normalized = normalizeRefreshOptions(
      options,
      this.minimumRefreshIntervalMs,
    );

    this.stopRefresh();

    const runTick = async () => {
      const result = await this.refreshOnce();

      if (normalized.onTick !== null) {
        await normalized.onTick(result);
      }

      return result;
    };

    this.refreshCancellation =
      this.timerRegistry.registerInterval(
        normalized.timerKey,
        runTick,
        normalized.intervalMs,
        {
          scope: 'monitoring',
          replace: true,
          allowOverlap: false,
        },
      );
    this.refreshTimerKey = normalized.timerKey;

    if (normalized.immediate) {
      runTick().catch(() => {});
    }

    let active = true;

    return () => {
      if (!active) {
        return false;
      }

      active = false;
      return this.stopRefresh();
    };
  }

  /**
   * Stops active monitoring playback.
   *
   * @returns {boolean} Whether an interval was stopped.
   */
  stopRefresh() {
    if (this.refreshCancellation === null) {
      return false;
    }

    const cancel = this.refreshCancellation;

    this.refreshCancellation = null;
    this.refreshTimerKey = null;

    return cancel() !== false;
  }

  /**
   * Returns whether deterministic refresh playback is active.
   *
   * @returns {boolean} Whether refresh is active.
   */
  isRefreshActive() {
    return this.refreshCancellation !== null;
  }

  /**
   * Returns the persisted monitoring dark-mode preference.
   *
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async getDarkModePreference() {
    this.ensureActive();

    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.MONITORING_VIEW,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    if (this.preferenceRepository === null) {
      return createSuccess(
        200,
        { monitoringDarkMode: false },
        correlationId,
        [
          {
            code: 'PREFERENCE_REPOSITORY_UNAVAILABLE',
            message:
              'Monitoring dark mode is using its default value.',
          },
        ],
      );
    }

    try {
      const preferences = await readPreferences(
        this.preferenceRepository,
      );

      return createSuccess(
        200,
        {
          monitoringDarkMode:
            preferences?.monitoringDarkMode === true ||
            preferences?.monitoring?.monitoringDarkMode === true,
        },
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        MONITORING_FACADE_ERROR_CODES.PREFERENCE_FAILED,
        'The monitoring dark-mode preference could not be loaded.',
        correlationId,
      );
    }
  }

  /**
   * Updates the persisted monitoring dark-mode preference.
   *
   * @param {boolean|Record<string, unknown>} request Preference request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async setDarkModePreference(request) {
    this.ensureActive();

    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.MONITORING_PREFERENCE_UPDATE,
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeDarkModeRequest(request);

    if (normalized === null) {
      return createFailure(
        422,
        MONITORING_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Monitoring dark-mode preference request validation failed.',
        correlationId,
        {
          fieldErrors: [
            {
              field: 'enabled',
              code: 'INVALID_BOOLEAN',
              message:
                'Monitoring dark-mode preference must be a boolean.',
            },
          ],
        },
      );
    }

    if (this.preferenceRepository === null) {
      return createFailure(
        503,
        MONITORING_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Monitoring dark-mode preferences are unavailable.',
        correlationId,
      );
    }

    try {
      const current = await readPreferences(
        this.preferenceRepository,
      );
      const expectedRevision =
        normalized.expectedRevision ??
        current?.revision;

      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0
      ) {
        return createFailure(
          422,
          MONITORING_FACADE_ERROR_CODES.VALIDATION_ERROR,
          'Monitoring preference revision is unavailable.',
          correlationId,
        );
      }

      const preferences = await updateDarkModePreference(
        this.preferenceRepository,
        normalized.enabled,
        {
          expectedRevision,
          ...(normalized.expectedRootRevision === undefined
            ? {}
            : {
                expectedRootRevision:
                  normalized.expectedRootRevision,
              }),
        },
      );

      return createSuccess(
        200,
        {
          monitoringDarkMode: normalized.enabled,
          preferences,
        },
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        MONITORING_FACADE_ERROR_CODES.PREFERENCE_FAILED,
        'The monitoring dark-mode preference could not be updated.',
        correlationId,
      );
    }
  }

  getMonitoringDashboard() {
    return this.getDashboard();
  }

  getMonitoring() {
    return this.getDashboard();
  }

  tick(now = undefined) {
    return this.refreshOnce(now);
  }

  advance(now = undefined) {
    return this.refreshOnce(now);
  }

  startPlayback(options = undefined) {
    return this.startRefresh(options);
  }

  stopPlayback() {
    return this.stopRefresh();
  }

  setMonitoringDarkMode(request) {
    return this.setDarkModePreference(request);
  }

  getMonitoringDarkMode() {
    return this.getDarkModePreference();
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.stopRefresh();
    this.destroyed = true;
  }
}

/**
 * Creates a permission-checked deterministic monitoring facade.
 *
 * @param {ConstructorParameters<typeof MonitoringFacade>[0]}
 * repositoryOrOptions Repository or facade options.
 * @param {ConstructorParameters<typeof MonitoringFacade>[1]} [options]
 * Facade options.
 * @returns {MonitoringFacade} Monitoring facade.
 */
export function createMonitoringFacade(
  repositoryOrOptions,
  options = {},
) {
  return new MonitoringFacade(repositoryOrOptions, options);
}

export const LocalMonitoringFacade = MonitoringFacade;
export const SimulatedMonitoringFacade = MonitoringFacade;
export const createLocalMonitoringFacade =
  createMonitoringFacade;
export const createSimulatedMonitoringFacade =
  createMonitoringFacade;

export default MonitoringFacade;