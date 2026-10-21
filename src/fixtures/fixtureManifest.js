import {
  DOCUMENT_ARTIFACT_MANIFEST,
  DOCUMENT_DISCLOSURES,
} from './documents.js';
import { OPERATIONS_FIXTURE_VERSION } from './operations.js';
import {
  DOCUMENT_NOTICE,
  FIXTURE_VERSION,
  REFERENCE_DATE,
  REQUIRED_DISCLOSURES,
  SCHEMA_VERSION,
  SIMULATION_STATUS_PHRASE,
} from '../platform/config/constants.js';

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

export const FIXTURE_MANIFEST_VERSION = '2026-10-21.1';

export const FIXTURE_USER_STORIES = Object.freeze([
  'SCRUM-2069',
  'SCRUM-2071',
  'SCRUM-2073',
  'SCRUM-2074',
  'SCRUM-2075',
]);

export const FIXTURE_SOURCE_MODULES = deepFreeze({
  ACCOUNTS: {
    module: 'src/fixtures/accounts.js',
    purpose:
      'Seeded local personas, users, and demonstration credentials.',
  },
  MEMBERS_CLAIMS: {
    module: 'src/fixtures/membersClaims.js',
    purpose:
      'Fictional members, coverage, providers, claims, service lines, reason codes, restrictions, and validation cases.',
  },
  DOCUMENTS: {
    module: 'src/fixtures/documents.js',
    purpose:
      'Document layouts, appeals, remittance rows, searchable text, versions, and static representative PDF artifacts.',
  },
  OPERATIONS: {
    module: 'src/fixtures/operations.js',
    purpose:
      'Deterministic request, pipeline, review, error, feed, batch, outbound, CDC, retry, and queue fixtures.',
  },
  INSIGHTS: {
    module: 'src/fixtures/insights.js',
    purpose:
      'Representative dashboards, monitoring, integrations, scripted assistance, compliance, executive, and productivity fixtures.',
  },
});

export const EXPECTED_RECORD_COUNTS = deepFreeze({
  ACCOUNTS: 6,
  USERS: 6,
  MEMBERS: 2,
  COVERAGES: 3,
  PROVIDERS: 3,
  CLAIMS: 6,
  SERVICE_LINES: 6,
  REASON_CODES: 6,
  RESTRICTIONS: 3,
  VALIDATION_CASES: 8,
  DOCUMENT_LAYOUTS: 3,
  APPEALS: 3,
  REMITTANCE_ROWS: 2,
  DOCUMENT_ARTIFACTS: 3,
  INITIAL_DOCUMENT_VERSIONS: 2,
  DOCUMENT_VERSION_DETAILS: 2,
  REQUESTS: 5,
  PROCESSING_OUTCOME_PROFILES: 4,
  PIPELINE_STEPS: 9,
  PIPELINE_RUNS: 4,
  MANUAL_REVIEWS: 1,
  MANUAL_REVIEW_SCENARIOS: 2,
  CLAIM_ADJUSTMENT_SCENARIOS: 3,
  ERROR_REPORTS: 2,
  ERROR_REPORT_ACTION_SCENARIOS: 4,
  AP_REPRINT_SCENARIOS: 3,
  CHANGE_835_SCENARIOS: 2,
  INBOUND_RUNS: 2,
  INBOUND_RETRY_RESULTS: 2,
  BATCH_STEPS: 10,
  BATCH_RUNS: 1,
  NIGHTLY_QUEUE_ROWS: 3,
  BATCH_RETRY_RESULTS: 2,
  CLAIM_REWORK_SCENARIOS: 2,
  OUTBOUND_RECORDS: 6,
  FAX_SIMULATION_RESULTS: 1,
  CDC_EVENTS: 1,
  IDEMPOTENCY_RESULTS: 2,
  CSR_RECENT_REQUESTS: 5,
  CSR_ALERTS: 3,
  CSR_REQUEST_CHART_POINTS: 7,
  MONITORING_SYNC_LATENCY_POINTS: 6,
  MONITORING_THROUGHPUT_BARS: 6,
  MONITORING_RESOURCE_GAUGES: 3,
  MONITORING_DISK_TIMELINE_POINTS: 7,
  MONITORING_EVENTS: 5,
  MONITORING_ALERTS: 2,
  INTEGRATIONS: 14,
  ASSISTANT_SCRIPTS: 5,
  COMPLIANCE_IMPLEMENTED_BEHAVIORS: 8,
  COMPLIANCE_PRODUCTION_ONLY_ITEMS: 11,
  COMPLIANCE_IDENTITY_CONTEXT_ITEMS: 2,
  EXECUTIVE_MONTHLY_TREND_POINTS: 12,
  PRODUCTIVITY_BEFORE_STEPS: 7,
  PRODUCTIVITY_AFTER_STEPS: 9,
  PRODUCTIVITY_ERROR_POINTS: 2,
  PRODUCTIVITY_CALLOUTS: 4,
});

export const FIXTURE_SEED_GROUPS = deepFreeze([
  {
    seedGroupId: 'ACCOUNTS',
    source: FIXTURE_SOURCE_MODULES.ACCOUNTS.module,
    exportName: 'SEEDED_ACCOUNTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.ACCOUNTS,
    primaryKey: 'userId',
    userStories: ['SCRUM-2069'],
  },
  {
    seedGroupId: 'USERS',
    source: FIXTURE_SOURCE_MODULES.ACCOUNTS.module,
    exportName: 'SEEDED_USERS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.USERS,
    primaryKey: 'userId',
    derivedFrom: 'ACCOUNTS',
    userStories: ['SCRUM-2069'],
  },
  {
    seedGroupId: 'MEMBERS',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'MEMBERS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.MEMBERS,
    primaryKey: 'memberId',
    userStories: ['SCRUM-2069', 'SCRUM-2071'],
  },
  {
    seedGroupId: 'COVERAGES',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'COVERAGES',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.COVERAGES,
    primaryKey: 'coverageId',
    userStories: ['SCRUM-2069'],
  },
  {
    seedGroupId: 'PROVIDERS',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'PROVIDERS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.PROVIDERS,
    primaryKey: 'providerId',
    userStories: ['SCRUM-2069', 'SCRUM-2071'],
  },
  {
    seedGroupId: 'CLAIMS',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'CLAIMS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.CLAIMS,
    primaryKey: 'claimNumber',
    userStories: ['SCRUM-2069', 'SCRUM-2071', 'SCRUM-2073'],
  },
  {
    seedGroupId: 'SERVICE_LINES',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'SERVICE_LINES',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.SERVICE_LINES,
    primaryKey: 'serviceLineId',
    userStories: ['SCRUM-2069', 'SCRUM-2071'],
  },
  {
    seedGroupId: 'REASON_CODES',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'REASON_CODES',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.REASON_CODES,
    primaryKey: 'reasonCodeId',
    userStories: ['SCRUM-2069', 'SCRUM-2071'],
  },
  {
    seedGroupId: 'RESTRICTIONS',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'RESTRICTIONS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.RESTRICTIONS,
    primaryKey: 'restrictionId',
    userStories: ['SCRUM-2069', 'SCRUM-2073'],
  },
  {
    seedGroupId: 'VALIDATION_CASES',
    source: FIXTURE_SOURCE_MODULES.MEMBERS_CLAIMS.module,
    exportName: 'VALIDATION_CASES',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.VALIDATION_CASES,
    primaryKey: 'caseId',
    userStories: ['SCRUM-2069', 'SCRUM-2073'],
  },
  {
    seedGroupId: 'DOCUMENT_LAYOUTS',
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    exportName: 'DOCUMENT_LAYOUTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.DOCUMENT_LAYOUTS,
    primaryKey: 'layoutId',
    userStories: ['SCRUM-2071'],
  },
  {
    seedGroupId: 'APPEALS',
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    exportName: 'APPEAL_FIXTURES',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.APPEALS,
    primaryKey: 'appealId',
    userStories: ['SCRUM-2071'],
  },
  {
    seedGroupId: 'REMITTANCE_ROWS',
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    exportName: 'REMITTANCE_ROWS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.REMITTANCE_ROWS,
    primaryKey: 'remittanceRowId',
    userStories: ['SCRUM-2071'],
  },
  {
    seedGroupId: 'DOCUMENT_ARTIFACTS',
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    exportName: 'DOCUMENT_ARTIFACT_MANIFEST',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.DOCUMENT_ARTIFACTS,
    primaryKey: 'artifactKey',
    userStories: ['SCRUM-2071', 'SCRUM-2075'],
  },
  {
    seedGroupId: 'DOCUMENT_VERSIONS',
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    exportName: 'INITIAL_DOCUMENT_VERSIONS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.INITIAL_DOCUMENT_VERSIONS,
    primaryKey: 'documentId',
    userStories: ['SCRUM-2071', 'SCRUM-2073'],
  },
  {
    seedGroupId: 'DOCUMENT_VERSION_DETAILS',
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    exportName: 'DOCUMENT_VERSION_DETAILS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.DOCUMENT_VERSION_DETAILS,
    primaryKey: 'documentId',
    userStories: ['SCRUM-2071'],
  },
  {
    seedGroupId: 'REQUESTS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_REQUESTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.REQUESTS,
    primaryKey: 'requestId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'PROCESSING_OUTCOME_PROFILES',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'PROCESSING_OUTCOME_PROFILES',
    expectedRecordCount:
      EXPECTED_RECORD_COUNTS.PROCESSING_OUTCOME_PROFILES,
    primaryKey: 'scenario',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'PIPELINE_STEPS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'PIPELINE_DEFINITION_FIXTURE.steps',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.PIPELINE_STEPS,
    primaryKey: 'step',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'PIPELINE_RUNS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_PIPELINE_RUNS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.PIPELINE_RUNS,
    primaryKey: 'runId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'MANUAL_REVIEWS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_MANUAL_REVIEWS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.MANUAL_REVIEWS,
    primaryKey: 'reviewId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'ERROR_REPORTS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_ERROR_REPORTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.ERROR_REPORTS,
    primaryKey: 'errorReportId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'INBOUND_RUNS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_INBOUND_RUNS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.INBOUND_RUNS,
    primaryKey: 'feedRunId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'BATCH_RUNS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_BATCH_RUNS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.BATCH_RUNS,
    primaryKey: 'batchId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'NIGHTLY_QUEUE_ROWS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'NIGHTLY_QUEUE_ROWS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.NIGHTLY_QUEUE_ROWS,
    primaryKey: 'rowId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'OUTBOUND_RECORDS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_OUTBOUND_RECORDS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.OUTBOUND_RECORDS,
    primaryKey: 'outboundId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'CDC_EVENTS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_CDC_EVENTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.CDC_EVENTS,
    primaryKey: 'cdcEventId',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'IDEMPOTENCY_RESULTS',
    source: FIXTURE_SOURCE_MODULES.OPERATIONS.module,
    exportName: 'INITIAL_IDEMPOTENCY_RESULTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.IDEMPOTENCY_RESULTS,
    primaryKey: 'idempotencyKey',
    userStories: ['SCRUM-2073'],
  },
  {
    seedGroupId: 'CSR_RECENT_REQUESTS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'CSR_RECENT_REQUESTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.CSR_RECENT_REQUESTS,
    primaryKey: 'requestId',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'CSR_ALERTS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'CSR_ALERTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.CSR_ALERTS,
    primaryKey: 'alertId',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'MONITORING_EVENTS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'MONITORING_EVENTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.MONITORING_EVENTS,
    primaryKey: 'eventId',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'MONITORING_ALERTS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'MONITORING_ALERTS',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.MONITORING_ALERTS,
    primaryKey: 'alertId',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'INTEGRATIONS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'INTEGRATION_INVENTORY',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.INTEGRATIONS,
    primaryKey: 'integrationId',
    userStories: ['SCRUM-2074', 'SCRUM-2075'],
  },
  {
    seedGroupId: 'ASSISTANT_SCRIPTS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'ASSISTANT_SCRIPT_LIST',
    expectedRecordCount: EXPECTED_RECORD_COUNTS.ASSISTANT_SCRIPTS,
    primaryKey: 'topic',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'EXECUTIVE_MONTHLY_TREND',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'EXECUTIVE_MONTHLY_TREND.points',
    expectedRecordCount:
      EXPECTED_RECORD_COUNTS.EXECUTIVE_MONTHLY_TREND_POINTS,
    primaryKey: 'month',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'PRODUCTIVITY_BEFORE_STEPS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'PRODUCTIVITY_BEFORE_STEPS',
    expectedRecordCount:
      EXPECTED_RECORD_COUNTS.PRODUCTIVITY_BEFORE_STEPS,
    primaryKey: 'step',
    userStories: ['SCRUM-2074'],
  },
  {
    seedGroupId: 'PRODUCTIVITY_AFTER_STEPS',
    source: FIXTURE_SOURCE_MODULES.INSIGHTS.module,
    exportName: 'PRODUCTIVITY_AFTER_STEPS',
    expectedRecordCount:
      EXPECTED_RECORD_COUNTS.PRODUCTIVITY_AFTER_STEPS,
    primaryKey: 'step',
    userStories: ['SCRUM-2074'],
  },
]);

export const FIXTURE_SEED_GROUPS_BY_ID = deepFreeze(
  Object.fromEntries(
    FIXTURE_SEED_GROUPS.map((group) => [group.seedGroupId, group]),
  ),
);

export const DISPLAY_TOKEN_REQUIREMENTS = deepFreeze([
  {
    tokenId: 'DOCUMENT_NOTICE',
    token: DOCUMENT_NOTICE,
    sources: ['documents', 'document-download'],
    userStories: ['SCRUM-2071'],
  },
  {
    tokenId: 'SIMULATION_STATUS',
    token: SIMULATION_STATUS_PHRASE,
    sources: ['pipeline', 'documents'],
    userStories: ['SCRUM-2071', 'SCRUM-2073'],
  },
  {
    tokenId: 'NON_AUTHORITATIVE_DISCLOSURE',
    token: REQUIRED_DISCLOSURES[0],
    sources: ['documents', 'downloads'],
    userStories: ['SCRUM-2071', 'SCRUM-2075'],
  },
  {
    tokenId: 'NO_DECISION_DISCLOSURE',
    token: REQUIRED_DISCLOSURES[1],
    sources: ['documents', 'downloads'],
    userStories: ['SCRUM-2071', 'SCRUM-2075'],
  },
  {
    tokenId: 'FICTIONAL_DATA_DISCLOSURE',
    token: REQUIRED_DISCLOSURES[2],
    sources: ['documents', 'downloads', 'reports'],
    userStories: ['SCRUM-2071', 'SCRUM-2075'],
  },
  {
    tokenId: 'EOB_TITLE',
    token: 'Explanation of Benefits',
    sources: ['documents', 'assistant'],
    userStories: ['SCRUM-2071', 'SCRUM-2074'],
  },
  {
    tokenId: 'EOR_TITLE',
    token: 'Explanation of Review',
    sources: ['documents', 'assistant'],
    userStories: ['SCRUM-2071', 'SCRUM-2074'],
  },
  {
    tokenId: 'REPRESENTATIVE_DOCUMENT',
    token: 'Representative Demo Document',
    sources: ['document-artifacts'],
    userStories: ['SCRUM-2071'],
  },
  {
    tokenId: 'PROVIDER_REMITTANCE',
    token: 'Provider Remittance Sample',
    sources: ['document-artifacts'],
    userStories: ['SCRUM-2071'],
  },
  {
    tokenId: 'PRIMARY_CLAIM',
    token: 'CL2024001',
    sources: ['claims', 'requests', 'documents'],
    userStories: ['SCRUM-2069', 'SCRUM-2071', 'SCRUM-2073'],
  },
  {
    tokenId: 'PRIMARY_MEMBER',
    token: 'John Doe',
    sources: ['accounts', 'members', 'documents'],
    userStories: ['SCRUM-2069', 'SCRUM-2071'],
  },
  {
    tokenId: 'SECONDARY_MEMBER',
    token: 'Jane Smith',
    sources: ['accounts', 'members', 'remittance'],
    userStories: ['SCRUM-2069', 'SCRUM-2071'],
  },
  {
    tokenId: 'SCRIPTED_ASSISTANT_DISCLOSURE',
    token: 'Scripted demo — no model call',
    sources: ['assistant'],
    userStories: ['SCRUM-2074'],
  },
  {
    tokenId: 'MONITORING_DISCLOSURE',
    token: 'Simulated fixture — no monitoring service is connected',
    sources: ['monitoring'],
    userStories: ['SCRUM-2074', 'SCRUM-2075'],
  },
  {
    tokenId: 'NO_LIVE_CONNECTIVITY',
    token: 'No live connectivity is configured.',
    sources: ['integrations'],
    userStories: ['SCRUM-2074', 'SCRUM-2075'],
  },
  {
    tokenId: 'PUBLISHED_FIXTURE',
    token: 'Published display fixtures',
    sources: ['executive-insights'],
    userStories: ['SCRUM-2074'],
  },
]);

export const REQUIRED_DISPLAY_TOKENS = Object.freeze(
  DISPLAY_TOKEN_REQUIREMENTS.map((requirement) => requirement.token),
);

export const REQUIRED_DISPLAY_TOKENS_BY_ID = deepFreeze(
  Object.fromEntries(
    DISPLAY_TOKEN_REQUIREMENTS.map((requirement) => [
      requirement.tokenId,
      requirement.token,
    ]),
  ),
);

export const FIXTURE_RELATIONSHIPS = deepFreeze([
  {
    relationshipId: 'ACCOUNT_TO_MEMBER',
    fromGroup: 'ACCOUNTS',
    fromField: 'memberId',
    toGroup: 'MEMBERS',
    toField: 'memberId',
    cardinality: 'MANY_TO_ZERO_OR_ONE',
    optional: true,
  },
  {
    relationshipId: 'COVERAGE_TO_MEMBER',
    fromGroup: 'COVERAGES',
    fromField: 'memberId',
    toGroup: 'MEMBERS',
    toField: 'memberId',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'CLAIM_TO_MEMBER',
    fromGroup: 'CLAIMS',
    fromField: 'memberId',
    toGroup: 'MEMBERS',
    toField: 'memberId',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'CLAIM_TO_COVERAGE',
    fromGroup: 'CLAIMS',
    fromField: 'coverageId',
    toGroup: 'COVERAGES',
    toField: 'coverageId',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'CLAIM_TO_PROVIDER',
    fromGroup: 'CLAIMS',
    fromField: 'providerId',
    toGroup: 'PROVIDERS',
    toField: 'providerId',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'SERVICE_LINE_TO_CLAIM',
    fromGroup: 'SERVICE_LINES',
    fromField: 'claimNumber',
    toGroup: 'CLAIMS',
    toField: 'claimNumber',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'SERVICE_LINE_TO_REASON_CODE',
    fromGroup: 'SERVICE_LINES',
    fromField: 'reasonCodeIds[]',
    toGroup: 'REASON_CODES',
    toField: 'reasonCodeId',
    cardinality: 'MANY_TO_MANY',
    optional: false,
  },
  {
    relationshipId: 'RESTRICTION_TO_CLAIM',
    fromGroup: 'RESTRICTIONS',
    fromField: 'claimNumber',
    toGroup: 'CLAIMS',
    toField: 'claimNumber',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'APPEAL_TO_CLAIM',
    fromGroup: 'APPEALS',
    fromField: 'claimNumber',
    toGroup: 'CLAIMS',
    toField: 'claimNumber',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'DOCUMENT_VERSION_TO_CLAIM',
    fromGroup: 'DOCUMENT_VERSIONS',
    fromField: 'claimNumber',
    toGroup: 'CLAIMS',
    toField: 'claimNumber',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'DOCUMENT_VERSION_TO_ARTIFACT',
    fromGroup: 'DOCUMENT_VERSIONS',
    fromField: 'artifactKey',
    toGroup: 'DOCUMENT_ARTIFACTS',
    toField: 'artifactKey',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'DOCUMENT_DETAIL_TO_VERSION',
    fromGroup: 'DOCUMENT_VERSION_DETAILS',
    fromField: 'documentId',
    toGroup: 'DOCUMENT_VERSIONS',
    toField: 'documentId',
    cardinality: 'ONE_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'REQUEST_TO_CLAIM',
    fromGroup: 'REQUESTS',
    fromField: 'claimNumber',
    toGroup: 'CLAIMS',
    toField: 'claimNumber',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'PIPELINE_RUN_TO_REQUEST',
    fromGroup: 'PIPELINE_RUNS',
    fromField: 'requestId',
    toGroup: 'REQUESTS',
    toField: 'requestId',
    cardinality: 'ONE_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'MANUAL_REVIEW_TO_REQUEST',
    fromGroup: 'MANUAL_REVIEWS',
    fromField: 'requestId',
    toGroup: 'REQUESTS',
    toField: 'requestId',
    cardinality: 'ONE_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'ERROR_REPORT_TO_REQUEST',
    fromGroup: 'ERROR_REPORTS',
    fromField: 'requestId',
    toGroup: 'REQUESTS',
    toField: 'requestId',
    cardinality: 'MANY_TO_ZERO_OR_ONE',
    optional: true,
  },
  {
    relationshipId: 'OUTBOUND_TO_DOCUMENT',
    fromGroup: 'OUTBOUND_RECORDS',
    fromField: 'documentId',
    toGroup: 'DOCUMENT_VERSIONS',
    toField: 'documentId',
    cardinality: 'MANY_TO_ONE',
    optional: false,
  },
  {
    relationshipId: 'CSR_RECENT_REQUEST_TO_REQUEST',
    fromGroup: 'CSR_RECENT_REQUESTS',
    fromField: 'requestId',
    toGroup: 'REQUESTS',
    toField: 'requestId',
    cardinality: 'ONE_TO_ONE',
    optional: false,
  },
]);

export const REPRESENTATIVE_ARTIFACTS = deepFreeze(
  DOCUMENT_ARTIFACT_MANIFEST.map((artifact) => ({
    artifactKey: artifact.artifactKey,
    documentType: artifact.documentType,
    audienceScope: artifact.audienceScope,
    assetUrl: artifact.assetUrl,
    filename: artifact.filename,
    mediaType: artifact.mediaType,
    checksumAlgorithm: artifact.checksumAlgorithm,
    checksum: artifact.checksum,
    documentDate: artifact.documentDate,
    fixtureVersion: artifact.fixtureVersion,
    representativeOnly: artifact.representativeOnly,
    requiredDisclosures: DOCUMENT_DISCLOSURES,
    source: FIXTURE_SOURCE_MODULES.DOCUMENTS.module,
    userStories: ['SCRUM-2071', 'SCRUM-2075'],
  })),
);

export const REPRESENTATIVE_ARTIFACTS_BY_KEY = deepFreeze(
  Object.fromEntries(
    REPRESENTATIVE_ARTIFACTS.map((artifact) => [
      artifact.artifactKey,
      artifact,
    ]),
  ),
);

export const FIXTURE_STORY_TRACEABILITY = deepFreeze({
  'SCRUM-2069': {
    seedGroups: [
      'ACCOUNTS',
      'USERS',
      'MEMBERS',
      'COVERAGES',
      'PROVIDERS',
      'CLAIMS',
      'SERVICE_LINES',
      'REASON_CODES',
      'RESTRICTIONS',
      'VALIDATION_CASES',
    ],
    displayTokenIds: [
      'PRIMARY_CLAIM',
      'PRIMARY_MEMBER',
      'SECONDARY_MEMBER',
    ],
  },
  'SCRUM-2071': {
    seedGroups: [
      'MEMBERS',
      'PROVIDERS',
      'CLAIMS',
      'SERVICE_LINES',
      'REASON_CODES',
      'DOCUMENT_LAYOUTS',
      'APPEALS',
      'REMITTANCE_ROWS',
      'DOCUMENT_ARTIFACTS',
      'DOCUMENT_VERSIONS',
      'DOCUMENT_VERSION_DETAILS',
    ],
    displayTokenIds: [
      'DOCUMENT_NOTICE',
      'SIMULATION_STATUS',
      'NON_AUTHORITATIVE_DISCLOSURE',
      'NO_DECISION_DISCLOSURE',
      'FICTIONAL_DATA_DISCLOSURE',
      'EOB_TITLE',
      'EOR_TITLE',
      'REPRESENTATIVE_DOCUMENT',
      'PROVIDER_REMITTANCE',
    ],
  },
  'SCRUM-2073': {
    seedGroups: [
      'CLAIMS',
      'RESTRICTIONS',
      'VALIDATION_CASES',
      'DOCUMENT_VERSIONS',
      'REQUESTS',
      'PROCESSING_OUTCOME_PROFILES',
      'PIPELINE_STEPS',
      'PIPELINE_RUNS',
      'MANUAL_REVIEWS',
      'ERROR_REPORTS',
      'INBOUND_RUNS',
      'BATCH_RUNS',
      'NIGHTLY_QUEUE_ROWS',
      'OUTBOUND_RECORDS',
      'CDC_EVENTS',
      'IDEMPOTENCY_RESULTS',
    ],
    displayTokenIds: ['SIMULATION_STATUS', 'PRIMARY_CLAIM'],
  },
  'SCRUM-2074': {
    seedGroups: [
      'CSR_RECENT_REQUESTS',
      'CSR_ALERTS',
      'MONITORING_EVENTS',
      'MONITORING_ALERTS',
      'INTEGRATIONS',
      'ASSISTANT_SCRIPTS',
      'EXECUTIVE_MONTHLY_TREND',
      'PRODUCTIVITY_BEFORE_STEPS',
      'PRODUCTIVITY_AFTER_STEPS',
    ],
    displayTokenIds: [
      'EOB_TITLE',
      'EOR_TITLE',
      'SCRIPTED_ASSISTANT_DISCLOSURE',
      'MONITORING_DISCLOSURE',
      'NO_LIVE_CONNECTIVITY',
      'PUBLISHED_FIXTURE',
    ],
  },
  'SCRUM-2075': {
    seedGroups: ['DOCUMENT_ARTIFACTS', 'INTEGRATIONS'],
    displayTokenIds: [
      'NON_AUTHORITATIVE_DISCLOSURE',
      'NO_DECISION_DISCLOSURE',
      'FICTIONAL_DATA_DISCLOSURE',
      'MONITORING_DISCLOSURE',
      'NO_LIVE_CONNECTIVITY',
    ],
  },
});

export const FIXTURE_PROVENANCE = deepFreeze({
  fixtureManifestVersion: FIXTURE_MANIFEST_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  operationsFixtureVersion: OPERATIONS_FIXTURE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  referenceDate: REFERENCE_DATE,
  generatedData: false,
  networkRequired: false,
  containsRealHealthcareData: false,
  representativeOnly: true,
  sources: FIXTURE_SOURCE_MODULES,
  userStories: FIXTURE_USER_STORIES,
  disclosure:
    'All records and artifacts are prepackaged fictional demonstration fixtures.',
});

export const FIXTURE_TRACEABILITY_MANIFEST = deepFreeze({
  manifestVersion: FIXTURE_MANIFEST_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  referenceDate: REFERENCE_DATE,
  userStories: FIXTURE_USER_STORIES,
  provenance: FIXTURE_PROVENANCE,
  expectedRecordCounts: EXPECTED_RECORD_COUNTS,
  seedGroups: FIXTURE_SEED_GROUPS,
  displayTokens: DISPLAY_TOKEN_REQUIREMENTS,
  relationships: FIXTURE_RELATIONSHIPS,
  representativeArtifacts: REPRESENTATIVE_ARTIFACTS,
  storyTraceability: FIXTURE_STORY_TRACEABILITY,
});

export const FIXTURE_MANIFEST = FIXTURE_TRACEABILITY_MANIFEST;
export const SEED_GROUPS = FIXTURE_SEED_GROUPS;
export const SEED_GROUPS_BY_ID = FIXTURE_SEED_GROUPS_BY_ID;
export const RECORD_COUNTS = EXPECTED_RECORD_COUNTS;
export const DISPLAY_TOKENS = REQUIRED_DISPLAY_TOKENS;
export const RELATIONSHIPS = FIXTURE_RELATIONSHIPS;
export const ARTIFACTS = REPRESENTATIVE_ARTIFACTS;
export const ARTIFACTS_BY_KEY = REPRESENTATIVE_ARTIFACTS_BY_KEY;
export const STORY_TRACEABILITY = FIXTURE_STORY_TRACEABILITY;
export const PROVENANCE = FIXTURE_PROVENANCE;

export default FIXTURE_TRACEABILITY_MANIFEST;