const FIXTURE_TIMESTAMP = '2024-01-22T14:32:15.000Z';
const INSIGHTS_FIXTURE_VERSION = '2026-10-21.1';

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

export const CSR_KPIS = deepFreeze({
  openRequests: 3,
  urgentRequests: 2,
  completedToday: 1,
  failedRequests: 1,
  averageProcessingMinutes: 15.5,
  targetProcessingMinutes: 22,
  representativeDownloads: 2,
  simulated: true,
  asOf: FIXTURE_TIMESTAMP,
});

export const CSR_RECENT_REQUESTS = deepFreeze([
  {
    requestId: '10000000-0000-4000-8000-000000000003',
    displayId: 'REQ-000003',
    claimNumber: 'CL2024004',
    memberIdMasked: '*****4321',
    memberName: 'Jane Smith',
    requestType: 'EOB',
    priority: 'URGENT',
    status: 'MANUAL_REVIEW',
    currentStep: 'BUSINESS_RULES',
    createdAt: '2024-01-22T10:14:00.000Z',
    representativeOnly: true,
  },
  {
    requestId: '10000000-0000-4000-8000-000000000002',
    displayId: 'REQ-000002',
    claimNumber: 'CL2024002',
    memberIdMasked: '*****4321',
    memberName: 'Jane Smith',
    requestType: 'EOR',
    priority: 'HIGH',
    status: 'PENDING',
    currentStep: 'REQUEST',
    createdAt: '2024-01-22T10:12:00.000Z',
    representativeOnly: true,
  },
  {
    requestId: '10000000-0000-4000-8000-000000000005',
    displayId: 'REQ-000005',
    claimNumber: 'CL2024001',
    memberIdMasked: '*****6789',
    memberName: 'John Doe',
    requestType: 'EOB',
    priority: 'NORMAL',
    status: 'PAUSED',
    currentStep: 'DATA_RETRIEVAL',
    createdAt: '2024-01-22T10:28:00.000Z',
    representativeOnly: true,
  },
  {
    requestId: '10000000-0000-4000-8000-000000000004',
    displayId: 'REQ-000004',
    claimNumber: 'CL2024003',
    memberIdMasked: '*****6789',
    memberName: 'John Doe',
    requestType: 'EOB',
    priority: 'NORMAL',
    status: 'FAILED',
    currentStep: 'QUALITY_CHECK',
    createdAt: '2024-01-22T10:18:00.000Z',
    representativeOnly: true,
  },
  {
    requestId: '10000000-0000-4000-8000-000000000001',
    displayId: 'REQ-000001',
    claimNumber: 'CL2024001',
    memberIdMasked: '*****6789',
    memberName: 'John Doe',
    requestType: 'BOTH',
    priority: 'URGENT',
    status: 'COMPLETE',
    currentStep: 'STORED',
    createdAt: '2024-01-22T09:55:00.000Z',
    representativeOnly: true,
  },
]);

export const CSR_ALERTS = deepFreeze([
  {
    alertId: 'CSR-ALERT-MANUAL-REVIEW-001',
    severity: 'WARNING',
    title: 'Manual review required',
    message:
      'REQ-000003 is waiting for an authorized operations review.',
    requestId: '10000000-0000-4000-8000-000000000003',
    createdAt: '2024-01-22T10:19:00.000Z',
    acknowledged: false,
    simulated: true,
  },
  {
    alertId: 'CSR-ALERT-QUALITY-001',
    severity: 'ERROR',
    title: 'Document quality check failed',
    message:
      'REQ-000004 stopped before PDF creation and storage.',
    requestId: '10000000-0000-4000-8000-000000000004',
    createdAt: '2024-01-22T10:25:00.000Z',
    acknowledged: false,
    simulated: true,
  },
  {
    alertId: 'CSR-ALERT-PAUSED-001',
    severity: 'INFO',
    title: 'Request playback paused',
    message:
      'REQ-000005 can resume from the data retrieval checkpoint.',
    requestId: '10000000-0000-4000-8000-000000000005',
    createdAt: '2024-01-22T10:31:00.000Z',
    acknowledged: true,
    simulated: true,
  },
]);

export const CSR_REQUEST_CHART = deepFreeze({
  title: 'Representative request activity',
  xAxisLabel: 'Fixture interval',
  yAxisLabel: 'Requests',
  legends: ['Created', 'Completed', 'Exceptions'],
  points: [
    {
      interval: '08:00',
      created: 2,
      completed: 1,
      exceptions: 0,
    },
    {
      interval: '09:00',
      created: 4,
      completed: 2,
      exceptions: 0,
    },
    {
      interval: '10:00',
      created: 5,
      completed: 1,
      exceptions: 2,
    },
    {
      interval: '11:00',
      created: 3,
      completed: 2,
      exceptions: 1,
    },
    {
      interval: '12:00',
      created: 4,
      completed: 4,
      exceptions: 0,
    },
    {
      interval: '13:00',
      created: 3,
      completed: 3,
      exceptions: 0,
    },
    {
      interval: '14:00',
      created: 2,
      completed: 2,
      exceptions: 0,
    },
  ],
  simulated: true,
});

export const CSR_DASHBOARD_FIXTURE = deepFreeze({
  simulated: true,
  asOf: FIXTURE_TIMESTAMP,
  disclosure:
    'Representative local fixtures; no live claims or monitoring service is connected.',
  kpis: CSR_KPIS,
  recentRequests: CSR_RECENT_REQUESTS,
  alerts: CSR_ALERTS,
  requestChart: CSR_REQUEST_CHART,
});

export const MONITORING_KPIS = deepFreeze({
  cdcStatus: 'HEALTHY',
  cdcStatusLabel: 'CDC Healthy',
  uptimePercent: 99.9,
  activeConnections: 1247,
  queueDepth: 23,
  errorRatePercent: 0.3,
  fixtureTime: '14:32:15',
});

export const MONITORING_SYNC_LATENCY = deepFreeze([
  { time: '14:27', milliseconds: 118 },
  { time: '14:28', milliseconds: 126 },
  { time: '14:29', milliseconds: 109 },
  { time: '14:30', milliseconds: 141 },
  { time: '14:31', milliseconds: 132 },
  { time: '14:32', milliseconds: 121 },
]);

export const MONITORING_THROUGHPUT = deepFreeze([
  { interval: '14:27', records: 820 },
  { interval: '14:28', records: 910 },
  { interval: '14:29', records: 875 },
  { interval: '14:30', records: 1040 },
  { interval: '14:31', records: 980 },
  { interval: '14:32', records: 1125 },
]);

export const MONITORING_RESOURCE_GAUGES = deepFreeze([
  {
    resource: 'CPU',
    valuePercent: 42,
    warningThresholdPercent: 75,
    criticalThresholdPercent: 90,
    status: 'HEALTHY',
  },
  {
    resource: 'Memory',
    valuePercent: 61,
    warningThresholdPercent: 80,
    criticalThresholdPercent: 92,
    status: 'HEALTHY',
  },
  {
    resource: 'Disk',
    valuePercent: 68,
    warningThresholdPercent: 80,
    criticalThresholdPercent: 90,
    status: 'HEALTHY',
  },
]);

export const MONITORING_DISK_TIMELINE = deepFreeze([
  { time: '08:00', usedPercent: 64 },
  { time: '09:00', usedPercent: 65 },
  { time: '10:00', usedPercent: 65 },
  { time: '11:00', usedPercent: 66 },
  { time: '12:00', usedPercent: 67 },
  { time: '13:00', usedPercent: 67 },
  { time: '14:00', usedPercent: 68 },
]);

export const MONITORING_EVENTS = deepFreeze([
  {
    eventId: 'MON-EVENT-001',
    occurredAt: '2024-01-22T14:31:52.000Z',
    category: 'CDC',
    severity: 'INFO',
    title: 'Claim replica checkpoint advanced',
    message:
      'The simulated CDC checkpoint advanced to fixture sequence 18,240.',
    source: 'LOCAL_CLAIMS_REPLICA',
    simulated: true,
  },
  {
    eventId: 'MON-EVENT-002',
    occurredAt: '2024-01-22T14:30:40.000Z',
    category: 'QUEUE',
    severity: 'INFO',
    title: 'Queue depth within fixture threshold',
    message:
      'The local demonstration queue contains 23 representative records.',
    source: 'LOCAL_MESSAGE_QUEUE',
    simulated: true,
  },
  {
    eventId: 'MON-EVENT-003',
    occurredAt: '2024-01-22T14:29:18.000Z',
    category: 'BATCH',
    severity: 'WARNING',
    title: 'Payment attachment row returned',
    message:
      'One fictional nightly batch row was returned for a missing payment reference.',
    source: 'NIGHTLY_BATCH',
    simulated: true,
  },
  {
    eventId: 'MON-EVENT-004',
    occurredAt: '2024-01-22T14:28:03.000Z',
    category: 'STORAGE',
    severity: 'INFO',
    title: 'Representative document stored',
    message:
      'A static sample artifact was associated with a completed local request.',
    source: 'LOCAL_DOCUMENT_STORAGE',
    simulated: true,
  },
  {
    eventId: 'MON-EVENT-005',
    occurredAt: '2024-01-22T14:27:31.000Z',
    category: 'QUALITY',
    severity: 'ERROR',
    title: 'Quality fixture stopped processing',
    message:
      'The deterministic quality scenario stopped before PDF creation.',
    source: 'QUALITY_ASSURANCE',
    simulated: true,
  },
]);

export const MONITORING_ALERTS = deepFreeze([
  {
    alertId: 'MON-ALERT-BATCH-001',
    createdAt: '2024-01-22T14:29:18.000Z',
    severity: 'WARNING',
    title: 'Batch payment reference missing',
    message:
      'One fictional row is available for deterministic retry.',
    metric: 'batchRetryableRows',
    value: 1,
    threshold: 0,
    acknowledged: false,
    simulated: true,
  },
  {
    alertId: 'MON-ALERT-QUALITY-001',
    createdAt: '2024-01-22T14:27:31.000Z',
    severity: 'ERROR',
    title: 'Document quality fixture failed',
    message:
      'The representative failure produced a local error report and no outbound artifact.',
    metric: 'qualityFailures',
    value: 1,
    threshold: 0,
    acknowledged: false,
    simulated: true,
  },
]);

export const MONITORING_DASHBOARD_FIXTURE = deepFreeze({
  simulated: true,
  tick: 0,
  revision: 1,
  asOf: FIXTURE_TIMESTAMP,
  disclosure:
    'Simulated fixture — no monitoring service is connected',
  kpis: MONITORING_KPIS,
  syncLatency: {
    unit: 'milliseconds',
    points: MONITORING_SYNC_LATENCY,
  },
  throughput: {
    unit: 'records per minute',
    bars: MONITORING_THROUGHPUT,
  },
  resourceGauges: MONITORING_RESOURCE_GAUGES,
  diskTimeline: MONITORING_DISK_TIMELINE,
  events: MONITORING_EVENTS,
  alerts: MONITORING_ALERTS,
});

export const INTEGRATION_LAYERS = deepFreeze([
  'DATA',
  'AI_AGENT',
  'APPLICATION',
  'INTEGRATION',
  'EXTERNAL',
]);

export const INTEGRATION_CONNECTION_TYPES = deepFreeze([
  'SYNC',
  'ASYNC',
  'BATCH',
  'REAL_TIME',
]);

export const INTEGRATION_INVENTORY = deepFreeze([
  {
    integrationId: 'int_claims_replica',
    name: 'Claims replica',
    aliases: [
      'Claims replica',
      'Local claims replica',
      'Claims database replica',
    ],
    layer: 'DATA',
    connectionTypes: ['REAL_TIME', 'SYNC'],
    status:
      'Status: Simulated — local fixture [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Bundled claims and service-line fixtures representing a local read replica.',
  },
  {
    integrationId: 'int_data_lake',
    name: 'Enterprise data lake',
    aliases: ['Data lake', 'Local data lake', 'Enterprise data lake'],
    layer: 'DATA',
    connectionTypes: ['BATCH', 'SYNC'],
    status:
      'Status: Simulated — bundled fixture [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Bundled member, coverage, provider, claim, and restriction data.',
  },
  {
    integrationId: 'int_document_storage',
    name: 'Document storage',
    aliases: [
      'Document repository',
      'Object storage',
      'PDF storage',
      'Document storage',
    ],
    layer: 'DATA',
    connectionTypes: ['SYNC'],
    status:
      'Status: Simulated — static assets [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Same-origin representative PDF assets and browser-local metadata.',
  },
  {
    integrationId: 'int_ai_agents',
    name: 'Processing agents',
    aliases: [
      'AI agents',
      'Validation agent',
      'Business rules agent',
      'Document generation agent',
      'Quality assurance agent',
    ],
    layer: 'AI_AGENT',
    connectionTypes: ['SYNC'],
    status:
      'Status: Simulated — deterministic rules [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Deterministic local functions labeled as agents for workflow demonstration.',
  },
  {
    integrationId: 'int_csr_portal',
    name: 'CSR portal',
    aliases: [
      'CSR application',
      'Member support portal',
      'Reprint portal',
      'CSR portal',
    ],
    layer: 'APPLICATION',
    connectionTypes: ['SYNC'],
    status:
      'Status: Simulated — browser SPA [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Static React application backed by bundled fixtures and browser-local state.',
  },
  {
    integrationId: 'int_operations_console',
    name: 'Operations console',
    aliases: [
      'BOS console',
      'Operations dashboard',
      'Administration console',
    ],
    layer: 'APPLICATION',
    connectionTypes: ['SYNC'],
    status:
      'Status: Simulated — browser SPA [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Local queue, review, exception, batch, and administrative demonstrations.',
  },
  {
    integrationId: 'int_queue',
    name: 'Kafka / RabbitMQ / message queue',
    aliases: [
      'Kafka',
      'RabbitMQ',
      'Message queue',
      'Event bus',
      'Local queue',
    ],
    layer: 'INTEGRATION',
    connectionTypes: ['ASYNC'],
    status:
      'Status: Simulated — UI hints + mock API [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Local in-memory/localStorage queue representation only.',
  },
  {
    integrationId: 'int_ap_reprint',
    name: 'AP reprint feed',
    aliases: [
      'AP feed',
      'AP reprint',
      'Accounts payable reprint feed',
    ],
    layer: 'INTEGRATION',
    connectionTypes: ['BATCH'],
    status:
      'Status: Simulated — CSV fixture [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Prepackaged AP reprint rows parsed and applied locally.',
  },
  {
    integrationId: 'int_edi_835',
    name: '835 change feed',
    aliases: [
      '835',
      'EDI 835',
      'Change 835',
      'Remittance change feed',
    ],
    layer: 'INTEGRATION',
    connectionTypes: ['BATCH'],
    status:
      'Status: Simulated — CSV fixture [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Allowlisted fictional claim changes and CDC events processed locally.',
  },
  {
    integrationId: 'int_ixit',
    name: 'IXIT reporting handoff',
    aliases: [
      'IXIT',
      'IXIT handoff',
      'Completed report handoff',
      'Reporting handoff',
    ],
    layer: 'INTEGRATION',
    connectionTypes: ['ASYNC', 'BATCH'],
    status:
      'Status: Simulated — local outbound record [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Masked local report references; no report is transmitted.',
  },
  {
    integrationId: 'int_email',
    name: 'Email delivery',
    aliases: ['Email', 'Email gateway', 'Member email'],
    layer: 'EXTERNAL',
    connectionTypes: ['ASYNC'],
    status:
      'Status: Simulated — not connected [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Outbound status representation only; no email is sent.',
  },
  {
    integrationId: 'int_crm',
    name: 'CRM activity',
    aliases: ['CRM', 'Customer relationship management', 'CRM activity'],
    layer: 'EXTERNAL',
    connectionTypes: ['SYNC', 'ASYNC'],
    status:
      'Status: Simulated — local activity reference [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'Masked local activity references; no CRM is connected.',
  },
  {
    integrationId: 'int_fax',
    name: 'Fax delivery',
    aliases: ['Fax', 'Fax gateway', 'Document fax'],
    layer: 'EXTERNAL',
    connectionTypes: ['ASYNC'],
    status:
      'Status: Simulated — no transmission [Pipeline-aligned]',
    networkEnabled: false,
    description:
      'A local state change can mark a fictional fax as sent.',
  },
  {
    integrationId: 'int_identity',
    name: 'Enterprise identity provider',
    aliases: ['SSO', 'SAML 2.0', 'OAuth 2.0', 'Identity provider'],
    layer: 'EXTERNAL',
    connectionTypes: ['SYNC'],
    status:
      'Status: Production context only — not connected',
    networkEnabled: false,
    description:
      'The demo uses local seeded personas and does not provide federated identity.',
  },
]);

export const INTEGRATION_INVENTORY_FIXTURE = deepFreeze({
  simulated: true,
  layers: INTEGRATION_LAYERS,
  connectionTypes: INTEGRATION_CONNECTION_TYPES,
  items: INTEGRATION_INVENTORY,
  disclosure: 'No live connectivity is configured.',
});

export const ASSISTANT_TOPICS = Object.freeze({
  EOB: 'EOB',
  EOR: 'EOR',
  CODE_45: 'CODE_45',
  REPRESENTATIVE_DOWNLOAD: 'REPRESENTATIVE_DOWNLOAD',
  REPRINT_STATUS: 'REPRINT_STATUS',
});

export const ASSISTANT_SCRIPTS = deepFreeze({
  EOB: {
    topic: ASSISTANT_TOPICS.EOB,
    title: 'Explain an EOB',
    answer:
      'An Explanation of Benefits summarizes how a claim was processed, including the billed amount, plan discount, plan payment, and fictional member responsibility. It is not a bill.',
    scriptVersion: INSIGHTS_FIXTURE_VERSION,
    disclosure: 'Scripted demo — no model call',
  },
  EOR: {
    topic: ASSISTANT_TOPICS.EOR,
    title: 'Explain an EOR',
    answer:
      'An Explanation of Review summarizes the fictional review result for a claim and may include service status, reason codes, and a masked payment reference. It is not an authoritative claim document.',
    scriptVersion: INSIGHTS_FIXTURE_VERSION,
    disclosure: 'Scripted demo — no model call',
  },
  CODE_45: {
    topic: ASSISTANT_TOPICS.CODE_45,
    title: 'Explain code 45',
    answer:
      "Code 45 indicates the charge exceeds the payer's allowed amount. In this fictional EOB fixture, the remaining patient responsibility reflects the displayed deductible application.",
    scriptVersion: INSIGHTS_FIXTURE_VERSION,
    disclosure: 'Scripted demo — no model call',
  },
  REPRESENTATIVE_DOWNLOAD: {
    topic: ASSISTANT_TOPICS.REPRESENTATIVE_DOWNLOAD,
    title: 'Explain representative downloads',
    answer:
      'The available PDF is a prepackaged representative sample built from fictional data. Downloading it does not retrieve a live claim document, and it must not be used for healthcare or payment decisions.',
    scriptVersion: INSIGHTS_FIXTURE_VERSION,
    disclosure: 'Scripted demo — no model call',
  },
  REPRINT_STATUS: {
    topic: ASSISTANT_TOPICS.REPRINT_STATUS,
    title: 'Explain reprint status',
    answer:
      'The displayed reprint status reflects a deterministic browser-local workflow. Pending, processing, review, complete, and failed states are demonstrations only, and no external payer system is contacted.',
    scriptVersion: INSIGHTS_FIXTURE_VERSION,
    disclosure: 'Scripted demo — no model call',
  },
});

export const ASSISTANT_SCRIPT_LIST = deepFreeze(
  Object.values(ASSISTANT_SCRIPTS),
);

export const COMPLIANCE_IMPLEMENTED_DEMO_BEHAVIOR = deepFreeze([
  'Client-side role states',
  'Browser-local masked audits',
  'PHI redaction',
  'CSR read-only financial fields',
  'Simulated MFA and session timeout',
  'Local snapshot controls',
  'Masking',
  'Fictional fixtures',
]);

export const COMPLIANCE_PRODUCTION_ONLY_NOT_PROVIDED = deepFreeze([
  'HIPAA compliance',
  'SOC 2 Type II',
  'PCI DSS',
  'State enforcement',
  'TLS 1.3 control',
  'AES-256 server-side encryption',
  'CSP/HSTS enforcement',
  'Server-side rate limiting',
  'Security assessments',
  'Disaster recovery',
  'Federated identity',
]);

export const COMPLIANCE_IDENTITY_CONTEXT = deepFreeze([
  'SAML 2.0 — production context only',
  'OAuth 2.0 — production context only',
]);

export const COMPLIANCE_GROUPS = deepFreeze({
  implementedDemoBehavior: COMPLIANCE_IMPLEMENTED_DEMO_BEHAVIOR,
  productionOnlyNotProvided:
    COMPLIANCE_PRODUCTION_ONLY_NOT_PROVIDED,
  identityContext: COMPLIANCE_IDENTITY_CONTEXT,
  certificationsClaimed: [],
  disclosure:
    'This static demonstration does not provide production authorization, certification, secure server storage, or disaster recovery.',
});

export const COMPLIANCE_STATUS_FIXTURE = COMPLIANCE_GROUPS;

export const EXECUTIVE_CASE_A = deepFreeze({
  caseId: 'PUBLISHED_CASE_A',
  label: 'Published Case A',
  leadTimeRange: '2–3 days',
  leadTimePoint: '2.5 days',
  target: '15 minutes',
  sourceType: 'PUBLISHED_DISPLAY_FIXTURE',
  calculatedFromClaims: false,
});

export const EXECUTIVE_CASE_B = deepFreeze({
  caseId: 'PUBLISHED_CASE_B',
  label: 'Published Case B',
  roiPercent: 1333,
  paybackMonths: 0.8,
  annualSavingsUsd: 10700000,
  speedMultiplier: 15.5,
  minutesBefore: 240,
  minutesAfter: 15.5,
  staffBefore: 25,
  staffAfter: 5,
  errorComparisons: [
    {
      comparisonId: 'PUBLISHED_ERROR_COMPARISON_1',
      label: 'Published processing error comparison',
      beforePercent: 8,
      afterPercent: 0.5,
    },
    {
      comparisonId: 'PUBLISHED_ERROR_COMPARISON_2',
      label: 'Published exception comparison',
      beforePercent: 15,
      afterPercent: 1,
    },
  ],
  sourceType: 'PUBLISHED_DISPLAY_FIXTURE',
  calculatedFromClaims: false,
});

export const EXECUTIVE_MONTHLY_TREND = deepFreeze({
  legends: ['Volume (k)', 'Savings ($M)'],
  points: [
    { month: 'M01', volume: 8.5, savings: 0.8 },
    { month: 'M02', volume: 9.1, savings: 1.5 },
    { month: 'M03', volume: 9.8, savings: 2.3 },
    { month: 'M04', volume: 10.4, savings: 3.1 },
    { month: 'M05', volume: 11.2, savings: 4.0 },
    { month: 'M06', volume: 11.9, savings: 4.9 },
    { month: 'M07', volume: 12.6, savings: 5.8 },
    { month: 'M08', volume: 13.1, savings: 6.7 },
    { month: 'M09', volume: 13.8, savings: 7.6 },
    { month: 'M10', volume: 14.4, savings: 8.6 },
    { month: 'M11', volume: 14.9, savings: 9.5 },
    { month: 'M12', volume: 15.5, savings: 10.5 },
  ],
  sourceType: 'PRESENTATION_FIXTURE',
});

export const EXECUTIVE_INSIGHTS_FIXTURE = deepFreeze({
  fixtureVersion: INSIGHTS_FIXTURE_VERSION,
  caseA: EXECUTIVE_CASE_A,
  caseB: EXECUTIVE_CASE_B,
  monthlyTrend: EXECUTIVE_MONTHLY_TREND,
  disclosure:
    'Published display fixtures; not calculated from local claim records. Conflicting figures are intentionally not reconciled.',
});

export const PRODUCTIVITY_BEFORE_STEPS = deepFreeze([
  {
    step: 'REQUEST_INTAKE',
    label: 'Request intake and assignment',
    printedMinutes: 30,
  },
  {
    step: 'VALIDATION',
    label: 'Member and claim validation',
    printedMinutes: 45,
  },
  {
    step: 'DATA_RETRIEVAL',
    label: 'Source data retrieval',
    printedMinutes: 35,
  },
  {
    step: 'BUSINESS_RULES',
    label: 'Business rule review',
    printedMinutes: 30,
  },
  {
    step: 'DOCUMENT_GENERATION',
    label: 'Document preparation',
    printedMinutes: 50,
  },
  {
    step: 'QUALITY_CHECK',
    label: 'Quality review',
    printedMinutes: 30,
  },
  {
    step: 'DELIVERY',
    label: 'Storage and delivery handoff',
    printedMinutes: 20,
  },
]);

export const PRODUCTIVITY_AFTER_STEPS = deepFreeze([
  {
    step: 'REQUEST',
    label: 'Request',
    printedMinutes: 0,
  },
  {
    step: 'VALIDATION',
    label: 'Validation',
    printedMinutes: 7,
  },
  {
    step: 'DATA_RETRIEVAL',
    label: 'Data retrieval',
    printedMinutes: 1,
  },
  {
    step: 'BUSINESS_RULES',
    label: 'Business rules',
    printedMinutes: 0.5,
  },
  {
    step: 'DOCUMENT_GENERATION',
    label: 'Document generation',
    printedMinutes: 5,
  },
  {
    step: 'QUALITY_CHECK',
    label: 'Quality check',
    printedMinutes: 2,
  },
  {
    step: 'PDF_CREATION',
    label: 'PDF creation',
    printedMinutes: 0,
  },
  {
    step: 'STORAGE',
    label: 'Storage',
    printedMinutes: 0,
  },
  {
    step: 'STORED',
    label: 'Stored',
    printedMinutes: 0,
  },
]);

export const PRODUCTIVITY_ERROR_POINTS = deepFreeze([
  {
    label: 'Published processing error comparison',
    beforePercent: 8,
    afterPercent: 0.5,
  },
  {
    label: 'Published exception comparison',
    beforePercent: 15,
    afterPercent: 1,
  },
]);

export const PRODUCTIVITY_CALLOUTS = deepFreeze([
  {
    calloutId: 'TIME',
    label: 'Processing time',
    before: '240 minutes',
    after: '15.5 minutes',
    change: '15.5x faster',
  },
  {
    calloutId: 'STAFF',
    label: 'Staff requirement',
    before: '25',
    after: '5',
    change: '20 fewer',
  },
  {
    calloutId: 'SAVINGS',
    label: 'Annual savings',
    before: '$0',
    after: '$10.7M',
    change: '$10.7M published fixture',
  },
  {
    calloutId: 'ROI',
    label: 'Return on investment',
    before: 'Baseline',
    after: '1333%',
    change: '0.8-month payback',
  },
]);

export const PRODUCTIVITY_INSIGHTS_FIXTURE = deepFreeze({
  fixtureVersion: INSIGHTS_FIXTURE_VERSION,
  before: {
    label: 'Representative manual process',
    totalMinutes: 240,
    staffCount: 25,
    steps: PRODUCTIVITY_BEFORE_STEPS,
  },
  after: {
    label: 'Representative target process',
    totalMinutes: 15.5,
    staffCount: 5,
    steps: PRODUCTIVITY_AFTER_STEPS,
  },
  printedMinuteTotal: 15.5,
  footer: {
    annualSavingsUsd: 10700000,
    roiPercent: 1333,
    paybackMonths: 0.8,
    speedMultiplier: 15.5,
  },
  errorPoints: PRODUCTIVITY_ERROR_POINTS,
  comparisonCallouts: PRODUCTIVITY_CALLOUTS,
  disclosure:
    'Published productivity fixtures; values are supplied for presentation and are not calculated from local claim records.',
});

export const CSR_INSIGHTS = CSR_DASHBOARD_FIXTURE;
export const CSR_DASHBOARD = CSR_DASHBOARD_FIXTURE;
export const CSR_KPI_FIXTURE = CSR_KPIS;
export const RECENT_REQUEST_FIXTURES = CSR_RECENT_REQUESTS;
export const CSR_ALERT_FIXTURES = CSR_ALERTS;
export const CSR_CHART_FIXTURE = CSR_REQUEST_CHART;

export const MONITORING_FIXTURE = MONITORING_DASHBOARD_FIXTURE;
export const MONITORING_SNAPSHOT = MONITORING_DASHBOARD_FIXTURE;
export const MONITORING_INITIAL_STATE = MONITORING_DASHBOARD_FIXTURE;
export const MONITORING_EVENT_FIXTURES = MONITORING_EVENTS;
export const MONITORING_ALERT_FIXTURES = MONITORING_ALERTS;

export const INTEGRATIONS = INTEGRATION_INVENTORY;
export const INTEGRATION_FIXTURES = INTEGRATION_INVENTORY;
export const INTEGRATION_ALIASES = deepFreeze(
  Object.fromEntries(
    INTEGRATION_INVENTORY.map((integration) => [
      integration.integrationId,
      integration.aliases,
    ]),
  ),
);
export const ARCHITECTURE_LAYERS = INTEGRATION_LAYERS;

export const SCRIPTED_ASSISTANT_RESPONSES = ASSISTANT_SCRIPTS;
export const ASSISTANT_RESPONSE_FIXTURES = ASSISTANT_SCRIPT_LIST;
export const COMPLIANCE_FIXTURE = COMPLIANCE_STATUS_FIXTURE;
export const COMPLIANCE_STATUS = COMPLIANCE_STATUS_FIXTURE;

export const CASE_A = EXECUTIVE_CASE_A;
export const CASE_B = EXECUTIVE_CASE_B;
export const MONTHLY_TRENDS = EXECUTIVE_MONTHLY_TREND;
export const EXECUTIVE_INSIGHTS = EXECUTIVE_INSIGHTS_FIXTURE;
export const PRODUCTIVITY_INSIGHTS = PRODUCTIVITY_INSIGHTS_FIXTURE;

const INSIGHTS_FIXTURES = deepFreeze({
  fixtureVersion: INSIGHTS_FIXTURE_VERSION,
  csr: CSR_DASHBOARD_FIXTURE,
  monitoring: MONITORING_DASHBOARD_FIXTURE,
  integrations: INTEGRATION_INVENTORY_FIXTURE,
  assistantScripts: ASSISTANT_SCRIPTS,
  compliance: COMPLIANCE_STATUS_FIXTURE,
  executive: EXECUTIVE_INSIGHTS_FIXTURE,
  productivity: PRODUCTIVITY_INSIGHTS_FIXTURE,
});

export default INSIGHTS_FIXTURES;