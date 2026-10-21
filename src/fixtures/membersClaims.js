const FIXTURE_TIMESTAMP = '2024-01-22T00:00:00.000Z';

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

export const CLAIM_NUMBERS = Object.freeze({
  JOHN_OFFICE_VISIT: 'CL2024001',
  JANE_OUTPATIENT_REVIEW: 'CL2024002',
  JOHN_DENIED_LAB: 'CL2024003',
  JANE_MANUAL_REVIEW: 'CL2024004',
  JOHN_EXPIRED_RETENTION: 'CL2020001',
  JANE_RESTRICTED: 'CL2024999',
});

export const MEMBER_IDS = Object.freeze({
  JOHN_DOE: '123456789',
  JANE_SMITH: '987654321',
});

export const PROVIDER_IDS = Object.freeze({
  LAKESIDE_FAMILY_MEDICINE: 'PRV1001',
  NORTHSTAR_DIAGNOSTICS: 'PRV1002',
  CENTRAL_OUTPATIENT_CENTER: 'PRV1003',
});

export const COVERAGE_IDS = Object.freeze({
  JOHN_ACTIVE: 'COV1001',
  JOHN_HISTORICAL: 'COV1002',
  JANE_ACTIVE: 'COV2001',
});

export const REASON_CODE_IDS = Object.freeze({
  CONTRACTUAL_ADJUSTMENT: 'CO45',
  MEMBER_DEDUCTIBLE: 'PR1',
  MEMBER_COPAY: 'PR3',
  DUPLICATE_SERVICE: 'CO18',
  NOT_COVERED: 'CO96',
  INFORMATION_ONLY: 'N620',
});

export const MEMBERS = deepFreeze([
  {
    memberId: MEMBER_IDS.JOHN_DOE,
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'John Doe',
    dateOfBirth: '1985-04-12',
    email: 'john.doe@example.invalid',
    phoneMasked: '(***) ***-0101',
    address: {
      line1: '100 Demo Avenue',
      line2: null,
      city: 'Sample City',
      state: 'MN',
      postalCode: '55001',
    },
    active: true,
    restricted: false,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    memberId: MEMBER_IDS.JANE_SMITH,
    firstName: 'Jane',
    lastName: 'Smith',
    displayName: 'Jane Smith',
    dateOfBirth: '1990-09-23',
    email: 'jane.smith@example.invalid',
    phoneMasked: '(***) ***-0202',
    address: {
      line1: '200 Example Street',
      line2: 'Unit 2',
      city: 'Sample City',
      state: 'MN',
      postalCode: '55002',
    },
    active: true,
    restricted: false,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
]);

export const COVERAGES = deepFreeze([
  {
    coverageId: COVERAGE_IDS.JOHN_ACTIVE,
    memberId: MEMBER_IDS.JOHN_DOE,
    planId: 'PLAN-DEMO-PPO',
    planName: 'Fictional Demo PPO',
    groupNumber: 'GRP100',
    effectiveDate: '2023-01-01',
    terminationDate: null,
    status: 'ACTIVE',
    productType: 'PPO',
  },
  {
    coverageId: COVERAGE_IDS.JOHN_HISTORICAL,
    memberId: MEMBER_IDS.JOHN_DOE,
    planId: 'PLAN-DEMO-LEGACY',
    planName: 'Fictional Historical Plan',
    groupNumber: 'GRP090',
    effectiveDate: '2019-01-01',
    terminationDate: '2020-12-31',
    status: 'TERMINATED',
    productType: 'PPO',
  },
  {
    coverageId: COVERAGE_IDS.JANE_ACTIVE,
    memberId: MEMBER_IDS.JANE_SMITH,
    planId: 'PLAN-DEMO-HMO',
    planName: 'Fictional Demo HMO',
    groupNumber: 'GRP200',
    effectiveDate: '2023-06-01',
    terminationDate: null,
    status: 'ACTIVE',
    productType: 'HMO',
  },
]);

export const PROVIDERS = deepFreeze([
  {
    providerId: PROVIDER_IDS.LAKESIDE_FAMILY_MEDICINE,
    npi: '1000000001',
    name: 'Lakeside Family Medicine',
    providerType: 'PRIMARY_CARE',
    networkStatus: 'IN_NETWORK',
    taxIdMasked: '**-***1001',
    address: {
      city: 'Sample City',
      state: 'MN',
      postalCode: '55001',
    },
  },
  {
    providerId: PROVIDER_IDS.NORTHSTAR_DIAGNOSTICS,
    npi: '1000000002',
    name: 'Northstar Diagnostics',
    providerType: 'LABORATORY',
    networkStatus: 'IN_NETWORK',
    taxIdMasked: '**-***1002',
    address: {
      city: 'Example Heights',
      state: 'MN',
      postalCode: '55003',
    },
  },
  {
    providerId: PROVIDER_IDS.CENTRAL_OUTPATIENT_CENTER,
    npi: '1000000003',
    name: 'Central Outpatient Center',
    providerType: 'OUTPATIENT_FACILITY',
    networkStatus: 'OUT_OF_NETWORK',
    taxIdMasked: '**-***1003',
    address: {
      city: 'Example Heights',
      state: 'MN',
      postalCode: '55004',
    },
  },
]);

export const SERVICE_LINES = deepFreeze([
  {
    serviceLineId: 'SL-CL2024001-1',
    claimNumber: CLAIM_NUMBERS.JOHN_OFFICE_VISIT,
    lineNumber: 1,
    serviceDateFrom: '2024-01-15',
    serviceDateTo: '2024-01-15',
    procedureCode: '99213',
    procedureDescription: 'Office visit - demo service line',
    diagnosisCodes: ['Z00.00'],
    units: 1,
    billedAmount: 250,
    allowedAmount: 200,
    discountAmount: 50,
    planPaidAmount: 160,
    memberResponsibilityAmount: 40,
    deductibleAmount: 0,
    copayAmount: 40,
    coinsuranceAmount: 0,
    status: 'PAID',
    reasonCodeIds: [
      REASON_CODE_IDS.CONTRACTUAL_ADJUSTMENT,
      REASON_CODE_IDS.MEMBER_COPAY,
    ],
  },
  {
    serviceLineId: 'SL-CL2024002-1',
    claimNumber: CLAIM_NUMBERS.JANE_OUTPATIENT_REVIEW,
    lineNumber: 1,
    serviceDateFrom: '2024-01-16',
    serviceDateTo: '2024-01-16',
    procedureCode: '71046',
    procedureDescription: 'Diagnostic imaging - demo service line',
    diagnosisCodes: ['R05.9'],
    units: 1,
    billedAmount: 420,
    allowedAmount: 300,
    discountAmount: 120,
    planPaidAmount: 240,
    memberResponsibilityAmount: 60,
    deductibleAmount: 60,
    copayAmount: 0,
    coinsuranceAmount: 0,
    status: 'PAID',
    reasonCodeIds: [
      REASON_CODE_IDS.CONTRACTUAL_ADJUSTMENT,
      REASON_CODE_IDS.MEMBER_DEDUCTIBLE,
    ],
  },
  {
    serviceLineId: 'SL-CL2024003-1',
    claimNumber: CLAIM_NUMBERS.JOHN_DENIED_LAB,
    lineNumber: 1,
    serviceDateFrom: '2024-01-17',
    serviceDateTo: '2024-01-17',
    procedureCode: '80053',
    procedureDescription: 'Laboratory panel - demo denied service',
    diagnosisCodes: ['Z13.9'],
    units: 1,
    billedAmount: 175,
    allowedAmount: 0,
    discountAmount: 0,
    planPaidAmount: 0,
    memberResponsibilityAmount: 0,
    deductibleAmount: 0,
    copayAmount: 0,
    coinsuranceAmount: 0,
    status: 'DENIED',
    reasonCodeIds: [REASON_CODE_IDS.NOT_COVERED],
  },
  {
    serviceLineId: 'SL-CL2024004-1',
    claimNumber: CLAIM_NUMBERS.JANE_MANUAL_REVIEW,
    lineNumber: 1,
    serviceDateFrom: '2024-01-18',
    serviceDateTo: '2024-01-18',
    procedureCode: '27447',
    procedureDescription: 'High-value procedure - demo review line',
    diagnosisCodes: ['M17.10'],
    units: 1,
    billedAmount: 25000,
    allowedAmount: 18000,
    discountAmount: 7000,
    planPaidAmount: 14400,
    memberResponsibilityAmount: 3600,
    deductibleAmount: 1000,
    copayAmount: 0,
    coinsuranceAmount: 2600,
    status: 'PENDING_REVIEW',
    reasonCodeIds: [REASON_CODE_IDS.INFORMATION_ONLY],
  },
  {
    serviceLineId: 'SL-CL2020001-1',
    claimNumber: CLAIM_NUMBERS.JOHN_EXPIRED_RETENTION,
    lineNumber: 1,
    serviceDateFrom: '2020-01-10',
    serviceDateTo: '2020-01-10',
    procedureCode: '99212',
    procedureDescription: 'Historical office visit - retention example',
    diagnosisCodes: ['Z00.00'],
    units: 1,
    billedAmount: 120,
    allowedAmount: 90,
    discountAmount: 30,
    planPaidAmount: 72,
    memberResponsibilityAmount: 18,
    deductibleAmount: 0,
    copayAmount: 18,
    coinsuranceAmount: 0,
    status: 'PAID',
    reasonCodeIds: [
      REASON_CODE_IDS.CONTRACTUAL_ADJUSTMENT,
      REASON_CODE_IDS.MEMBER_COPAY,
    ],
  },
  {
    serviceLineId: 'SL-CL2024999-1',
    claimNumber: CLAIM_NUMBERS.JANE_RESTRICTED,
    lineNumber: 1,
    serviceDateFrom: '2024-01-19',
    serviceDateTo: '2024-01-19',
    procedureCode: '90834',
    procedureDescription: 'Restricted demo service line',
    diagnosisCodes: ['Z71.9'],
    units: 1,
    billedAmount: 200,
    allowedAmount: 150,
    discountAmount: 50,
    planPaidAmount: 120,
    memberResponsibilityAmount: 30,
    deductibleAmount: 0,
    copayAmount: 30,
    coinsuranceAmount: 0,
    status: 'PAID',
    reasonCodeIds: [
      REASON_CODE_IDS.CONTRACTUAL_ADJUSTMENT,
      REASON_CODE_IDS.MEMBER_COPAY,
    ],
  },
]);

export const CLAIMS = deepFreeze([
  {
    claimNumber: CLAIM_NUMBERS.JOHN_OFFICE_VISIT,
    memberId: MEMBER_IDS.JOHN_DOE,
    coverageId: COVERAGE_IDS.JOHN_ACTIVE,
    providerId: PROVIDER_IDS.LAKESIDE_FAMILY_MEDICINE,
    claimType: 'PROFESSIONAL',
    status: 'PROCESSED',
    receivedDate: '2024-01-16',
    processedDate: '2024-01-20',
    serviceDateFrom: '2024-01-15',
    serviceDateTo: '2024-01-15',
    billedAmount: 250,
    allowedAmount: 200,
    discountAmount: 50,
    planPaidAmount: 160,
    memberResponsibilityAmount: 40,
    paymentReference: 'PAY-DEMO-0001',
    eligibleForReprint: true,
    documentTypes: ['EOB', 'EOR'],
    serviceLineIds: ['SL-CL2024001-1'],
    sourceSystem: 'CLAIMS_REPLICA',
    lastUpdatedAt: '2024-01-20T15:30:00.000Z',
  },
  {
    claimNumber: CLAIM_NUMBERS.JANE_OUTPATIENT_REVIEW,
    memberId: MEMBER_IDS.JANE_SMITH,
    coverageId: COVERAGE_IDS.JANE_ACTIVE,
    providerId: PROVIDER_IDS.CENTRAL_OUTPATIENT_CENTER,
    claimType: 'INSTITUTIONAL',
    status: 'PROCESSED',
    receivedDate: '2024-01-17',
    processedDate: '2024-01-21',
    serviceDateFrom: '2024-01-16',
    serviceDateTo: '2024-01-16',
    billedAmount: 420,
    allowedAmount: 300,
    discountAmount: 120,
    planPaidAmount: 240,
    memberResponsibilityAmount: 60,
    paymentReference: 'PAY-DEMO-0002',
    eligibleForReprint: true,
    documentTypes: ['EOR'],
    serviceLineIds: ['SL-CL2024002-1'],
    sourceSystem: 'CLAIMS_REPLICA',
    lastUpdatedAt: '2024-01-21T16:00:00.000Z',
  },
  {
    claimNumber: CLAIM_NUMBERS.JOHN_DENIED_LAB,
    memberId: MEMBER_IDS.JOHN_DOE,
    coverageId: COVERAGE_IDS.JOHN_ACTIVE,
    providerId: PROVIDER_IDS.NORTHSTAR_DIAGNOSTICS,
    claimType: 'PROFESSIONAL',
    status: 'DENIED',
    receivedDate: '2024-01-18',
    processedDate: '2024-01-21',
    serviceDateFrom: '2024-01-17',
    serviceDateTo: '2024-01-17',
    billedAmount: 175,
    allowedAmount: 0,
    discountAmount: 0,
    planPaidAmount: 0,
    memberResponsibilityAmount: 0,
    paymentReference: null,
    eligibleForReprint: true,
    documentTypes: ['EOB'],
    serviceLineIds: ['SL-CL2024003-1'],
    sourceSystem: 'CLAIMS_REPLICA',
    lastUpdatedAt: '2024-01-21T17:00:00.000Z',
  },
  {
    claimNumber: CLAIM_NUMBERS.JANE_MANUAL_REVIEW,
    memberId: MEMBER_IDS.JANE_SMITH,
    coverageId: COVERAGE_IDS.JANE_ACTIVE,
    providerId: PROVIDER_IDS.CENTRAL_OUTPATIENT_CENTER,
    claimType: 'INSTITUTIONAL',
    status: 'PENDING_REVIEW',
    receivedDate: '2024-01-19',
    processedDate: null,
    serviceDateFrom: '2024-01-18',
    serviceDateTo: '2024-01-18',
    billedAmount: 25000,
    allowedAmount: 18000,
    discountAmount: 7000,
    planPaidAmount: 14400,
    memberResponsibilityAmount: 3600,
    paymentReference: null,
    eligibleForReprint: false,
    documentTypes: [],
    serviceLineIds: ['SL-CL2024004-1'],
    sourceSystem: 'CLAIMS_REPLICA',
    lastUpdatedAt: '2024-01-22T09:00:00.000Z',
  },
  {
    claimNumber: CLAIM_NUMBERS.JOHN_EXPIRED_RETENTION,
    memberId: MEMBER_IDS.JOHN_DOE,
    coverageId: COVERAGE_IDS.JOHN_HISTORICAL,
    providerId: PROVIDER_IDS.LAKESIDE_FAMILY_MEDICINE,
    claimType: 'PROFESSIONAL',
    status: 'PROCESSED',
    receivedDate: '2020-01-11',
    processedDate: '2020-01-15',
    serviceDateFrom: '2020-01-10',
    serviceDateTo: '2020-01-10',
    billedAmount: 120,
    allowedAmount: 90,
    discountAmount: 30,
    planPaidAmount: 72,
    memberResponsibilityAmount: 18,
    paymentReference: 'PAY-DEMO-LEGACY-0001',
    eligibleForReprint: false,
    documentTypes: ['EOB'],
    serviceLineIds: ['SL-CL2020001-1'],
    sourceSystem: 'CLAIMS_ARCHIVE',
    lastUpdatedAt: '2020-01-15T12:00:00.000Z',
  },
  {
    claimNumber: CLAIM_NUMBERS.JANE_RESTRICTED,
    memberId: MEMBER_IDS.JANE_SMITH,
    coverageId: COVERAGE_IDS.JANE_ACTIVE,
    providerId: PROVIDER_IDS.LAKESIDE_FAMILY_MEDICINE,
    claimType: 'PROFESSIONAL',
    status: 'PROCESSED',
    receivedDate: '2024-01-20',
    processedDate: '2024-01-22',
    serviceDateFrom: '2024-01-19',
    serviceDateTo: '2024-01-19',
    billedAmount: 200,
    allowedAmount: 150,
    discountAmount: 50,
    planPaidAmount: 120,
    memberResponsibilityAmount: 30,
    paymentReference: 'PAY-DEMO-0999',
    eligibleForReprint: true,
    documentTypes: ['EOB', 'EOR'],
    serviceLineIds: ['SL-CL2024999-1'],
    sourceSystem: 'CLAIMS_REPLICA',
    lastUpdatedAt: '2024-01-22T10:00:00.000Z',
  },
]);

export const REASON_CODES = deepFreeze([
  {
    reasonCodeId: REASON_CODE_IDS.CONTRACTUAL_ADJUSTMENT,
    groupCode: 'CO',
    code: '45',
    shortLabel: 'Contractual adjustment',
    description:
      'Fictional adjustment showing the difference between billed and allowed amounts.',
    memberLiability: false,
  },
  {
    reasonCodeId: REASON_CODE_IDS.MEMBER_DEDUCTIBLE,
    groupCode: 'PR',
    code: '1',
    shortLabel: 'Deductible',
    description:
      'Fictional amount applied to the member deductible.',
    memberLiability: true,
  },
  {
    reasonCodeId: REASON_CODE_IDS.MEMBER_COPAY,
    groupCode: 'PR',
    code: '3',
    shortLabel: 'Copayment',
    description:
      'Fictional copayment assigned to the member.',
    memberLiability: true,
  },
  {
    reasonCodeId: REASON_CODE_IDS.DUPLICATE_SERVICE,
    groupCode: 'CO',
    code: '18',
    shortLabel: 'Duplicate service',
    description:
      'Fictional denial because the service duplicates a previously processed line.',
    memberLiability: false,
  },
  {
    reasonCodeId: REASON_CODE_IDS.NOT_COVERED,
    groupCode: 'CO',
    code: '96',
    shortLabel: 'Non-covered service',
    description:
      'Fictional denial because the service is not covered in this demonstration.',
    memberLiability: false,
  },
  {
    reasonCodeId: REASON_CODE_IDS.INFORMATION_ONLY,
    groupCode: 'N',
    code: '620',
    shortLabel: 'Information only',
    description:
      'Fictional informational message used by the manual-review scenario.',
    memberLiability: false,
  },
]);

export const RESTRICTIONS = deepFreeze([
  {
    restrictionId: 'RST-RETENTION-CL2020001',
    restrictionType: 'RETENTION',
    claimNumber: CLAIM_NUMBERS.JOHN_EXPIRED_RETENTION,
    memberId: MEMBER_IDS.JOHN_DOE,
    allowedRoles: [],
    blockedActions: ['DOCUMENT_VIEW', 'DOCUMENT_DOWNLOAD', 'REPRINT_REQUEST'],
    reasonCode: 'RETENTION_PERIOD_EXPIRED',
    message:
      'The fictional claim is outside the configured document retention period.',
    active: true,
  },
  {
    restrictionId: 'RST-ACCESS-CL2024999',
    restrictionType: 'ROLE_ACCESS',
    claimNumber: CLAIM_NUMBERS.JANE_RESTRICTED,
    memberId: MEMBER_IDS.JANE_SMITH,
    allowedRoles: ['ADMIN', 'BOS'],
    blockedActions: ['DOCUMENT_VIEW', 'DOCUMENT_DOWNLOAD', 'REPRINT_REQUEST'],
    reasonCode: 'CLAIM_ACCESS_RESTRICTED',
    message:
      'The fictional claim requires an authorized operations role.',
    active: true,
  },
  {
    restrictionId: 'RST-REVIEW-CL2024004',
    restrictionType: 'CLAIM_STATE',
    claimNumber: CLAIM_NUMBERS.JANE_MANUAL_REVIEW,
    memberId: MEMBER_IDS.JANE_SMITH,
    allowedRoles: ['ADMIN', 'BOS'],
    blockedActions: ['DOCUMENT_DOWNLOAD', 'REPRINT_REQUEST'],
    reasonCode: 'CLAIM_NOT_FINALIZED',
    message:
      'Documents cannot be generated until the fictional claim review is complete.',
    active: true,
  },
]);

export const VALIDATION_CASES = deepFreeze([
  {
    caseId: 'VALID-CLEAN-CLAIM',
    name: 'Valid member and claim',
    claimNumber: CLAIM_NUMBERS.JOHN_OFFICE_VISIT,
    memberId: MEMBER_IDS.JOHN_DOE,
    requestType: 'BOTH',
    expectedValid: true,
    expectedRuleId: null,
    expectedCode: null,
  },
  {
    caseId: 'VALID-EOR-ONLY',
    name: 'Valid EOR-only claim',
    claimNumber: CLAIM_NUMBERS.JANE_OUTPATIENT_REVIEW,
    memberId: MEMBER_IDS.JANE_SMITH,
    requestType: 'EOR',
    expectedValid: true,
    expectedRuleId: null,
    expectedCode: null,
  },
  {
    caseId: 'INVALID-MISSING-CLAIM',
    name: 'Claim does not exist',
    claimNumber: 'CL9999999',
    memberId: MEMBER_IDS.JOHN_DOE,
    requestType: 'EOB',
    expectedValid: false,
    expectedRuleId: 'CLAIM_EXISTS',
    expectedCode: 'CLAIM_NOT_FOUND',
  },
  {
    caseId: 'INVALID-MISSING-MEMBER',
    name: 'Member does not exist',
    claimNumber: CLAIM_NUMBERS.JOHN_OFFICE_VISIT,
    memberId: '000000000',
    requestType: 'EOB',
    expectedValid: false,
    expectedRuleId: 'MEMBER_EXISTS',
    expectedCode: 'MEMBER_NOT_FOUND',
  },
  {
    caseId: 'INVALID-MEMBER-CLAIM-MISMATCH',
    name: 'Claim belongs to another member',
    claimNumber: CLAIM_NUMBERS.JOHN_OFFICE_VISIT,
    memberId: MEMBER_IDS.JANE_SMITH,
    requestType: 'EOB',
    expectedValid: false,
    expectedRuleId: 'MEMBER_CLAIM_MATCH',
    expectedCode: 'MEMBER_CLAIM_MISMATCH',
  },
  {
    caseId: 'INVALID-RETENTION',
    name: 'Claim is outside retention period',
    claimNumber: CLAIM_NUMBERS.JOHN_EXPIRED_RETENTION,
    memberId: MEMBER_IDS.JOHN_DOE,
    requestType: 'EOB',
    expectedValid: false,
    expectedRuleId: 'RETENTION_ELIGIBLE',
    expectedCode: 'RETENTION_PERIOD_EXPIRED',
  },
  {
    caseId: 'INVALID-RESTRICTED-CSR',
    name: 'CSR cannot access restricted claim',
    claimNumber: CLAIM_NUMBERS.JANE_RESTRICTED,
    memberId: MEMBER_IDS.JANE_SMITH,
    requestType: 'BOTH',
    requestedByRole: 'CSR',
    expectedValid: false,
    expectedRuleId: 'CSR_ACCESS_ALLOWED',
    expectedCode: 'CLAIM_ACCESS_RESTRICTED',
  },
  {
    caseId: 'MANUAL-REVIEW-AMOUNT',
    name: 'High-value claim requires manual review',
    claimNumber: CLAIM_NUMBERS.JANE_MANUAL_REVIEW,
    memberId: MEMBER_IDS.JANE_SMITH,
    requestType: 'EOB',
    expectedValid: false,
    expectedRuleId: 'MANUAL_REVIEW_THRESHOLD',
    expectedCode: 'MANUAL_REVIEW_REQUIRED',
  },
]);

export const LOCAL_DATA_LAKE_FIXTURE = deepFreeze({
  source: 'LOCAL_DATA_LAKE',
  simulated: true,
  asOf: FIXTURE_TIMESTAMP,
  members: MEMBERS,
  coverages: COVERAGES,
  providers: PROVIDERS,
  claims: CLAIMS,
  serviceLines: SERVICE_LINES,
  reasonCodes: REASON_CODES,
  restrictions: RESTRICTIONS,
});

export const LOCAL_REPLICA_FIXTURE = deepFreeze({
  source: 'LOCAL_CLAIMS_REPLICA',
  simulated: true,
  asOf: FIXTURE_TIMESTAMP,
  replicationStatus: 'CURRENT',
  lastReplicatedAt: '2024-01-22T00:00:00.000Z',
  claims: CLAIMS.filter(
    (claim) => claim.sourceSystem === 'CLAIMS_REPLICA',
  ),
  serviceLines: SERVICE_LINES.filter(
    (line) =>
      line.claimNumber !== CLAIM_NUMBERS.JOHN_EXPIRED_RETENTION,
  ),
});

export const MEMBERS_BY_ID = deepFreeze(
  Object.fromEntries(MEMBERS.map((member) => [member.memberId, member])),
);

export const COVERAGES_BY_ID = deepFreeze(
  Object.fromEntries(
    COVERAGES.map((coverage) => [coverage.coverageId, coverage]),
  ),
);

export const PROVIDERS_BY_ID = deepFreeze(
  Object.fromEntries(
    PROVIDERS.map((provider) => [provider.providerId, provider]),
  ),
);

export const CLAIMS_BY_NUMBER = deepFreeze(
  Object.fromEntries(
    CLAIMS.map((claim) => [claim.claimNumber, claim]),
  ),
);

export const SERVICE_LINES_BY_CLAIM = deepFreeze(
  Object.fromEntries(
    CLAIMS.map((claim) => [
      claim.claimNumber,
      SERVICE_LINES.filter(
        (line) => line.claimNumber === claim.claimNumber,
      ),
    ]),
  ),
);

export const REASON_CODES_BY_ID = deepFreeze(
  Object.fromEntries(
    REASON_CODES.map((reason) => [reason.reasonCodeId, reason]),
  ),
);

export const JOHN_DOE = MEMBERS_BY_ID[MEMBER_IDS.JOHN_DOE];
export const JANE_SMITH = MEMBERS_BY_ID[MEMBER_IDS.JANE_SMITH];

export const CL2024001 =
  CLAIMS_BY_NUMBER[CLAIM_NUMBERS.JOHN_OFFICE_VISIT];
export const CL2024002 =
  CLAIMS_BY_NUMBER[CLAIM_NUMBERS.JANE_OUTPATIENT_REVIEW];
export const CL2024003 =
  CLAIMS_BY_NUMBER[CLAIM_NUMBERS.JOHN_DENIED_LAB];
export const CL2024004 =
  CLAIMS_BY_NUMBER[CLAIM_NUMBERS.JANE_MANUAL_REVIEW];
export const CL2020001 =
  CLAIMS_BY_NUMBER[CLAIM_NUMBERS.JOHN_EXPIRED_RETENTION];
export const CL2024999 =
  CLAIMS_BY_NUMBER[CLAIM_NUMBERS.JANE_RESTRICTED];

export const MEMBER_FIXTURES = MEMBERS;
export const COVERAGE_FIXTURES = COVERAGES;
export const PROVIDER_FIXTURES = PROVIDERS;
export const CLAIM_FIXTURES = CLAIMS;
export const SERVICE_LINE_FIXTURES = SERVICE_LINES;
export const REASON_CODE_FIXTURES = REASON_CODES;
export const RESTRICTION_FIXTURES = RESTRICTIONS;
export const VALIDATION_CASE_FIXTURES = VALIDATION_CASES;
export const CLAIM_VALIDATION_CASES = VALIDATION_CASES;
export const DATA_LAKE_FIXTURE = LOCAL_DATA_LAKE_FIXTURE;
export const REPLICA_FIXTURE = LOCAL_REPLICA_FIXTURE;
export const LOCAL_DATA_LAKE = LOCAL_DATA_LAKE_FIXTURE;
export const LOCAL_REPLICA = LOCAL_REPLICA_FIXTURE;

const MEMBERS_CLAIMS_FIXTURES = deepFreeze({
  members: MEMBERS,
  coverages: COVERAGES,
  providers: PROVIDERS,
  claims: CLAIMS,
  serviceLines: SERVICE_LINES,
  reasonCodes: REASON_CODES,
  restrictions: RESTRICTIONS,
  validationCases: VALIDATION_CASES,
  dataLake: LOCAL_DATA_LAKE_FIXTURE,
  replica: LOCAL_REPLICA_FIXTURE,
});

export default MEMBERS_CLAIMS_FIXTURES;