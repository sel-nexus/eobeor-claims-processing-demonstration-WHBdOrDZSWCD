import { createStore } from 'zustand/vanilla';
import { browserClock } from '../../../platform/time/clock.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';
import {
  PRIORITY_VALUES,
  REQUEST_STATUS_VALUES,
  REQUEST_TYPE_VALUES,
  SOURCE_TYPE_VALUES,
} from '../domain/domainConstants.js';
import { isOperationsEnvelope } from '../domain/operationsSchemas.js';

export const OPERATIONS_STORE_SCHEMA_VERSION = 1;

export const OPERATIONS_STORE_HYDRATION_STATUSES = Object.freeze({
  HYDRATING: 'HYDRATING',
  READY: 'READY',
  ERROR: 'ERROR',
  DESTROYED: 'DESTROYED',
});

export const OPERATIONS_PLAYER_STATUSES = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const OPERATIONS_STORE_ERROR_CODES = Object.freeze({
  INVALID_REPOSITORY: 'INVALID_REPOSITORY',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  INVALID_FILTERS: 'INVALID_FILTERS',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  INVALID_PLAYER_STATE: 'INVALID_PLAYER_STATE',
  INVALID_TIMER: 'INVALID_TIMER',
  HYDRATION_FAILED: 'HYDRATION_FAILED',
  STORE_DESTROYED: 'STORE_DESTROYED',
});

const PLAYER_STATUS_VALUES = new Set(
  Object.values(OPERATIONS_PLAYER_STATUSES),
);
const REQUEST_STATUS_VALUE_SET = new Set(REQUEST_STATUS_VALUES);
const PRIORITY_VALUE_SET = new Set(PRIORITY_VALUES);
const REQUEST_TYPE_VALUE_SET = new Set(REQUEST_TYPE_VALUES);
const SOURCE_TYPE_VALUE_SET = new Set(SOURCE_TYPE_VALUES);
const SORT_FIELDS = new Set([
  'QUEUE',
  'CREATED_AT',
  'PRIORITY',
  'STATUS',
  'DISPLAY_ID',
]);
const SORT_DIRECTIONS = new Set(['ASC', 'DESC']);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 200;
const MAXIMUM_WARNINGS = 50;

export const DEFAULT_OPERATIONS_FILTERS = deepFreeze({
  statuses: [],
  priorities: [],
  requestTypes: [],
  sourceTypes: [],
  memberId: null,
  claimNumber: null,
  search: '',
  sortBy: 'QUEUE',
  sortDirection: 'ASC',
  page: DEFAULT_PAGE,
  limit: DEFAULT_LIMIT,
  offset: null,
});

export const DEFAULT_OPERATIONS_PLAYER_STATE = deepFreeze({
  status: OPERATIONS_PLAYER_STATUSES.IDLE,
  currentStep: null,
  completedSteps: [],
  startedAt: null,
  updatedAt: null,
  completedAt: null,
  errorCode: null,
});

const EMPTY_COLLECTION = Object.freeze({});

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
    (typeof value.getSnapshot !== 'function' &&
      typeof value.read !== 'function' &&
      typeof value.load !== 'function')
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_REPOSITORY,
      'Operations store requires a repository with getSnapshot(), read(), or load().',
    );
  }

  return value;
}

function resolveConstructorArguments(repositoryOrOptions, options) {
  if (
    isPlainObject(repositoryOrOptions) &&
    (repositoryOrOptions.repository !== undefined ||
      repositoryOrOptions.operationsRepository !== undefined)
  ) {
    return {
      repository:
        repositoryOrOptions.repository ??
        repositoryOrOptions.operationsRepository,
      options: repositoryOrOptions,
    };
  }

  return {
    repository: repositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function requireIdentifier(value, name = 'Identifier') {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_IDENTIFIER,
      `${name} must be a non-empty string of at most 200 characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function getCurrentTimestamp(clock) {
  let value;

  if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.nowIso === 'function'
  ) {
    value = clock.nowIso();
  } else if (
    clock !== null &&
    typeof clock === 'object' &&
    typeof clock.now === 'function'
  ) {
    value = clock.now();
  } else if (typeof clock === 'function') {
    value = clock();
  } else {
    throw new TypeError(
      'Operations store clock must provide nowIso() or now().',
    );
  }

  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Operations store clock must provide a valid timestamp.',
    );
  }

  return date.toISOString();
}

function readRepositorySnapshot(repository) {
  if (typeof repository.getSnapshot === 'function') {
    return repository.getSnapshot();
  }

  if (typeof repository.read === 'function') {
    return repository.read();
  }

  return repository.load();
}

function resolveOperationsEnvelope(value) {
  if (isOperationsEnvelope(value)) {
    return value;
  }

  if (
    isPlainObject(value) &&
    isOperationsEnvelope(value.envelope)
  ) {
    return value.envelope;
  }

  if (
    isPlainObject(value) &&
    isOperationsEnvelope(value.operationsEnvelope)
  ) {
    return value.operationsEnvelope;
  }

  throw new OperationsStoreError(
    OPERATIONS_STORE_ERROR_CODES.INVALID_ENVELOPE,
    'Operations repository returned an invalid operations envelope.',
  );
}

function normalizeStringArray(value, acceptedValues, name) {
  if (value === undefined) {
    return undefined;
  }

  const source =
    value === null || value === '' ? [] : Array.isArray(value) ? value : [value];
  const normalized = source.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
        `${name} must contain supported non-empty strings.`,
      );
    }

    return item.trim().toUpperCase();
  });

  if (
    normalized.some((item) => !acceptedValues.has(item)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
      `${name} contains an unsupported or duplicate value.`,
    );
  }

  return normalized;
}

function normalizeNullableIdentifier(value, name) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requireIdentifier(value, name);
}

function normalizePositiveInteger(value, name, maximum) {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
      `${name} is outside the supported range.`,
      {
        value,
        maximum: maximum ?? null,
      },
    );
  }

  return value;
}

function normalizeOffset(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
      'Operations filter offset must be a non-negative safe integer or null.',
    );
  }

  return value;
}

function normalizeFilters(changes, current) {
  if (!isPlainObject(changes) || !isJsonCompatible(changes)) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
      'Operations filters must be a safe JSON-compatible object.',
    );
  }

  const allowedFields = new Set([
    'statuses',
    'status',
    'priorities',
    'priority',
    'requestTypes',
    'requestType',
    'sourceTypes',
    'sourceType',
    'memberId',
    'claimNumber',
    'search',
    'query',
    'q',
    'sortBy',
    'sortDirection',
    'direction',
    'page',
    'limit',
    'offset',
  ]);

  Object.keys(changes).forEach((field) => {
    if (!allowedFields.has(field)) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
        `Operations filter field ${field} is not supported.`,
        { field },
      );
    }
  });

  const statuses = normalizeStringArray(
    changes.statuses ?? changes.status,
    REQUEST_STATUS_VALUE_SET,
    'Request statuses',
  );
  const priorities = normalizeStringArray(
    changes.priorities ?? changes.priority,
    PRIORITY_VALUE_SET,
    'Request priorities',
  );
  const requestTypes = normalizeStringArray(
    changes.requestTypes ?? changes.requestType,
    REQUEST_TYPE_VALUE_SET,
    'Request types',
  );
  const sourceTypes = normalizeStringArray(
    changes.sourceTypes ?? changes.sourceType,
    SOURCE_TYPE_VALUE_SET,
    'Request source types',
  );
  const memberId = normalizeNullableIdentifier(
    changes.memberId,
    'Member ID',
  );
  const claimNumber = normalizeNullableIdentifier(
    changes.claimNumber,
    'Claim number',
  );
  const searchValue = changes.search ?? changes.query ?? changes.q;
  let search;

  if (searchValue !== undefined) {
    if (searchValue === null || searchValue === '') {
      search = '';
    } else if (typeof searchValue !== 'string') {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
        'Operations search filter must be a string.',
      );
    } else {
      search = searchValue.normalize('NFKC').trim();

      if (search.length > 200) {
        throw new OperationsStoreError(
          OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
          'Operations search filter must not exceed 200 characters.',
        );
      }
    }
  }

  const sortByValue = changes.sortBy;
  let sortBy;

  if (sortByValue !== undefined) {
    sortBy =
      typeof sortByValue === 'string'
        ? sortByValue.trim().toUpperCase()
        : sortByValue;

    if (!SORT_FIELDS.has(sortBy)) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
        'Operations sort field is not supported.',
        { sortBy: sortByValue },
      );
    }
  }

  const directionValue =
    changes.sortDirection ?? changes.direction;
  let sortDirection;

  if (directionValue !== undefined) {
    sortDirection =
      typeof directionValue === 'string'
        ? directionValue.trim().toUpperCase()
        : directionValue;

    if (!SORT_DIRECTIONS.has(sortDirection)) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_FILTERS,
        'Operations sort direction must be ASC or DESC.',
      );
    }
  }

  const page = normalizePositiveInteger(
    changes.page,
    'Operations filter page',
  );
  const limit = normalizePositiveInteger(
    changes.limit,
    'Operations filter limit',
    MAXIMUM_LIMIT,
  );
  const offset = normalizeOffset(changes.offset);

  return deepFreeze({
    ...current,
    ...(statuses === undefined ? {} : { statuses }),
    ...(priorities === undefined ? {} : { priorities }),
    ...(requestTypes === undefined ? {} : { requestTypes }),
    ...(sourceTypes === undefined ? {} : { sourceTypes }),
    ...(memberId === undefined ? {} : { memberId }),
    ...(claimNumber === undefined ? {} : { claimNumber }),
    ...(search === undefined ? {} : { search }),
    ...(sortBy === undefined ? {} : { sortBy }),
    ...(sortDirection === undefined ? {} : { sortDirection }),
    ...(page === undefined ? {} : { page }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  });
}

function normalizePlayerState(value, current, timestamp) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
      'Operations player state must be a safe JSON-compatible object.',
    );
  }

  const status =
    value.status === undefined
      ? current.status
      : typeof value.status === 'string'
        ? value.status.trim().toUpperCase()
        : value.status;

  if (!PLAYER_STATUS_VALUES.has(status)) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
      'Operations player status is not supported.',
      { status: value.status },
    );
  }

  const currentStep =
    value.currentStep === undefined
      ? current.currentStep
      : value.currentStep;

  if (
    currentStep !== null &&
    (typeof currentStep !== 'string' ||
      currentStep.trim().length === 0)
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
      'Operations player step must be a non-empty string or null.',
    );
  }

  const completedSteps =
    value.completedSteps === undefined
      ? current.completedSteps
      : value.completedSteps;

  if (
    !Array.isArray(completedSteps) ||
    completedSteps.some(
      (step) =>
        typeof step !== 'string' || step.trim().length === 0,
    ) ||
    new Set(completedSteps).size !== completedSteps.length
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
      'Operations player completed steps must be unique non-empty strings.',
    );
  }

  const errorCode =
    value.errorCode === undefined
      ? current.errorCode
      : value.errorCode;

  if (
    errorCode !== null &&
    (typeof errorCode !== 'string' ||
      errorCode.trim().length === 0)
  ) {
    throw new OperationsStoreError(
      OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
      'Operations player error code must be a non-empty string or null.',
    );
  }

  const startedAt =
    value.startedAt === undefined
      ? current.startedAt
      : value.startedAt;
  const completedAt =
    value.completedAt === undefined
      ? current.completedAt
      : value.completedAt;

  [startedAt, completedAt].forEach((dateValue) => {
    if (
      dateValue !== null &&
      (typeof dateValue !== 'string' ||
        !Number.isFinite(Date.parse(dateValue)))
    ) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
        'Operations player timestamps must be valid ISO timestamps or null.',
      );
    }
  });

  return deepFreeze({
    status,
    currentStep:
      typeof currentStep === 'string'
        ? currentStep.trim()
        : null,
    completedSteps: completedSteps.map((step) => step.trim()),
    startedAt,
    updatedAt: timestamp,
    completedAt,
    errorCode:
      typeof errorCode === 'string' ? errorCode.trim() : null,
  });
}

function createEmptyState() {
  return {
    storeSchemaVersion: OPERATIONS_STORE_SCHEMA_VERSION,
    hydrationStatus:
      OPERATIONS_STORE_HYDRATION_STATUSES.HYDRATING,
    hydrated: false,
    revision: 0,
    envelope: null,
    operationsEnvelope: null,
    persistent: null,
    requests: EMPTY_COLLECTION,
    pipelineRuns: EMPTY_COLLECTION,
    documents: EMPTY_COLLECTION,
    inboundRuns: EMPTY_COLLECTION,
    batchRuns: EMPTY_COLLECTION,
    reviews: EMPTY_COLLECTION,
    errorReports: EMPTY_COLLECTION,
    outboundRecords: EMPTY_COLLECTION,
    idempotencyResults: EMPTY_COLLECTION,
    cdcEvents: EMPTY_COLLECTION,
    players: Object.freeze({}),
    selectedRowIds: Object.freeze([]),
    filters: DEFAULT_OPERATIONS_FILTERS,
    warnings: Object.freeze([]),
    timerKeys: Object.freeze([]),
    activeRequestIds: Object.freeze([]),
    lastHydratedAt: null,
    hydrationError: null,
  };
}

function createStoreSnapshot({
  envelope,
  hydrationStatus,
  players,
  selectedRowIds,
  filters,
  warnings,
  timerKeys,
  activeRequestIds,
  lastHydratedAt,
  hydrationError,
}) {
  const persistentEnvelope = envelope ?? null;
  const collections = persistentEnvelope ?? {};

  return Object.freeze({
    storeSchemaVersion: OPERATIONS_STORE_SCHEMA_VERSION,
    hydrationStatus,
    hydrated:
      hydrationStatus ===
      OPERATIONS_STORE_HYDRATION_STATUSES.READY,
    revision: persistentEnvelope?.revision ?? 0,
    envelope: persistentEnvelope,
    operationsEnvelope: persistentEnvelope,
    persistent: persistentEnvelope,
    requests: collections.requests ?? EMPTY_COLLECTION,
    pipelineRuns: collections.pipelineRuns ?? EMPTY_COLLECTION,
    documents: collections.documents ?? EMPTY_COLLECTION,
    inboundRuns: collections.inboundRuns ?? EMPTY_COLLECTION,
    batchRuns: collections.batchRuns ?? EMPTY_COLLECTION,
    reviews: collections.reviews ?? EMPTY_COLLECTION,
    errorReports: collections.errorReports ?? EMPTY_COLLECTION,
    outboundRecords:
      collections.outboundRecords ?? EMPTY_COLLECTION,
    idempotencyResults:
      collections.idempotencyResults ?? EMPTY_COLLECTION,
    cdcEvents: collections.cdcEvents ?? EMPTY_COLLECTION,
    players: deepFreeze(players),
    selectedRowIds: Object.freeze([...selectedRowIds]),
    filters: deepFreeze(filters),
    warnings: deepFreeze(warnings),
    timerKeys: Object.freeze([...timerKeys]),
    activeRequestIds: Object.freeze([...activeRequestIds]),
    lastHydratedAt,
    hydrationError:
      hydrationError === null
        ? null
        : deepFreeze(hydrationError),
  });
}

function createNormalizedWarning(id, code, message, timestamp) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new TypeError(
      'Operations store warning code must be a non-empty string.',
    );
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new TypeError(
      'Operations store warning message must be a non-empty string.',
    );
  }

  return deepFreeze({
    warningId: id,
    code: code.trim().toUpperCase(),
    message: message.trim(),
    createdAt: timestamp,
  });
}

/**
 * Error raised when operations store state or input is invalid.
 */
export class OperationsStoreError extends Error {
  /**
   * @param {string} code Stable store error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OperationsStoreError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Zustand-backed operations domain store.
 *
 * Persisted operations entities are read exclusively from the injected
 * repository. Playback state, selections, filters, warnings, timers, and
 * abort controllers remain memory-only.
 */
export class OperationsStore {
  /**
   * @param {object|Record<string, unknown>} repositoryOrOptions Operations
   * repository or options containing `repository` or `operationsRepository`.
   * @param {{clock?: object|Function}} [options] Store options.
   */
  constructor(repositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      repositoryOrOptions,
      options,
    );

    if (!isPlainObject(resolved.options)) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_OPTIONS,
        'Operations store options must be a plain object.',
      );
    }

    this.repository = requireRepository(resolved.repository);
    this.clock = resolved.options.clock ?? browserClock;
    this.destroyed = false;
    this.warningSequence = 0;
    this.timers = new Map();
    this.abortControllers = new Map();
    this.unsubscribeRepository = () => {};
    this.store = createStore(() =>
      createStoreSnapshot(createEmptyState()),
    );
    this.storeApi = this.store;

    this.hydrate();

    if (typeof this.repository.subscribe === 'function') {
      this.unsubscribeRepository = this.repository.subscribe(() => {
        if (!this.destroyed) {
          this.refresh();
        }
      });
    }
  }

  ensureActive() {
    if (this.destroyed) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.STORE_DESTROYED,
        'Operations store has been destroyed.',
      );
    }
  }

  replaceState(changes) {
    if (this.destroyed) {
      return this.store.getState();
    }

    const current = this.store.getState();
    const snapshot = createStoreSnapshot({
      envelope:
        changes.envelope === undefined
          ? current.envelope
          : changes.envelope,
      hydrationStatus:
        changes.hydrationStatus ?? current.hydrationStatus,
      players: changes.players ?? current.players,
      selectedRowIds:
        changes.selectedRowIds ?? current.selectedRowIds,
      filters: changes.filters ?? current.filters,
      warnings: changes.warnings ?? current.warnings,
      timerKeys: changes.timerKeys ?? current.timerKeys,
      activeRequestIds:
        changes.activeRequestIds ?? current.activeRequestIds,
      lastHydratedAt:
        changes.lastHydratedAt === undefined
          ? current.lastHydratedAt
          : changes.lastHydratedAt,
      hydrationError:
        changes.hydrationError === undefined
          ? current.hydrationError
          : changes.hydrationError,
    });

    this.store.setState(snapshot, true);
    return snapshot;
  }

  /**
   * Hydrates persistent entities from the operations repository.
   *
   * @returns {Readonly<Record<string, unknown>>} Store snapshot.
   */
  hydrate() {
    this.ensureActive();

    try {
      const envelope = resolveOperationsEnvelope(
        readRepositorySnapshot(this.repository),
      );

      return this.replaceState({
        envelope,
        hydrationStatus:
          OPERATIONS_STORE_HYDRATION_STATUSES.READY,
        lastHydratedAt: getCurrentTimestamp(this.clock),
        hydrationError: null,
      });
    } catch (error) {
      const hydrationError = {
        code: OPERATIONS_STORE_ERROR_CODES.HYDRATION_FAILED,
        message: 'Operations data could not be hydrated.',
        repositoryCode:
          error !== null && typeof error === 'object'
            ? error.code ?? null
            : null,
      };

      return this.replaceState({
        hydrationStatus:
          OPERATIONS_STORE_HYDRATION_STATUSES.ERROR,
        lastHydratedAt: getCurrentTimestamp(this.clock),
        hydrationError,
      });
    }
  }

  /**
   * Reloads persistent entities while preserving all ephemeral state.
   *
   * @returns {Readonly<Record<string, unknown>>} Store snapshot.
   */
  refresh() {
    return this.hydrate();
  }

  /**
   * Returns the immutable current store snapshot.
   *
   * @returns {Readonly<Record<string, unknown>>} Store snapshot.
   */
  getSnapshot() {
    return this.store.getState();
  }

  getState() {
    return this.getSnapshot();
  }

  snapshot() {
    return this.getSnapshot();
  }

  getRevision() {
    return this.getSnapshot().revision;
  }

  getPersistentSnapshot() {
    return this.getSnapshot().envelope;
  }

  /**
   * Updates local queue filters without persisting them.
   *
   * @param {Record<string, unknown>} changes Filter changes.
   * @returns {Readonly<Record<string, unknown>>} Updated filters.
   */
  setFilters(changes) {
    this.ensureActive();
    const current = this.getSnapshot();
    const filters = normalizeFilters(changes, current.filters);

    this.replaceState({ filters });
    return filters;
  }

  setFilter(field, value) {
    requireIdentifier(field, 'Filter field');
    return this.setFilters({ [field]: value });
  }

  resetFilters() {
    this.ensureActive();
    this.replaceState({ filters: DEFAULT_OPERATIONS_FILTERS });
    return DEFAULT_OPERATIONS_FILTERS;
  }

  /**
   * Replaces the memory-only selected queue row identifiers.
   *
   * @param {string[]} rowIds Selected row identifiers.
   * @returns {readonly string[]} Updated selection.
   */
  setSelectedRows(rowIds) {
    this.ensureActive();

    if (!Array.isArray(rowIds)) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_IDENTIFIER,
        'Selected operations rows must be an array.',
      );
    }

    const selectedRowIds = rowIds.map((rowId) =>
      requireIdentifier(rowId, 'Selected row ID'),
    );

    if (new Set(selectedRowIds).size !== selectedRowIds.length) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_IDENTIFIER,
        'Selected operations rows must be unique.',
      );
    }

    this.replaceState({ selectedRowIds });
    return this.getSnapshot().selectedRowIds;
  }

  toggleRowSelection(rowId) {
    this.ensureActive();
    const identifier = requireIdentifier(rowId, 'Selected row ID');
    const selected = new Set(this.getSnapshot().selectedRowIds);

    if (selected.has(identifier)) {
      selected.delete(identifier);
    } else {
      selected.add(identifier);
    }

    return this.setSelectedRows([...selected]);
  }

  selectRow(rowId) {
    const identifier = requireIdentifier(rowId, 'Selected row ID');
    const selected = new Set(this.getSnapshot().selectedRowIds);

    selected.add(identifier);
    return this.setSelectedRows([...selected]);
  }

  deselectRow(rowId) {
    const identifier = requireIdentifier(rowId, 'Selected row ID');
    const selected = new Set(this.getSnapshot().selectedRowIds);

    selected.delete(identifier);
    return this.setSelectedRows([...selected]);
  }

  clearSelection() {
    this.ensureActive();
    this.replaceState({ selectedRowIds: [] });
    return this.getSnapshot().selectedRowIds;
  }

  /**
   * Updates memory-only deterministic playback state for a request.
   *
   * @param {string} requestId Request identifier.
   * @param {Record<string, unknown>} changes Player changes.
   * @returns {Readonly<Record<string, unknown>>} Updated player state.
   */
  setPlayerState(requestId, changes) {
    this.ensureActive();
    const identifier = requireIdentifier(requestId, 'Request ID');
    const current = this.getSnapshot();
    const previous =
      current.players[identifier] ??
      DEFAULT_OPERATIONS_PLAYER_STATE;
    const timestamp = getCurrentTimestamp(this.clock);
    const player = normalizePlayerState(
      changes,
      previous,
      timestamp,
    );
    const players = {
      ...current.players,
      [identifier]: player,
    };
    const active = new Set(current.activeRequestIds);

    if (player.status === OPERATIONS_PLAYER_STATUSES.RUNNING) {
      active.add(identifier);
    } else {
      active.delete(identifier);
    }

    this.replaceState({
      players,
      activeRequestIds: [...active],
    });

    return player;
  }

  getPlayerState(requestId) {
    const identifier = requireIdentifier(requestId, 'Request ID');

    return (
      this.getSnapshot().players[identifier] ??
      DEFAULT_OPERATIONS_PLAYER_STATE
    );
  }

  startPlayer(requestId, currentStep = null) {
    const timestamp = getCurrentTimestamp(this.clock);

    return this.setPlayerState(requestId, {
      status: OPERATIONS_PLAYER_STATUSES.RUNNING,
      currentStep,
      completedSteps: [],
      startedAt: timestamp,
      completedAt: null,
      errorCode: null,
    });
  }

  advancePlayer(requestId, currentStep, completedSteps) {
    return this.setPlayerState(requestId, {
      status: OPERATIONS_PLAYER_STATUSES.RUNNING,
      currentStep,
      completedSteps,
      completedAt: null,
      errorCode: null,
    });
  }

  pausePlayer(requestId, currentStep) {
    return this.setPlayerState(requestId, {
      status: OPERATIONS_PLAYER_STATUSES.PAUSED,
      currentStep,
    });
  }

  completePlayer(requestId, completedSteps = undefined) {
    return this.setPlayerState(requestId, {
      status: OPERATIONS_PLAYER_STATUSES.COMPLETE,
      currentStep: 'STORED',
      ...(completedSteps === undefined ? {} : { completedSteps }),
      completedAt: getCurrentTimestamp(this.clock),
      errorCode: null,
    });
  }

  failPlayer(requestId, errorCode, currentStep = undefined) {
    return this.setPlayerState(requestId, {
      status: OPERATIONS_PLAYER_STATUSES.FAILED,
      ...(currentStep === undefined ? {} : { currentStep }),
      completedAt: getCurrentTimestamp(this.clock),
      errorCode: requireIdentifier(
        errorCode,
        'Player error code',
      ),
    });
  }

  cancelPlayer(requestId) {
    this.abortRequest(requestId);

    return this.setPlayerState(requestId, {
      status: OPERATIONS_PLAYER_STATUSES.CANCELLED,
      completedAt: getCurrentTimestamp(this.clock),
    });
  }

  resetPlayer(requestId) {
    this.ensureActive();
    const identifier = requireIdentifier(requestId, 'Request ID');
    const current = this.getSnapshot();
    const players = { ...current.players };
    const active = new Set(current.activeRequestIds);

    delete players[identifier];
    active.delete(identifier);
    this.abortRequest(identifier);

    this.replaceState({
      players,
      activeRequestIds: [...active],
    });

    return DEFAULT_OPERATIONS_PLAYER_STATE;
  }

  resetAllPlayers() {
    this.ensureActive();

    [...this.abortControllers.keys()].forEach((requestId) => {
      this.abortRequest(requestId);
    });

    this.replaceState({
      players: {},
      activeRequestIds: [],
    });
  }

  /**
   * Creates or returns the memory-only AbortController for a request.
   *
   * @param {string} requestId Request identifier.
   * @returns {AbortController} Abort controller.
   */
  getAbortController(requestId) {
    this.ensureActive();
    const identifier = requireIdentifier(requestId, 'Request ID');
    const existing = this.abortControllers.get(identifier);

    if (existing !== undefined && !existing.signal.aborted) {
      return existing;
    }

    const AbortControllerConstructor = globalThis.AbortController;

    if (typeof AbortControllerConstructor !== 'function') {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_PLAYER_STATE,
        'AbortController is unavailable in this runtime.',
      );
    }

    const controller = new AbortControllerConstructor();

    this.abortControllers.set(identifier, controller);
    return controller;
  }

  abortRequest(requestId) {
    const identifier = requireIdentifier(requestId, 'Request ID');
    const controller = this.abortControllers.get(identifier);

    if (controller === undefined) {
      return false;
    }

    controller.abort();
    this.abortControllers.delete(identifier);
    return true;
  }

  /**
   * Registers a memory-only timer.
   *
   * Reusing a key replaces the existing timer. Callback failures are converted
   * to local warnings and never persisted.
   *
   * @param {string} timerKey Timer key.
   * @param {Function} callback Timer callback.
   * @param {number} delayMs Delay in milliseconds.
   * @returns {string} Registered timer key.
   */
  scheduleTimer(timerKey, callback, delayMs) {
    this.ensureActive();
    const key = requireIdentifier(timerKey, 'Timer key');

    if (
      typeof callback !== 'function' ||
      !Number.isFinite(delayMs) ||
      delayMs < 0
    ) {
      throw new OperationsStoreError(
        OPERATIONS_STORE_ERROR_CODES.INVALID_TIMER,
        'Operations timer requires a callback and non-negative finite delay.',
      );
    }

    this.clearTimer(key);

    const handle = globalThis.setTimeout(() => {
      this.timers.delete(key);

      if (!this.destroyed) {
        this.replaceState({
          timerKeys: [...this.timers.keys()],
        });
      }

      try {
        const result = callback();

        if (
          result !== null &&
          (typeof result === 'object' ||
            typeof result === 'function') &&
          typeof result.then === 'function'
        ) {
          result.catch(() => {
            if (!this.destroyed) {
              this.addWarning(
                'PLAYER_CALLBACK_FAILED',
                'A local playback callback could not be completed.',
              );
            }
          });
        }
      } catch {
        if (!this.destroyed) {
          this.addWarning(
            'PLAYER_CALLBACK_FAILED',
            'A local playback callback could not be completed.',
          );
        }
      }
    }, delayMs);

    this.timers.set(key, handle);
    this.replaceState({
      timerKeys: [...this.timers.keys()],
    });

    return key;
  }

  clearTimer(timerKey) {
    const key = requireIdentifier(timerKey, 'Timer key');
    const handle = this.timers.get(key);

    if (handle === undefined) {
      return false;
    }

    globalThis.clearTimeout(handle);
    this.timers.delete(key);

    if (!this.destroyed) {
      this.replaceState({
        timerKeys: [...this.timers.keys()],
      });
    }

    return true;
  }

  clearTimers() {
    this.timers.forEach((handle) => {
      globalThis.clearTimeout(handle);
    });
    this.timers.clear();

    if (!this.destroyed) {
      this.replaceState({ timerKeys: [] });
    }
  }

  /**
   * Adds a bounded memory-only warning.
   *
   * @param {string} code Stable warning code.
   * @param {string} message Human-readable warning.
   * @returns {Readonly<Record<string, unknown>>} Added warning.
   */
  addWarning(code, message) {
    this.ensureActive();
    this.warningSequence += 1;

    const warning = createNormalizedWarning(
      `operations-warning-${this.warningSequence}`,
      code,
      message,
      getCurrentTimestamp(this.clock),
    );
    const warnings = [
      ...this.getSnapshot().warnings,
      warning,
    ].slice(-MAXIMUM_WARNINGS);

    this.replaceState({ warnings });
    return warning;
  }

  dismissWarning(warningId) {
    this.ensureActive();
    const identifier = requireIdentifier(
      warningId,
      'Warning ID',
    );
    const current = this.getSnapshot();
    const warnings = current.warnings.filter(
      (warning) => warning.warningId !== identifier,
    );
    const changed = warnings.length !== current.warnings.length;

    if (changed) {
      this.replaceState({ warnings });
    }

    return changed;
  }

  clearWarnings() {
    this.ensureActive();
    this.replaceState({ warnings: [] });
    return this.getSnapshot().warnings;
  }

  /**
   * Subscribes to operations store snapshot changes.
   *
   * @param {(snapshot: Readonly<Record<string, unknown>>, previousSnapshot: Readonly<Record<string, unknown>>) => void}
   * listener Snapshot listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'Operations store listener must be a function.',
      );
    }

    if (this.destroyed) {
      return () => {};
    }

    return this.store.subscribe(listener);
  }

  /**
   * Releases repository subscriptions and memory-only runtime resources.
   *
   * @returns {void}
   */
  destroy() {
    if (this.destroyed) {
      return;
    }

    this.clearTimers();

    this.abortControllers.forEach((controller) => {
      controller.abort();
    });
    this.abortControllers.clear();
    this.unsubscribeRepository();
    this.unsubscribeRepository = () => {};
    this.destroyed = true;

    const current = this.store.getState();

    this.store.setState(
      createStoreSnapshot({
        envelope: current.envelope,
        hydrationStatus:
          OPERATIONS_STORE_HYDRATION_STATUSES.DESTROYED,
        players: current.players,
        selectedRowIds: current.selectedRowIds,
        filters: current.filters,
        warnings: current.warnings,
        timerKeys: [],
        activeRequestIds: [],
        lastHydratedAt: current.lastHydratedAt,
        hydrationError: current.hydrationError,
      }),
      true,
    );
  }

  load() {
    return this.getSnapshot();
  }

  setQueueFilters(changes) {
    return this.setFilters(changes);
  }

  resetQueueFilters() {
    return this.resetFilters();
  }

  setSelectedRequestIds(requestIds) {
    return this.setSelectedRows(requestIds);
  }

  toggleSelectedRequest(requestId) {
    return this.toggleRowSelection(requestId);
  }

  clearSelectedRequests() {
    return this.clearSelection();
  }

  registerTimer(timerKey, callback, delayMs) {
    return this.scheduleTimer(timerKey, callback, delayMs);
  }

  removeTimer(timerKey) {
    return this.clearTimer(timerKey);
  }

  pushWarning(code, message) {
    return this.addWarning(code, message);
  }
}

/**
 * Creates a Zustand-backed operations store.
 *
 * @param {ConstructorParameters<typeof OperationsStore>[0]}
 * repositoryOrOptions Repository or store options.
 * @param {ConstructorParameters<typeof OperationsStore>[1]} [options]
 * Store options.
 * @returns {OperationsStore} Operations store.
 */
export function createOperationsStore(
  repositoryOrOptions,
  options = {},
) {
  return new OperationsStore(repositoryOrOptions, options);
}

export function selectOperationsEnvelope(state) {
  return state.envelope;
}

export function selectOperationsRequests(state) {
  return state.requests;
}

export function selectOperationsFilters(state) {
  return state.filters;
}

export function selectSelectedOperationRows(state) {
  return state.selectedRowIds;
}

export function selectOperationsWarnings(state) {
  return state.warnings;
}

export function selectOperationPlayer(state, requestId) {
  return (
    state.players?.[requestId] ??
    DEFAULT_OPERATIONS_PLAYER_STATE
  );
}

export function selectIsOperationPlayerActive(state, requestId) {
  return state.activeRequestIds?.includes(requestId) === true;
}

export const OperationsDomainStore = OperationsStore;
export const LocalOperationsStore = OperationsStore;
export const createOperationsDomainStore = createOperationsStore;
export const createLocalOperationsStore = createOperationsStore;

export default OperationsStore;