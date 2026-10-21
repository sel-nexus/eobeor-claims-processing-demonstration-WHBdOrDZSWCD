import {
  SEEDED_ACCOUNTS,
  SEEDED_USERS,
} from '../../fixtures/accounts.js';
import DOCUMENT_FIXTURES, {
  DOCUMENT_ARTIFACT_KEYS,
  DOCUMENT_ARTIFACT_MANIFEST,
  DOCUMENT_AUDIENCE_SCOPES,
  DOCUMENT_AUDIENCES,
  DOCUMENT_DISCLOSURES,
  DOCUMENT_LAYOUTS,
  DOCUMENT_VERSION_DETAILS,
  INITIAL_DOCUMENT_VERSIONS,
  REMITTANCE_ROWS,
} from '../../fixtures/documents.js';
import {
  DISPLAY_TOKEN_REQUIREMENTS,
  EXPECTED_RECORD_COUNTS,
  FIXTURE_RELATIONSHIPS,
  FIXTURE_SEED_GROUPS,
  FIXTURE_SOURCE_MODULES,
  FIXTURE_TRACEABILITY_MANIFEST,
  REPRESENTATIVE_ARTIFACTS,
} from '../../fixtures/fixtureManifest.js';
import INSIGHTS_FIXTURES, {
  ASSISTANT_SCRIPT_LIST,
  COMPLIANCE_IDENTITY_CONTEXT,
  COMPLIANCE_IMPLEMENTED_DEMO_BEHAVIOR,
  COMPLIANCE_PRODUCTION_ONLY_NOT_PROVIDED,
  CSR_ALERTS,
  CSR_RECENT_REQUESTS,
  CSR_REQUEST_CHART,
  EXECUTIVE_MONTHLY_TREND,
  INTEGRATION_INVENTORY,
  MONITORING_ALERTS,
  MONITORING_DISK_TIMELINE,
  MONITORING_EVENTS,
  MONITORING_RESOURCE_GAUGES,
  MONITORING_SYNC_LATENCY,
  MONITORING_THROUGHPUT,
  PRODUCTIVITY_AFTER_STEPS,
  PRODUCTIVITY_BEFORE_STEPS,
  PRODUCTIVITY_CALLOUTS,
  PRODUCTIVITY_ERROR_POINTS,
} from '../../fixtures/insights.js';
import MEMBERS_CLAIMS_FIXTURES, {
  CLAIMS,
  COVERAGES,
  MEMBERS,
  PROVIDERS,
  REASON_CODES,
  RESTRICTIONS,
  SERVICE_LINES,
  VALIDATION_CASES,
} from '../../fixtures/membersClaims.js';
import OPERATIONS_FIXTURES, {
  INITIAL_OPERATIONS_ENVELOPE,
} from '../../fixtures/operations.js';
import {
  CANONICAL_SEED_BUNDLE,
  INITIAL_AUDIT_EVENTS,
  INITIAL_SETTINGS,
} from '../../fixtures/seedBundle.js';
import {
  isDocumentVersion,
  isOperationsEnvelope,
} from '../../features/operations/domain/operationsSchemas.js';
import {
  REQUIRED_DISCLOSURES,
  SCHEMA_VERSION,
} from '../config/constants.js';
import {
  isAuditEventCollection,
  isJsonCompatible,
  isMonitoringState,
  isPlainObject,
  isSettings,
  isUserCollection,
} from './schemas.js';

export const FIXTURE_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_FIXTURE_ROOT: 'INVALID_FIXTURE_ROOT',
  INVALID_MANIFEST: 'INVALID_MANIFEST',
  MISSING_SEED_GROUP: 'MISSING_SEED_GROUP',
  DUPLICATE_IDENTIFIER: 'DUPLICATE_IDENTIFIER',
  RECORD_COUNT_MISMATCH: 'RECORD_COUNT_MISMATCH',
  FOREIGN_KEY_VIOLATION: 'FOREIGN_KEY_VIOLATION',
  CALCULATION_MISMATCH: 'CALCULATION_MISMATCH',
  AUDIENCE_SEGREGATION_VIOLATION:
    'AUDIENCE_SEGREGATION_VIOLATION',
  REQUIRED_LABEL_MISMATCH: 'REQUIRED_LABEL_MISMATCH',
  REQUIRED_DISCLOSURE_MISSING: 'REQUIRED_DISCLOSURE_MISSING',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  BASELINE_INTEGRITY_VIOLATION: 'BASELINE_INTEGRITY_VIOLATION',
});

export const REQUIRED_EXACT_FIXTURE_LABELS = Object.freeze({
  EOB_TITLE: 'Explanation of Benefits',
  EOR_TITLE: 'Explanation of Review',
  REMITTANCE_SUBTITLE: 'Provider Remittance Sample',
  REPRESENTATIVE_DOCUMENT: 'Representative Demo Document',
  SCRIPTED_ASSISTANT_DISCLOSURE: 'Scripted demo — no model call',
  MONITORING_DISCLOSURE:
    'Simulated fixture — no monitoring service is connected',
  INTEGRATION_DISCLOSURE: 'No live connectivity is configured.',
  EXECUTIVE_DISCLOSURE_PREFIX: 'Published display fixtures',
});

const EPSILON = 0.000001;

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }

  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  return value;
}

function createError(code, message, path, details) {
  const error = {
    code,
    message,
    path,
  };

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function addError(errors, code, message, path, details) {
  errors.push(createError(code, message, path, details));
}

function areNumbersEqual(left, right) {
  return (
    typeof left === 'number' &&
    Number.isFinite(left) &&
    typeof right === 'number' &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= EPSILON
  );
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function toCollection(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (isPlainObject(value)) {
    return Object.values(value);
  }

  return null;
}

function getPathValue(value, path) {
  return path.split('.').reduce((current, property) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[property];
  }, value);
}

function getRelationshipValues(record, field) {
  if (field.endsWith('[]')) {
    const value = getPathValue(record, field.slice(0, -2));
    return Array.isArray(value) ? value : [];
  }

  return [getPathValue(record, field)];
}

function validateUniqueField(
  errors,
  collection,
  field,
  path,
  options = {},
) {
  if (!Array.isArray(collection)) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.SCHEMA_VIOLATION,
      `${path} must be an array.`,
      path,
    );
    return;
  }

  const seen = new Set();

  collection.forEach((record, index) => {
    const value = record?.[field];

    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.length === 0)
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.SCHEMA_VIOLATION,
        `${path}[${index}].${field} is required.`,
        `${path}[${index}].${field}`,
      );
      return;
    }

    const normalized =
      options.caseInsensitive === true && typeof value === 'string'
        ? value.toLowerCase()
        : value;

    if (seen.has(normalized)) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `${path} contains a duplicate ${field}.`,
        `${path}[${index}].${field}`,
        { value },
      );
      return;
    }

    seen.add(normalized);
  });
}

function createGroupRegistry() {
  return {
    ACCOUNTS: SEEDED_ACCOUNTS,
    USERS: SEEDED_USERS,
    MEMBERS,
    COVERAGES,
    PROVIDERS,
    CLAIMS,
    SERVICE_LINES,
    REASON_CODES,
    RESTRICTIONS,
    VALIDATION_CASES,
    DOCUMENT_LAYOUTS,
    APPEALS: DOCUMENT_FIXTURES.appeals,
    REMITTANCE_ROWS,
    DOCUMENT_ARTIFACTS: DOCUMENT_ARTIFACT_MANIFEST,
    DOCUMENT_VERSIONS: INITIAL_DOCUMENT_VERSIONS,
    DOCUMENT_VERSION_DETAILS,
    REQUESTS: OPERATIONS_FIXTURES.requests,
    PROCESSING_OUTCOME_PROFILES:
      OPERATIONS_FIXTURES.outcomeProfiles,
    PIPELINE_STEPS: OPERATIONS_FIXTURES.pipelineDefinition.steps,
    PIPELINE_RUNS: OPERATIONS_FIXTURES.pipelineRuns,
    MANUAL_REVIEWS: OPERATIONS_FIXTURES.manualReviews,
    MANUAL_REVIEW_SCENARIOS:
      OPERATIONS_FIXTURES.manualReviewScenarios,
    CLAIM_ADJUSTMENT_SCENARIOS:
      OPERATIONS_FIXTURES.claimAdjustmentScenarios,
    ERROR_REPORTS: OPERATIONS_FIXTURES.errorReports,
    ERROR_REPORT_ACTION_SCENARIOS:
      OPERATIONS_FIXTURES.errorReportActionScenarios,
    AP_REPRINT_SCENARIOS: OPERATIONS_FIXTURES.apReprintScenarios,
    CHANGE_835_SCENARIOS: OPERATIONS_FIXTURES.change835Scenarios,
    INBOUND_RUNS: OPERATIONS_FIXTURES.inboundRuns,
    INBOUND_RETRY_RESULTS:
      OPERATIONS_FIXTURES.inboundRetryResults,
    BATCH_STEPS: OPERATIONS_FIXTURES.batchRuns[0]?.steps ?? [],
    BATCH_RUNS: OPERATIONS_FIXTURES.batchRuns,
    NIGHTLY_QUEUE_ROWS: OPERATIONS_FIXTURES.batchRows,
    BATCH_RETRY_RESULTS: OPERATIONS_FIXTURES.batchRetryResults,
    CLAIM_REWORK_SCENARIOS:
      OPERATIONS_FIXTURES.claimReworkScenarios,
    OUTBOUND_RECORDS: OPERATIONS_FIXTURES.outboundRecords,
    FAX_SIMULATION_RESULTS:
      OPERATIONS_FIXTURES.faxSimulationResults,
    CDC_EVENTS: OPERATIONS_FIXTURES.cdcEvents,
    IDEMPOTENCY_RESULTS: OPERATIONS_FIXTURES.idempotencyResults,
    CSR_RECENT_REQUESTS,
    CSR_ALERTS,
    CSR_REQUEST_CHART_POINTS: CSR_REQUEST_CHART.points,
    MONITORING_SYNC_LATENCY_POINTS: MONITORING_SYNC_LATENCY,
    MONITORING_THROUGHPUT_BARS: MONITORING_THROUGHPUT,
    MONITORING_RESOURCE_GAUGES,
    MONITORING_DISK_TIMELINE_POINTS: MONITORING_DISK_TIMELINE,
    MONITORING_EVENTS,
    MONITORING_ALERTS,
    INTEGRATIONS: INTEGRATION_INVENTORY,
    ASSISTANT_SCRIPTS: ASSISTANT_SCRIPT_LIST,
    COMPLIANCE_IMPLEMENTED_BEHAVIORS:
      COMPLIANCE_IMPLEMENTED_DEMO_BEHAVIOR,
    COMPLIANCE_PRODUCTION_ONLY_ITEMS:
      COMPLIANCE_PRODUCTION_ONLY_NOT_PROVIDED,
    COMPLIANCE_IDENTITY_CONTEXT_ITEMS:
      COMPLIANCE_IDENTITY_CONTEXT,
    EXECUTIVE_MONTHLY_TREND_POINTS:
      EXECUTIVE_MONTHLY_TREND.points,
    PRODUCTIVITY_BEFORE_STEPS,
    PRODUCTIVITY_AFTER_STEPS,
    PRODUCTIVITY_ERROR_POINTS,
    PRODUCTIVITY_CALLOUTS,
  };
}

function validateManifest(errors, registry) {
  const manifest = FIXTURE_TRACEABILITY_MANIFEST;

  if (!isPlainObject(manifest) || !isJsonCompatible(manifest)) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.INVALID_MANIFEST,
      'Fixture traceability manifest must be JSON-compatible.',
      'fixtureManifest',
    );
    return;
  }

  if (
    !isPlainObject(FIXTURE_SOURCE_MODULES) ||
    Object.keys(FIXTURE_SOURCE_MODULES).length === 0
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.INVALID_MANIFEST,
      'Fixture source modules must be declared.',
      'fixtureManifest.sources',
    );
  }

  validateUniqueField(
    errors,
    FIXTURE_SEED_GROUPS,
    'seedGroupId',
    'fixtureManifest.seedGroups',
  );

  validateUniqueField(
    errors,
    DISPLAY_TOKEN_REQUIREMENTS,
    'tokenId',
    'fixtureManifest.displayTokens',
  );

  validateUniqueField(
    errors,
    FIXTURE_RELATIONSHIPS,
    'relationshipId',
    'fixtureManifest.relationships',
  );

  const declaredGroupIds = new Set(
    FIXTURE_SEED_GROUPS.map((group) => group.seedGroupId),
  );

  FIXTURE_SEED_GROUPS.forEach((group, index) => {
    const path = `fixtureManifest.seedGroups[${index}]`;
    const records = toCollection(registry[group.seedGroupId]);

    if (records === null) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.MISSING_SEED_GROUP,
        `Seed group ${group.seedGroupId} has no fixture collection.`,
        path,
      );
      return;
    }

    if (
      records.length !== group.expectedRecordCount ||
      records.length !==
        EXPECTED_RECORD_COUNTS[group.seedGroupId]
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.RECORD_COUNT_MISMATCH,
        `Seed group ${group.seedGroupId} does not match its expected record count.`,
        path,
        {
          expected: group.expectedRecordCount,
          actual: records.length,
        },
      );
    }

    if (
      typeof group.source !== 'string' ||
      group.source.length === 0 ||
      typeof group.exportName !== 'string' ||
      group.exportName.length === 0
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.INVALID_MANIFEST,
        `Seed group ${group.seedGroupId} is missing source metadata.`,
        path,
      );
    }

    if (
      group.derivedFrom !== undefined &&
      !declaredGroupIds.has(group.derivedFrom)
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.INVALID_MANIFEST,
        `Seed group ${group.seedGroupId} references an unknown derived group.`,
        `${path}.derivedFrom`,
      );
    }

    if (typeof group.primaryKey === 'string') {
      validateUniqueField(
        errors,
        records,
        group.primaryKey,
        `fixtures.${group.seedGroupId}`,
      );
    }
  });

  Object.entries(EXPECTED_RECORD_COUNTS).forEach(
    ([groupId, expectedCount]) => {
      const records = toCollection(registry[groupId]);

      if (records === null) {
        addError(
          errors,
          FIXTURE_VALIDATION_ERROR_CODES.MISSING_SEED_GROUP,
          `Expected fixture group ${groupId} is unavailable.`,
          `fixtures.${groupId}`,
        );
        return;
      }

      if (records.length !== expectedCount) {
        addError(
          errors,
          FIXTURE_VALIDATION_ERROR_CODES.RECORD_COUNT_MISMATCH,
          `Fixture group ${groupId} contains an unexpected number of records.`,
          `fixtures.${groupId}`,
          {
            expected: expectedCount,
            actual: records.length,
          },
        );
      }
    },
  );
}

function validateRelationships(errors, registry) {
  FIXTURE_RELATIONSHIPS.forEach((relationship, relationshipIndex) => {
    const sourceRecords = toCollection(
      registry[relationship.fromGroup],
    );
    const targetRecords = toCollection(
      registry[relationship.toGroup],
    );
    const path = `fixtureManifest.relationships[${relationshipIndex}]`;

    if (sourceRecords === null || targetRecords === null) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.MISSING_SEED_GROUP,
        `Relationship ${relationship.relationshipId} references an unavailable fixture group.`,
        path,
      );
      return;
    }

    const targetValues = new Set(
      targetRecords.map((record) =>
        getPathValue(record, relationship.toField),
      ),
    );

    sourceRecords.forEach((record, recordIndex) => {
      const values = getRelationshipValues(
        record,
        relationship.fromField,
      );

      values.forEach((value) => {
        if (
          (value === null || value === undefined || value === '') &&
          relationship.optional === true
        ) {
          return;
        }

        if (!targetValues.has(value)) {
          addError(
            errors,
            FIXTURE_VALIDATION_ERROR_CODES.FOREIGN_KEY_VIOLATION,
            `Relationship ${relationship.relationshipId} contains an unresolved reference.`,
            `fixtures.${relationship.fromGroup}[${recordIndex}].${relationship.fromField}`,
            {
              value,
              targetGroup: relationship.toGroup,
              targetField: relationship.toField,
            },
          );
        }
      });
    });
  });

  const claimNumbers = new Set(CLAIMS.map((claim) => claim.claimNumber));
  const memberIds = new Set(MEMBERS.map((member) => member.memberId));
  const serviceLineIds = new Set(
    SERVICE_LINES.map((line) => line.serviceLineId),
  );
  const reasonCodeIds = new Set(
    REASON_CODES.map((reason) => reason.reasonCodeId),
  );

  CLAIMS.forEach((claim, claimIndex) => {
    claim.serviceLineIds.forEach((serviceLineId) => {
      if (!serviceLineIds.has(serviceLineId)) {
        addError(
          errors,
          FIXTURE_VALIDATION_ERROR_CODES.FOREIGN_KEY_VIOLATION,
          'Claim references an unknown service line.',
          `claims[${claimIndex}].serviceLineIds`,
          { serviceLineId },
        );
      }
    });
  });

  SERVICE_LINES.forEach((line, lineIndex) => {
    if (!claimNumbers.has(line.claimNumber)) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.FOREIGN_KEY_VIOLATION,
        'Service line references an unknown claim.',
        `serviceLines[${lineIndex}].claimNumber`,
      );
    }

    line.reasonCodeIds.forEach((reasonCodeId) => {
      if (!reasonCodeIds.has(reasonCodeId)) {
        addError(
          errors,
          FIXTURE_VALIDATION_ERROR_CODES.FOREIGN_KEY_VIOLATION,
          'Service line references an unknown reason code.',
          `serviceLines[${lineIndex}].reasonCodeIds`,
          { reasonCodeId },
        );
      }
    });
  });

  REMITTANCE_ROWS.forEach((row, rowIndex) => {
    if (
      !claimNumbers.has(row.claimNumber) ||
      !memberIds.has(row.memberId)
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.FOREIGN_KEY_VIOLATION,
        'Remittance row references an unknown claim or member.',
        `remittanceRows[${rowIndex}]`,
      );
      return;
    }

    const claim = CLAIMS.find(
      (candidate) => candidate.claimNumber === row.claimNumber,
    );

    if (claim?.memberId !== row.memberId) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.FOREIGN_KEY_VIOLATION,
        'Remittance row member does not own the referenced claim.',
        `remittanceRows[${rowIndex}].memberId`,
      );
    }
  });
}

function validateFinancialRecord(errors, record, path) {
  const expectedAllowed =
    record.billedAmount - record.discountAmount;
  const expectedAllowedFromResponsibility =
    record.planPaidAmount + record.memberResponsibilityAmount;

  if (!areNumbersEqual(record.allowedAmount, expectedAllowed)) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
      'Allowed amount must equal billed amount minus discount amount.',
      path,
      {
        expected: expectedAllowed,
        actual: record.allowedAmount,
      },
    );
  }

  if (
    !areNumbersEqual(
      record.allowedAmount,
      expectedAllowedFromResponsibility,
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
      'Allowed amount must equal plan paid plus member responsibility.',
      path,
      {
        expected: expectedAllowedFromResponsibility,
        actual: record.allowedAmount,
      },
    );
  }
}

function validateCalculations(errors) {
  CLAIMS.forEach((claim, index) => {
    validateFinancialRecord(errors, claim, `claims[${index}]`);
  });

  SERVICE_LINES.forEach((line, index) => {
    validateFinancialRecord(
      errors,
      line,
      `serviceLines[${index}]`,
    );

    const responsibilityParts =
      line.deductibleAmount +
      line.copayAmount +
      line.coinsuranceAmount;

    if (
      !areNumbersEqual(
        line.memberResponsibilityAmount,
        responsibilityParts,
      )
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
        'Service-line responsibility must equal deductible, copay, and coinsurance.',
        `serviceLines[${index}]`,
        {
          expected: responsibilityParts,
          actual: line.memberResponsibilityAmount,
        },
      );
    }
  });

  DOCUMENT_VERSION_DETAILS.forEach((detail, index) => {
    validateFinancialRecord(
      errors,
      detail,
      `documentVersionDetails[${index}]`,
    );
  });

  REMITTANCE_ROWS.forEach((row, index) => {
    const expectedAllowed =
      row.planPaidAmount + row.memberResponsibilityAmount;

    if (!areNumbersEqual(row.allowedAmount, expectedAllowed)) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
        'Remittance allowed amount must equal plan paid plus member responsibility.',
        `remittanceRows[${index}]`,
      );
    }
  });

  const printedMinuteTotal = sum(
    PRODUCTIVITY_AFTER_STEPS.map((step) => step.printedMinutes),
  );

  if (
    !areNumbersEqual(
      printedMinuteTotal,
      INSIGHTS_FIXTURES.productivity.printedMinuteTotal,
    ) ||
    !areNumbersEqual(
      printedMinuteTotal,
      INSIGHTS_FIXTURES.productivity.after.totalMinutes,
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
      'Productivity after-step minutes must equal the published total.',
      'insights.productivity.after.steps',
      {
        calculated: printedMinuteTotal,
        published:
          INSIGHTS_FIXTURES.productivity.printedMinuteTotal,
      },
    );
  }

  const beforeMinuteTotal = sum(
    PRODUCTIVITY_BEFORE_STEPS.map((step) => step.printedMinutes),
  );

  if (
    !areNumbersEqual(
      beforeMinuteTotal,
      INSIGHTS_FIXTURES.productivity.before.totalMinutes,
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
      'Productivity before-step minutes must equal the published total.',
      'insights.productivity.before.steps',
      {
        calculated: beforeMinuteTotal,
        published:
          INSIGHTS_FIXTURES.productivity.before.totalMinutes,
      },
    );
  }

  const summary = OPERATIONS_FIXTURES.processingSummary;
  const requestCountTotal = Object.values(
    summary.requestCounts,
  ).reduce(
    (total, value, index) =>
      index === 0 ? total : total + value,
    0,
  );

  if (
    summary.requestCounts.total !==
      OPERATIONS_FIXTURES.requests.length ||
    requestCountTotal !== summary.requestCounts.total
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.CALCULATION_MISMATCH,
      'Operations request summary does not match request fixtures.',
      'operations.processingSummary.requestCounts',
    );
  }
}

function validateAudienceSegregation(errors) {
  const memberScope =
    DOCUMENT_AUDIENCE_SCOPES[DOCUMENT_AUDIENCES.MEMBER];
  const providerScope =
    DOCUMENT_AUDIENCE_SCOPES[DOCUMENT_AUDIENCES.PROVIDER];
  const remittanceArtifact = DOCUMENT_ARTIFACT_MANIFEST.find(
    (artifact) =>
      artifact.artifactKey ===
      DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE,
  );
  const remittanceLayout = DOCUMENT_LAYOUTS.EOR_REMITTANCE;

  if (
    memberScope?.ownershipRequiredForMember !== true ||
    !memberScope.allowedRoles.includes('MEMBER')
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.AUDIENCE_SEGREGATION_VIOLATION,
      'Member documents must require member ownership.',
      'documents.audienceScopes.MEMBER',
    );
  }

  if (
    providerScope?.allowedRoles.includes('MEMBER') ||
    providerScope?.allowedRoles.includes('CSR')
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.AUDIENCE_SEGREGATION_VIOLATION,
      'Provider remittance documents must not be available to member or CSR roles.',
      'documents.audienceScopes.PROVIDER.allowedRoles',
    );
  }

  if (
    remittanceArtifact?.audienceScope !==
      DOCUMENT_AUDIENCES.PROVIDER ||
    remittanceLayout?.audienceScope !== DOCUMENT_AUDIENCES.PROVIDER
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.AUDIENCE_SEGREGATION_VIOLATION,
      'EOR remittance artifacts and layouts must use provider scope.',
      'documents.remittance',
    );
  }

  INITIAL_DOCUMENT_VERSIONS.forEach((document, index) => {
    const artifact = DOCUMENT_ARTIFACT_MANIFEST.find(
      (candidate) =>
        candidate.artifactKey === document.artifactKey,
    );
    const claim = CLAIMS.find(
      (candidate) =>
        candidate.claimNumber === document.claimNumber,
    );

    if (
      artifact?.audienceScope !== DOCUMENT_AUDIENCES.MEMBER ||
      document.artifactKey ===
        DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE
    ) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.AUDIENCE_SEGREGATION_VIOLATION,
        'Member document versions may reference only member-scoped artifacts.',
        `documents.initialVersions[${index}].artifactKey`,
      );
    }

    if (claim?.memberId !== document.memberId) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.AUDIENCE_SEGREGATION_VIOLATION,
        'Document member must own the referenced claim.',
        `documents.initialVersions[${index}].memberId`,
      );
    }
  });

  if (
    REPRESENTATIVE_ARTIFACTS.some(
      (artifact) =>
        artifact.artifactKey ===
          DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE &&
        artifact.audienceScope !== DOCUMENT_AUDIENCES.PROVIDER,
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.AUDIENCE_SEGREGATION_VIOLATION,
      'Representative remittance metadata must preserve provider scope.',
      'fixtureManifest.representativeArtifacts',
    );
  }
}

function validateRequiredLabels(errors) {
  const labels = {
    EOB_TITLE: DOCUMENT_LAYOUTS.EOB?.title,
    EOR_TITLE: DOCUMENT_LAYOUTS.EOR?.title,
    REMITTANCE_SUBTITLE: DOCUMENT_LAYOUTS.EOR_REMITTANCE?.subtitle,
    REPRESENTATIVE_DOCUMENT:
      DISPLAY_TOKEN_REQUIREMENTS.find(
        (requirement) =>
          requirement.tokenId === 'REPRESENTATIVE_DOCUMENT',
      )?.token,
    SCRIPTED_ASSISTANT_DISCLOSURE:
      ASSISTANT_SCRIPT_LIST[0]?.disclosure,
    MONITORING_DISCLOSURE:
      INSIGHTS_FIXTURES.monitoring.disclosure,
    INTEGRATION_DISCLOSURE:
      INSIGHTS_FIXTURES.integrations.disclosure,
  };

  Object.entries(REQUIRED_EXACT_FIXTURE_LABELS).forEach(
    ([labelId, expected]) => {
      if (labelId === 'EXECUTIVE_DISCLOSURE_PREFIX') {
        if (
          !INSIGHTS_FIXTURES.executive.disclosure.startsWith(expected)
        ) {
          addError(
            errors,
            FIXTURE_VALIDATION_ERROR_CODES.REQUIRED_LABEL_MISMATCH,
            `Required fixture label ${labelId} does not match.`,
            `labels.${labelId}`,
            {
              expected,
              actual: INSIGHTS_FIXTURES.executive.disclosure,
            },
          );
        }

        return;
      }

      if (labels[labelId] !== expected) {
        addError(
          errors,
          FIXTURE_VALIDATION_ERROR_CODES.REQUIRED_LABEL_MISMATCH,
          `Required fixture label ${labelId} does not match.`,
          `labels.${labelId}`,
          {
            expected,
            actual: labels[labelId],
          },
        );
      }
    },
  );

  const searchableFixtureText = JSON.stringify({
    documents: DOCUMENT_FIXTURES,
    operations: OPERATIONS_FIXTURES,
    insights: INSIGHTS_FIXTURES,
    manifest: FIXTURE_TRACEABILITY_MANIFEST,
  });

  DISPLAY_TOKEN_REQUIREMENTS.forEach((requirement) => {
    if (!searchableFixtureText.includes(requirement.token)) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.REQUIRED_LABEL_MISMATCH,
        `Required display token ${requirement.tokenId} is absent from fixtures.`,
        `fixtureManifest.displayTokens.${requirement.tokenId}`,
      );
    }
  });

  const requiredDisclosures = [
    ...REQUIRED_DISCLOSURES,
    ...DOCUMENT_DISCLOSURES,
  ];

  [...new Set(requiredDisclosures)].forEach((disclosure) => {
    if (!searchableFixtureText.includes(disclosure)) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.REQUIRED_DISCLOSURE_MISSING,
        'A required fixture disclosure is missing.',
        'fixtures.disclosures',
        { disclosure },
      );
    }
  });
}

function validateSchemas(errors) {
  const schemaChecks = [
    {
      valid: isUserCollection(SEEDED_USERS),
      path: 'accounts.users',
      name: 'Seeded users',
    },
    {
      valid: isSettings(INITIAL_SETTINGS),
      path: 'seedBundle.settings',
      name: 'Initial settings',
    },
    {
      valid: isAuditEventCollection(INITIAL_AUDIT_EVENTS),
      path: 'seedBundle.auditEvents',
      name: 'Initial audit events',
    },
    {
      valid: isMonitoringState(INSIGHTS_FIXTURES.monitoring),
      path: 'insights.monitoring',
      name: 'Monitoring fixture',
    },
    {
      valid: isOperationsEnvelope(INITIAL_OPERATIONS_ENVELOPE),
      path: 'operations.initialEnvelope',
      name: 'Operations envelope',
    },
    {
      valid: INITIAL_DOCUMENT_VERSIONS.every(isDocumentVersion),
      path: 'documents.initialVersions',
      name: 'Initial document versions',
    },
  ];

  schemaChecks.forEach((check) => {
    if (!check.valid) {
      addError(
        errors,
        FIXTURE_VALIDATION_ERROR_CODES.SCHEMA_VIOLATION,
        `${check.name} does not satisfy its schema.`,
        check.path,
      );
    }
  });
}

function validateBaseline(errors) {
  if (
    !isPlainObject(CANONICAL_SEED_BUNDLE) ||
    !isJsonCompatible(CANONICAL_SEED_BUNDLE)
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.INVALID_FIXTURE_ROOT,
      'Canonical seed bundle must be safe JSON-compatible data.',
      'seedBundle',
    );
    return;
  }

  if (
    CANONICAL_SEED_BUNDLE.schemaVersion !== SCHEMA_VERSION ||
    CANONICAL_SEED_BUNDLE.representativeOnly !== true ||
    CANONICAL_SEED_BUNDLE.networkRequired !== false
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'Canonical seed metadata is inconsistent with the static demonstration.',
      'seedBundle',
    );
  }

  if (
    FIXTURE_TRACEABILITY_MANIFEST.provenance.generatedData !== false ||
    FIXTURE_TRACEABILITY_MANIFEST.provenance.networkRequired !== false ||
    FIXTURE_TRACEABILITY_MANIFEST.provenance
      .containsRealHealthcareData !== false ||
    FIXTURE_TRACEABILITY_MANIFEST.provenance.representativeOnly !== true
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'Fixture provenance must identify fictional, local representative data.',
      'fixtureManifest.provenance',
    );
  }

  if (
    CANONICAL_SEED_BUNDLE.operationsEnvelope !==
      INITIAL_OPERATIONS_ENVELOPE ||
    CANONICAL_SEED_BUNDLE.membersClaims !==
      MEMBERS_CLAIMS_FIXTURES ||
    CANONICAL_SEED_BUNDLE.documents !== DOCUMENT_FIXTURES ||
    CANONICAL_SEED_BUNDLE.insights !== INSIGHTS_FIXTURES
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'Canonical seed bundle does not reference the published baseline fixtures.',
      'seedBundle',
    );
  }

  validateUniqueField(
    errors,
    SEEDED_USERS,
    'username',
    'accounts.users',
    { caseInsensitive: true },
  );

  if (
    SEEDED_ACCOUNTS.some(
      (account) =>
        account.credentials.localOnly !== true ||
        account.credentialNotice.length === 0,
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'Seeded credentials must be explicitly local-only.',
      'accounts.credentials',
    );
  }

  if (
    DOCUMENT_ARTIFACT_MANIFEST.some(
      (artifact) =>
        artifact.representativeOnly !== true ||
        !artifact.assetUrl.startsWith('/documents/') ||
        artifact.mediaType !== 'application/pdf'
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'Document artifacts must be same-origin representative PDFs.',
      'documents.artifactManifest',
    );
  }

  if (
    INTEGRATION_INVENTORY.some(
      (integration) => integration.networkEnabled !== false,
    )
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'Fixture integrations must not enable live network connectivity.',
      'insights.integrations.items',
    );
  }

  if (
    INSIGHTS_FIXTURES.compliance.certificationsClaimed.length !== 0
  ) {
    addError(
      errors,
      FIXTURE_VALIDATION_ERROR_CODES.BASELINE_INTEGRITY_VIOLATION,
      'The static demonstration must not claim certifications.',
      'insights.compliance.certificationsClaimed',
    );
  }
}

/**
 * Error raised when fixture integrity validation fails.
 */
export class FixtureIntegrityError extends Error {
  /**
   * @param {string} message Human-readable error message.
   * @param {readonly Record<string, unknown>[]} errors Validation errors.
   */
  constructor(message, errors) {
    super(message);
    this.name = 'FixtureIntegrityError';
    this.code = 'FIXTURE_SCHEMA_INVALID';
    this.errors = deepFreeze([...errors]);
  }
}

/**
 * Validates the bundled fixture baseline and traceability manifest.
 */
export class FixtureSchemaValidator {
  /**
   * Runs all fixture integrity checks.
   *
   * @returns {Readonly<{
   *   valid: boolean,
   *   errors: readonly Readonly<Record<string, unknown>>[],
   *   checkedRecordCounts: Readonly<Record<string, number>>,
   *   manifestVersion: string
   * }>} Fixture validation report.
   */
  validate() {
    const errors = [];
    const registry = createGroupRegistry();

    validateManifest(errors, registry);
    validateRelationships(errors, registry);
    validateCalculations(errors);
    validateAudienceSegregation(errors);
    validateRequiredLabels(errors);
    validateSchemas(errors);
    validateBaseline(errors);

    const checkedRecordCounts = Object.fromEntries(
      Object.keys(EXPECTED_RECORD_COUNTS).map((groupId) => {
        const collection = toCollection(registry[groupId]);
        return [groupId, collection?.length ?? 0];
      }),
    );

    return deepFreeze({
      valid: errors.length === 0,
      errors,
      checkedRecordCounts,
      manifestVersion:
        FIXTURE_TRACEABILITY_MANIFEST.manifestVersion,
    });
  }

  /**
   * Validates fixtures and throws when any integrity rule fails.
   *
   * @returns {ReturnType<FixtureSchemaValidator['validate']>} Valid report.
   */
  assertValid() {
    const report = this.validate();

    if (!report.valid) {
      throw new FixtureIntegrityError(
        `Fixture integrity validation failed with ${report.errors.length} error(s).`,
        report.errors,
      );
    }

    return report;
  }
}

/**
 * Creates a fixture integrity validator.
 *
 * @returns {FixtureSchemaValidator} Fixture validator.
 */
export function createFixtureSchemaValidator() {
  return new FixtureSchemaValidator();
}

/**
 * Validates all bundled fixtures without throwing.
 *
 * @returns {ReturnType<FixtureSchemaValidator['validate']>} Validation report.
 */
export function validateFixtures() {
  return createFixtureSchemaValidator().validate();
}

/**
 * Validates all bundled fixtures and throws on integrity failure.
 *
 * @returns {ReturnType<FixtureSchemaValidator['validate']>} Validation report.
 */
export function assertFixtureIntegrity() {
  return createFixtureSchemaValidator().assertValid();
}

export const validateFixtureIntegrity = validateFixtures;
export const validateFixtureManifest = validateFixtures;
export const assertFixturesValid = assertFixtureIntegrity;
export const FixtureValidator = FixtureSchemaValidator;

export default FixtureSchemaValidator;