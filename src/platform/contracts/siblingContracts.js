import { SCHEMA_VERSION } from '../config/constants.js';

export const SIBLING_CONTRACT_VERSION = SCHEMA_VERSION;

export const SIBLING_CONTRACT_NAMES = Object.freeze({
  PROCESSING_SUMMARY_PROVIDER: 'ProcessingSummaryProvider',
  COMPLETED_REPORT_PROVIDER: 'CompletedReportProvider',
  PLATFORM_SUMMARY_FACADE: 'PlatformSummaryFacade',
  PROCESSING_SUMMARY_DTO: 'ProcessingSummaryDto',
  COMPLETED_REPORT_DTO: 'CompletedReportDto',
  PLATFORM_SUMMARY_DTO: 'PlatformSummaryDto',
  OPERATIONS_PLATFORM_DATA: 'OperationsPlatformData',
});

export const SIBLING_CONTRACTS = Object.freeze({
  processingSummaryProvider: Object.freeze({
    name: SIBLING_CONTRACT_NAMES.PROCESSING_SUMMARY_PROVIDER,
    version: SIBLING_CONTRACT_VERSION,
    methods: Object.freeze(['getProcessingSummary']),
  }),
  completedReportProvider: Object.freeze({
    name: SIBLING_CONTRACT_NAMES.COMPLETED_REPORT_PROVIDER,
    version: SIBLING_CONTRACT_VERSION,
    methods: Object.freeze(['getCompletedReports']),
  }),
  platformSummaryFacade: Object.freeze({
    name: SIBLING_CONTRACT_NAMES.PLATFORM_SUMMARY_FACADE,
    version: SIBLING_CONTRACT_VERSION,
    methods: Object.freeze(['getPlatformSummary']),
  }),
});

const blockedPropertyNames = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Determines whether a value is a non-array object.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is a record.
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Determines whether a value is a plain data object.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether the value is a plain object.
 */
function isPlainObject(value) {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Determines whether a value uses the current sibling contract version.
 * DTOs without an explicit version are accepted so adapters can version them.
 *
 * @param {Record<string, unknown>} value Candidate DTO.
 * @returns {boolean} Whether its declared version is supported.
 */
function hasSupportedVersion(value) {
  const declaredVersion =
    value.contractVersion ?? value.schemaVersion ?? value.version;

  return (
    declaredVersion === undefined ||
    declaredVersion === SIBLING_CONTRACT_VERSION
  );
}

/**
 * Recursively validates that a value can safely cross a cluster boundary.
 *
 * @param {unknown} value Candidate value.
 * @param {Set<object>} ancestors Objects in the current traversal path.
 * @returns {boolean} Whether the value is JSON-compatible contract data.
 */
function isContractValue(value, ancestors = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);

    return value.every((item) => isContractValue(item, nextAncestors));
  }

  if (!isPlainObject(value) || ancestors.has(value)) {
    return false;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  return Object.entries(value).every(
    ([key, item]) =>
      !blockedPropertyNames.has(key) &&
      isContractValue(item, nextAncestors),
  );
}

/**
 * Clones and deeply freezes cross-cluster data.
 *
 * @param {unknown} value Valid contract data.
 * @returns {unknown} Deeply frozen clone.
 */
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

/**
 * Creates a versioned, frozen copy of a DTO.
 *
 * @param {Record<string, unknown>} value Valid contract DTO.
 * @returns {Readonly<Record<string, unknown>>} Frozen versioned DTO.
 */
function createVersionedDto(value) {
  const {
    contractVersion: ignoredContractVersion,
    schemaVersion: ignoredSchemaVersion,
    ...data
  } = value;

  void ignoredContractVersion;
  void ignoredSchemaVersion;

  return cloneAndFreeze({
    ...data,
    contractVersion: SIBLING_CONTRACT_VERSION,
  });
}

/**
 * Throws when a DTO does not satisfy its runtime schema predicate.
 *
 * @param {unknown} value Candidate DTO.
 * @param {(candidate: unknown) => boolean} predicate Schema predicate.
 * @param {string} contractName Contract name for the error message.
 * @returns {Record<string, unknown>} Validated DTO.
 */
function requireDto(value, predicate, contractName) {
  if (!predicate(value)) {
    throw new TypeError(
      `${contractName} must be a plain, JSON-compatible object using contract version ${SIBLING_CONTRACT_VERSION}.`,
    );
  }

  return value;
}

/**
 * Determines whether a provider exposes a processing-summary operation.
 *
 * @param {unknown} value Candidate provider.
 * @returns {boolean} Whether the provider satisfies the contract.
 */
export function isProcessingSummaryProvider(value) {
  return (
    isRecord(value) &&
    (typeof value.getProcessingSummary === 'function' ||
      typeof value.provideProcessingSummary === 'function')
  );
}

/**
 * Determines whether a provider exposes a completed-report operation.
 *
 * @param {unknown} value Candidate provider.
 * @returns {boolean} Whether the provider satisfies the contract.
 */
export function isCompletedReportProvider(value) {
  return (
    isRecord(value) &&
    (typeof value.getCompletedReports === 'function' ||
      typeof value.getCompletedReport === 'function' ||
      typeof value.provideCompletedReports === 'function')
  );
}

/**
 * Determines whether a facade exposes platform summary data.
 *
 * A facade may provide one aggregate operation or the three platform summary
 * operations independently.
 *
 * @param {unknown} value Candidate facade.
 * @returns {boolean} Whether the facade satisfies the contract.
 */
export function isPlatformSummaryFacade(value) {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.getPlatformSummary === 'function' ||
    typeof value.providePlatformSummary === 'function'
  ) {
    return true;
  }

  return (
    typeof value.getAccessContext === 'function' &&
    typeof value.getAuditSummary === 'function' &&
    (typeof value.getPlatformSettings === 'function' ||
      typeof value.getSettings === 'function')
  );
}

/**
 * Determines whether a value is a processing-summary DTO.
 *
 * @param {unknown} value Candidate DTO.
 * @returns {boolean} Whether the value satisfies the runtime schema.
 */
export function isProcessingSummaryDto(value) {
  return (
    isPlainObject(value) &&
    hasSupportedVersion(value) &&
    isContractValue(value)
  );
}

/**
 * Determines whether a value is a completed-report DTO.
 *
 * @param {unknown} value Candidate DTO.
 * @returns {boolean} Whether the value satisfies the runtime schema.
 */
export function isCompletedReportDto(value) {
  return (
    isPlainObject(value) &&
    hasSupportedVersion(value) &&
    isContractValue(value)
  );
}

/**
 * Determines whether a value is a platform-summary DTO.
 *
 * @param {unknown} value Candidate DTO.
 * @returns {boolean} Whether the value satisfies the runtime schema.
 */
export function isPlatformSummaryDto(value) {
  return (
    isPlainObject(value) &&
    hasSupportedVersion(value) &&
    isContractValue(value)
  );
}

/**
 * Determines whether a value is operations/platform cross-cluster data.
 *
 * The envelope must contain both operations and platform sections.
 *
 * @param {unknown} value Candidate DTO.
 * @returns {boolean} Whether the value satisfies the runtime schema.
 */
export function isOperationsPlatformData(value) {
  return (
    isPlainObject(value) &&
    hasSupportedVersion(value) &&
    Object.prototype.hasOwnProperty.call(value, 'operations') &&
    Object.prototype.hasOwnProperty.call(value, 'platform') &&
    isPlainObject(value.operations) &&
    isPlainObject(value.platform) &&
    isContractValue(value)
  );
}

/**
 * Converts processing summary data to a versioned, deeply frozen DTO.
 *
 * @param {unknown} value Processing summary data.
 * @returns {Readonly<Record<string, unknown>>} Frozen DTO.
 */
export function adaptProcessingSummaryDto(value) {
  const dto = requireDto(
    value,
    isProcessingSummaryDto,
    SIBLING_CONTRACT_NAMES.PROCESSING_SUMMARY_DTO,
  );

  return createVersionedDto(dto);
}

/**
 * Converts completed report data to a versioned, deeply frozen DTO.
 *
 * @param {unknown} value Completed report data.
 * @returns {Readonly<Record<string, unknown>>} Frozen DTO.
 */
export function adaptCompletedReportDto(value) {
  const dto = requireDto(
    value,
    isCompletedReportDto,
    SIBLING_CONTRACT_NAMES.COMPLETED_REPORT_DTO,
  );

  return createVersionedDto(dto);
}

/**
 * Converts platform summary data to a versioned, deeply frozen DTO.
 *
 * @param {unknown} value Platform summary data.
 * @returns {Readonly<Record<string, unknown>>} Frozen DTO.
 */
export function adaptPlatformSummaryDto(value) {
  const dto = requireDto(
    value,
    isPlatformSummaryDto,
    SIBLING_CONTRACT_NAMES.PLATFORM_SUMMARY_DTO,
  );

  return createVersionedDto(dto);
}

/**
 * Converts an operations/platform envelope to versioned, frozen data.
 *
 * @param {unknown} value Cross-cluster operations/platform data.
 * @returns {Readonly<Record<string, unknown>>} Frozen DTO.
 */
export function adaptOperationsPlatformData(value) {
  const dto = requireDto(
    value,
    isOperationsPlatformData,
    SIBLING_CONTRACT_NAMES.OPERATIONS_PLATFORM_DATA,
  );

  return createVersionedDto(dto);
}

export const createProcessingSummaryDto = adaptProcessingSummaryDto;
export const createCompletedReportDto = adaptCompletedReportDto;
export const createPlatformSummaryDto = adaptPlatformSummaryDto;
export const createOperationsPlatformData = adaptOperationsPlatformData;
export const isOperationsPlatformDto = isOperationsPlatformData;
export const adaptOperationsPlatformDto = adaptOperationsPlatformData;