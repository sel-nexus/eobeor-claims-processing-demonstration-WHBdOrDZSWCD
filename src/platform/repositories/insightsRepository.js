import INSIGHTS_FIXTURES, {
  ASSISTANT_SCRIPTS,
  ASSISTANT_SCRIPT_LIST,
  COMPLIANCE_STATUS_FIXTURE,
  CSR_DASHBOARD_FIXTURE,
  EXECUTIVE_INSIGHTS_FIXTURE,
  INTEGRATION_CONNECTION_TYPES,
  INTEGRATION_INVENTORY,
  INTEGRATION_INVENTORY_FIXTURE,
  INTEGRATION_LAYERS,
  MONITORING_DASHBOARD_FIXTURE,
  PRODUCTIVITY_INSIGHTS_FIXTURE,
} from '../../fixtures/insights.js';
import {
  isJsonCompatible,
  isMonitoringState,
  isPlainObject,
} from '../validation/schemas.js';
import { browserClock } from '../time/clock.js';

export const INSIGHTS_REPOSITORY_SCHEMA_VERSION = 1;
export const INSIGHTS_REPOSITORY_SLICE = 'insights';

export const INSIGHTS_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_GATEWAY: 'INVALID_GATEWAY',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  INVALID_UPDATE: 'INVALID_UPDATE',
  INVALID_REVISION: 'INVALID_REVISION',
  EXPECTED_REVISION_REQUIRED: 'EXPECTED_REVISION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  UNSUPPORTED_TOPIC: 'UNSUPPORTED_TOPIC',
  INQUIRY_NOT_FOUND: 'INQUIRY_NOT_FOUND',
  RESPONSE_NOT_FOUND: 'RESPONSE_NOT_FOUND',
});

export const PLAYBACK_STATUSES = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
});

const PLAYBACK_STATUS_VALUES = new Set(
  Object.values(PLAYBACK_STATUSES),
);
const INTEGRATION_LAYER_VALUES = new Set(INTEGRATION_LAYERS);
const INTEGRATION_CONNECTION_TYPE_VALUES = new Set(
  INTEGRATION_CONNECTION_TYPES,
);
const ASSISTANT_TOPIC_VALUES = new Set(
  ASSISTANT_SCRIPT_LIST.map((script) => script.topic),
);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAXIMUM_LIMIT = 100;

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

export const DEFAULT_PLAYBACK_STATE = deepFreeze({
  status: PLAYBACK_STATUSES.IDLE,
  tick: 0,
  currentStep: null,
  completedSteps: [],
  startedAt: null,
  updatedAt: null,
  completedAt: null,
  errorCode: null,
  simulated: true,
});

export const DEFAULT_INSIGHTS_REPOSITORY_STATE = deepFreeze({
  schemaVersion: INSIGHTS_REPOSITORY_SCHEMA_VERSION,
  revision: 0,
  updatedAt: null,
  updatedBy: null,
  monitoring: MONITORING_DASHBOARD_FIXTURE,
  inquiries: {},
  assistantResponses: {},
  assistantAttachments: {},
  playback: DEFAULT_PLAYBACK_STATE,
});

function requireGateway(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.commit !== 'function'
  ) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_GATEWAY,
      'Insights repository requires a storage gateway with read() and commit().',
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

function requireRevision(value, name = 'Expected revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_REVISION,
      `${name} must be a non-negative safe integer.`,
      { revision: value },
    );
  }

  return value;
}

function requireIdentifier(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_IDENTIFIER,
      `${name} must be a non-empty string of at most 200 characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function requirePlainJsonObject(value, name) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      `${name} must be a safe JSON-compatible object.`,
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
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Insights query pagination values are outside the supported range.',
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
    'Insights repository clock must provide a valid current timestamp.',
  );
}

function isNullableIsoTimestamp(value) {
  return (
    value === null ||
    (typeof value === 'string' &&
      Number.isFinite(Date.parse(value)))
  );
}

function isEntityMap(value) {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([identifier, entity]) =>
        identifier.trim().length > 0 &&
        isPlainObject(entity) &&
        isJsonCompatible(entity),
    )
  );
}

function isPlaybackState(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    PLAYBACK_STATUS_VALUES.has(value.status) &&
    Number.isSafeInteger(value.tick) &&
    value.tick >= 0 &&
    (value.currentStep === null ||
      (typeof value.currentStep === 'string' &&
        value.currentStep.trim().length > 0)) &&
    Array.isArray(value.completedSteps) &&
    value.completedSteps.every(
      (step) =>
        typeof step === 'string' && step.trim().length > 0,
    ) &&
    new Set(value.completedSteps).size ===
      value.completedSteps.length &&
    isNullableIsoTimestamp(value.startedAt) &&
    isNullableIsoTimestamp(value.updatedAt) &&
    isNullableIsoTimestamp(value.completedAt) &&
    (value.errorCode === null ||
      (typeof value.errorCode === 'string' &&
        value.errorCode.trim().length > 0)) &&
    value.simulated === true
  );
}

/**
 * Determines whether a value is valid persisted support-insight state.
 *
 * @param {unknown} value Candidate repository state.
 * @returns {boolean} Whether the value satisfies the state schema.
 */
export function isInsightsRepositoryState(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    value.schemaVersion === INSIGHTS_REPOSITORY_SCHEMA_VERSION &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    (value.updatedAt === null ||
      (typeof value.updatedAt === 'string' &&
        Number.isFinite(Date.parse(value.updatedAt)))) &&
    (value.updatedBy === null ||
      (typeof value.updatedBy === 'string' &&
        value.updatedBy.trim().length > 0)) &&
    isMonitoringState(value.monitoring) &&
    isEntityMap(value.inquiries) &&
    isEntityMap(value.assistantResponses) &&
    isEntityMap(value.assistantAttachments) &&
    isPlaybackState(value.playback)
  );
}

function readState(envelope, sliceName) {
  if (envelope === null || !isPlainObject(envelope.slices)) {
    return DEFAULT_INSIGHTS_REPOSITORY_STATE;
  }

  const value = envelope.slices[sliceName];

  if (value === undefined || value === null) {
    return DEFAULT_INSIGHTS_REPOSITORY_STATE;
  }

  if (isInsightsRepositoryState(value)) {
    return deepFreeze(value);
  }

  if (
    value === INSIGHTS_FIXTURES ||
    (isPlainObject(value) &&
      value.csr !== undefined &&
      value.monitoring !== undefined &&
      value.integrations !== undefined)
  ) {
    return DEFAULT_INSIGHTS_REPOSITORY_STATE;
  }

  throw new InsightsRepositoryError(
    INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_STATE,
    'Persisted support-insight state does not satisfy its schema.',
    { sliceName },
  );
}

function buildNextState(envelope, sliceName, state) {
  const slices = isPlainObject(envelope?.slices)
    ? envelope.slices
    : {};

  return {
    ...(envelope ?? {}),
    slices: {
      ...slices,
      [sliceName]: state,
    },
  };
}

function resolveExpectedEntityRevision(options) {
  if (Number.isSafeInteger(options)) {
    return requireRevision(options);
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'Insights mutation options must be an object or revision.',
    );
  }

  if (
    options.expectedRevision === undefined ||
    options.expectedRevision === null
  ) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.EXPECTED_REVISION_REQUIRED,
      'Expected support-insight revision is required.',
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
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Persisted support-insight data changed before the mutation.',
      {
        expectedRevision: normalized,
        actualRevision: currentRevision,
      },
    );
  }

  return normalized;
}

function assertStateRevision(state, expectedRevision) {
  if (state.revision !== expectedRevision) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
      'Support-insight state changed before the mutation.',
      {
        expectedRevision,
        actualRevision: state.revision,
      },
    );
  }
}

function normalizeActor(options) {
  if (!isPlainObject(options)) {
    return 'system';
  }

  const actor = options.updatedBy ?? options.actorId ?? 'system';

  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Insights updater must be a non-empty string.',
    );
  }

  return actor.normalize('NFC').trim();
}

function normalizeSearch(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Insights search query must be a non-empty string.',
    );
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .trim();
}

function normalizeIntegrationQuery(input) {
  if (!isPlainObject(input)) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Integration inventory query must be an object.',
    );
  }

  const layer =
    input.layer === undefined ||
    input.layer === null ||
    input.layer === ''
      ? null
      : String(input.layer).trim().toUpperCase();
  const connectionType =
    input.connectionType === undefined ||
    input.connectionType === null ||
    input.connectionType === ''
      ? null
      : String(input.connectionType).trim().toUpperCase();

  if (
    layer !== null &&
    !INTEGRATION_LAYER_VALUES.has(layer)
  ) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Integration layer is not supported.',
      {
        layer,
        acceptedValues: INTEGRATION_LAYERS,
      },
    );
  }

  if (
    connectionType !== null &&
    !INTEGRATION_CONNECTION_TYPE_VALUES.has(connectionType)
  ) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_QUERY,
      'Integration connection type is not supported.',
      {
        connectionType,
        acceptedValues: INTEGRATION_CONNECTION_TYPES,
      },
    );
  }

  return {
    layer,
    connectionType,
    search: normalizeSearch(input.query ?? input.q ?? input.search),
    page: requirePositiveInteger(input.page, DEFAULT_PAGE),
    limit: requirePositiveInteger(
      input.limit,
      DEFAULT_LIMIT,
      MAXIMUM_LIMIT,
    ),
  };
}

function paginate(values, page, limit, revision) {
  const start = (page - 1) * limit;

  return deepFreeze({
    items: values.slice(start, start + limit),
    page,
    limit,
    total: values.length,
    totalPages:
      values.length === 0 ? 0 : Math.ceil(values.length / limit),
    revision,
  });
}

function normalizeMonitoringState(value) {
  if (!isMonitoringState(value)) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Monitoring state does not satisfy its schema.',
    );
  }

  return deepFreeze(value);
}

function normalizePlaybackState(value) {
  if (!isPlaybackState(value)) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      'Playback state does not satisfy its schema.',
    );
  }

  return deepFreeze(value);
}

function normalizeEntity(value, identifierFields, name) {
  requirePlainJsonObject(value, name);

  const identifier = identifierFields
    .map((field) => value[field])
    .find(
      (candidate) =>
        typeof candidate === 'string' &&
        candidate.trim().length > 0,
    );

  if (identifier === undefined) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_IDENTIFIER,
      `${name} must include a valid identifier.`,
      { acceptedIdentifierFields: identifierFields },
    );
  }

  return {
    identifier: requireIdentifier(identifier, `${name} identifier`),
    value: deepFreeze(value),
  };
}

function normalizeCollection(value, identifierFields, name) {
  const source = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? Object.values(value)
      : null;

  if (source === null) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
      `${name} must be an array or object map.`,
    );
  }

  const result = {};

  source.forEach((entity) => {
    const normalized = normalizeEntity(
      entity,
      identifierFields,
      name,
    );

    if (
      Object.prototype.hasOwnProperty.call(
        result,
        normalized.identifier,
      )
    ) {
      throw new InsightsRepositoryError(
        INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_UPDATE,
        `${name} contains a duplicate identifier.`,
        { identifier: normalized.identifier },
      );
    }

    result[normalized.identifier] = normalized.value;
  });

  return result;
}

function createNextRepositoryState(
  current,
  changes,
  timestamp,
  actor,
) {
  const next = {
    ...current,
    ...changes,
    schemaVersion: INSIGHTS_REPOSITORY_SCHEMA_VERSION,
    revision: current.revision + 1,
    updatedAt: timestamp,
    updatedBy: actor,
  };

  if (!isInsightsRepositoryState(next)) {
    throw new InsightsRepositoryError(
      INSIGHTS_REPOSITORY_ERROR_CODES.INVALID_STATE,
      'Updated support-insight state does not satisfy its schema.',
    );
  }

  return deepFreeze(next);
}

/**
 * Error raised when support-insight repository data or operations are invalid.
 */
export class InsightsRepositoryError extends Error {
  /**
   * @param {string} code Stable repository error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'InsightsRepositoryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Repository for immutable support fixtures and mutable browser-local insight
 * playback, monitoring, inquiry, and assistant state.
 */
export class InsightsRepository {
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
        : INSIGHTS_REPOSITORY_SLICE;
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
   * Returns the mutable support-insight revision.
   *
   * @returns {number} Support-insight revision.
   */
  getStateRevision() {
    return readState(
      this.gateway.read(),
      this.sliceName,
    ).revision;
  }

  /**
   * Returns immutable fixture data and current mutable state.
   *
   * @returns {Readonly<Record<string, unknown>>} Repository snapshot.
   */
  getSnapshot() {
    const envelope = this.gateway.read();
    const state = readState(envelope, this.sliceName);

    return deepFreeze({
      schemaVersion: INSIGHTS_REPOSITORY_SCHEMA_VERSION,
      revision: envelope?.rootRevision ?? 0,
      stateRevision: state.revision,
      csr: CSR_DASHBOARD_FIXTURE,
      monitoring: state.monitoring,
      integrations: INTEGRATION_INVENTORY_FIXTURE,
      assistantScripts: ASSISTANT_SCRIPTS,
      compliance: COMPLIANCE_STATUS_FIXTURE,
      executive: EXECUTIVE_INSIGHTS_FIXTURE,
      productivity: PRODUCTIVITY_INSIGHTS_FIXTURE,
      inquiries: Object.values(state.inquiries),
      assistantResponses: Object.values(
        state.assistantResponses,
      ),
      assistantAttachments: Object.values(
        state.assistantAttachments,
      ),
      playback: state.playback,
      mutableState: state,
    });
  }

  /**
   * Returns the representative CSR dashboard.
   *
   * @returns {Readonly<Record<string, unknown>>} CSR dashboard.
   */
  getCsrDashboard() {
    return CSR_DASHBOARD_FIXTURE;
  }

  /**
   * Returns current simulated monitoring state.
   *
   * @returns {Readonly<Record<string, unknown>>} Monitoring dashboard.
   */
  getMonitoringDashboard() {
    return readState(
      this.gateway.read(),
      this.sliceName,
    ).monitoring;
  }

  /**
   * Replaces simulated monitoring state using optimistic revisions.
   *
   * @param {Record<string, unknown>} monitoring Monitoring state.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored monitoring state.
   */
  updateMonitoring(monitoring, options = {}) {
    const normalizedMonitoring =
      normalizeMonitoringState(monitoring);
    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);

    assertStateRevision(current, expectedRevision);

    const next = createNextRepositoryState(
      current,
      { monitoring: normalizedMonitoring },
      getCurrentTimestamp(this.clock),
      normalizeActor(options),
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, next),
      {},
    );

    return next.monitoring;
  }

  /**
   * Returns a filtered integration inventory.
   *
   * @param {Record<string, unknown>} [input] Inventory filters.
   * @returns {Readonly<Record<string, unknown>>} Paged inventory.
   */
  listIntegrations(input = {}) {
    const query = normalizeIntegrationQuery(input);
    const items = INTEGRATION_INVENTORY.filter((integration) => {
      if (
        query.layer !== null &&
        integration.layer !== query.layer
      ) {
        return false;
      }

      if (
        query.connectionType !== null &&
        !integration.connectionTypes.includes(
          query.connectionType,
        )
      ) {
        return false;
      }

      if (query.search !== null) {
        const searchable = [
          integration.integrationId,
          integration.name,
          ...integration.aliases,
          integration.layer,
          ...integration.connectionTypes,
          integration.status,
          integration.description,
        ]
          .join(' ')
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('en-US');

        if (!searchable.includes(query.search)) {
          return false;
        }
      }

      return true;
    });

    return deepFreeze({
      ...paginate(
        items,
        query.page,
        query.limit,
        this.getRevision(),
      ),
      layers: INTEGRATION_LAYERS,
      connectionTypes: INTEGRATION_CONNECTION_TYPES,
      disclosure: INTEGRATION_INVENTORY_FIXTURE.disclosure,
      simulated: true,
    });
  }

  /**
   * Returns all scripted assistant responses.
   *
   * @returns {readonly Readonly<Record<string, unknown>>[]} Scripts.
   */
  getAssistantScripts() {
    return ASSISTANT_SCRIPT_LIST;
  }

  /**
   * Returns one scripted assistant response.
   *
   * @param {string} topic Assistant topic.
   * @returns {Readonly<Record<string, unknown>>} Script.
   */
  getAssistantScript(topic) {
    const normalizedTopic = requireIdentifier(
      topic,
      'Assistant topic',
    ).toUpperCase();

    if (!ASSISTANT_TOPIC_VALUES.has(normalizedTopic)) {
      throw new InsightsRepositoryError(
        INSIGHTS_REPOSITORY_ERROR_CODES.UNSUPPORTED_TOPIC,
        'Assistant topic is not supported.',
        {
          topic: normalizedTopic,
          acceptedValues: [...ASSISTANT_TOPIC_VALUES],
        },
      );
    }

    return ASSISTANT_SCRIPTS[normalizedTopic];
  }

  /**
   * Stores assistant response metadata for later inquiry attachment.
   *
   * @param {Record<string, unknown>} response Assistant response.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored response.
   */
  saveAssistantResponse(response, options = {}) {
    const normalized = normalizeEntity(
      response,
      ['responseId', 'id'],
      'Assistant response',
    );

    if (
      typeof response.topic !== 'string' ||
      !ASSISTANT_TOPIC_VALUES.has(response.topic.toUpperCase())
    ) {
      throw new InsightsRepositoryError(
        INSIGHTS_REPOSITORY_ERROR_CODES.UNSUPPORTED_TOPIC,
        'Assistant response topic is not supported.',
      );
    }

    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);

    assertStateRevision(current, expectedRevision);

    const next = createNextRepositoryState(
      current,
      {
        assistantResponses: {
          ...current.assistantResponses,
          [normalized.identifier]: normalized.value,
        },
      },
      getCurrentTimestamp(this.clock),
      normalizeActor(options),
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, next),
      {},
    );

    return next.assistantResponses[normalized.identifier];
  }

  /**
   * Returns one stored assistant response.
   *
   * @param {string} responseId Response identifier.
   * @returns {Readonly<Record<string, unknown>>|null} Response or null.
   */
  getAssistantResponse(responseId) {
    const identifier = requireIdentifier(
      responseId,
      'Assistant response ID',
    );
    const state = readState(
      this.gateway.read(),
      this.sliceName,
    );

    return state.assistantResponses[identifier] ?? null;
  }

  /**
   * Returns all local inquiries.
   *
   * @returns {readonly Readonly<Record<string, unknown>>[]} Inquiries.
   */
  getInquiries() {
    return deepFreeze(
      Object.values(
        readState(this.gateway.read(), this.sliceName).inquiries,
      ),
    );
  }

  /**
   * Returns one local inquiry.
   *
   * @param {string} inquiryId Inquiry identifier.
   * @returns {Readonly<Record<string, unknown>>|null} Inquiry or null.
   */
  getInquiry(inquiryId) {
    const identifier = requireIdentifier(
      inquiryId,
      'Inquiry ID',
    );

    return (
      readState(this.gateway.read(), this.sliceName).inquiries[
        identifier
      ] ?? null
    );
  }

  /**
   * Replaces local inquiries using optimistic revisions.
   *
   * @param {unknown[]|Record<string, unknown>} inquiries Inquiries.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Stored inquiries.
   */
  replaceInquiries(inquiries, options = {}) {
    const normalized = normalizeCollection(
      inquiries,
      ['inquiryId', 'id'],
      'Inquiry collection',
    );
    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);

    assertStateRevision(current, expectedRevision);

    const next = createNextRepositoryState(
      current,
      { inquiries: normalized },
      getCurrentTimestamp(this.clock),
      normalizeActor(options),
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, next),
      {},
    );

    return deepFreeze(Object.values(next.inquiries));
  }

  /**
   * Creates or replaces one local inquiry.
   *
   * @param {Record<string, unknown>} inquiry Inquiry data.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored inquiry.
   */
  upsertInquiry(inquiry, options = {}) {
    const normalized = normalizeEntity(
      inquiry,
      ['inquiryId', 'id'],
      'Inquiry',
    );
    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);

    assertStateRevision(current, expectedRevision);

    const next = createNextRepositoryState(
      current,
      {
        inquiries: {
          ...current.inquiries,
          [normalized.identifier]: normalized.value,
        },
      },
      getCurrentTimestamp(this.clock),
      normalizeActor(options),
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, next),
      {},
    );

    return next.inquiries[normalized.identifier];
  }

  /**
   * Attaches a stored assistant response to a local inquiry.
   *
   * @param {string} inquiryId Inquiry identifier.
   * @param {Record<string, unknown>} attachment Attachment data.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored attachment.
   */
  attachAssistantResponse(
    inquiryId,
    attachment,
    options = {},
  ) {
    const normalizedInquiryId = requireIdentifier(
      inquiryId,
      'Inquiry ID',
    );
    requirePlainJsonObject(
      attachment,
      'Assistant attachment',
    );

    const normalized = normalizeEntity(
      {
        ...attachment,
        inquiryId: normalizedInquiryId,
      },
      ['attachmentId', 'id'],
      'Assistant attachment',
    );
    const responseId = requireIdentifier(
      attachment.responseId,
      'Assistant response ID',
    );
    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);
    const inquiry = current.inquiries[normalizedInquiryId];

    assertStateRevision(current, expectedRevision);

    if (inquiry === undefined) {
      throw new InsightsRepositoryError(
        INSIGHTS_REPOSITORY_ERROR_CODES.INQUIRY_NOT_FOUND,
        'Inquiry was not found.',
        { inquiryId: normalizedInquiryId },
      );
    }

    if (current.assistantResponses[responseId] === undefined) {
      throw new InsightsRepositoryError(
        INSIGHTS_REPOSITORY_ERROR_CODES.RESPONSE_NOT_FOUND,
        'Assistant response was not found.',
        { responseId },
      );
    }

    const inquiryRevision =
      Number.isSafeInteger(inquiry.revision) &&
      inquiry.revision >= 0
        ? inquiry.revision
        : 0;
    const expectedInquiryRevision = isPlainObject(options)
      ? options.expectedInquiryRevision
      : undefined;

    if (
      expectedInquiryRevision !== undefined &&
      requireRevision(
        expectedInquiryRevision,
        'Expected inquiry revision',
      ) !== inquiryRevision
    ) {
      throw new InsightsRepositoryError(
        INSIGHTS_REPOSITORY_ERROR_CODES.REVISION_CONFLICT,
        'Inquiry changed before the attachment was stored.',
        {
          expectedRevision: expectedInquiryRevision,
          actualRevision: inquiryRevision,
        },
      );
    }

    const storedAttachment = deepFreeze({
      ...normalized.value,
      inquiryId: normalizedInquiryId,
      responseId,
    });
    const updatedInquiry = deepFreeze({
      ...inquiry,
      revision: inquiryRevision + 1,
      updatedAt: getCurrentTimestamp(this.clock),
      assistantAttachmentIds: [
        ...(Array.isArray(inquiry.assistantAttachmentIds)
          ? inquiry.assistantAttachmentIds
          : []),
        normalized.identifier,
      ],
    });
    const next = createNextRepositoryState(
      current,
      {
        inquiries: {
          ...current.inquiries,
          [normalizedInquiryId]: updatedInquiry,
        },
        assistantAttachments: {
          ...current.assistantAttachments,
          [normalized.identifier]: storedAttachment,
        },
      },
      getCurrentTimestamp(this.clock),
      normalizeActor(options),
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, next),
      {},
    );

    return deepFreeze({
      attachment:
        next.assistantAttachments[normalized.identifier],
      inquiryRevision: updatedInquiry.revision,
    });
  }

  /**
   * Returns assistant attachments, optionally limited to one inquiry.
   *
   * @param {string|null} [inquiryId] Optional inquiry identifier.
   * @returns {readonly Readonly<Record<string, unknown>>[]} Attachments.
   */
  getAssistantAttachments(inquiryId = null) {
    const attachments = Object.values(
      readState(this.gateway.read(), this.sliceName)
        .assistantAttachments,
    );

    if (inquiryId === null || inquiryId === undefined) {
      return deepFreeze(attachments);
    }

    const identifier = requireIdentifier(
      inquiryId,
      'Inquiry ID',
    );

    return deepFreeze(
      attachments.filter(
        (attachment) => attachment.inquiryId === identifier,
      ),
    );
  }

  /**
   * Returns the honest static compliance fixture.
   *
   * @returns {Readonly<Record<string, unknown>>} Compliance status.
   */
  getComplianceStatus() {
    return COMPLIANCE_STATUS_FIXTURE;
  }

  /**
   * Returns immutable executive insight fixtures.
   *
   * @returns {Readonly<Record<string, unknown>>} Executive insights.
   */
  getExecutiveInsights() {
    return EXECUTIVE_INSIGHTS_FIXTURE;
  }

  /**
   * Returns immutable productivity insight fixtures.
   *
   * @returns {Readonly<Record<string, unknown>>} Productivity insights.
   */
  getProductivityInsights() {
    return PRODUCTIVITY_INSIGHTS_FIXTURE;
  }

  /**
   * Returns current deterministic playback state.
   *
   * @returns {Readonly<Record<string, unknown>>} Playback state.
   */
  getPlaybackState() {
    return readState(
      this.gateway.read(),
      this.sliceName,
    ).playback;
  }

  /**
   * Replaces deterministic playback state using optimistic revisions.
   *
   * @param {Record<string, unknown>} playback Playback state.
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Stored playback state.
   */
  updatePlayback(playback, options = {}) {
    const normalizedPlayback =
      normalizePlaybackState(playback);
    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);

    assertStateRevision(current, expectedRevision);

    const next = createNextRepositoryState(
      current,
      { playback: normalizedPlayback },
      getCurrentTimestamp(this.clock),
      normalizeActor(options),
    );

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, next),
      {},
    );

    return next.playback;
  }

  /**
   * Restores mutable insight state to fixture defaults.
   *
   * @param {number|Record<string, unknown>} options Mutation options.
   * @returns {Readonly<Record<string, unknown>>} Restored state.
   */
  reset(options = {}) {
    const expectedRevision =
      resolveExpectedEntityRevision(options);
    const envelope = this.gateway.read();
    const rootRevision = envelope?.rootRevision ?? 0;
    const expectedRootRevision = resolveExpectedRootRevision(
      options,
      rootRevision,
    );
    const current = readState(envelope, this.sliceName);

    assertStateRevision(current, expectedRevision);

    const restored = deepFreeze({
      ...DEFAULT_INSIGHTS_REPOSITORY_STATE,
      revision: current.revision + 1,
      updatedAt: getCurrentTimestamp(this.clock),
      updatedBy: normalizeActor(options),
    });

    this.gateway.commit(
      expectedRootRevision,
      buildNextState(envelope, this.sliceName, restored),
      {},
    );

    return restored;
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
        'Insights repository listener must be a function.',
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

  getCsrInsights() {
    return this.getCsrDashboard();
  }

  getMonitoring() {
    return this.getMonitoringDashboard();
  }

  replaceMonitoring(monitoring, options = {}) {
    return this.updateMonitoring(monitoring, options);
  }

  getIntegrationInventory(input = {}) {
    return this.listIntegrations(input);
  }

  listAssistantScripts() {
    return this.getAssistantScripts();
  }

  findAssistantScript(topic) {
    return this.getAssistantScript(topic);
  }

  listInquiries() {
    return this.getInquiries();
  }

  findInquiry(inquiryId) {
    return this.getInquiry(inquiryId);
  }

  getExecutive() {
    return this.getExecutiveInsights();
  }

  getProductivity() {
    return this.getProductivityInsights();
  }

  getCompliance() {
    return this.getComplianceStatus();
  }

  replacePlayback(playback, options = {}) {
    return this.updatePlayback(playback, options);
  }

  restoreDefaults(options = {}) {
    return this.reset(options);
  }
}

/**
 * Creates a support-insight repository.
 *
 * @param {ConstructorParameters<typeof InsightsRepository>[0]}
 * gatewayOrOptions Gateway or repository options.
 * @param {ConstructorParameters<typeof InsightsRepository>[1]} [options]
 * Repository options.
 * @returns {InsightsRepository} Insights repository.
 */
export function createInsightsRepository(
  gatewayOrOptions,
  options = {},
) {
  return new InsightsRepository(gatewayOrOptions, options);
}

export const SupportInsightsRepository = InsightsRepository;
export const LocalInsightsRepository = InsightsRepository;
export const createSupportInsightsRepository =
  createInsightsRepository;
export const createLocalInsightsRepository =
  createInsightsRepository;
export const isSupportInsightsState = isInsightsRepositoryState;

export default InsightsRepository;