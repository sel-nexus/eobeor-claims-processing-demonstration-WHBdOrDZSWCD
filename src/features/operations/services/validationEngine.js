import { REFERENCE_DATE } from '../../../platform/config/constants.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_TYPE_VALUES,
  RULE_IDS,
  SOURCE_TYPE_VALUES,
} from '../domain/domainConstants.js';

export const VALIDATION_ENGINE_SCHEMA_VERSION = 1;

export const VALIDATION_OUTCOMES = Object.freeze({
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  WARNING: 'WARNING',
  SKIPPED: 'SKIPPED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
});

export const VALIDATION_RULE_IDS = Object.freeze({
  REQUIRED_FIELDS: RULE_IDS.REQUEST_FIELDS_VALID,
  SOURCE_FORMAT: 'SOURCE_FORMAT_VALID',
  CLAIM_EXISTS: RULE_IDS.CLAIM_EXISTS,
  MEMBER_EXISTS: RULE_IDS.MEMBER_EXISTS,
  MEMBER_CLAIM_MATCH: RULE_IDS.MEMBER_CLAIM_MATCH,
  DUPLICATE_OPEN_REQUEST: RULE_IDS.DUPLICATE_OPEN_REQUEST,
  CLAIM_ELIGIBLE: RULE_IDS.CLAIM_ELIGIBLE,
  RETENTION_ELIGIBLE: RULE_IDS.RETENTION_ELIGIBLE,
  COVERAGE_ACTIVE: RULE_IDS.COVERAGE_ACTIVE,
  ACCESS_ALLOWED: RULE_IDS.CSR_ACCESS_ALLOWED,
  CALCULATIONS_VALID: 'CALCULATIONS_VALID',
  REDACTION_VALID: 'REDACTION_VALID',
  AUTO_APPROVAL_THRESHOLD: RULE_IDS.MANUAL_REVIEW_THRESHOLD,
  RETRY_ALLOWED: 'RETRY_ALLOWED',
  DOCUMENT_QUALITY: RULE_IDS.DOCUMENT_QUALITY,
  PAYMENT_REFERENCE_PRESENT: RULE_IDS.PAYMENT_REFERENCE_PRESENT,
  OUTBOUND_READY: RULE_IDS.OUTBOUND_READY,
});

export const VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  REQUIRED_FIELD_MISSING: 'REQUIRED_FIELD_MISSING',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  INVALID_REQUEST_TYPE: 'INVALID_REQUEST_TYPE',
  INVALID_SOURCE_TYPE: 'INVALID_SOURCE_TYPE',
  INVALID_SOURCE_DETAIL: 'INVALID_SOURCE_DETAIL',
  INVALID_FORMAT: 'INVALID_FORMAT',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  MEMBER_CLAIM_MISMATCH: 'MEMBER_CLAIM_MISMATCH',
  DUPLICATE_OPEN_REQUEST: 'DUPLICATE_OPEN_REQUEST',
  CLAIM_NOT_ELIGIBLE: 'CLAIM_NOT_ELIGIBLE',
  CLAIM_NOT_FINALIZED: 'CLAIM_NOT_FINALIZED',
  RETENTION_PERIOD_EXPIRED: 'RETENTION_PERIOD_EXPIRED',
  COVERAGE_NOT_FOUND: 'COVERAGE_NOT_FOUND',
  COVERAGE_INACTIVE: 'COVERAGE_INACTIVE',
  CLAIM_ACCESS_RESTRICTED: 'CLAIM_ACCESS_RESTRICTED',
  CALCULATION_MISMATCH: 'CALCULATION_MISMATCH',
  SENSITIVE_VALUE_NOT_REDACTED: 'SENSITIVE_VALUE_NOT_REDACTED',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
  RETRY_NOT_ALLOWED: 'RETRY_NOT_ALLOWED',
  RETRY_LIMIT_REACHED: 'RETRY_LIMIT_REACHED',
  DOCUMENT_QUALITY_FAILED: 'DOCUMENT_QUALITY_FAILED',
  PAYMENT_REFERENCE_MISSING: 'PAYMENT_REFERENCE_MISSING',
  OUTBOUND_NOT_READY: 'OUTBOUND_NOT_READY',
});

export const VALIDATION_DEFAULTS = Object.freeze({
  referenceDate: REFERENCE_DATE,
  retentionYears: 7,
  autoApprovalThresholdCents: 50000,
  maximumRetryAttempts: 3,
  maximumSourceDetailLength: 200,
  calculationTolerance: 0.000001,
  metadataLabel: 'Demo default',
});

export const INBOUND_HEADER_REQUIREMENTS = Object.freeze({
  AP_REPRINT: Object.freeze([
    'claim_number',
    'member_id',
    'request_type',
    'priority',
    'source_reference',
  ]),
  CHANGE_835: Object.freeze([
    'record_type',
    'member_id',
    'claim_number',
    'field',
    'new_value',
  ]),
});

export const CHANGE_835_ALLOWLISTED_FIELDS = Object.freeze([
  'coverage_status',
  'claim_status',
  'provider_reference',
]);

const IDENTIFIER_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const FINALIZED_CLAIM_STATUSES = new Set([
  'PROCESSED',
  'PAID',
  'DENIED',
  'COMPLETE',
]);
const REQUEST_TYPE_SET = new Set(REQUEST_TYPE_VALUES);
const SOURCE_TYPE_SET = new Set(SOURCE_TYPE_VALUES);
const OPEN_STATUS_SET = new Set(OPEN_REQUEST_STATUSES);
const MASK_PATTERN = /(?:\*{2,}|\[REDACTED(?::[A-Z]+)?\])/i;
const SENSITIVE_KEY_PARTS = Object.freeze([
  'password',
  'passcode',
  'mfacode',
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'sessionid',
  'ssn',
  'socialsecurity',
  'routingnumber',
  'accountnumber',
  'cardnumber',
  'credential',
  'secret',
]);
const BLOCKED_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
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

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toUpperCase()
    : null;
}

function normalizeRole(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : null;
}

function normalizeDateOnly(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const source = value.trim();
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(source)
      ? `${source}T00:00:00.000Z`
      : source,
  );

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

function subtractCalendarYears(dateOnly, years) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  const month = date.getUTCMonth();
  const result = new Date(date.getTime());

  result.setUTCFullYear(result.getUTCFullYear() - years);

  if (result.getUTCMonth() !== month) {
    result.setUTCDate(0);
  }

  return result.toISOString().slice(0, 10);
}

function isDateWithinRange(date, start, end) {
  const normalizedDate = normalizeDateOnly(date);
  const normalizedStart = normalizeDateOnly(start);
  const normalizedEnd =
    end === null || end === undefined
      ? null
      : normalizeDateOnly(end);

  return (
    normalizedDate !== null &&
    normalizedStart !== null &&
    normalizedDate >= normalizedStart &&
    (normalizedEnd === null || normalizedDate <= normalizedEnd)
  );
}

function normalizeCollection(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (isPlainObject(value)) {
    return Object.values(value);
  }

  return [];
}

function resolveCollection(fixtures, names) {
  for (const name of names) {
    const value = fixtures?.[name];

    if (Array.isArray(value) || isPlainObject(value)) {
      return normalizeCollection(value);
    }
  }

  return [];
}

function resolveClaim(fixtures, claimNumber) {
  if (!isPlainObject(fixtures)) {
    return null;
  }

  const direct =
    fixtures.claim ??
    fixtures.claimsByNumber?.[claimNumber] ??
    fixtures.claimsById?.[claimNumber];

  if (
    isPlainObject(direct) &&
    direct.claimNumber === claimNumber
  ) {
    return direct;
  }

  return (
    resolveCollection(fixtures, ['claims', 'claimFixtures']).find(
      (claim) => claim?.claimNumber === claimNumber,
    ) ?? null
  );
}

function resolveMember(fixtures, memberId) {
  if (!isPlainObject(fixtures)) {
    return null;
  }

  const direct =
    fixtures.member ??
    fixtures.membersById?.[memberId];

  if (isPlainObject(direct) && direct.memberId === memberId) {
    return direct;
  }

  return (
    resolveCollection(fixtures, ['members', 'memberFixtures']).find(
      (member) => member?.memberId === memberId,
    ) ?? null
  );
}

function resolveCoverage(fixtures, claim, memberId) {
  if (!isPlainObject(fixtures) || !isPlainObject(claim)) {
    return null;
  }

  const direct =
    fixtures.coverage ??
    fixtures.coveragesById?.[claim.coverageId];

  if (
    isPlainObject(direct) &&
    direct.coverageId === claim.coverageId
  ) {
    return direct;
  }

  const coverages = resolveCollection(fixtures, [
    'coverages',
    'coverageFixtures',
  ]);

  return (
    coverages.find(
      (coverage) =>
        coverage?.coverageId === claim.coverageId,
    ) ??
    coverages.find(
      (coverage) =>
        coverage?.memberId === memberId &&
        coverage?.status === 'ACTIVE',
    ) ??
    null
  );
}

function resolveServiceLines(fixtures, claim) {
  if (!isPlainObject(fixtures) || !isPlainObject(claim)) {
    return [];
  }

  const indexed =
    fixtures.serviceLinesByClaim?.[claim.claimNumber];

  if (Array.isArray(indexed)) {
    return indexed;
  }

  return resolveCollection(fixtures, [
    'serviceLines',
    'serviceLineFixtures',
  ]).filter(
    (line) => line?.claimNumber === claim.claimNumber,
  );
}

function resolveThresholdCents(settings, fallback) {
  if (
    Number.isSafeInteger(settings?.autoApprovalThresholdCents) &&
    settings.autoApprovalThresholdCents >= 0
  ) {
    return settings.autoApprovalThresholdCents;
  }

  if (
    typeof settings?.autoApproveAmount === 'number' &&
    Number.isFinite(settings.autoApproveAmount) &&
    settings.autoApproveAmount >= 0
  ) {
    return Math.round(settings.autoApproveAmount * 100);
  }

  return fallback;
}

function resolveRetentionYears(settings, fallback) {
  return Number.isSafeInteger(settings?.retentionYears) &&
    settings.retentionYears >= 1
    ? settings.retentionYears
    : fallback;
}

function resolveResponsibilityCents(claim) {
  if (
    Number.isSafeInteger(claim?.patientResponsibilityCents) &&
    claim.patientResponsibilityCents >= 0
  ) {
    return claim.patientResponsibilityCents;
  }

  if (
    Number.isSafeInteger(claim?.memberResponsibilityCents) &&
    claim.memberResponsibilityCents >= 0
  ) {
    return claim.memberResponsibilityCents;
  }

  if (
    typeof claim?.memberResponsibilityAmount === 'number' &&
    Number.isFinite(claim.memberResponsibilityAmount) &&
    claim.memberResponsibilityAmount >= 0
  ) {
    return Math.round(claim.memberResponsibilityAmount * 100);
  }

  return null;
}

function normalizeKey(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function isSensitiveKey(value) {
  const normalized = normalizeKey(value);

  return SENSITIVE_KEY_PARTS.some(
    (part) =>
      normalized === part || normalized.includes(part),
  );
}

function collectRedactionViolations(
  value,
  path = '$',
  ancestors = new Set(),
) {
  if (value === null || typeof value !== 'object') {
    return [];
  }

  if (ancestors.has(value)) {
    return [path];
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  const violations = [];

  Object.entries(value).forEach(([key, item]) => {
    const childPath = `${path}.${key}`;

    if (BLOCKED_PROPERTY_NAMES.has(key)) {
      violations.push(childPath);
      return;
    }

    if (isSensitiveKey(key)) {
      if (
        item !== null &&
        item !== undefined &&
        (typeof item !== 'string' ||
          !MASK_PATTERN.test(item))
      ) {
        violations.push(childPath);
      }

      return;
    }

    if (
      normalizeKey(key).endsWith('masked') &&
      typeof item === 'string' &&
      item.length > 0 &&
      !MASK_PATTERN.test(item)
    ) {
      violations.push(childPath);
      return;
    }

    violations.push(
      ...collectRedactionViolations(
        item,
        childPath,
        nextAncestors,
      ),
    );
  });

  return violations;
}

function calculateFinancialErrors(record, path, tolerance) {
  if (!isPlainObject(record)) {
    return [];
  }

  const errors = [];
  const fields = [
    'billedAmount',
    'discountAmount',
    'allowedAmount',
    'planPaidAmount',
    'memberResponsibilityAmount',
  ];
  const presentFields = fields.filter(
    (field) => record[field] !== undefined,
  );

  if (presentFields.length === 0) {
    return errors;
  }

  presentFields.forEach((field) => {
    if (
      typeof record[field] !== 'number' ||
      !Number.isFinite(record[field]) ||
      record[field] < 0
    ) {
      errors.push({
        path: `${path}.${field}`,
        reason: 'NON_NEGATIVE_FINITE_NUMBER_REQUIRED',
      });
    }
  });

  if (errors.length > 0) {
    return errors;
  }

  const hasSummaryFields = fields.every(
    (field) => record[field] !== undefined,
  );

  if (!hasSummaryFields) {
    errors.push({
      path,
      reason: 'FINANCIAL_FIELDS_INCOMPLETE',
    });
    return errors;
  }

  const expectedAllowed =
    record.billedAmount - record.discountAmount;
  const expectedDistribution =
    record.planPaidAmount +
    record.memberResponsibilityAmount;

  if (
    Math.abs(record.allowedAmount - expectedAllowed) > tolerance
  ) {
    errors.push({
      path,
      reason: 'BILLED_MINUS_DISCOUNT_MISMATCH',
    });
  }

  if (
    Math.abs(record.allowedAmount - expectedDistribution) >
    tolerance
  ) {
    errors.push({
      path,
      reason: 'PAYMENT_DISTRIBUTION_MISMATCH',
    });
  }

  const responsibilityParts = [
    record.deductibleAmount,
    record.copayAmount,
    record.coinsuranceAmount,
  ];

  if (
    responsibilityParts.every(
      (value) =>
        typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    const total = responsibilityParts.reduce(
      (sum, value) => sum + value,
      0,
    );

    if (
      Math.abs(
        record.memberResponsibilityAmount - total,
      ) > tolerance
    ) {
      errors.push({
        path,
        reason: 'RESPONSIBILITY_COMPONENT_MISMATCH',
      });
    }
  }

  return errors;
}

function createRuleResult({
  ruleId,
  label,
  outcome,
  code = null,
  message,
  evidence = {},
  metadata = {},
}) {
  return deepFreeze({
    ruleId,
    label,
    outcome,
    passed:
      outcome === VALIDATION_OUTCOMES.PASSED ||
      outcome === VALIDATION_OUTCOMES.WARNING ||
      outcome === VALIDATION_OUTCOMES.SKIPPED,
    code,
    message,
    evidence,
    metadata,
  });
}

function passed(rule, message, evidence = {}, metadata = {}) {
  return createRuleResult({
    ruleId: rule.ruleId,
    label: rule.label,
    outcome: VALIDATION_OUTCOMES.PASSED,
    message,
    evidence,
    metadata,
  });
}

function failed(
  rule,
  code,
  message,
  evidence = {},
  metadata = {},
) {
  return createRuleResult({
    ruleId: rule.ruleId,
    label: rule.label,
    outcome: VALIDATION_OUTCOMES.FAILED,
    code,
    message,
    evidence,
    metadata,
  });
}

function skipped(rule, message, evidence = {}) {
  return createRuleResult({
    ruleId: rule.ruleId,
    label: rule.label,
    outcome: VALIDATION_OUTCOMES.SKIPPED,
    message,
    evidence,
  });
}

function manualReview(
  rule,
  code,
  message,
  evidence,
  metadata,
) {
  return createRuleResult({
    ruleId: rule.ruleId,
    label: rule.label,
    outcome: VALIDATION_OUTCOMES.MANUAL_REVIEW,
    code,
    message,
    evidence,
    metadata,
  });
}

function summarizeResults(results) {
  const failedResults = results.filter(
    (result) =>
      result.outcome === VALIDATION_OUTCOMES.FAILED,
  );
  const reviewResults = results.filter(
    (result) =>
      result.outcome === VALIDATION_OUTCOMES.MANUAL_REVIEW,
  );
  const warningResults = results.filter(
    (result) =>
      result.outcome === VALIDATION_OUTCOMES.WARNING,
  );
  const outcome =
    failedResults.length > 0
      ? VALIDATION_OUTCOMES.FAILED
      : reviewResults.length > 0
        ? VALIDATION_OUTCOMES.MANUAL_REVIEW
        : VALIDATION_OUTCOMES.PASSED;

  return deepFreeze({
    schemaVersion: VALIDATION_ENGINE_SCHEMA_VERSION,
    valid:
      failedResults.length === 0 &&
      reviewResults.length === 0,
    outcome,
    requiresManualReview: reviewResults.length > 0,
    failedRuleId:
      failedResults[0]?.ruleId ??
      reviewResults[0]?.ruleId ??
      null,
    code:
      failedResults[0]?.code ??
      reviewResults[0]?.code ??
      null,
    results,
    errors: failedResults,
    manualReviews: reviewResults,
    warnings: warningResults,
    evidence: {
      evaluatedRuleCount: results.length,
      passedRuleCount: results.filter(
        (result) =>
          result.outcome === VALIDATION_OUTCOMES.PASSED,
      ).length,
      failedRuleCount: failedResults.length,
      manualReviewRuleCount: reviewResults.length,
      skippedRuleCount: results.filter(
        (result) =>
          result.outcome === VALIDATION_OUTCOMES.SKIPPED,
      ).length,
    },
  });
}

export const VALIDATION_RULE_CATALOG = deepFreeze([
  {
    ruleId: VALIDATION_RULE_IDS.REQUIRED_FIELDS,
    label: 'Required request fields',
    category: 'REQUEST',
    description:
      'Requires claim, member, request type, priority, and source values.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.SOURCE_FORMAT,
    label: 'Source and format',
    category: 'REQUEST',
    description:
      'Validates canonical identifiers, source type, and source detail.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.CLAIM_EXISTS,
    label: 'Claim exists',
    category: 'DATA',
    description:
      'Confirms that the fictional claim is available locally.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.MEMBER_EXISTS,
    label: 'Member exists',
    category: 'DATA',
    description:
      'Confirms that the fictional member is available locally.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.MEMBER_CLAIM_MATCH,
    label: 'Member and claim match',
    category: 'DATA',
    description:
      'Confirms that the fictional member owns the claim.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.DUPLICATE_OPEN_REQUEST,
    label: 'Duplicate open request',
    category: 'REQUEST',
    description:
      'Prevents a duplicate open claim, member, and request-type tuple.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.CLAIM_ELIGIBLE,
    label: 'Claim status and eligibility',
    category: 'BUSINESS_RULE',
    description:
      'Requires a finalized claim that is eligible for reprint.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.RETENTION_ELIGIBLE,
    label: 'Retention eligibility',
    category: 'BUSINESS_RULE',
    description:
      'Applies the configured document retention period.',
    demoDefault: {
      label: VALIDATION_DEFAULTS.metadataLabel,
      value: VALIDATION_DEFAULTS.retentionYears,
      unit: 'years',
    },
  },
  {
    ruleId: VALIDATION_RULE_IDS.COVERAGE_ACTIVE,
    label: 'Coverage active on service date',
    category: 'BUSINESS_RULE',
    description:
      'Requires matching coverage active for the claim service date.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.ACCESS_ALLOWED,
    label: 'Role and restriction access',
    category: 'AUTHORIZATION',
    description:
      'Applies local role and claim restriction fixtures.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.CALCULATIONS_VALID,
    label: 'Financial calculations',
    category: 'QUALITY',
    description:
      'Checks billed, discount, allowed, paid, and responsibility totals.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.REDACTION_VALID,
    label: 'Sensitive value redaction',
    category: 'PRIVACY',
    description:
      'Rejects unmasked credential, session, and financial account values.',
  },
  {
    ruleId: VALIDATION_RULE_IDS.AUTO_APPROVAL_THRESHOLD,
    label: 'Auto-approval threshold',
    category: 'BUSINESS_RULE',
    description:
      'Routes responsibility above the local threshold to manual review.',
    demoDefault: {
      label: VALIDATION_DEFAULTS.metadataLabel,
      value: VALIDATION_DEFAULTS.autoApprovalThresholdCents,
      unit: 'cents',
    },
  },
  {
    ruleId: VALIDATION_RULE_IDS.RETRY_ALLOWED,
    label: 'Retry eligibility',
    category: 'RESILIENCE',
    description:
      'Allows retries only for failed rows below the attempt limit.',
    demoDefault: {
      label: VALIDATION_DEFAULTS.metadataLabel,
      value: VALIDATION_DEFAULTS.maximumRetryAttempts,
      unit: 'attempts',
    },
  },
  {
    ruleId: VALIDATION_RULE_IDS.DOCUMENT_QUALITY,
    label: 'Document quality',
    category: 'QUALITY',
    description:
      'Requires complete, calculated, and redacted document metadata.',
  },
]);

const RULES_BY_ID = Object.freeze(
  Object.fromEntries(
    VALIDATION_RULE_CATALOG.map((rule) => [
      rule.ruleId,
      rule,
    ]),
  ),
);

function rule(ruleId) {
  return RULES_BY_ID[ruleId] ?? {
    ruleId,
    label: ruleId,
  };
}

/**
 * Pure deterministic validation engine for local operations workflows.
 */
export class ValidationEngine {
  /**
   * @param {{
   *   referenceDate?: string,
   *   retentionYears?: number,
   *   autoApprovalThresholdCents?: number,
   *   maximumRetryAttempts?: number,
   *   calculationTolerance?: number
   * }} [options] Validation options.
   */
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError(
        'Validation engine options must be a plain object.',
      );
    }

    const referenceDate = normalizeDateOnly(
      options.referenceDate ?? VALIDATION_DEFAULTS.referenceDate,
    );

    if (referenceDate === null) {
      throw new TypeError(
        'Validation reference date must be a valid date.',
      );
    }

    this.options = deepFreeze({
      referenceDate,
      retentionYears:
        Number.isSafeInteger(options.retentionYears) &&
        options.retentionYears >= 1
          ? options.retentionYears
          : VALIDATION_DEFAULTS.retentionYears,
      autoApprovalThresholdCents:
        Number.isSafeInteger(
          options.autoApprovalThresholdCents,
        ) && options.autoApprovalThresholdCents >= 0
          ? options.autoApprovalThresholdCents
          : VALIDATION_DEFAULTS.autoApprovalThresholdCents,
      maximumRetryAttempts:
        Number.isSafeInteger(options.maximumRetryAttempts) &&
        options.maximumRetryAttempts >= 1
          ? options.maximumRetryAttempts
          : VALIDATION_DEFAULTS.maximumRetryAttempts,
      calculationTolerance:
        typeof options.calculationTolerance === 'number' &&
        Number.isFinite(options.calculationTolerance) &&
        options.calculationTolerance >= 0
          ? options.calculationTolerance
          : VALIDATION_DEFAULTS.calculationTolerance,
    });
  }

  getRuleCatalog() {
    return VALIDATION_RULE_CATALOG;
  }

  getDefaults() {
    return deepFreeze({
      ...this.options,
      label: VALIDATION_DEFAULTS.metadataLabel,
    });
  }

  validateRequiredFields(request) {
    const definition = rule(
      VALIDATION_RULE_IDS.REQUIRED_FIELDS,
    );

    if (!isPlainObject(request) || !isJsonCompatible(request)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.INVALID_INPUT,
        'Request must be a safe JSON-compatible object.',
        { requestObjectValid: false },
      );
    }

    const requiredFields = [
      'claimNumber',
      'memberId',
      'requestType',
      'priority',
      'sourceType',
    ];
    const missingFields = requiredFields.filter(
      (field) =>
        typeof request[field] !== 'string' ||
        request[field].trim().length === 0,
    );

    return missingFields.length === 0
      ? passed(
          definition,
          'All required request fields are present.',
          {
            requiredFieldCount: requiredFields.length,
            missingFields: [],
          },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.REQUIRED_FIELD_MISSING,
          'One or more required request fields are missing.',
          {
            requiredFieldCount: requiredFields.length,
            missingFields,
          },
        );
  }

  validateSourceAndFormat(request) {
    const definition = rule(
      VALIDATION_RULE_IDS.SOURCE_FORMAT,
    );

    if (!isPlainObject(request)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.INVALID_INPUT,
        'Request format cannot be evaluated.',
      );
    }

    const claimNumber = normalizeIdentifier(
      request.claimNumber,
    );
    const memberId = normalizeIdentifier(request.memberId);
    const requestType = normalizeIdentifier(
      request.requestType,
    );
    const sourceType = normalizeIdentifier(
      request.sourceType,
    );
    const sourceDetail = request.sourceDetail ?? '';
    const invalidFields = [];

    if (
      claimNumber === null ||
      !IDENTIFIER_PATTERN.test(claimNumber)
    ) {
      invalidFields.push('claimNumber');
    }

    if (
      memberId === null ||
      !IDENTIFIER_PATTERN.test(memberId)
    ) {
      invalidFields.push('memberId');
    }

    if (
      requestType === null ||
      !REQUEST_TYPE_SET.has(requestType)
    ) {
      invalidFields.push('requestType');
    }

    if (
      sourceType === null ||
      !SOURCE_TYPE_SET.has(sourceType)
    ) {
      invalidFields.push('sourceType');
    }

    if (
      typeof sourceDetail !== 'string' ||
      sourceDetail.trim().length >
        VALIDATION_DEFAULTS.maximumSourceDetailLength
    ) {
      invalidFields.push('sourceDetail');
    }

    return invalidFields.length === 0
      ? passed(
          definition,
          'Request source and identifier formats are valid.',
          {
            sourceType,
            requestType,
            invalidFields: [],
          },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.INVALID_FORMAT,
          'Request contains an unsupported source or field format.',
          { invalidFields },
        );
  }

  validateDuplicate(request, requests = []) {
    const definition = rule(
      VALIDATION_RULE_IDS.DUPLICATE_OPEN_REQUEST,
    );

    if (!isPlainObject(request)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.INVALID_INPUT,
        'Duplicate request validation requires a request.',
      );
    }

    const claimNumber = normalizeIdentifier(
      request.claimNumber,
    );
    const memberId = normalizeIdentifier(request.memberId);
    const requestType = normalizeIdentifier(
      request.requestType,
    );
    const requestId = request.requestId ?? null;
    const matches = normalizeCollection(requests).filter(
      (candidate) =>
        candidate?.requestId !== requestId &&
        normalizeIdentifier(candidate?.claimNumber) === claimNumber &&
        normalizeIdentifier(candidate?.memberId) === memberId &&
        normalizeIdentifier(candidate?.requestType) === requestType &&
        OPEN_STATUS_SET.has(candidate?.status),
    );

    return matches.length === 0
      ? passed(
          definition,
          'No duplicate open request was found.',
          { duplicateCount: 0 },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.DUPLICATE_OPEN_REQUEST,
          'An open request already exists for this claim, member, and request type.',
          {
            duplicateCount: matches.length,
            duplicateRequestIds: matches.map(
              (candidate) => candidate.requestId,
            ),
          },
        );
  }

  validateClaimStatus(claim) {
    const definition = rule(
      VALIDATION_RULE_IDS.CLAIM_ELIGIBLE,
    );

    if (!isPlainObject(claim)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.CLAIM_NOT_FOUND,
        'The fictional claim was not found.',
        { claimFound: false },
      );
    }

    if (!FINALIZED_CLAIM_STATUSES.has(claim.status)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.CLAIM_NOT_FINALIZED,
        'The fictional claim is not finalized.',
        {
          claimFound: true,
          status: claim.status ?? null,
        },
      );
    }

    if (claim.eligibleForReprint !== true) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.CLAIM_NOT_ELIGIBLE,
        'The fictional claim is not eligible for reprint.',
        {
          claimFound: true,
          status: claim.status,
          eligibleForReprint: false,
        },
      );
    }

    return passed(
      definition,
      'The fictional claim is finalized and eligible.',
      {
        claimFound: true,
        status: claim.status,
        eligibleForReprint: true,
      },
    );
  }

  validateRetention(claim, settings = {}) {
    const definition = rule(
      VALIDATION_RULE_IDS.RETENTION_ELIGIBLE,
    );

    if (!isPlainObject(claim)) {
      return skipped(
        definition,
        'Retention was not evaluated because the claim is unavailable.',
      );
    }

    const retentionYears = resolveRetentionYears(
      settings,
      this.options.retentionYears,
    );
    const referenceDate =
      normalizeDateOnly(settings.referenceDate) ??
      this.options.referenceDate;
    const claimDate = normalizeDateOnly(
      claim.serviceDateTo ??
        claim.serviceDateFrom ??
        claim.processedDate ??
        claim.receivedDate,
    );
    const cutoffDate = subtractCalendarYears(
      referenceDate,
      retentionYears,
    );
    const metadata = {
      source:
        settings.retentionYears === undefined
          ? VALIDATION_DEFAULTS.metadataLabel
          : 'Configured setting',
      retentionYears,
      referenceDate,
      cutoffDate,
    };

    if (claimDate === null) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.INVALID_FORMAT,
        'Claim retention date is invalid.',
        { claimDate: null },
        metadata,
      );
    }

    return claimDate >= cutoffDate
      ? passed(
          definition,
          'The claim is within the document retention period.',
          { claimDate, cutoffDate },
          metadata,
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.RETENTION_PERIOD_EXPIRED,
          'The fictional claim is outside the configured retention period.',
          { claimDate, cutoffDate },
          metadata,
        );
  }

  validateCoverage(claim, coverage, memberId) {
    const definition = rule(
      VALIDATION_RULE_IDS.COVERAGE_ACTIVE,
    );

    if (!isPlainObject(claim)) {
      return skipped(
        definition,
        'Coverage was not evaluated because the claim is unavailable.',
      );
    }

    if (!isPlainObject(coverage)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.COVERAGE_NOT_FOUND,
        'Matching fictional coverage was not found.',
        { coverageFound: false },
      );
    }

    const serviceDate =
      claim.serviceDateFrom ?? claim.serviceDateTo;
    const memberMatches =
      memberId === undefined ||
      memberId === null ||
      coverage.memberId === memberId;
    const activeOnServiceDate =
      coverage.status === 'ACTIVE' &&
      isDateWithinRange(
        serviceDate,
        coverage.effectiveDate,
        coverage.terminationDate,
      );

    return memberMatches && activeOnServiceDate
      ? passed(
          definition,
          'Coverage was active for the claim service date.',
          {
            coverageFound: true,
            memberMatches: true,
            activeOnServiceDate: true,
            serviceDate: normalizeDateOnly(serviceDate),
          },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.COVERAGE_INACTIVE,
          'Coverage was not active for the claim service date.',
          {
            coverageFound: true,
            memberMatches,
            activeOnServiceDate,
            status: coverage.status ?? null,
            serviceDate: normalizeDateOnly(serviceDate),
          },
        );
  }

  validateAccess(claim, restrictions = [], context = {}) {
    const definition = rule(
      VALIDATION_RULE_IDS.ACCESS_ALLOWED,
    );

    if (!isPlainObject(claim)) {
      return skipped(
        definition,
        'Access restrictions were not evaluated because the claim is unavailable.',
      );
    }

    const role = normalizeRole(context.role) ?? 'MEMBER';
    const action =
      normalizeIdentifier(context.action) ?? 'REPRINT_REQUEST';
    const applicable = normalizeCollection(restrictions).filter(
      (restriction) =>
        restriction?.active === true &&
        (restriction.claimNumber === claim.claimNumber ||
          restriction.memberId === claim.memberId),
    );
    const blocked = applicable.filter((restriction) => {
      const allowedRoles = Array.isArray(
        restriction.allowedRoles,
      )
        ? restriction.allowedRoles.map(normalizeRole)
        : [];
      const blockedActions = Array.isArray(
        restriction.blockedActions,
      )
        ? restriction.blockedActions.map(normalizeIdentifier)
        : [];

      return (
        !allowedRoles.includes(role) &&
        (blockedActions.length === 0 ||
          blockedActions.includes(action))
      );
    });

    return blocked.length === 0
      ? passed(
          definition,
          'The current demo role may access this claim action.',
          {
            role,
            action,
            applicableRestrictionCount: applicable.length,
            blockedRestrictionCount: 0,
          },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.CLAIM_ACCESS_RESTRICTED,
          'The fictional claim requires an authorized operations role.',
          {
            role,
            action,
            applicableRestrictionCount: applicable.length,
            blockedRestrictionCount: blocked.length,
            reasonCodes: blocked.map(
              (restriction) => restriction.reasonCode,
            ),
          },
        );
  }

  validateCalculations(record, serviceLines = []) {
    const definition = rule(
      VALIDATION_RULE_IDS.CALCULATIONS_VALID,
    );
    const errors = [
      ...calculateFinancialErrors(
        record,
        '$',
        this.options.calculationTolerance,
      ),
      ...normalizeCollection(serviceLines).flatMap(
        (line, index) =>
          calculateFinancialErrors(
            line,
            `$.serviceLines[${index}]`,
            this.options.calculationTolerance,
          ),
      ),
    ];

    return errors.length === 0
      ? passed(
          definition,
          'Financial calculations are internally consistent.',
          {
            checkedRecordCount:
              1 + normalizeCollection(serviceLines).length,
            mismatchCount: 0,
          },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
          'One or more financial calculations do not balance.',
          {
            checkedRecordCount:
              1 + normalizeCollection(serviceLines).length,
            mismatchCount: errors.length,
            mismatches: errors,
          },
        );
  }

  validateRedaction(value) {
    const definition = rule(
      VALIDATION_RULE_IDS.REDACTION_VALID,
    );
    const violations = collectRedactionViolations(value);

    return violations.length === 0
      ? passed(
          definition,
          'Sensitive values satisfy the local redaction policy.',
          { violationCount: 0 },
        )
      : failed(
          definition,
          VALIDATION_ERROR_CODES.SENSITIVE_VALUE_NOT_REDACTED,
          'One or more sensitive values are not redacted.',
          {
            violationCount: violations.length,
            paths: violations,
          },
        );
  }

  validateAutoApproval(claim, settings = {}) {
    const definition = rule(
      VALIDATION_RULE_IDS.AUTO_APPROVAL_THRESHOLD,
    );

    if (!isPlainObject(claim)) {
      return skipped(
        definition,
        'Auto-approval was not evaluated because the claim is unavailable.',
      );
    }

    const responsibilityCents =
      resolveResponsibilityCents(claim);
    const thresholdCents = resolveThresholdCents(
      settings,
      this.options.autoApprovalThresholdCents,
    );
    const metadata = {
      source:
        settings.autoApprovalThresholdCents === undefined &&
        settings.autoApproveAmount === undefined
          ? VALIDATION_DEFAULTS.metadataLabel
          : 'Configured setting',
      thresholdCents,
      unit: 'cents',
    };

    if (responsibilityCents === null) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.INVALID_FORMAT,
        'Member responsibility must be a non-negative monetary value.',
        { responsibilityCents: null },
        metadata,
      );
    }

    return responsibilityCents <= thresholdCents
      ? passed(
          definition,
          'Member responsibility is within the auto-approval threshold.',
          {
            responsibilityCents,
            thresholdCents,
          },
          metadata,
        )
      : manualReview(
          definition,
          VALIDATION_ERROR_CODES.MANUAL_REVIEW_REQUIRED,
          'Member responsibility exceeds the demo review threshold.',
          {
            responsibilityCents,
            thresholdCents,
          },
          metadata,
        );
  }

  validateRetry(row, options = {}) {
    const definition = rule(
      VALIDATION_RULE_IDS.RETRY_ALLOWED,
    );

    if (!isPlainObject(row)) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.INVALID_INPUT,
        'Retry validation requires a row or failed operation.',
      );
    }

    const maximumAttempts =
      Number.isSafeInteger(options.maximumAttempts) &&
      options.maximumAttempts >= 1
        ? options.maximumAttempts
        : this.options.maximumRetryAttempts;
    const attempt = row.attempt;
    const metadata = {
      source:
        options.maximumAttempts === undefined
          ? VALIDATION_DEFAULTS.metadataLabel
          : 'Configured setting',
      maximumAttempts,
    };

    if (row.status !== 'FAILED') {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.RETRY_NOT_ALLOWED,
        'Only failed rows may be retried.',
        {
          status: row.status ?? null,
          attempt: Number.isInteger(attempt) ? attempt : null,
        },
        metadata,
      );
    }

    if (
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      attempt >= maximumAttempts
    ) {
      return failed(
        definition,
        VALIDATION_ERROR_CODES.RETRY_LIMIT_REACHED,
        'The maximum number of retry attempts has been reached.',
        {
          status: row.status,
          attempt: Number.isInteger(attempt) ? attempt : null,
          nextAttempt:
            Number.isInteger(attempt) ? attempt + 1 : null,
        },
        metadata,
      );
    }

    return passed(
      definition,
      'The failed row is eligible for an explicit retry.',
      {
        status: row.status,
        attempt,
        nextAttempt: attempt + 1,
      },
      metadata,
    );
  }

  validateInboundHeader(feedType, header) {
    const normalizedFeedType = normalizeIdentifier(feedType);
    const expected =
      INBOUND_HEADER_REQUIREMENTS[normalizedFeedType];

    if (
      expected === undefined ||
      !Array.isArray(header) ||
      header.length !== expected.length ||
      header.some(
        (column, index) =>
          typeof column !== 'string' ||
          column.trim().toLowerCase() !== expected[index],
      )
    ) {
      return deepFreeze({
        valid: false,
        code: VALIDATION_ERROR_CODES.INVALID_FORMAT,
        feedType: normalizedFeedType,
        expectedHeader: expected ?? [],
        actualHeader: Array.isArray(header)
          ? header.map((column) => String(column).trim())
          : [],
      });
    }

    return deepFreeze({
      valid: true,
      code: null,
      feedType: normalizedFeedType,
      expectedHeader: expected,
      actualHeader: header.map((column) =>
        column.trim().toLowerCase(),
      ),
    });
  }

  validateInboundRow(feedType, values) {
    const normalizedFeedType = normalizeIdentifier(feedType);
    const headerValidation = this.validateInboundHeader(
      normalizedFeedType,
      Object.keys(isPlainObject(values) ? values : {}),
    );
    const errors = [];

    if (!isPlainObject(values) || !isJsonCompatible(values)) {
      errors.push({
        field: '$',
        code: VALIDATION_ERROR_CODES.INVALID_INPUT,
      });
    } else if (normalizedFeedType === 'AP_REPRINT') {
      const claimNumber = normalizeIdentifier(
        values.claim_number,
      );
      const memberId = normalizeIdentifier(values.member_id);
      const requestType = normalizeIdentifier(
        values.request_type,
      );

      if (
        claimNumber === null ||
        !IDENTIFIER_PATTERN.test(claimNumber)
      ) {
        errors.push({
          field: 'claim_number',
          code: VALIDATION_ERROR_CODES.INVALID_IDENTIFIER,
        });
      }

      if (
        memberId === null ||
        !IDENTIFIER_PATTERN.test(memberId)
      ) {
        errors.push({
          field: 'member_id',
          code: VALIDATION_ERROR_CODES.INVALID_IDENTIFIER,
        });
      }

      if (
        requestType === null ||
        !REQUEST_TYPE_SET.has(requestType)
      ) {
        errors.push({
          field: 'request_type',
          code: VALIDATION_ERROR_CODES.INVALID_REQUEST_TYPE,
        });
      }
    } else if (normalizedFeedType === 'CHANGE_835') {
      const field =
        typeof values.field === 'string'
          ? values.field.trim().toLowerCase()
          : '';

      if (!CHANGE_835_ALLOWLISTED_FIELDS.includes(field)) {
        errors.push({
          field: 'field',
          code: 'FIELD_NOT_ALLOWLISTED',
        });
      }
    } else {
      errors.push({
        field: 'feedType',
        code: VALIDATION_ERROR_CODES.INVALID_FORMAT,
      });
    }

    return deepFreeze({
      valid: headerValidation.valid && errors.length === 0,
      code:
        errors[0]?.code ??
        (headerValidation.valid
          ? null
          : headerValidation.code),
      errors,
      headerValidation,
    });
  }

  validateBusinessRules(
    request,
    claim,
    member,
    settings = {},
    fixtures = {},
    context = {},
  ) {
    const results = [];
    const normalizedMemberId = normalizeIdentifier(
      request?.memberId,
    );

    results.push(this.validateClaimStatus(claim));

    if (!isPlainObject(member)) {
      results.push(
        failed(
          rule(VALIDATION_RULE_IDS.MEMBER_EXISTS),
          VALIDATION_ERROR_CODES.MEMBER_NOT_FOUND,
          'The fictional member was not found.',
          { memberFound: false },
        ),
      );
    } else {
      results.push(
        passed(
          rule(VALIDATION_RULE_IDS.MEMBER_EXISTS),
          'The fictional member was found.',
          { memberFound: true },
        ),
      );
    }

    if (!isPlainObject(claim) || !isPlainObject(member)) {
      results.push(
        skipped(
          rule(VALIDATION_RULE_IDS.MEMBER_CLAIM_MATCH),
          'Member and claim ownership could not be evaluated.',
        ),
      );
    } else if (
      claim.memberId !== normalizedMemberId ||
      member.memberId !== normalizedMemberId
    ) {
      results.push(
        failed(
          rule(VALIDATION_RULE_IDS.MEMBER_CLAIM_MATCH),
          VALIDATION_ERROR_CODES.MEMBER_CLAIM_MISMATCH,
          'The fictional claim belongs to another member.',
          { ownershipConfirmed: false },
        ),
      );
    } else {
      results.push(
        passed(
          rule(VALIDATION_RULE_IDS.MEMBER_CLAIM_MATCH),
          'The fictional member owns the claim.',
          { ownershipConfirmed: true },
        ),
      );
    }

    results.push(this.validateRetention(claim, settings));
    results.push(
      this.validateCoverage(
        claim,
        resolveCoverage(
          fixtures,
          claim,
          normalizedMemberId,
        ),
        normalizedMemberId,
      ),
    );
    results.push(
      this.validateAccess(
        claim,
        resolveCollection(fixtures, [
          'restrictions',
          'restrictionFixtures',
        ]),
        context,
      ),
    );
    results.push(
      this.validateCalculations(
        claim,
        resolveServiceLines(fixtures, claim),
      ),
    );
    results.push(this.validateAutoApproval(claim, settings));

    return summarizeResults(results);
  }

  validateRequest(request, fixtures = {}, context = {}) {
    const results = [
      this.validateRequiredFields(request),
      this.validateSourceAndFormat(request),
    ];

    if (!isPlainObject(request)) {
      return summarizeResults(results);
    }

    const claimNumber = normalizeIdentifier(
      request.claimNumber,
    );
    const memberId = normalizeIdentifier(request.memberId);
    const claim = resolveClaim(fixtures, claimNumber);
    const member = resolveMember(fixtures, memberId);
    const requests = resolveCollection(fixtures, [
      'requests',
      'reprintRequests',
    ]);

    if (claim === null) {
      results.push(
        failed(
          rule(VALIDATION_RULE_IDS.CLAIM_EXISTS),
          VALIDATION_ERROR_CODES.CLAIM_NOT_FOUND,
          'The fictional claim was not found.',
          { claimFound: false },
        ),
      );
    } else {
      results.push(
        passed(
          rule(VALIDATION_RULE_IDS.CLAIM_EXISTS),
          'The fictional claim was found.',
          { claimFound: true },
        ),
      );
    }

    results.push(
      this.validateDuplicate(request, requests),
    );

    const business = this.validateBusinessRules(
      request,
      claim,
      member,
      fixtures.settings ?? {},
      fixtures,
      context,
    );

    results.push(...business.results);
    results.push(this.validateRedaction(request));

    return summarizeResults(results);
  }

  validateQuality(draftMetadata, options = {}) {
    const definition = rule(
      VALIDATION_RULE_IDS.DOCUMENT_QUALITY,
    );

    if (
      !isPlainObject(draftMetadata) ||
      !isJsonCompatible(draftMetadata)
    ) {
      return summarizeResults([
        failed(
          definition,
          VALIDATION_ERROR_CODES.DOCUMENT_QUALITY_FAILED,
          'Document metadata must be a safe JSON-compatible object.',
        ),
      ]);
    }

    const requiredFields = [
      'documentType',
      'claimNumber',
      'memberId',
    ];
    const missingFields = requiredFields.filter(
      (field) =>
        typeof draftMetadata[field] !== 'string' ||
        draftMetadata[field].trim().length === 0,
    );
    const results = [];

    results.push(
      missingFields.length === 0
        ? passed(
            definition,
            'Required document metadata is present.',
            { missingFields: [] },
          )
        : failed(
            definition,
            VALIDATION_ERROR_CODES.DOCUMENT_QUALITY_FAILED,
            'Required document metadata is missing.',
            { missingFields },
          ),
    );
    results.push(
      this.validateCalculations(
        draftMetadata,
        draftMetadata.serviceLines ?? [],
      ),
    );
    results.push(this.validateRedaction(draftMetadata));

    if (options.requirePaymentReference === true) {
      const paymentRule = rule(
        VALIDATION_RULE_IDS.PAYMENT_REFERENCE_PRESENT,
      );
      const paymentReference =
        draftMetadata.paymentReferenceMasked ??
        draftMetadata.paymentReference;

      results.push(
        typeof paymentReference === 'string' &&
          paymentReference.trim().length > 0
          ? passed(
              paymentRule,
              'A payment reference is present.',
              {
                paymentReferencePresent: true,
                masked: MASK_PATTERN.test(paymentReference),
              },
            )
          : failed(
              paymentRule,
              VALIDATION_ERROR_CODES.PAYMENT_REFERENCE_MISSING,
              'A payment reference is required.',
              { paymentReferencePresent: false },
            ),
      );
    }

    return summarizeResults(results);
  }

  validate(request, fixtures = {}, context = {}) {
    return this.validateRequest(request, fixtures, context);
  }

  evaluateRequest(request, fixtures = {}, context = {}) {
    return this.validateRequest(request, fixtures, context);
  }

  evaluateBusinessRules(
    request,
    claim,
    member,
    settings = {},
    fixtures = {},
    context = {},
  ) {
    return this.validateBusinessRules(
      request,
      claim,
      member,
      settings,
      fixtures,
      context,
    );
  }

  evaluateQuality(draftMetadata, options = {}) {
    return this.validateQuality(draftMetadata, options);
  }

  canRetry(row, options = {}) {
    return this.validateRetry(row, options);
  }
}

/**
 * Creates a pure operations validation engine.
 *
 * @param {ConstructorParameters<typeof ValidationEngine>[0]} [options]
 * Validation options.
 * @returns {ValidationEngine} Validation engine.
 */
export function createValidationEngine(options = {}) {
  return new ValidationEngine(options);
}

export function validateOperationRequest(
  request,
  fixtures = {},
  context = {},
  options = {},
) {
  return createValidationEngine(options).validateRequest(
    request,
    fixtures,
    context,
  );
}

export function validateOperationBusinessRules(
  request,
  claim,
  member,
  settings = {},
  fixtures = {},
  context = {},
  options = {},
) {
  return createValidationEngine(options).validateBusinessRules(
    request,
    claim,
    member,
    settings,
    fixtures,
    context,
  );
}

export function validateOperationQuality(
  draftMetadata,
  options = {},
) {
  return createValidationEngine(options).validateQuality(
    draftMetadata,
    options,
  );
}

export const OperationValidationEngine = ValidationEngine;
export const DeterministicValidationEngine = ValidationEngine;
export const createOperationValidationEngine =
  createValidationEngine;
export const createDeterministicValidationEngine =
  createValidationEngine;
export const RULE_CATALOG = VALIDATION_RULE_CATALOG;
export const DEMO_VALIDATION_DEFAULTS = VALIDATION_DEFAULTS;

export default ValidationEngine;