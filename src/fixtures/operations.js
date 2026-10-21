const FIXTURE_TIMESTAMP = '2024-01-22T12:00:00.000Z';

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

export const OPERATIONS_FIXTURE_VERSION = 1;

export const OPERATIONS_FIXTURE_IDS = deepFreeze({
  requests: {
    COMPLETE: '10000000-0000-4000-8000-000000000001',
    PENDING: '10000000-0000-4000-8000-000000000002',
    MANUAL_REVIEW: '10000000-0000-4000-8000-000000000003',
    QUALITY_FAILED: '10000000-0000-4000-8000-000000000004',
    PAUSED: '10000000-0000-4000-8000-000000000005',
  },
  pipelineRuns: {
    COMPLETE: '20000000-0000-4000-8000-000000000001',
    MANUAL_REVIEW: '20000000-0000-4000-8000-000000000003',
    QUALITY_FAILED: '20000000-0000-4000-8000-000000000004',
    PAUSED: '20000000-0000-4000-8000-000000000005',
  },
  reviews: {
    HIGH_VALUE: 'REVIEW-CL2024004-001',
  },
  errors: {
    QUALITY_FAILED: 'ERROR-QUALITY-CL2024003-001',
    BATCH_PAYMENT: 'ERROR-BATCH-PAYMENT-001',
  },
  inboundRuns: {
    AP_REPRINT: 'FEED-AP-20240122-001',
    CHANGE_835: 'FEED-835-20240122-001',
  },
  batches: {
    NIGHTLY: 'BATCH-20240122-001',
  },
});

const PIPELINE_STEP_DEFINITIONS = deepFreeze([
  {
    step: 'REQUEST',
    label: 'Request',
    printedMinutes: '0',
    agent: 'INTAKE',
  },
  {
    step: 'VALIDATION',
    label: 'Validation',
    printedMinutes: '7',
    agent: 'VALIDATION',
  },
  {
    step: 'DATA_RETRIEVAL',
    label: 'Data retrieval',
    printedMinutes: '1',
    agent: 'DATA_RETRIEVAL',
  },
  {
    step: 'BUSINESS_RULES',
    label: 'Business rules',
    printedMinutes: '0.5',
    agent: 'BUSINESS_RULES',
  },
  {
    step: 'DOCUMENT_GENERATION',
    label: 'Document generation',
    printedMinutes: '5',
    agent: 'DOCUMENT_GENERATION',
  },
  {
    step: 'QUALITY_CHECK',
    label: 'Quality check',
    printedMinutes: '2',
    agent: 'QUALITY_ASSURANCE',
  },
  {
    step: 'PDF_CREATION',
    label: 'PDF creation',
    printedMinutes: '0',
    agent: 'PDF_CREATION',
  },
  {
    step: 'STORAGE',
    label: 'Storage',
    printedMinutes: '0',
    agent: 'STORAGE',
  },
  {
    step: 'STORED',
    label: 'Stored',
    printedMinutes: '0',
    agent: 'OUTBOUND',
  },
]);

export const PIPELINE_DEFINITION_FIXTURE = deepFreeze({
  slaMinutes: 22,
  targetMinutes: 15.5,
  playbackMode: 'COMPRESSED',
  simulatedDelayMs: 400,
  steps: PIPELINE_STEP_DEFINITIONS,
});

function createPassedStepResult(definition, index) {
  const minute = String(index).padStart(2, '0');
  const nextMinute = String(index + 1).padStart(2, '0');

  return {
    step: definition.step,
    status: 'PASSED',
    printedMinutes: definition.printedMinutes,
    startedAt: `2024-01-22T10:${minute}:00.000Z`,
    endedAt: `2024-01-22T10:${nextMinute}:00.000Z`,
    code: `${definition.step}_PASSED`,
    message: `${definition.label} completed for demonstration.`,
  };
}

const COMPLETE_STEP_RESULTS = PIPELINE_STEP_DEFINITIONS.map(
  createPassedStepResult,
);

const MANUAL_REVIEW_STEP_RESULTS = [
  ...PIPELINE_STEP_DEFINITIONS.slice(0, 3).map(
    createPassedStepResult,
  ),
  {
    step: 'BUSINESS_RULES',
    status: 'FAILED',
    printedMinutes: '0.5',
    startedAt: '2024-01-22T10:03:00.000Z',
    endedAt: '2024-01-22T10:04:00.000Z',
    code: 'MANUAL_REVIEW_REQUIRED',
    message:
      'Member responsibility exceeds the fictional demo review threshold.',
  },
];

const QUALITY_FAILURE_STEP_RESULTS = [
  ...PIPELINE_STEP_DEFINITIONS.slice(0, 5).map(
    createPassedStepResult,
  ),
  {
    step: 'QUALITY_CHECK',
    status: 'FAILED',
    printedMinutes: '2',
    startedAt: '2024-01-22T10:05:00.000Z',
    endedAt: '2024-01-22T10:06:00.000Z',
    code: 'DOCUMENT_QUALITY_FAILED',
    message:
      'The deterministic quality-failure scenario stopped document creation.',
  },
];

export const INITIAL_REQUESTS = deepFreeze([
  {
    requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
    displayId: 'REQ-000001',
    claimNumber: 'CL2024001',
    memberId: '123456789',
    requestType: 'BOTH',
    priority: 'URGENT',
    sourceType: 'WEB',
    sourceDetail: 'Member portal demonstration',
    status: 'COMPLETE',
    createdAt: '2024-01-22T09:55:00.000Z',
    startedAt: '2024-01-22T10:00:00.000Z',
    completedAt: '2024-01-22T10:09:00.000Z',
    processingTimeMs: 3600,
    result: 'EOB and EOR representative documents stored.',
    documentReferences: [
      'DOC-EOB-CL2024001-V1',
      'DOC-EOR-CL2024001-V1',
    ],
    errorReportId: null,
    currentStep: 'STORED',
    faxStatus: 'NOT_REQUESTED',
    requestedBy: 'usr_member_john',
    version: 1,
  },
  {
    requestId: OPERATIONS_FIXTURE_IDS.requests.PENDING,
    displayId: 'REQ-000002',
    claimNumber: 'CL2024002',
    memberId: '987654321',
    requestType: 'EOR',
    priority: 'HIGH',
    sourceType: 'FILE_FEED',
    sourceDetail: 'AP reprint row AP-77',
    status: 'PENDING',
    createdAt: '2024-01-22T10:12:00.000Z',
    startedAt: null,
    completedAt: null,
    processingTimeMs: null,
    result: null,
    documentReferences: [],
    errorReportId: null,
    currentStep: 'REQUEST',
    faxStatus: 'NOT_REQUESTED',
    requestedBy: 'usr_bos',
    version: 1,
  },
  {
    requestId: OPERATIONS_FIXTURE_IDS.requests.MANUAL_REVIEW,
    displayId: 'REQ-000003',
    claimNumber: 'CL2024004',
    memberId: '987654321',
    requestType: 'EOB',
    priority: 'URGENT',
    sourceType: 'WEB',
    sourceDetail: 'High-value claim demonstration',
    status: 'MANUAL_REVIEW',
    createdAt: '2024-01-22T10:14:00.000Z',
    startedAt: '2024-01-22T10:15:00.000Z',
    completedAt: null,
    processingTimeMs: null,
    result: 'Waiting for authorized manual review.',
    documentReferences: [],
    errorReportId: null,
    currentStep: 'BUSINESS_RULES',
    faxStatus: 'NOT_REQUESTED',
    requestedBy: 'usr_bos',
    version: 1,
  },
  {
    requestId: OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
    displayId: 'REQ-000004',
    claimNumber: 'CL2024003',
    memberId: '123456789',
    requestType: 'EOB',
    priority: 'NORMAL',
    sourceType: 'REWORK',
    sourceDetail: 'Deterministic quality-failure scenario',
    status: 'FAILED',
    createdAt: '2024-01-22T10:18:00.000Z',
    startedAt: '2024-01-22T10:19:00.000Z',
    completedAt: '2024-01-22T10:25:00.000Z',
    processingTimeMs: 2400,
    result: 'Document quality check failed.',
    documentReferences: [],
    errorReportId:
      OPERATIONS_FIXTURE_IDS.errors.QUALITY_FAILED,
    currentStep: 'QUALITY_CHECK',
    faxStatus: 'NOT_REQUESTED',
    requestedBy: 'usr_bos',
    version: 1,
  },
  {
    requestId: OPERATIONS_FIXTURE_IDS.requests.PAUSED,
    displayId: 'REQ-000005',
    claimNumber: 'CL2024001',
    memberId: '123456789',
    requestType: 'EOB',
    priority: 'NORMAL',
    sourceType: 'BATCH',
    sourceDetail: 'Paused refresh-recovery demonstration',
    status: 'PAUSED',
    createdAt: '2024-01-22T10:28:00.000Z',
    startedAt: '2024-01-22T10:29:00.000Z',
    completedAt: null,
    processingTimeMs: null,
    result: 'Playback paused after browser hydration.',
    documentReferences: [],
    errorReportId: null,
    currentStep: 'DATA_RETRIEVAL',
    faxStatus: 'NOT_REQUESTED',
    requestedBy: 'system',
    version: 1,
  },
]);

export const INITIAL_PIPELINE_RUNS = deepFreeze([
  {
    runId: OPERATIONS_FIXTURE_IDS.pipelineRuns.COMPLETE,
    requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
    scenario: 'SUCCESS',
    status: 'COMPLETE',
    currentStep: 'STORED',
    completedSteps: PIPELINE_STEP_DEFINITIONS.map(
      (definition) => definition.step,
    ),
    checkpoint: {
      step: 'STORED',
      nextStep: null,
      resumable: false,
    },
    agentOutcomes: PIPELINE_STEP_DEFINITIONS.map((definition) => ({
      agent: definition.agent,
      step: definition.step,
      outcome: 'PASSED',
      simulated: true,
    })),
    stepResults: COMPLETE_STEP_RESULTS,
    startedAt: '2024-01-22T10:00:00.000Z',
    updatedAt: '2024-01-22T10:09:00.000Z',
  },
  {
    runId: OPERATIONS_FIXTURE_IDS.pipelineRuns.MANUAL_REVIEW,
    requestId: OPERATIONS_FIXTURE_IDS.requests.MANUAL_REVIEW,
    scenario: 'RULE_FAILURE',
    status: 'MANUAL_REVIEW',
    currentStep: 'BUSINESS_RULES',
    completedSteps: [
      'REQUEST',
      'VALIDATION',
      'DATA_RETRIEVAL',
    ],
    checkpoint: {
      step: 'BUSINESS_RULES',
      nextStep: 'DOCUMENT_GENERATION',
      resumable: true,
      reviewId:
        OPERATIONS_FIXTURE_IDS.reviews.HIGH_VALUE,
    },
    agentOutcomes: [
      {
        agent: 'INTAKE',
        step: 'REQUEST',
        outcome: 'PASSED',
        simulated: true,
      },
      {
        agent: 'VALIDATION',
        step: 'VALIDATION',
        outcome: 'PASSED',
        simulated: true,
      },
      {
        agent: 'DATA_RETRIEVAL',
        step: 'DATA_RETRIEVAL',
        outcome: 'PASSED',
        simulated: true,
      },
      {
        agent: 'BUSINESS_RULES',
        step: 'BUSINESS_RULES',
        outcome: 'MANUAL_REVIEW',
        code: 'MANUAL_REVIEW_REQUIRED',
        simulated: true,
      },
    ],
    stepResults: MANUAL_REVIEW_STEP_RESULTS,
    startedAt: '2024-01-22T10:15:00.000Z',
    updatedAt: '2024-01-22T10:19:00.000Z',
  },
  {
    runId: OPERATIONS_FIXTURE_IDS.pipelineRuns.QUALITY_FAILED,
    requestId: OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
    scenario: 'QUALITY_FAILURE',
    status: 'FAILED',
    currentStep: 'QUALITY_CHECK',
    completedSteps: [
      'REQUEST',
      'VALIDATION',
      'DATA_RETRIEVAL',
      'BUSINESS_RULES',
      'DOCUMENT_GENERATION',
    ],
    checkpoint: {
      step: 'QUALITY_CHECK',
      nextStep: null,
      resumable: false,
      errorReportId:
        OPERATIONS_FIXTURE_IDS.errors.QUALITY_FAILED,
    },
    agentOutcomes: [
      ...PIPELINE_STEP_DEFINITIONS.slice(0, 5).map(
        (definition) => ({
          agent: definition.agent,
          step: definition.step,
          outcome: 'PASSED',
          simulated: true,
        }),
      ),
      {
        agent: 'QUALITY_ASSURANCE',
        step: 'QUALITY_CHECK',
        outcome: 'FAILED',
        code: 'DOCUMENT_QUALITY_FAILED',
        simulated: true,
      },
    ],
    stepResults: QUALITY_FAILURE_STEP_RESULTS,
    startedAt: '2024-01-22T10:19:00.000Z',
    updatedAt: '2024-01-22T10:25:00.000Z',
  },
  {
    runId: OPERATIONS_FIXTURE_IDS.pipelineRuns.PAUSED,
    requestId: OPERATIONS_FIXTURE_IDS.requests.PAUSED,
    scenario: 'SUCCESS',
    status: 'PAUSED',
    currentStep: 'DATA_RETRIEVAL',
    completedSteps: ['REQUEST', 'VALIDATION'],
    checkpoint: {
      step: 'DATA_RETRIEVAL',
      nextStep: 'BUSINESS_RULES',
      resumable: true,
    },
    agentOutcomes: [
      {
        agent: 'INTAKE',
        step: 'REQUEST',
        outcome: 'PASSED',
        simulated: true,
      },
      {
        agent: 'VALIDATION',
        step: 'VALIDATION',
        outcome: 'PASSED',
        simulated: true,
      },
    ],
    stepResults: PIPELINE_STEP_DEFINITIONS.slice(0, 2).map(
      createPassedStepResult,
    ),
    startedAt: '2024-01-22T10:29:00.000Z',
    updatedAt: '2024-01-22T10:31:00.000Z',
  },
]);

export const PROCESSING_OUTCOME_PROFILES = deepFreeze([
  {
    scenario: 'SUCCESS',
    label: 'Successful processing',
    terminalRequestStatus: 'COMPLETE',
    terminalPipelineStatus: 'COMPLETE',
    terminalStep: 'STORED',
    failureCode: null,
    createsDocuments: true,
    createsErrorReport: false,
    createsManualReview: false,
    retryable: false,
  },
  {
    scenario: 'INVALID_REQUEST',
    label: 'Invalid request',
    terminalRequestStatus: 'FAILED',
    terminalPipelineStatus: 'FAILED',
    terminalStep: 'VALIDATION',
    failureCode: 'REQUEST_VALIDATION_FAILED',
    createsDocuments: false,
    createsErrorReport: true,
    createsManualReview: false,
    retryable: true,
  },
  {
    scenario: 'RULE_FAILURE',
    label: 'Manual review required',
    terminalRequestStatus: 'MANUAL_REVIEW',
    terminalPipelineStatus: 'MANUAL_REVIEW',
    terminalStep: 'BUSINESS_RULES',
    failureCode: 'MANUAL_REVIEW_REQUIRED',
    createsDocuments: false,
    createsErrorReport: false,
    createsManualReview: true,
    retryable: false,
  },
  {
    scenario: 'QUALITY_FAILURE',
    label: 'Document quality failure',
    terminalRequestStatus: 'FAILED',
    terminalPipelineStatus: 'FAILED',
    terminalStep: 'QUALITY_CHECK',
    failureCode: 'DOCUMENT_QUALITY_FAILED',
    createsDocuments: false,
    createsErrorReport: true,
    createsManualReview: false,
    retryable: true,
  },
]);

export const PIPELINE_EVIDENCE = deepFreeze({
  successfulRun: {
    requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
    runId: OPERATIONS_FIXTURE_IDS.pipelineRuns.COMPLETE,
    expectedStepCount: 9,
    documentIds: [
      'DOC-EOB-CL2024001-V1',
      'DOC-EOR-CL2024001-V1',
    ],
    completedWithoutNetwork: true,
    disclosure:
      'Processed for demonstration only; no external system was contacted.',
  },
  validationChecks: [
    {
      order: 1,
      ruleId: 'REQUEST_FIELDS_VALID',
      outcome: 'PASSED',
      printedMinutes: '2',
    },
    {
      order: 2,
      ruleId: 'MEMBER_CLAIM_MATCH',
      outcome: 'PASSED',
      printedMinutes: '3',
    },
    {
      order: 3,
      ruleId: 'CLAIM_ELIGIBLE',
      outcome: 'PASSED',
      printedMinutes: '2',
    },
  ],
  qualityFailure: {
    requestId:
      OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
    failedStep: 'QUALITY_CHECK',
    errorReportId:
      OPERATIONS_FIXTURE_IDS.errors.QUALITY_FAILED,
    documentIds: [],
    outboundRecordIds: [],
  },
  resume: {
    requestId: OPERATIONS_FIXTURE_IDS.requests.PAUSED,
    checkpoint: 'DATA_RETRIEVAL',
    completedSteps: ['REQUEST', 'VALIDATION'],
    nextStep: 'DATA_RETRIEVAL',
    repeatedEffects: false,
  },
});

export const INITIAL_MANUAL_REVIEWS = deepFreeze([
  {
    reviewId: OPERATIONS_FIXTURE_IDS.reviews.HIGH_VALUE,
    requestId:
      OPERATIONS_FIXTURE_IDS.requests.MANUAL_REVIEW,
    triggerCode: 'MEMBER_RESPONSIBILITY_THRESHOLD',
    thresholdCents: 50000,
    status: 'OPEN',
    decisionBy: null,
    decidedAt: null,
  },
]);

export const MANUAL_REVIEW_SCENARIOS = deepFreeze([
  {
    scenarioId: 'REVIEW-HIGH-VALUE-APPROVE',
    reviewId: OPERATIONS_FIXTURE_IDS.reviews.HIGH_VALUE,
    claimNumber: 'CL2024004',
    memberResponsibilityCents: 360000,
    thresholdCents: 50000,
    decision: 'APPROVE',
    requiredRoles: ['BOS', 'ADMIN'],
    expectedRequestStatus: 'PROCESSING',
    resumeFrom: 'DOCUMENT_GENERATION',
  },
  {
    scenarioId: 'REVIEW-HIGH-VALUE-REJECT',
    reviewId: OPERATIONS_FIXTURE_IDS.reviews.HIGH_VALUE,
    claimNumber: 'CL2024004',
    memberResponsibilityCents: 360000,
    thresholdCents: 50000,
    decision: 'REJECT',
    requiredRoles: ['BOS', 'ADMIN'],
    expectedRequestStatus: 'FAILED',
    createsErrorReport: true,
  },
]);

export const CLAIM_ADJUSTMENT_SCENARIOS = deepFreeze([
  {
    scenarioId: 'ADJUST-MEMBER-RESPONSIBILITY',
    claimNumber: 'CL2024004',
    field: 'patientResponsibilityCents',
    beforeValue: 360000,
    newValue: 48000,
    reasonCode: 'COORDINATION_OF_BENEFITS',
    allowedRoles: ['BOS', 'ADMIN'],
    expectedOutcome: 'PASSED',
  },
  {
    scenarioId: 'ADJUST-MISSING-REASON',
    claimNumber: 'CL2024004',
    field: 'patientResponsibilityCents',
    beforeValue: 360000,
    newValue: 48000,
    reasonCode: null,
    allowedRoles: ['BOS', 'ADMIN'],
    expectedOutcome: 'FAILED',
    expectedCode: 'REASON_REQUIRED',
  },
  {
    scenarioId: 'ADJUST-FORBIDDEN-CSR',
    claimNumber: 'CL2024004',
    field: 'patientResponsibilityCents',
    beforeValue: 360000,
    newValue: 48000,
    reasonCode: 'COORDINATION_OF_BENEFITS',
    actorRole: 'CSR',
    expectedOutcome: 'FAILED',
    expectedCode: 'FORBIDDEN',
  },
]);

export const INITIAL_ERROR_REPORTS = deepFreeze([
  {
    errorReportId:
      OPERATIONS_FIXTURE_IDS.errors.QUALITY_FAILED,
    requestId:
      OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
    claimNumber: 'CL2024003',
    severity: 'ERROR',
    status: 'OPEN',
    summary: 'Document quality check failed',
    details:
      'The deterministic quality fixture stopped before PDF creation and storage.',
    context: {
      stage: 'QUALITY_CHECK',
      correlationId: 'corr-quality-001',
      ruleId: 'DOCUMENT_QUALITY',
      simulated: true,
    },
    resolution: {
      recommendation:
        'Correct the fixture metadata and retry the request.',
      retryFrom: 'DOCUMENT_GENERATION',
    },
    createdAt: '2024-01-22T10:25:00.000Z',
    relatedEntities: {
      claimNumber: 'CL2024003',
      requestId:
        OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
    },
    auditTrail: [
      {
        at: '2024-01-22T10:25:00.000Z',
        action: 'CREATED',
        actor: 'system',
      },
    ],
    stackTrace:
      'ValidationError: fixture rule DOCUMENT_QUALITY failed',
    footer: 'Fictional demo data',
  },
  {
    errorReportId:
      OPERATIONS_FIXTURE_IDS.errors.BATCH_PAYMENT,
    requestId: null,
    claimNumber: 'CL2024002',
    severity: 'WARNING',
    status: 'QUEUED',
    summary: 'Batch payment reference missing',
    details:
      'A fictional nightly batch row was returned to the local queue.',
    context: {
      stage: 'PAYMENT_ATTACHMENT',
      correlationId: 'corr-batch-001',
      simulated: true,
    },
    resolution: {
      recommendation:
        'Attach the masked fixture payment reference and retry the row.',
    },
    createdAt: '2024-01-22T11:10:00.000Z',
    relatedEntities: {
      batchId: OPERATIONS_FIXTURE_IDS.batches.NIGHTLY,
      rowId: 'BROW-20240122-002',
    },
    auditTrail: [
      {
        at: '2024-01-22T11:10:00.000Z',
        action: 'QUEUED',
        actor: 'system',
      },
    ],
    stackTrace: null,
    footer: 'Fictional demo data',
  },
]);

export const ERROR_REPORT_ACTION_SCENARIOS = deepFreeze([
  {
    action: 'EXPORT',
    startingStatus: 'OPEN',
    expectedStatus: 'OPEN',
    resultKind: 'LOCAL_BLOB',
    transmitted: false,
  },
  {
    action: 'QUEUE',
    startingStatus: 'OPEN',
    expectedStatus: 'QUEUED',
    resultKind: 'LOCAL_EXCEPTION_QUEUE',
    transmitted: false,
  },
  {
    action: 'CLOSE',
    startingStatus: 'OPEN',
    expectedStatus: 'CLOSED',
    resultKind: 'STATUS_CHANGE',
    transmitted: false,
  },
  {
    action: 'CLOSE',
    startingStatus: 'CLOSED',
    expectedStatus: 'CLOSED',
    resultKind: 'ERROR',
    expectedCode: 'INVALID_STATE',
    transmitted: false,
  },
]);

export const AP_REPRINT_HEADER = deepFreeze([
  'claim_number',
  'member_id',
  'request_type',
  'priority',
  'source_reference',
]);

export const CHANGE_835_HEADER = deepFreeze([
  'record_type',
  'member_id',
  'claim_number',
  'field',
  'new_value',
]);

export const AP_REPRINT_SCENARIOS = deepFreeze([
  {
    scenarioId: 'AP-VALID-SINGLE',
    filename: 'ap-reprints-valid.csv',
    maskedApiKeyId: '****A19F',
    header: AP_REPRINT_HEADER,
    rows: [
      {
        rowNumber: 2,
        values: {
          claim_number: 'CL2024002',
          member_id: '987654321',
          request_type: 'EOR',
          priority: 'HIGH',
          source_reference: 'AP-77',
        },
      },
    ],
    expectedStatus: 'COMPLETE',
    expectedAccepted: 1,
    expectedFailed: 0,
  },
  {
    scenarioId: 'AP-MIXED-ROWS',
    filename: 'ap-reprints-mixed.csv',
    maskedApiKeyId: '****B20F',
    header: AP_REPRINT_HEADER,
    rows: [
      {
        rowNumber: 2,
        values: {
          claim_number: 'CL2024001',
          member_id: '123456789',
          request_type: 'EOB',
          priority: 'NORMAL',
          source_reference: 'AP-78',
        },
      },
      {
        rowNumber: 3,
        values: {
          claim_number: 'CL9999999',
          member_id: '123456789',
          request_type: 'EOB',
          priority: 'NORMAL',
          source_reference: 'AP-79',
        },
      },
    ],
    expectedStatus: 'COMPLETED_WITH_ERRORS',
    expectedAccepted: 1,
    expectedFailed: 1,
  },
  {
    scenarioId: 'AP-BAD-HEADER',
    filename: 'ap-reprints-bad-header.csv',
    maskedApiKeyId: '****C21F',
    header: [
      'member_id',
      'claim_number',
      'request_type',
      'priority',
    ],
    rows: [],
    expectedStatus: 'FAILED',
    expectedCode: 'BAD_HEADER',
  },
]);

export const CHANGE_835_SCENARIOS = deepFreeze([
  {
    scenarioId: '835-ALLOWLISTED-CHANGE',
    filename: 'change-835-valid.csv',
    maskedApiKeyId: '****835A',
    header: CHANGE_835_HEADER,
    rows: [
      {
        rowNumber: 2,
        values: {
          record_type: 'CLM',
          member_id: '987654321',
          claim_number: 'CL2024002',
          field: 'provider_reference',
          new_value: 'PRV1003',
        },
      },
    ],
    expectedStatus: 'COMPLETE',
    expectedCdcOperation: 'UPDATE',
  },
  {
    scenarioId: '835-BLOCKED-FIELD',
    filename: 'change-835-blocked.csv',
    maskedApiKeyId: '****835B',
    header: CHANGE_835_HEADER,
    rows: [
      {
        rowNumber: 2,
        values: {
          record_type: 'CLM',
          member_id: '987654321',
          claim_number: 'CL2024002',
          field: 'member_name',
          new_value: 'Blocked Value',
        },
      },
    ],
    expectedStatus: 'COMPLETED_WITH_ERRORS',
    expectedCode: 'FIELD_NOT_ALLOWLISTED',
  },
]);

export const INITIAL_INBOUND_RUNS = deepFreeze([
  {
    feedRunId: OPERATIONS_FIXTURE_IDS.inboundRuns.AP_REPRINT,
    feedType: 'AP_REPRINT',
    filename: 'ap-reprints-mixed.csv',
    maskedApiKeyId: '****A19F',
    header: AP_REPRINT_HEADER,
    status: 'COMPLETED_WITH_ERRORS',
    rows: [
      {
        rowNumber: 2,
        values: {
          claim_number: 'CL2024002',
          member_id: '987654321',
          request_type: 'EOR',
          priority: 'HIGH',
          source_reference: 'AP-77',
        },
        status: 'APPLIED',
        attempt: 1,
        errorCode: null,
        resultReference:
          OPERATIONS_FIXTURE_IDS.requests.PENDING,
      },
      {
        rowNumber: 3,
        values: {
          claim_number: 'CL9999999',
          member_id: '123456789',
          request_type: 'EOB',
          priority: 'NORMAL',
          source_reference: 'AP-78',
        },
        status: 'FAILED',
        attempt: 1,
        errorCode: 'CLAIM_NOT_FOUND',
        resultReference: null,
      },
    ],
    createdAt: '2024-01-22T10:12:00.000Z',
  },
  {
    feedRunId: OPERATIONS_FIXTURE_IDS.inboundRuns.CHANGE_835,
    feedType: 'CHANGE_835',
    filename: 'change-835-valid.csv',
    maskedApiKeyId: '****835A',
    header: CHANGE_835_HEADER,
    status: 'COMPLETE',
    rows: [
      {
        rowNumber: 2,
        values: {
          record_type: 'CLM',
          member_id: '987654321',
          claim_number: 'CL2024002',
          field: 'provider_reference',
          new_value: 'PRV1003',
        },
        status: 'APPLIED',
        attempt: 1,
        errorCode: null,
        resultReference: 'CDC-835-20240122-001',
      },
    ],
    createdAt: '2024-01-22T10:35:00.000Z',
  },
]);

export const INBOUND_RETRY_RESULTS = deepFreeze([
  {
    scenarioId: 'AP-RETRY-CORRECTED-CLAIM',
    feedRunId: OPERATIONS_FIXTURE_IDS.inboundRuns.AP_REPRINT,
    rowNumber: 3,
    previousAttempt: 1,
    correctedValues: {
      claim_number: 'CL2024001',
      member_id: '123456789',
      request_type: 'EOB',
      priority: 'NORMAL',
      source_reference: 'AP-78',
    },
    attempt: 2,
    status: 'APPLIED',
    errorCode: null,
    resultReference: '10000000-0000-4000-8000-000000000006',
  },
  {
    scenarioId: 'AP-RETRY-LIMIT',
    feedRunId: OPERATIONS_FIXTURE_IDS.inboundRuns.AP_REPRINT,
    rowNumber: 3,
    previousAttempt: 3,
    correctedValues: {
      claim_number: 'CL2024001',
      member_id: '123456789',
      request_type: 'EOB',
      priority: 'NORMAL',
      source_reference: 'AP-78',
    },
    attempt: 3,
    status: 'FAILED',
    errorCode: 'RETRY_NOT_ALLOWED',
    resultReference: null,
  },
]);

export const BATCH_STEP_DEFINITION = deepFreeze([
  'INTAKE',
  'MEMBER_VALIDATION',
  'CLAIM_VALIDATION',
  'PROVIDER_CONSOLIDATION',
  'MEMBER_CONSOLIDATION',
  'PAYMENT_ATTACHMENT',
  'DOCUMENT_PREPARATION',
  'REPORT_CREATION',
  'IXIT_HANDOFF',
  'COMPLETION',
]);

const COMPLETE_BATCH_STEPS = BATCH_STEP_DEFINITION.map(
  (step, index) => ({
    step,
    status: 'PASSED',
    startedAt: `2024-01-22T11:${String(index).padStart(2, '0')}:00.000Z`,
    endedAt: `2024-01-22T11:${String(index + 1).padStart(2, '0')}:00.000Z`,
    code: `${step}_PASSED`,
    message: `${step} completed for demonstration.`,
  }),
);

export const INITIAL_BATCH_RUNS = deepFreeze([
  {
    batchId: OPERATIONS_FIXTURE_IDS.batches.NIGHTLY,
    status: 'COMPLETED_WITH_ERRORS',
    steps: COMPLETE_BATCH_STEPS,
    rows: [
      {
        rowId: 'BROW-20240122-001',
        claimNumber: 'CL2024001',
        memberId: '123456789',
        status: 'COMPLETE',
        attempt: 1,
        reasonCode: null,
        reportId: 'IXIT-REPORT-20240122-001',
      },
      {
        rowId: 'BROW-20240122-002',
        claimNumber: 'CL2024002',
        memberId: '987654321',
        status: 'FAILED',
        attempt: 1,
        reasonCode: 'PAYMENT_MISSING',
        reportId: null,
      },
    ],
    startedAt: '2024-01-22T11:00:00.000Z',
    completedAt: '2024-01-22T11:10:00.000Z',
  },
]);

export const NIGHTLY_QUEUE_ROWS = deepFreeze([
  {
    rowId: 'BROW-20240122-001',
    claimNumber: 'CL2024001',
    memberId: '123456789',
    requestType: 'BOTH',
    priority: 'NORMAL',
    source: 'NIGHTLY_BATCH',
    status: 'COMPLETE',
    reasonCode: null,
  },
  {
    rowId: 'BROW-20240122-002',
    claimNumber: 'CL2024002',
    memberId: '987654321',
    requestType: 'EOR',
    priority: 'HIGH',
    source: 'NIGHTLY_BATCH',
    status: 'QUEUED',
    reasonCode: 'PAYMENT_MISSING',
  },
  {
    rowId: 'BROW-REWORK-20240122-001',
    claimNumber: 'CL2024003',
    memberId: '123456789',
    requestType: 'BOTH',
    priority: 'NORMAL',
    source: 'REWORK',
    status: 'QUEUED',
    reasonCode: 'CORRECTED_CLAIM',
  },
]);

export const BATCH_RETRY_RESULTS = deepFreeze([
  {
    scenarioId: 'BATCH-PAYMENT-RETRY-SUCCESS',
    batchId: OPERATIONS_FIXTURE_IDS.batches.NIGHTLY,
    rowId: 'BROW-20240122-002',
    previousStatus: 'FAILED',
    previousAttempt: 1,
    resolution: {
      paymentReference: '****0002',
    },
    attempt: 2,
    status: 'COMPLETE',
    reasonCode: null,
    reportId: 'IXIT-REPORT-20240122-002',
  },
  {
    scenarioId: 'BATCH-RETRY-NOT-ALLOWED',
    batchId: OPERATIONS_FIXTURE_IDS.batches.NIGHTLY,
    rowId: 'BROW-20240122-001',
    previousStatus: 'COMPLETE',
    previousAttempt: 1,
    resolution: {
      paymentReference: '****0001',
    },
    attempt: 1,
    status: 'COMPLETE',
    errorCode: 'ROW_NOT_RETRYABLE',
    reportId: 'IXIT-REPORT-20240122-001',
  },
]);

export const CLAIM_REWORK_SCENARIOS = deepFreeze([
  {
    scenarioId: 'REWORK-IMMEDIATE',
    claimNumber: 'CL2024003',
    memberId: '123456789',
    execution: 'IMMEDIATE',
    requestType: 'BOTH',
    reasonCode: 'CORRECTED_CLAIM',
    notes: 'Corrected fictional denied service fixture.',
    expectedStatus: 'COMPLETE',
    expectedDocumentTypes: ['EOB', 'EOR'],
  },
  {
    scenarioId: 'REWORK-NIGHTLY',
    claimNumber: 'CL2024002',
    memberId: '987654321',
    execution: 'NIGHTLY_BATCH',
    requestType: 'BOTH',
    reasonCode: 'PROVIDER_CORRECTION',
    notes: 'Queue fictional correction for the nightly run.',
    expectedStatus: 'PENDING',
    expectedBatchRowId: 'BROW-REWORK-20240122-002',
  },
]);

export const INITIAL_OUTBOUND_RECORDS = deepFreeze([
  {
    outboundId: 'OUT-IXIT-DOC-EOB-001',
    kind: 'IXIT',
    documentId: 'DOC-EOB-CL2024001-V1',
    status: 'COMPLETE',
    payloadMasked: {
      reportId: 'IXIT-REPORT-20240122-001',
      destination: 'MOCK_IXIT',
      transmitted: false,
    },
    createdAt: '2024-01-22T10:09:00.000Z',
  },
  {
    outboundId: 'OUT-REPORT-DOC-EOB-001',
    kind: 'REPORTING',
    documentId: 'DOC-EOB-CL2024001-V1',
    status: 'COMPLETE',
    payloadMasked: {
      reportReference: 'REPORT-****0001',
      transmitted: false,
    },
    createdAt: '2024-01-22T10:09:00.000Z',
  },
  {
    outboundId: 'OUT-REPRINT-DOC-EOB-001',
    kind: 'REPRINT_REFERENCE',
    documentId: 'DOC-EOB-CL2024001-V1',
    status: 'COMPLETE',
    payloadMasked: {
      requestDisplayId: 'REQ-000001',
      transmitted: false,
    },
    createdAt: '2024-01-22T10:09:00.000Z',
  },
  {
    outboundId: 'OUT-EMAIL-DOC-EOR-001',
    kind: 'EMAIL',
    documentId: 'DOC-EOR-CL2024001-V1',
    status: 'NOT_REQUESTED',
    payloadMasked: {
      destination: null,
      transmitted: false,
    },
    createdAt: '2024-01-22T10:09:00.000Z',
  },
  {
    outboundId: 'OUT-CRM-DOC-EOR-001',
    kind: 'CRM',
    documentId: 'DOC-EOR-CL2024001-V1',
    status: 'COMPLETE',
    payloadMasked: {
      activityReference: 'CRM-****0001',
      transmitted: false,
    },
    createdAt: '2024-01-22T10:09:00.000Z',
  },
  {
    outboundId: 'OUT-FAX-DOC-EOB-001',
    kind: 'FAX',
    documentId: 'DOC-EOB-CL2024001-V1',
    status: 'READY',
    payloadMasked: {
      destinationMasked: '(***) ***-0101',
      transmitted: false,
    },
    createdAt: '2024-01-22T10:10:00.000Z',
  },
]);

export const FAX_SIMULATION_RESULTS = deepFreeze([
  {
    outboundId: 'OUT-FAX-DOC-EOB-001',
    documentId: 'DOC-EOB-CL2024001-V1',
    previousStatus: 'READY',
    status: 'SENT',
    destinationMasked: '(***) ***-0101',
    transmitted: false,
    message:
      'Fax marked sent for demonstration; no external transmission occurred.',
  },
]);

export const INITIAL_CDC_EVENTS = deepFreeze([
  {
    cdcEventId: 'CDC-835-20240122-001',
    operation: 'UPDATE',
    entityType: 'CLAIM',
    entityId: 'CL2024002',
    before: {
      providerReference: 'PRV-LEGACY-0002',
    },
    after: {
      providerReference: 'PRV1003',
    },
    occurredAt: '2024-01-22T10:35:00.000Z',
    correlationId: 'corr-835-001',
  },
]);

export const DETERMINISTIC_RETRY_RESULTS = deepFreeze({
  pipelineResume: {
    requestId: OPERATIONS_FIXTURE_IDS.requests.PAUSED,
    runId: OPERATIONS_FIXTURE_IDS.pipelineRuns.PAUSED,
    resumedFrom: 'DATA_RETRIEVAL',
    status: 'PROCESSING',
    nextStep: 'DATA_RETRIEVAL',
    repeatedCompletedSteps: false,
  },
  inbound: INBOUND_RETRY_RESULTS,
  batch: BATCH_RETRY_RESULTS,
  qualityFailure: {
    requestId:
      OPERATIONS_FIXTURE_IDS.requests.QUALITY_FAILED,
    previousStatus: 'FAILED',
    retryFrom: 'DOCUMENT_GENERATION',
    scenario: 'SUCCESS',
    expectedStatus: 'COMPLETE',
    expectedDocumentCount: 1,
  },
});

export const OPERATIONS_QUEUE_FIXTURE = deepFreeze({
  defaultSort: {
    primary: 'priorityRank',
    secondary: 'createdAt',
    direction: 'ASC',
  },
  priorityRanks: {
    URGENT: 0,
    HIGH: 1,
    NORMAL: 2,
  },
  rows: [
    INITIAL_REQUESTS[2],
    INITIAL_REQUESTS[1],
    INITIAL_REQUESTS[4],
    INITIAL_REQUESTS[3],
    INITIAL_REQUESTS[0],
  ],
  filters: {
    statuses: [
      'PENDING',
      'PROCESSING',
      'PAUSED',
      'MANUAL_REVIEW',
      'COMPLETE',
      'FAILED',
      'CANCELLED',
    ],
    priorities: ['URGENT', 'HIGH', 'NORMAL'],
    requestTypes: ['EOB', 'EOR', 'BOTH'],
  },
  bulkScenarios: [
    {
      operationId: 'BULK-20240122-001',
      action: 'PROCESS',
      requestIds: [
        OPERATIONS_FIXTURE_IDS.requests.PENDING,
        OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
      ],
      results: [
        {
          requestId: OPERATIONS_FIXTURE_IDS.requests.PENDING,
          status: 'COMPLETE',
          errorCode: null,
        },
        {
          requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
          status: 'FAILED',
          errorCode: 'INVALID_STATE',
        },
      ],
    },
  ],
});

export const QUEUE_EXPORT_FIXTURE = deepFreeze({
  filename: 'operations-queue-demo-20240122.csv',
  mediaType: 'text/csv',
  localOnly: true,
  headers: [
    'display_id',
    'claim_number',
    'request_type',
    'priority',
    'status',
    'created_at',
  ],
  formulaPrefix: "'",
  rows: INITIAL_REQUESTS.map((request) => [
    request.displayId,
    request.claimNumber,
    request.requestType,
    request.priority,
    request.status,
    request.createdAt,
  ]),
});

export const INITIAL_IDEMPOTENCY_RESULTS = deepFreeze([
  {
    idempotencyKey:
      '30000000-0000-4000-8000-000000000001',
    commandName: 'createRequest',
    requestHash: 'fixture-create-request-complete-v1',
    result: {
      requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
      displayId: 'REQ-000001',
      status: 'COMPLETE',
    },
    createdAt: '2024-01-22T09:55:00.000Z',
  },
  {
    idempotencyKey:
      '30000000-0000-4000-8000-000000000002',
    commandName: 'applyInboundRows',
    requestHash: 'fixture-ap-feed-20240122-v1',
    result: {
      feedRunId:
        OPERATIONS_FIXTURE_IDS.inboundRuns.AP_REPRINT,
      status: 'COMPLETED_WITH_ERRORS',
      accepted: 1,
      failed: 1,
    },
    createdAt: '2024-01-22T10:12:00.000Z',
  },
]);

export const OPERATIONS_DOCUMENT_VERSIONS = deepFreeze([
  {
    documentId: 'DOC-EOB-CL2024001-V1',
    documentType: 'EOB',
    claimNumber: 'CL2024001',
    memberId: '123456789',
    version: 1,
    status: 'COMPLETE',
    documentDate: '2024-01-20',
    artifactKey: 'EOB_SAMPLE',
    fixtureText:
      'Explanation of Benefits John Doe CL2024001 representative fictional demo document.',
    createdAt: '2024-01-22T00:00:00.000Z',
    createdBy: 'system',
    requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
  },
  {
    documentId: 'DOC-EOR-CL2024001-V1',
    documentType: 'EOR',
    claimNumber: 'CL2024001',
    memberId: '123456789',
    version: 1,
    status: 'COMPLETE',
    documentDate: '2024-01-22',
    artifactKey: 'EOR_SAMPLE',
    fixtureText:
      'Explanation of Review John Doe CL2024001 representative fictional demo document.',
    createdAt: '2024-01-22T00:00:00.000Z',
    createdBy: 'system',
    requestId: OPERATIONS_FIXTURE_IDS.requests.COMPLETE,
  },
]);

function indexBy(values, key) {
  return Object.fromEntries(
    values.map((value) => [value[key], value]),
  );
}

export const REQUESTS_BY_ID = deepFreeze(
  indexBy(INITIAL_REQUESTS, 'requestId'),
);

export const PIPELINE_RUNS_BY_ID = deepFreeze(
  indexBy(INITIAL_PIPELINE_RUNS, 'runId'),
);

export const MANUAL_REVIEWS_BY_ID = deepFreeze(
  indexBy(INITIAL_MANUAL_REVIEWS, 'reviewId'),
);

export const ERROR_REPORTS_BY_ID = deepFreeze(
  indexBy(INITIAL_ERROR_REPORTS, 'errorReportId'),
);

export const INBOUND_RUNS_BY_ID = deepFreeze(
  indexBy(INITIAL_INBOUND_RUNS, 'feedRunId'),
);

export const BATCH_RUNS_BY_ID = deepFreeze(
  indexBy(INITIAL_BATCH_RUNS, 'batchId'),
);

export const OUTBOUND_RECORDS_BY_ID = deepFreeze(
  indexBy(INITIAL_OUTBOUND_RECORDS, 'outboundId'),
);

export const CDC_EVENTS_BY_ID = deepFreeze(
  indexBy(INITIAL_CDC_EVENTS, 'cdcEventId'),
);

export const DOCUMENTS_BY_ID = deepFreeze(
  indexBy(OPERATIONS_DOCUMENT_VERSIONS, 'documentId'),
);

export const INITIAL_OPERATIONS_ENVELOPE = deepFreeze({
  schemaVersion: 1,
  revision: 1,
  commitId: '40000000-0000-4000-8000-000000000001',
  updatedAt: FIXTURE_TIMESTAMP,
  requests: REQUESTS_BY_ID,
  pipelineRuns: PIPELINE_RUNS_BY_ID,
  documents: DOCUMENTS_BY_ID,
  inboundRuns: INBOUND_RUNS_BY_ID,
  batchRuns: BATCH_RUNS_BY_ID,
  reviews: MANUAL_REVIEWS_BY_ID,
  errorReports: ERROR_REPORTS_BY_ID,
  outboundRecords: OUTBOUND_RECORDS_BY_ID,
  idempotencyResults: deepFreeze(
    indexBy(INITIAL_IDEMPOTENCY_RESULTS, 'idempotencyKey'),
  ),
  cdcEvents: CDC_EVENTS_BY_ID,
});

export const OPERATIONS_PROCESSING_SUMMARY = deepFreeze({
  simulated: true,
  asOf: FIXTURE_TIMESTAMP,
  requestCounts: {
    total: INITIAL_REQUESTS.length,
    pending: 1,
    processing: 0,
    paused: 1,
    manualReview: 1,
    complete: 1,
    failed: 1,
    cancelled: 0,
  },
  inboundCounts: {
    runs: INITIAL_INBOUND_RUNS.length,
    appliedRows: 2,
    failedRows: 1,
  },
  batchCounts: {
    runs: INITIAL_BATCH_RUNS.length,
    completedRows: 1,
    retryableRows: 1,
  },
  documentCounts: {
    EOB: 1,
    EOR: 1,
  },
  outboundCounts: {
    total: INITIAL_OUTBOUND_RECORDS.length,
    ready: 1,
    sent: 0,
    complete: 4,
    notRequested: 1,
  },
});

export const REQUEST_FIXTURES = INITIAL_REQUESTS;
export const OPERATION_REQUESTS = INITIAL_REQUESTS;
export const PIPELINE_RUN_FIXTURES = INITIAL_PIPELINE_RUNS;
export const PIPELINE_EVIDENCE_FIXTURE = PIPELINE_EVIDENCE;
export const OUTCOME_PROFILES = PROCESSING_OUTCOME_PROFILES;
export const MANUAL_REVIEW_FIXTURES = INITIAL_MANUAL_REVIEWS;
export const ERROR_REPORT_FIXTURES = INITIAL_ERROR_REPORTS;
export const AP_SCENARIOS = AP_REPRINT_SCENARIOS;
export const EDI_835_SCENARIOS = CHANGE_835_SCENARIOS;
export const INBOUND_RUN_FIXTURES = INITIAL_INBOUND_RUNS;
export const BATCH_RUN_FIXTURES = INITIAL_BATCH_RUNS;
export const BATCH_ROW_FIXTURES = NIGHTLY_QUEUE_ROWS;
export const OUTBOUND_RECORD_FIXTURES = INITIAL_OUTBOUND_RECORDS;
export const CDC_EVENT_FIXTURES = INITIAL_CDC_EVENTS;
export const RETRY_RESULT_FIXTURES = DETERMINISTIC_RETRY_RESULTS;
export const QUEUE_FIXTURES = OPERATIONS_QUEUE_FIXTURE;
export const OPERATIONS_ENVELOPE_FIXTURE =
  INITIAL_OPERATIONS_ENVELOPE;
export const INITIAL_OPERATIONS_STATE =
  INITIAL_OPERATIONS_ENVELOPE;

const OPERATIONS_FIXTURES = deepFreeze({
  fixtureVersion: OPERATIONS_FIXTURE_VERSION,
  requests: INITIAL_REQUESTS,
  outcomeProfiles: PROCESSING_OUTCOME_PROFILES,
  pipelineDefinition: PIPELINE_DEFINITION_FIXTURE,
  pipelineRuns: INITIAL_PIPELINE_RUNS,
  pipelineEvidence: PIPELINE_EVIDENCE,
  manualReviews: INITIAL_MANUAL_REVIEWS,
  manualReviewScenarios: MANUAL_REVIEW_SCENARIOS,
  claimAdjustmentScenarios: CLAIM_ADJUSTMENT_SCENARIOS,
  errorReports: INITIAL_ERROR_REPORTS,
  errorReportActionScenarios: ERROR_REPORT_ACTION_SCENARIOS,
  queue: OPERATIONS_QUEUE_FIXTURE,
  queueExport: QUEUE_EXPORT_FIXTURE,
  apReprintScenarios: AP_REPRINT_SCENARIOS,
  change835Scenarios: CHANGE_835_SCENARIOS,
  inboundRuns: INITIAL_INBOUND_RUNS,
  inboundRetryResults: INBOUND_RETRY_RESULTS,
  batchRuns: INITIAL_BATCH_RUNS,
  batchRows: NIGHTLY_QUEUE_ROWS,
  batchRetryResults: BATCH_RETRY_RESULTS,
  claimReworkScenarios: CLAIM_REWORK_SCENARIOS,
  outboundRecords: INITIAL_OUTBOUND_RECORDS,
  faxSimulationResults: FAX_SIMULATION_RESULTS,
  cdcEvents: INITIAL_CDC_EVENTS,
  deterministicRetryResults: DETERMINISTIC_RETRY_RESULTS,
  idempotencyResults: INITIAL_IDEMPOTENCY_RESULTS,
  processingSummary: OPERATIONS_PROCESSING_SUMMARY,
  initialEnvelope: INITIAL_OPERATIONS_ENVELOPE,
});

export default OPERATIONS_FIXTURES;