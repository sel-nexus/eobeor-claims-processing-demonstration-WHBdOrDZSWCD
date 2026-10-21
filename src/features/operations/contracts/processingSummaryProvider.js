import {
  adaptProcessingSummaryDto,
  SIBLING_CONTRACT_VERSION,
} from '../../../platform/contracts/siblingContracts.js';
import {
  isPlainObject,
} from '../../../platform/validation/schemas.js';

export const PROCESSING_SUMMARY_PROVIDER_SCHEMA_VERSION = 1;
export const PROCESSING_SUMMARY_DTO_NAME =
  'ProcessingSummaryDTO.v1';

export const PROCESSING_SUMMARY_PROVIDER_ERROR_CODES =
  Object.freeze({
    INVALID_SOURCE: 'INVALID_SOURCE',
    INVALID_ENVELOPE: 'INVALID_ENVELOPE',
    INVALID_LISTENER: 'INVALID_LISTENER',
  });

const REQUEST_STATUSES = Object.freeze([
  'PENDING',
  'PROCESSING',
  'PAUSED',
  'MANUAL_REVIEW',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
]);

const PIPELINE_STATUSES = Object.freeze([
  'RUNNING',
  'PAUSED',
  'MANUAL_REVIEW',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
]);

const DOCUMENT_STATUSES = Object.freeze([
  'COMPLETE',
  'VOID',
]);

const INBOUND_ROW_STATUSES = Object.freeze([
  'PENDING',
  'APPLIED',
  'FAILED',
]);

const BATCH_ROW_STATUSES = Object.freeze([
  'QUEUED',
  'PROCESSING',
  'COMPLETE',
  'FAILED',
]);

const REVIEW_STATUSES = Object.freeze([
  'OPEN',
  'APPROVED',
  'REJECTED',
]);

const ERROR_REPORT_STATUSES = Object.freeze([
  'OPEN',
  'QUEUED',
  'CLOSED',
]);

const OUTBOUND_STATUSES = Object.freeze([
  'COMPLETE',
  'READY',
  'SENT',
  'NOT_REQUESTED',
]);

const providerCache = new WeakMap();

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

function isReadableSource(value) {
  return (
    isPlainObject(value) ||
    (value !== null &&
      typeof value === 'object' &&
      (typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function' ||
        typeof value.read === 'function' ||
        typeof value.load === 'function'))
  );
}

function requireSource(value) {
  if (!isReadableSource(value)) {
    throw new ProcessingSummaryProviderError(
      PROCESSING_SUMMARY_PROVIDER_ERROR_CODES.INVALID_SOURCE,
      'Processing summary provider requires an operations snapshot or readable source.',
    );
  }

  return value;
}

function readSource(source) {
  if (typeof source.getSnapshot === 'function') {
    return source.getSnapshot();
  }

  if (typeof source.getState === 'function') {
    return source.getState();
  }

  if (typeof source.read === 'function') {
    return source.read();
  }

  if (typeof source.load === 'function') {
    return source.load();
  }

  return source;
}

function hasOperationsCollections(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.requests) &&
    isPlainObject(value.pipelineRuns) &&
    isPlainObject(value.documents) &&
    isPlainObject(value.inboundRuns) &&
    isPlainObject(value.batchRuns) &&
    isPlainObject(value.reviews) &&
    isPlainObject(value.errorReports) &&
    isPlainObject(value.outboundRecords)
  );
}

function resolveEnvelope(value) {
  const candidates = [
    value,
    value?.envelope,
    value?.operationsEnvelope,
    value?.persistent,
    value?.data,
    value?.slices?.operationsEnvelope,
    value?.slices?.operations,
    value?.operations?.initialEnvelope,
  ];

  const envelope = candidates.find(hasOperationsCollections);

  if (envelope === undefined) {
    throw new ProcessingSummaryProviderError(
      PROCESSING_SUMMARY_PROVIDER_ERROR_CODES.INVALID_ENVELOPE,
      'Operations source does not contain a valid summary envelope.',
    );
  }

  return envelope;
}

function countByStatus(values, statuses) {
  const counts = Object.fromEntries(
    statuses.map((status) => [status, 0]),
  );

  values.forEach((value) => {
    if (
      isPlainObject(value) &&
      Object.prototype.hasOwnProperty.call(counts, value.status)
    ) {
      counts[value.status] += 1;
    }
  });

  return counts;
}

function collectNestedRows(runs) {
  return runs.flatMap((run) =>
    isPlainObject(run) && Array.isArray(run.rows)
      ? run.rows.filter(isPlainObject)
      : [],
  );
}

function createProcessingSummary(envelope) {
  const requests = Object.values(envelope.requests);
  const pipelineRuns = Object.values(envelope.pipelineRuns);
  const documents = Object.values(envelope.documents);
  const inboundRuns = Object.values(envelope.inboundRuns);
  const batchRuns = Object.values(envelope.batchRuns);
  const reviews = Object.values(envelope.reviews);
  const errorReports = Object.values(envelope.errorReports);
  const outboundRecords = Object.values(
    envelope.outboundRecords,
  );
  const inboundRows = collectNestedRows(inboundRuns);
  const batchRows = collectNestedRows(batchRuns);
  const requestStatuses = countByStatus(
    requests,
    REQUEST_STATUSES,
  );
  const pipelineStatuses = countByStatus(
    pipelineRuns,
    PIPELINE_STATUSES,
  );
  const documentStatuses = countByStatus(
    documents,
    DOCUMENT_STATUSES,
  );
  const inboundRowStatuses = countByStatus(
    inboundRows,
    INBOUND_ROW_STATUSES,
  );
  const batchRowStatuses = countByStatus(
    batchRows,
    BATCH_ROW_STATUSES,
  );
  const reviewStatuses = countByStatus(
    reviews,
    REVIEW_STATUSES,
  );
  const errorStatuses = countByStatus(
    errorReports,
    ERROR_REPORT_STATUSES,
  );
  const outboundStatuses = countByStatus(
    outboundRecords,
    OUTBOUND_STATUSES,
  );
  const documentTypeCounts = documents.reduce(
    (counts, document) => {
      if (document?.documentType === 'EOB') {
        counts.eob += 1;
      } else if (document?.documentType === 'EOR') {
        counts.eor += 1;
      }

      return counts;
    },
    { eob: 0, eor: 0 },
  );

  return adaptProcessingSummaryDto({
    schemaVersion: SIBLING_CONTRACT_VERSION,
    dtoName: PROCESSING_SUMMARY_DTO_NAME,
    providerSchemaVersion:
      PROCESSING_SUMMARY_PROVIDER_SCHEMA_VERSION,
    revision:
      Number.isSafeInteger(envelope.revision) &&
      envelope.revision >= 0
        ? envelope.revision
        : 0,
    asOf:
      typeof envelope.updatedAt === 'string' &&
      Number.isFinite(Date.parse(envelope.updatedAt))
        ? new Date(envelope.updatedAt).toISOString()
        : null,
    simulated: true,
    representativeOnly: true,
    requestCounts: {
      total: requests.length,
      pending: requestStatuses.PENDING,
      processing: requestStatuses.PROCESSING,
      paused: requestStatuses.PAUSED,
      manualReview: requestStatuses.MANUAL_REVIEW,
      complete: requestStatuses.COMPLETE,
      failed: requestStatuses.FAILED,
      cancelled: requestStatuses.CANCELLED,
    },
    pipelineCounts: {
      total: pipelineRuns.length,
      running: pipelineStatuses.RUNNING,
      paused: pipelineStatuses.PAUSED,
      manualReview: pipelineStatuses.MANUAL_REVIEW,
      complete: pipelineStatuses.COMPLETE,
      failed: pipelineStatuses.FAILED,
      cancelled: pipelineStatuses.CANCELLED,
    },
    documentCounts: {
      total: documents.length,
      eob: documentTypeCounts.eob,
      eor: documentTypeCounts.eor,
      complete: documentStatuses.COMPLETE,
      void: documentStatuses.VOID,
    },
    inboundCounts: {
      runs: inboundRuns.length,
      rows: inboundRows.length,
      pendingRows: inboundRowStatuses.PENDING,
      appliedRows: inboundRowStatuses.APPLIED,
      failedRows: inboundRowStatuses.FAILED,
    },
    batchCounts: {
      runs: batchRuns.length,
      rows: batchRows.length,
      queuedRows: batchRowStatuses.QUEUED,
      processingRows: batchRowStatuses.PROCESSING,
      completedRows: batchRowStatuses.COMPLETE,
      failedRows: batchRowStatuses.FAILED,
    },
    reviewCounts: {
      total: reviews.length,
      open: reviewStatuses.OPEN,
      approved: reviewStatuses.APPROVED,
      rejected: reviewStatuses.REJECTED,
    },
    errorReportCounts: {
      total: errorReports.length,
      open: errorStatuses.OPEN,
      queued: errorStatuses.QUEUED,
      closed: errorStatuses.CLOSED,
    },
    outboundCounts: {
      total: outboundRecords.length,
      complete: outboundStatuses.COMPLETE,
      ready: outboundStatuses.READY,
      sent: outboundStatuses.SENT,
      notRequested: outboundStatuses.NOT_REQUESTED,
    },
    disclosure:
      'Representative browser-local operations summary; no external system was contacted.',
  });
}

/**
 * Error raised when processing summary data cannot be read safely.
 */
export class ProcessingSummaryProviderError extends Error {
  /**
   * @param {string} code Stable provider error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ProcessingSummaryProviderError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Provides sanitized aggregate operations data for sibling dashboards.
 */
export class ProcessingSummaryProvider {
  /**
   * @param {object|Record<string, unknown>} source Operations repository,
   * store, or immutable operations envelope.
   */
  constructor(source) {
    this.source = requireSource(source);
    this.cachedEnvelope = null;
    this.cachedRevision = null;
    this.cachedUpdatedAt = null;
    this.cachedSummary = null;
  }

  /**
   * Returns a sanitized immutable processing summary.
   *
   * @returns {Readonly<Record<string, unknown>>} Processing summary DTO.
   */
  listProcessingSummary() {
    const envelope = resolveEnvelope(readSource(this.source));
    const revision =
      Number.isSafeInteger(envelope.revision)
        ? envelope.revision
        : 0;
    const updatedAt =
      typeof envelope.updatedAt === 'string'
        ? envelope.updatedAt
        : null;

    if (
      this.cachedSummary !== null &&
      this.cachedEnvelope === envelope &&
      this.cachedRevision === revision &&
      this.cachedUpdatedAt === updatedAt
    ) {
      return this.cachedSummary;
    }

    this.cachedEnvelope = envelope;
    this.cachedRevision = revision;
    this.cachedUpdatedAt = updatedAt;
    this.cachedSummary = createProcessingSummary(envelope);

    return this.cachedSummary;
  }

  getProcessingSummary() {
    return this.listProcessingSummary();
  }

  provideProcessingSummary() {
    return this.listProcessingSummary();
  }

  /**
   * Subscribes to sanitized processing-summary changes.
   *
   * @param {(summary: Readonly<Record<string, unknown>>, previousSummary: Readonly<Record<string, unknown>>) => void}
   * listener Summary listener.
   * @returns {() => void} Unsubscribe function.
   */
  subscribeProcessingSummary(listener) {
    if (typeof listener !== 'function') {
      throw new ProcessingSummaryProviderError(
        PROCESSING_SUMMARY_PROVIDER_ERROR_CODES.INVALID_LISTENER,
        'Processing summary listener must be a function.',
      );
    }

    if (typeof this.source.subscribe !== 'function') {
      return () => {};
    }

    let previousSummary = this.listProcessingSummary();

    return this.source.subscribe(() => {
      const summary = this.listProcessingSummary();

      if (summary === previousSummary) {
        return;
      }

      const previous = previousSummary;

      previousSummary = summary;
      listener(summary, previous);
    });
  }

  subscribe(listener) {
    return this.subscribeProcessingSummary(listener);
  }
}

/**
 * Creates a processing summary provider.
 *
 * @param {ConstructorParameters<typeof ProcessingSummaryProvider>[0]} source
 * Operations source.
 * @returns {ProcessingSummaryProvider} Processing summary provider.
 */
export function createProcessingSummaryProvider(source) {
  return new ProcessingSummaryProvider(source);
}

function getCachedProvider(source) {
  requireSource(source);

  if (
    source === null ||
    (typeof source !== 'object' && typeof source !== 'function')
  ) {
    return createProcessingSummaryProvider(source);
  }

  const existing = providerCache.get(source);

  if (existing !== undefined) {
    return existing;
  }

  const provider = createProcessingSummaryProvider(source);

  providerCache.set(source, provider);
  return provider;
}

/**
 * Returns sanitized aggregate operations data.
 *
 * @param {object|Record<string, unknown>} source Operations source.
 * @returns {Readonly<Record<string, unknown>>} Processing summary DTO.
 */
export function listProcessingSummary(source) {
  return getCachedProvider(source).listProcessingSummary();
}

/**
 * Subscribes to sanitized aggregate operations data.
 *
 * @param {object|Record<string, unknown>} source Operations source.
 * @param {(summary: Readonly<Record<string, unknown>>, previousSummary: Readonly<Record<string, unknown>>) => void}
 * listener Summary listener.
 * @returns {() => void} Unsubscribe function.
 */
export function subscribeProcessingSummary(source, listener) {
  return getCachedProvider(source).subscribeProcessingSummary(
    listener,
  );
}

export const LocalProcessingSummaryProvider =
  ProcessingSummaryProvider;
export const OperationsProcessingSummaryProvider =
  ProcessingSummaryProvider;
export const createLocalProcessingSummaryProvider =
  createProcessingSummaryProvider;
export const getProcessingSummary = listProcessingSummary;

export default ProcessingSummaryProvider;