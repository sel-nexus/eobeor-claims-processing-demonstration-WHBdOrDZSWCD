import {
  SEEDED_ACCOUNTS,
  SEEDED_USERS,
} from './accounts.js';
import DOCUMENT_FIXTURES from './documents.js';
import INSIGHTS_FIXTURES, {
  MONITORING_DASHBOARD_FIXTURE,
} from './insights.js';
import MEMBERS_CLAIMS_FIXTURES from './membersClaims.js';
import OPERATIONS_FIXTURES, {
  INITIAL_OPERATIONS_ENVELOPE,
} from './operations.js';
import {
  APP_CONFIG,
  FIXTURE_VERSION,
  REFERENCE_DATE,
  SCHEMA_VERSION,
} from '../platform/config/constants.js';

const SEEDED_AT = '2024-01-22T00:00:00.000Z';

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

export const INITIAL_SETTINGS = deepFreeze({
  retentionYears: 7,
  autoApproveAmount: 500,
  sessionTimeoutMinutes: 30,
  revision: 1,
  updatedBy: 'system',
  updatedAt: SEEDED_AT,
  labels: {
    applicationName: 'EOB/EOR Claims Processing',
    eob: 'Explanation of Benefits',
    eor: 'Explanation of Review',
  },
});

export const INITIAL_PREFERENCES = deepFreeze({
  theme: 'system',
  reducedMotion: false,
  defaultPageSize: 10,
  dashboard: {
    compactTables: false,
    showFixtureDisclosures: true,
    showRepresentativeCharts: true,
  },
  monitoring: {
    autoRefresh: false,
    refreshIntervalSeconds: 30,
    showAcknowledgedAlerts: true,
  },
  documents: {
    openDownloadsInNewTab: true,
    showDownloadNotice: true,
  },
  revision: 1,
  updatedAt: SEEDED_AT,
});

export const INITIAL_AUDIT_EVENTS = deepFreeze([
  {
    eventId: 'AUDIT-SEED-20240122-001',
    occurredAt: SEEDED_AT,
    actor: {
      userId: 'usr_admin',
      displayName: 'Administrator',
      role: 'ADMIN',
    },
    action: 'FIXTURE_BASELINE_INITIALIZED',
    entity: {
      type: 'SEED_BUNDLE',
      id: `FIXTURE-${FIXTURE_VERSION}`,
    },
    before: null,
    after: {
      fixtureVersion: FIXTURE_VERSION,
      referenceDate: REFERENCE_DATE,
      representativeOnly: true,
      networkRequired: false,
    },
    outcome: 'SUCCESS',
    correlationId: 'corr-seed-bundle-20240122-001',
  },
]);

export const INITIAL_SCHEMA_META = deepFreeze({
  version: SCHEMA_VERSION,
  seedVersion: FIXTURE_VERSION,
  rootRevision: 1,
  migratedAt: null,
});

export const INITIAL_ROOT_COMMIT_JOURNAL = deepFreeze({
  rootRevision: 1,
  checksums: {
    platform: `fixture-platform-${FIXTURE_VERSION}`,
    membersClaims: `fixture-members-claims-${FIXTURE_VERSION}`,
    documents: `fixture-documents-${FIXTURE_VERSION}`,
    operations: `fixture-operations-${FIXTURE_VERSION}`,
    insights: `fixture-insights-${FIXTURE_VERSION}`,
    preferences: `fixture-preferences-${FIXTURE_VERSION}`,
    auditEvents: `fixture-audit-${FIXTURE_VERSION}`,
  },
  lastCommandId: null,
});

export const PLATFORM_SEED = deepFreeze({
  config: APP_CONFIG,
  accounts: SEEDED_ACCOUNTS,
  users: SEEDED_USERS,
  settings: INITIAL_SETTINGS,
  session: null,
  monitoring: MONITORING_DASHBOARD_FIXTURE,
  schemaMeta: INITIAL_SCHEMA_META,
  rootCommitJournal: INITIAL_ROOT_COMMIT_JOURNAL,
});

export const CANONICAL_SEED_BUNDLE = deepFreeze({
  schemaVersion: SCHEMA_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  referenceDate: REFERENCE_DATE,
  seededAt: SEEDED_AT,
  representativeOnly: true,
  networkRequired: false,
  platform: PLATFORM_SEED,
  membersClaims: MEMBERS_CLAIMS_FIXTURES,
  documents: DOCUMENT_FIXTURES,
  operations: OPERATIONS_FIXTURES,
  operationsEnvelope: INITIAL_OPERATIONS_ENVELOPE,
  insights: INSIGHTS_FIXTURES,
  preferences: INITIAL_PREFERENCES,
  auditEvents: INITIAL_AUDIT_EVENTS,
});

export const SEED_BUNDLE = CANONICAL_SEED_BUNDLE;
export const BASELINE_SEED_BUNDLE = CANONICAL_SEED_BUNDLE;
export const PLATFORM_FIXTURE_SEED = PLATFORM_SEED;
export const PREFERENCE_SEED = INITIAL_PREFERENCES;
export const AUDIT_SEED = INITIAL_AUDIT_EVENTS;
export const SETTINGS_SEED = INITIAL_SETTINGS;

export default CANONICAL_SEED_BUNDLE;