import {
  BATCH_ROW_STATUS_VALUES,
  BATCH_STATUS_VALUES,
  BATCH_STEP_VALUES,
  FAX_STATE_VALUES,
  OUTCOME_VALUES,
  PIPELINE_STATUS_VALUES,
  PIPELINE_STEP_STATUS_VALUES,
  PIPELINE_STEP_VALUES,
  PRIORITY_VALUES,
  PROCESSING_SCENARIO_VALUES,
  REQUEST_STATUS_VALUES,
  REQUEST_TYPE_VALUES,
  SEVERITY_VALUES,
  SOURCE_TYPE_VALUES,
} from './domainConstants.js';
import {
  isFiniteNumber,
  isIsoDateTime,
  isJsonCompatible,
  isNonEmptyString,
  isNonNegativeInteger,
  isPlainObject,
} from '../../../platform/validation/schemas.js';

export const DOCUMENT_TYPES = Object.freeze({
  EOB: 'EOB',
  EOR: 'EOR',
});

export const DOCUMENT_STATUSES = Object.freeze({
  COMPLETE: 'COMPLETE',
  VOID: 'VOID',
});

export const DOCUMENT_ARTIFACT_KEYS = Object.freeze({
  EOB_SAMPLE: 'EOB_SAMPLE',
  EOR_SAMPLE: 'EOR_SAMPLE',
});

export const INBOUND_FEED_TYPES = Object.freeze({
  AP_REPRINT: 'AP_REPRINT',
  CHANGE_835: 'CHANGE_835',
});

export const INBOUND_RUN_STATUSES = Object.freeze({
  PARSING: 'PARSING',
  COMPLETE: 'COMPLETE',
  COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
  FAILED: 'FAILED',
});

export const INBOUND_ROW_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  FAILED: 'FAILED',
});

export const REVIEW_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

export const ERROR_REPORT_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  QUEUED: 'QUEUED',
  CLOSED: 'CLOSED',
});

export const OUTBOUND_KINDS = Object.freeze({
  IXIT: 'IXIT',
  REPORTING: 'REPORTING',
  REPRINT_REFERENCE: 'REPRINT_REFERENCE',
  EMAIL: 'EMAIL',
  CRM: 'CRM',
  FAX: 'FAX',
});

export const OUTBOUND_STATUSES = Object.freeze({
  COMPLETE: 'COMPLETE',
  READY: 'READY',
  SENT: 'SENT',
  NOT_REQUESTED: 'NOT_REQUESTED',
});

export const CDC_OPERATIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
});

export const DOCUMENT_TYPE_VALUES = Object.freeze(
  Object.values(DOCUMENT_TYPES),
);

export const DOCUMENT_STATUS_VALUES = Object.freeze(
  Object.values(DOCUMENT_STATUSES),
);

export const DOCUMENT_ARTIFACT_KEY_VALUES = Object.freeze(
  Object.values(DOCUMENT_ARTIFACT_KEYS),
);

export const INBOUND_FEED_TYPE_VALUES = Object.freeze(
  Object.values(INBOUND_FEED_TYPES),
);

export const INBOUND_RUN_STATUS_VALUES = Object.freeze(
  Object.values(INBOUND_RUN_STATUSES),
);

export const INBOUND_ROW_STATUS_VALUES = Object.freeze(
  Object.values(INBOUND_ROW_STATUSES),
);

export const REVIEW_STATUS_VALUES = Object.freeze(
  Object.values(REVIEW_STATUSES),
);

export const ERROR_REPORT_STATUS_VALUES = Object.freeze(
  Object.values(ERROR_REPORT_STATUSES),
);

export const OUTBOUND_KIND_VALUES = Object.freeze(
  Object.values(OUTBOUND_KINDS),
);

export const OUTBOUND_STATUS_VALUES = Object.freeze(
  Object.values(OUTBOUND_STATUSES),
);

export const CDC_OPERATION_VALUES = Object.freeze(
  Object.values(CDC_OPERATIONS),
);

const requestTypeValues = new Set(REQUEST_TYPE_VALUES);
const priorityValues = new Set(PRIORITY_VALUES);
const requestStatusValues = new Set(REQUEST_STATUS_VALUES);
const pipelineStatusValues = new Set(PIPELINE_STATUS_VALUES);
const pipelineStepValues = new Set(PIPELINE_STEP_VALUES);
const pipelineStepStatusValues = new Set(PIPELINE_STEP_STATUS_VALUES);
const batchStepValues = new Set(BATCH_STEP_VALUES);
const batchStatusValues = new Set(BATCH_STATUS_VALUES);
const batchRowStatusValues = new Set(BATCH_ROW_STATUS_VALUES);
const sourceTypeValues = new Set(SOURCE_TYPE_VALUES);
const outcomeValues = new Set(OUTCOME_VALUES);
const processingScenarioValues = new Set(PROCESSING_SCENARIO_VALUES);
const faxStateValues = new Set(FAX_STATE_VALUES);
const severityValues = new Set(SEVERITY_VALUES);
const documentTypeValues = new Set(DOCUMENT_TYPE_VALUES);
const documentStatusValues = new Set(DOCUMENT_STATUS_VALUES);
const documentArtifactKeyValues = new Set(DOCUMENT_ARTIFACT_KEY_VALUES);
const inboundFeedTypeValues = new Set(INBOUND_FEED_TYPE_VALUES);
const inboundRunStatusValues = new Set(INBOUND_RUN_STATUS_VALUES);
const inboundRowStatusValues = new Set(INBOUND_ROW_STATUS_VALUES);
const reviewStatusValues = new Set(REVIEW_STATUS_VALUES);
const errorReportStatusValues = new Set(ERROR_REPORT_STATUS_VALUES);
const outboundKindValues = new Set(OUTBOUND_KIND_VALUES);
const outboundStatusValues = new Set(OUTBOUND_STATUS_VALUES);
const cdcOperationValues = new Set(CDC_OPERATION_VALUES);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[A-Z0-9_-]+$/;
const DISPLAY_ID_PATTERN = /^REQ-[0-9]{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function isEnumValue(values, value) {
  return typeof value === 'string' && values.has(value);
}

function isStringWithin(value, minimum, maximum) {
  return (
    typeof value === 'string' &&
    value.trim().length >= minimum &&
    value.trim().length <= maximum
  );
}

function isNullableStringWithin(value, maximum) {
  return value === null || isStringWithin(value, 0, maximum);
}

function isIdentifier(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 40 &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function isEntityId(value, maximum = 100) {
  return isStringWithin(value, 1, maximum);
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isNullableIsoDateTime(value) {
  return value === null || isIsoDateTime(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isNullableNonNegativeInteger(value) {
  return value === null || isNonNegativeInteger(value);
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
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

function isDecimalString(value) {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value);
}

function isJsonObject(value) {
  return isPlainObject(value) && isJsonCompatible(value);
}

function hasUniqueValues(values) {
  return new Set(values).size === values.length;
}

function hasValidChronology(startedAt, completedAt) {
  return (
    completedAt === null ||
    startedAt === null ||
    Date.parse(completedAt) >= Date.parse(startedAt)
  );
}

function cloneAndFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item)));
  }

  if (isPlainObject(value)) {
    const clone = {};

    Object.entries(value).forEach(([key, item]) => {
      clone[key] = cloneAndFreeze(item);
    });

    return Object.freeze(clone);
  }

  return value;
}

function createEntity(value, predicate, entityName) {
  if (!predicate(value)) {
    throw new TypeError(`${entityName} does not satisfy its schema.`);
  }

  return cloneAndFreeze(value);
}

/**
 * Determines whether a value is a valid operations identifier.
 *
 * @param {unknown} value Candidate identifier.
 * @returns {boolean} Whether the identifier is valid.
 */
export function isOperationsIdentifier(value) {
  return isIdentifier(value);
}

/**
 * Determines whether a value is an RFC 4122 UUID.
 *
 * @param {unknown} value Candidate UUID.
 * @returns {boolean} Whether the value is a UUID.
 */
export function isOperationsUuid(value) {
  return isUuid(value);
}

/**
 * Determines whether a value is a valid pipeline step result.
 *
 * @param {unknown} value Candidate step result.
 * @returns {boolean} Whether the value satisfies the step schema.
 */
export function isPipelineStepResult(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  return (
    isEnumValue(pipelineStepValues, value.step) &&
    isEnumValue(pipelineStepStatusValues, value.status) &&
    isDecimalString(value.printedMinutes) &&
    (value.startedAt === null || isIsoDateTime(value.startedAt)) &&
    (value.endedAt === null || isIsoDateTime(value.endedAt)) &&
    (value.startedAt === null ||
      value.endedAt === null ||
      Date.parse(value.endedAt) >= Date.parse(value.startedAt)) &&
    (value.code === null || isStringWithin(value.code, 1, 100)) &&
    (value.message === null || isStringWithin(value.message, 0, 300))
  );
}

/**
 * Creates an immutable pipeline step result.
 *
 * @param {unknown} value Step result data.
 * @returns {Readonly<Record<string, unknown>>} Frozen step result.
 */
export function createPipelineStepResult(value) {
  return createEntity(
    value,
    isPipelineStepResult,
    'Pipeline step result',
  );
}

/**
 * Determines whether a value is a valid reprint request.
 *
 * @param {unknown} value Candidate request.
 * @returns {boolean} Whether the value satisfies the request schema.
 */
export function isReprintRequest(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const referencesAreValid =
    Array.isArray(value.documentReferences) &&
    value.documentReferences.every((reference) =>
      isEntityId(reference, 100),
    ) &&
    hasUniqueValues(value.documentReferences);

  return (
    isUuid(value.requestId) &&
    typeof value.displayId === 'string' &&
    DISPLAY_ID_PATTERN.test(value.displayId) &&
    isIdentifier(value.claimNumber) &&
    isIdentifier(value.memberId) &&
    isEnumValue(requestTypeValues, value.requestType) &&
    isEnumValue(priorityValues, value.priority) &&
    isEnumValue(sourceTypeValues, value.sourceType) &&
    isStringWithin(value.sourceDetail, 0, 200) &&
    isEnumValue(requestStatusValues, value.status) &&
    isIsoDateTime(value.createdAt) &&
    isNullableIsoDateTime(value.startedAt) &&
    isNullableIsoDateTime(value.completedAt) &&
    hasValidChronology(value.startedAt, value.completedAt) &&
    Date.parse(value.startedAt ?? value.createdAt) >=
      Date.parse(value.createdAt) &&
    (value.completedAt === null ||
      Date.parse(value.completedAt) >= Date.parse(value.createdAt)) &&
    isNullableNonNegativeInteger(value.processingTimeMs) &&
    isNullableStringWithin(value.result, 500) &&
    referencesAreValid &&
    (value.errorReportId === null ||
      isEntityId(value.errorReportId, 100)) &&
    isEnumValue(pipelineStepValues, value.currentStep) &&
    isEnumValue(faxStateValues, value.faxStatus) &&
    isStringWithin(value.requestedBy, 1, 80) &&
    isPositiveInteger(value.version)
  );
}

/**
 * Creates an immutable reprint request.
 *
 * @param {unknown} value Request data.
 * @returns {Readonly<Record<string, unknown>>} Frozen request.
 */
export function createReprintRequest(value) {
  return createEntity(value, isReprintRequest, 'Reprint request');
}

/**
 * Determines whether a value is a valid pipeline run.
 *
 * @param {unknown} value Candidate run.
 * @returns {boolean} Whether the value satisfies the pipeline run schema.
 */
export function isPipelineRun(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const completedStepsAreValid =
    Array.isArray(value.completedSteps) &&
    value.completedSteps.every((step) =>
      isEnumValue(pipelineStepValues, step),
    ) &&
    hasUniqueValues(value.completedSteps);

  const stepResultsAreValid =
    value.stepResults === undefined ||
    (Array.isArray(value.stepResults) &&
      value.stepResults.every(isPipelineStepResult) &&
      hasUniqueValues(value.stepResults.map((result) => result.step)));

  return (
    isUuid(value.runId) &&
    isUuid(value.requestId) &&
    isEnumValue(processingScenarioValues, value.scenario) &&
    isEnumValue(pipelineStatusValues, value.status) &&
    isEnumValue(pipelineStepValues, value.currentStep) &&
    completedStepsAreValid &&
    isJsonObject(value.checkpoint) &&
    Array.isArray(value.agentOutcomes) &&
    value.agentOutcomes.every(isJsonObject) &&
    isIsoDateTime(value.startedAt) &&
    isIsoDateTime(value.updatedAt) &&
    Date.parse(value.updatedAt) >= Date.parse(value.startedAt) &&
    stepResultsAreValid
  );
}

/**
 * Creates an immutable pipeline run.
 *
 * @param {unknown} value Pipeline run data.
 * @returns {Readonly<Record<string, unknown>>} Frozen pipeline run.
 */
export function createPipelineRun(value) {
  return createEntity(value, isPipelineRun, 'Pipeline run');
}

/**
 * Determines whether a value is a valid immutable document version.
 *
 * @param {unknown} value Candidate document version.
 * @returns {boolean} Whether the value satisfies the document schema.
 */
export function isDocumentVersion(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  return (
    isEntityId(value.documentId, 100) &&
    isEnumValue(documentTypeValues, value.documentType) &&
    isIdentifier(value.claimNumber) &&
    isIdentifier(value.memberId) &&
    isPositiveInteger(value.version) &&
    isEnumValue(documentStatusValues, value.status) &&
    isDateOnly(value.documentDate) &&
    isEnumValue(documentArtifactKeyValues, value.artifactKey) &&
    isStringWithin(value.fixtureText, 0, 20000) &&
    isIsoDateTime(value.createdAt) &&
    isStringWithin(value.createdBy, 1, 80) &&
    isUuid(value.requestId)
  );
}

/**
 * Creates an immutable document version.
 *
 * @param {unknown} value Document version data.
 * @returns {Readonly<Record<string, unknown>>} Frozen document version.
 */
export function createDocumentVersion(value) {
  return createEntity(value, isDocumentVersion, 'Document version');
}

/**
 * Determines whether a value is a valid idempotency record.
 *
 * @param {unknown} value Candidate record.
 * @returns {boolean} Whether the value satisfies the idempotency schema.
 */
export function isIdempotencyRecord(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isUuid(value.idempotencyKey) &&
    isStringWithin(value.commandName, 1, 100) &&
    isStringWithin(value.requestHash, 1, 256) &&
    isJsonObject(value.result) &&
    isIsoDateTime(value.createdAt)
  );
}

/**
 * Creates an immutable idempotency record.
 *
 * @param {unknown} value Idempotency data.
 * @returns {Readonly<Record<string, unknown>>} Frozen record.
 */
export function createIdempotencyRecord(value) {
  return createEntity(
    value,
    isIdempotencyRecord,
    'Idempotency record',
  );
}

/**
 * Determines whether a value is a valid inbound feed row.
 *
 * @param {unknown} value Candidate row.
 * @returns {boolean} Whether the value satisfies the inbound row schema.
 */
export function isInboundRow(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    Number.isInteger(value.rowNumber) &&
    value.rowNumber > 1 &&
    isJsonObject(value.values) &&
    isEnumValue(inboundRowStatusValues, value.status) &&
    Number.isInteger(value.attempt) &&
    value.attempt >= 1 &&
    value.attempt <= 3 &&
    (value.errorCode === null ||
      isStringWithin(value.errorCode, 1, 100)) &&
    (value.resultReference === null ||
      isEntityId(value.resultReference, 100))
  );
}

/**
 * Creates an immutable inbound feed row.
 *
 * @param {unknown} value Inbound row data.
 * @returns {Readonly<Record<string, unknown>>} Frozen inbound row.
 */
export function createInboundRow(value) {
  return createEntity(value, isInboundRow, 'Inbound row');
}

/**
 * Determines whether a value is a valid inbound feed run.
 *
 * @param {unknown} value Candidate run.
 * @returns {boolean} Whether the value satisfies the inbound run schema.
 */
export function isInboundRun(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  return (
    isEntityId(value.feedRunId, 100) &&
    isEnumValue(inboundFeedTypeValues, value.feedType) &&
    isStringWithin(value.filename, 1, 255) &&
    isStringWithin(value.maskedApiKeyId, 4, 32) &&
    Array.isArray(value.header) &&
    value.header.length > 0 &&
    value.header.every(
      (column) => isStringWithin(column, 1, 100),
    ) &&
    hasUniqueValues(value.header) &&
    isEnumValue(inboundRunStatusValues, value.status) &&
    Array.isArray(value.rows) &&
    value.rows.length <= 5000 &&
    value.rows.every(isInboundRow) &&
    hasUniqueValues(value.rows.map((row) => row.rowNumber)) &&
    isIsoDateTime(value.createdAt)
  );
}

/**
 * Creates an immutable inbound feed run.
 *
 * @param {unknown} value Inbound run data.
 * @returns {Readonly<Record<string, unknown>>} Frozen inbound run.
 */
export function createInboundRun(value) {
  return createEntity(value, isInboundRun, 'Inbound run');
}

/**
 * Determines whether a value is a valid batch step result.
 *
 * @param {unknown} value Candidate step.
 * @returns {boolean} Whether the value satisfies the batch step schema.
 */
export function isBatchStepResult(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const statusIsValid =
    isEnumValue(pipelineStepStatusValues, value.status) ||
    isEnumValue(outcomeValues, value.status);

  return (
    isEnumValue(batchStepValues, value.step) &&
    statusIsValid &&
    (value.startedAt === null || isIsoDateTime(value.startedAt)) &&
    (value.endedAt === null || isIsoDateTime(value.endedAt)) &&
    (value.startedAt === null ||
      value.endedAt === null ||
      Date.parse(value.endedAt) >= Date.parse(value.startedAt)) &&
    (value.code === null || isStringWithin(value.code, 1, 100)) &&
    (value.message === null || isStringWithin(value.message, 0, 300))
  );
}

/**
 * Creates an immutable batch step result.
 *
 * @param {unknown} value Batch step data.
 * @returns {Readonly<Record<string, unknown>>} Frozen batch step.
 */
export function createBatchStepResult(value) {
  return createEntity(
    value,
    isBatchStepResult,
    'Batch step result',
  );
}

/**
 * Determines whether a value is a valid batch row.
 *
 * @param {unknown} value Candidate row.
 * @returns {boolean} Whether the value satisfies the batch row schema.
 */
export function isBatchRow(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isEntityId(value.rowId, 100) &&
    isIdentifier(value.claimNumber) &&
    isIdentifier(value.memberId) &&
    isEnumValue(batchRowStatusValues, value.status) &&
    Number.isInteger(value.attempt) &&
    value.attempt >= 1 &&
    value.attempt <= 3 &&
    (value.reasonCode === null ||
      isStringWithin(value.reasonCode, 1, 100)) &&
    (value.reportId === null || isEntityId(value.reportId, 100))
  );
}

/**
 * Creates an immutable batch row.
 *
 * @param {unknown} value Batch row data.
 * @returns {Readonly<Record<string, unknown>>} Frozen batch row.
 */
export function createBatchRow(value) {
  return createEntity(value, isBatchRow, 'Batch row');
}

/**
 * Determines whether a value is a valid batch run.
 *
 * @param {unknown} value Candidate run.
 * @returns {boolean} Whether the value satisfies the batch run schema.
 */
export function isBatchRun(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  return (
    isEntityId(value.batchId, 100) &&
    isEnumValue(batchStatusValues, value.status) &&
    Array.isArray(value.steps) &&
    value.steps.every(isBatchStepResult) &&
    hasUniqueValues(value.steps.map((step) => step.step)) &&
    Array.isArray(value.rows) &&
    value.rows.every(isBatchRow) &&
    hasUniqueValues(value.rows.map((row) => row.rowId)) &&
    isNullableIsoDateTime(value.startedAt) &&
    isNullableIsoDateTime(value.completedAt) &&
    hasValidChronology(value.startedAt, value.completedAt)
  );
}

/**
 * Creates an immutable batch run.
 *
 * @param {unknown} value Batch run data.
 * @returns {Readonly<Record<string, unknown>>} Frozen batch run.
 */
export function createBatchRun(value) {
  return createEntity(value, isBatchRun, 'Batch run');
}

/**
 * Determines whether a value is a valid manual review.
 *
 * @param {unknown} value Candidate review.
 * @returns {boolean} Whether the value satisfies the review schema.
 */
export function isManualReview(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const isOpen = value.status === REVIEW_STATUSES.OPEN;
  const decisionFieldsAreValid = isOpen
    ? value.decisionBy === null && value.decidedAt === null
    : isStringWithin(value.decisionBy, 1, 80) &&
      isIsoDateTime(value.decidedAt);

  return (
    isEntityId(value.reviewId, 100) &&
    isUuid(value.requestId) &&
    isStringWithin(value.triggerCode, 1, 100) &&
    isNonNegativeInteger(value.thresholdCents) &&
    isEnumValue(reviewStatusValues, value.status) &&
    decisionFieldsAreValid
  );
}

/**
 * Creates an immutable manual review.
 *
 * @param {unknown} value Manual review data.
 * @returns {Readonly<Record<string, unknown>>} Frozen manual review.
 */
export function createManualReview(value) {
  return createEntity(value, isManualReview, 'Manual review');
}

function isErrorAuditEntry(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isIsoDateTime(value.at) &&
    isStringWithin(value.action, 1, 100) &&
    isStringWithin(value.actor, 1, 80)
  );
}

/**
 * Determines whether a value is a valid error report.
 *
 * @param {unknown} value Candidate report.
 * @returns {boolean} Whether the value satisfies the error report schema.
 */
export function isErrorReport(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const optionalAuditIsValid =
    value.auditTrail === undefined ||
    (Array.isArray(value.auditTrail) &&
      value.auditTrail.every(isErrorAuditEntry));

  const optionalStackIsValid =
    value.stackTrace === undefined ||
    value.stackTrace === null ||
    isStringWithin(value.stackTrace, 0, 4000);

  const optionalFooterIsValid =
    value.footer === undefined ||
    isStringWithin(value.footer, 1, 200);

  return (
    isEntityId(value.errorReportId, 100) &&
    (value.requestId === null || isUuid(value.requestId)) &&
    (value.claimNumber === null ||
      isIdentifier(value.claimNumber)) &&
    isEnumValue(severityValues, value.severity) &&
    isEnumValue(errorReportStatusValues, value.status) &&
    isStringWithin(value.summary, 1, 200) &&
    isStringWithin(value.details, 1, 2000) &&
    isJsonObject(value.context) &&
    isJsonObject(value.resolution) &&
    isIsoDateTime(value.createdAt) &&
    (value.relatedEntities === undefined ||
      isJsonObject(value.relatedEntities)) &&
    optionalAuditIsValid &&
    optionalStackIsValid &&
    optionalFooterIsValid
  );
}

/**
 * Creates an immutable error report.
 *
 * @param {unknown} value Error report data.
 * @returns {Readonly<Record<string, unknown>>} Frozen error report.
 */
export function createErrorReport(value) {
  return createEntity(value, isErrorReport, 'Error report');
}

/**
 * Determines whether a value is a valid change-data-capture event.
 *
 * @param {unknown} value Candidate event.
 * @returns {boolean} Whether the value satisfies the CDC event schema.
 */
export function isCdcEvent(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const operation = value.operation ?? value.changeType;
  const eventId = value.cdcEventId ?? value.eventId;
  const occurredAt = value.occurredAt ?? value.createdAt;

  return (
    isEntityId(eventId, 100) &&
    isEnumValue(cdcOperationValues, operation) &&
    isStringWithin(value.entityType, 1, 100) &&
    isEntityId(value.entityId, 100) &&
    (value.before === null || isJsonObject(value.before)) &&
    (value.after === null || isJsonObject(value.after)) &&
    isIsoDateTime(occurredAt) &&
    isStringWithin(value.correlationId, 1, 100)
  );
}

/**
 * Creates an immutable change-data-capture event.
 *
 * @param {unknown} value CDC event data.
 * @returns {Readonly<Record<string, unknown>>} Frozen CDC event.
 */
export function createCdcEvent(value) {
  return createEntity(value, isCdcEvent, 'CDC event');
}

/**
 * Determines whether a value is a valid outbound record.
 *
 * @param {unknown} value Candidate record.
 * @returns {boolean} Whether the value satisfies the outbound schema.
 */
export function isOutboundRecord(value) {
  return (
    isPlainObject(value) &&
    isJsonCompatible(value) &&
    isEntityId(value.outboundId, 100) &&
    isEnumValue(outboundKindValues, value.kind) &&
    isEntityId(value.documentId, 100) &&
    isEnumValue(outboundStatusValues, value.status) &&
    isJsonObject(value.payloadMasked) &&
    isIsoDateTime(value.createdAt)
  );
}

/**
 * Creates an immutable outbound record.
 *
 * @param {unknown} value Outbound record data.
 * @returns {Readonly<Record<string, unknown>>} Frozen outbound record.
 */
export function createOutboundRecord(value) {
  return createEntity(value, isOutboundRecord, 'Outbound record');
}

/**
 * Determines whether a value is a valid operations envelope.
 *
 * @param {unknown} value Candidate envelope.
 * @returns {boolean} Whether the value satisfies the operations schema.
 */
export function isOperationsEnvelope(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    return false;
  }

  const collectionSchemas = [
    ['requests', isReprintRequest],
    ['pipelineRuns', isPipelineRun],
    ['documents', isDocumentVersion],
    ['inboundRuns', isInboundRun],
    ['batchRuns', isBatchRun],
    ['reviews', isManualReview],
    ['errorReports', isErrorReport],
    ['outboundRecords', isOutboundRecord],
    ['idempotencyResults', isIdempotencyRecord],
  ];

  const collectionsAreValid = collectionSchemas.every(
    ([property, predicate]) =>
      isPlainObject(value[property]) &&
      Object.values(value[property]).every(predicate),
  );

  const cdcEventsAreValid =
    value.cdcEvents === undefined ||
    (isPlainObject(value.cdcEvents) &&
      Object.values(value.cdcEvents).every(isCdcEvent));

  return (
    (value.schemaVersion === 1 || value.schemaVersion === '1') &&
    isNonNegativeInteger(value.revision) &&
    isUuid(value.commitId) &&
    isIsoDateTime(value.updatedAt) &&
    collectionsAreValid &&
    cdcEventsAreValid
  );
}

/**
 * Creates an immutable operations envelope.
 *
 * @param {unknown} value Operations envelope data.
 * @returns {Readonly<Record<string, unknown>>} Frozen envelope.
 */
export function createOperationsEnvelope(value) {
  return createEntity(
    value,
    isOperationsEnvelope,
    'Operations envelope',
  );
}

/**
 * Evaluates an operations schema predicate.
 *
 * @param {(candidate: unknown) => boolean} predicate Schema predicate.
 * @param {unknown} value Candidate value.
 * @param {string} schemaName Human-readable schema name.
 * @returns {{valid: true, errors: readonly []}|{valid: false, errors: readonly string[]}}
 * Validation result.
 */
export function validateOperationsSchema(predicate, value, schemaName) {
  if (typeof predicate !== 'function') {
    throw new TypeError('Schema predicate must be a function.');
  }

  if (!isNonEmptyString(schemaName)) {
    throw new TypeError('Schema name must be a non-empty string.');
  }

  if (predicate(value)) {
    return Object.freeze({
      valid: true,
      errors: Object.freeze([]),
    });
  }

  return Object.freeze({
    valid: false,
    errors: Object.freeze([
      `${schemaName} does not satisfy its schema.`,
    ]),
  });
}

export const isRequest = isReprintRequest;
export const createRequest = createReprintRequest;
export const isPipelineStep = isPipelineStepResult;
export const createPipelineStep = createPipelineStepResult;
export const isDocument = isDocumentVersion;
export const createDocument = createDocumentVersion;
export const isInboundFeedRow = isInboundRow;
export const createInboundFeedRow = createInboundRow;
export const isInboundFeedRun = isInboundRun;
export const createInboundFeedRun = createInboundRun;
export const isBatchStep = isBatchStepResult;
export const createBatchStep = createBatchStepResult;
export const isReview = isManualReview;
export const createReview = createManualReview;
export const isChangeDataCaptureEvent = isCdcEvent;
export const createChangeDataCaptureEvent = createCdcEvent;

export const OPERATIONS_SCHEMAS = Object.freeze({
  request: isReprintRequest,
  reprintRequest: isReprintRequest,
  pipelineRun: isPipelineRun,
  pipelineStep: isPipelineStepResult,
  pipelineStepResult: isPipelineStepResult,
  document: isDocumentVersion,
  documentVersion: isDocumentVersion,
  idempotencyRecord: isIdempotencyRecord,
  inboundRow: isInboundRow,
  inboundRun: isInboundRun,
  batchStep: isBatchStepResult,
  batchRow: isBatchRow,
  batchRun: isBatchRun,
  manualReview: isManualReview,
  errorReport: isErrorReport,
  cdcEvent: isCdcEvent,
  outboundRecord: isOutboundRecord,
  operationsEnvelope: isOperationsEnvelope,
});