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
  EOR_REMITTANCE_SAMPLE: 'EOR_REMITTANCE_SAMPLE',
});

export const DOCUMENT_AUDIENCES = Object.freeze({
  MEMBER: 'MEMBER',
  PROVIDER: 'PROVIDER',
  OPERATIONS: 'OPERATIONS',
});

export const DOCUMENT_AUDIENCE_SCOPES = deepFreeze({
  MEMBER: {
    scope: DOCUMENT_AUDIENCES.MEMBER,
    label: 'Member document',
    description:
      'Fictional claim explanation intended for the associated demo member and authorized support roles.',
    allowedRoles: ['MEMBER', 'CSR', 'BOS', 'ADMIN'],
    ownershipRequiredForMember: true,
  },
  PROVIDER: {
    scope: DOCUMENT_AUDIENCES.PROVIDER,
    label: 'Provider remittance document',
    description:
      'Fictional remittance data intended for authorized operations demonstrations.',
    allowedRoles: ['BOS', 'ADMIN'],
    ownershipRequiredForMember: false,
  },
  OPERATIONS: {
    scope: DOCUMENT_AUDIENCES.OPERATIONS,
    label: 'Operations-only document',
    description:
      'Fictional document metadata intended for authorized operational support demonstrations.',
    allowedRoles: ['BOS', 'ITS', 'ADMIN'],
    ownershipRequiredForMember: false,
  },
});

export const DOCUMENT_DISCLOSURES = Object.freeze([
  'This is not a bill.',
  'This prepackaged sample uses fictional data and is not an authoritative claim document.',
  'No coverage, payment, or benefit decision is represented by this artifact.',
  'FICTIONAL DEMO DATA - DO NOT USE FOR HEALTHCARE OR PAYMENT DECISIONS',
]);

export const DOCUMENT_DOWNLOAD_NOTICE =
  'Representative demo document generated from a static sample; not an authoritative claim document.';

export const EOB_LAYOUT = deepFreeze({
  layoutId: 'LAYOUT-EOB-001',
  documentType: DOCUMENT_TYPES.EOB,
  title: 'Explanation of Benefits',
  shortTitle: 'EOB',
  audienceScope: DOCUMENT_AUDIENCES.MEMBER,
  pageSize: 'LETTER',
  orientation: 'PORTRAIT',
  version: 1,
  sections: [
    {
      sectionId: 'HEADER',
      label: 'Document header',
      fields: [
        'documentTitle',
        'documentDate',
        'memberName',
        'memberId',
        'claimNumber',
        'version',
      ],
    },
    {
      sectionId: 'CLAIM_SUMMARY',
      label: 'Claim summary',
      fields: [
        'providerName',
        'serviceDateFrom',
        'serviceDateTo',
        'claimStatus',
      ],
    },
    {
      sectionId: 'FINANCIAL_SUMMARY',
      label: 'Financial summary',
      fields: [
        'billedAmount',
        'discountAmount',
        'allowedAmount',
        'planPaidAmount',
        'memberResponsibilityAmount',
      ],
    },
    {
      sectionId: 'SERVICE_DETAILS',
      label: 'Service detail',
      repeatFor: 'serviceLines',
      fields: [
        'procedureDescription',
        'billedAmount',
        'allowedAmount',
        'planPaidAmount',
        'memberResponsibilityAmount',
        'reasonCodes',
      ],
    },
    {
      sectionId: 'APPEAL_RIGHTS',
      label: 'Questions and appeal rights',
      fields: ['summary', 'deadlineDescription', 'instructions'],
    },
    {
      sectionId: 'DISCLOSURES',
      label: 'Demonstration disclosures',
      fields: ['documentNotice', 'requiredDisclosures'],
    },
  ],
});

export const EOR_LAYOUT = deepFreeze({
  layoutId: 'LAYOUT-EOR-001',
  documentType: DOCUMENT_TYPES.EOR,
  title: 'Explanation of Review',
  shortTitle: 'EOR',
  audienceScope: DOCUMENT_AUDIENCES.MEMBER,
  pageSize: 'LETTER',
  orientation: 'PORTRAIT',
  version: 1,
  sections: [
    {
      sectionId: 'HEADER',
      label: 'Document header',
      fields: [
        'documentTitle',
        'documentDate',
        'memberName',
        'memberId',
        'claimNumber',
        'version',
      ],
    },
    {
      sectionId: 'REVIEW_SUMMARY',
      label: 'Review summary',
      fields: [
        'providerName',
        'serviceDateFrom',
        'serviceDateTo',
        'reviewStatus',
      ],
    },
    {
      sectionId: 'FINANCIAL_SUMMARY',
      label: 'Financial summary',
      fields: [
        'billedAmount',
        'discountAmount',
        'allowedAmount',
        'planPaidAmount',
        'memberResponsibilityAmount',
      ],
    },
    {
      sectionId: 'REVIEW_DETAILS',
      label: 'Review detail',
      repeatFor: 'serviceLines',
      fields: [
        'procedureDescription',
        'status',
        'reasonCodes',
        'paymentReference',
      ],
    },
    {
      sectionId: 'APPEAL_RIGHTS',
      label: 'Questions and appeal rights',
      fields: ['summary', 'deadlineDescription', 'instructions'],
    },
    {
      sectionId: 'DISCLOSURES',
      label: 'Demonstration disclosures',
      fields: ['documentNotice', 'requiredDisclosures'],
    },
  ],
});

export const EOR_REMITTANCE_LAYOUT = deepFreeze({
  layoutId: 'LAYOUT-EOR-REMITTANCE-001',
  documentType: DOCUMENT_TYPES.EOR,
  title: 'Explanation of Review',
  subtitle: 'Provider Remittance Sample',
  audienceScope: DOCUMENT_AUDIENCES.PROVIDER,
  pageSize: 'LETTER',
  orientation: 'PORTRAIT',
  version: 1,
  sections: [
    {
      sectionId: 'HEADER',
      label: 'Remittance header',
      fields: ['documentTitle', 'documentDate', 'version'],
    },
    {
      sectionId: 'REMITTANCE_ROWS',
      label: 'Patient remittance rows',
      repeatFor: 'remittanceRows',
      fields: [
        'memberName',
        'memberId',
        'claimNumber',
        'allowedAmount',
        'planPaidAmount',
        'paymentReferenceMasked',
      ],
    },
    {
      sectionId: 'DISCLOSURES',
      label: 'Demonstration disclosures',
      fields: ['documentNotice', 'requiredDisclosures'],
    },
  ],
});

export const DOCUMENT_LAYOUTS = deepFreeze({
  EOB: EOB_LAYOUT,
  EOR: EOR_LAYOUT,
  EOR_REMITTANCE: EOR_REMITTANCE_LAYOUT,
});

export const APPEAL_FIXTURES = deepFreeze([
  {
    appealId: 'APL-CL2024001-EOB',
    claimNumber: 'CL2024001',
    documentType: DOCUMENT_TYPES.EOB,
    available: true,
    decisionType: 'PROCESSED',
    summary:
      'If you disagree with this fictional explanation, you may request a demo review.',
    deadlineDescription:
      'For demonstration only, submit a request within 180 days of the document date.',
    instructions: [
      'Identify the fictional claim number and the item you want reviewed.',
      'Provide a short explanation using demo data only.',
      'Do not submit real medical, identity, or payment information.',
    ],
    contactLabel: 'Demo Member Services',
    contactReference: 'CONTACT-DEMO-MEMBER-SERVICES',
    authoritative: false,
  },
  {
    appealId: 'APL-CL2024001-EOR',
    claimNumber: 'CL2024001',
    documentType: DOCUMENT_TYPES.EOR,
    available: true,
    decisionType: 'REVIEW_COMPLETE',
    summary:
      'If you disagree with this fictional review result, you may request a demo reconsideration.',
    deadlineDescription:
      'For demonstration only, submit a request within 180 days of the document date.',
    instructions: [
      'Reference the fictional claim and review document.',
      'Describe the fictional outcome you want reconsidered.',
      'Do not submit real medical, identity, or payment information.',
    ],
    contactLabel: 'Demo Review Services',
    contactReference: 'CONTACT-DEMO-REVIEW-SERVICES',
    authoritative: false,
  },
  {
    appealId: 'APL-CL2024003-EOB',
    claimNumber: 'CL2024003',
    documentType: DOCUMENT_TYPES.EOB,
    available: true,
    decisionType: 'DENIED',
    summary:
      'The fictional laboratory service was marked non-covered for the denied-claim demonstration.',
    deadlineDescription:
      'For demonstration only, submit a request within 180 days of the fictional decision date.',
    instructions: [
      'Reference reason code CO96 and claim CL2024003.',
      'Explain why the fictional service should be reviewed.',
      'Use only the prepackaged demonstration fixtures.',
    ],
    contactLabel: 'Demo Appeals Unit',
    contactReference: 'CONTACT-DEMO-APPEALS',
    authoritative: false,
  },
]);

export const APPEALS_BY_CLAIM = deepFreeze(
  Object.fromEntries(
    ['CL2024001', 'CL2024003'].map((claimNumber) => [
      claimNumber,
      APPEAL_FIXTURES.filter(
        (appeal) => appeal.claimNumber === claimNumber,
      ),
    ]),
  ),
);

export const REMITTANCE_ROWS = deepFreeze([
  {
    remittanceRowId: 'REM-20240122-001',
    rowNumber: 1,
    memberName: 'John Doe',
    memberId: '123456789',
    claimNumber: 'CL2024001',
    providerId: 'PRV1001',
    providerName: 'Lakeside Family Medicine',
    serviceDate: '2024-01-15',
    billedAmount: 250,
    allowedAmount: 200,
    planPaidAmount: 160,
    memberResponsibilityAmount: 40,
    paymentReferenceMasked: '****0001',
    status: 'PAID',
    audienceScope: DOCUMENT_AUDIENCES.PROVIDER,
  },
  {
    remittanceRowId: 'REM-20240122-002',
    rowNumber: 2,
    memberName: 'Jane Smith',
    memberId: '987654321',
    claimNumber: 'CL2024002',
    providerId: 'PRV1003',
    providerName: 'Central Outpatient Center',
    serviceDate: '2024-01-16',
    billedAmount: 420,
    allowedAmount: 300,
    planPaidAmount: 240,
    memberResponsibilityAmount: 60,
    paymentReferenceMasked: '****0002',
    status: 'PAID',
    audienceScope: DOCUMENT_AUDIENCES.PROVIDER,
  },
]);

export const DOCUMENT_SEARCH_TEXT = deepFreeze({
  EOB_SAMPLE: [
    'Explanation of Benefits',
    'EOB',
    'John Doe',
    '123456789',
    'CL2024001',
    'Lakeside Family Medicine',
    'Office visit - demo service line',
    'Provider billed $250.00',
    'Plan discount $50.00',
    'Plan paid $160.00',
    'Your responsibility $40.00',
    'Processed for demonstration only',
    ...DOCUMENT_DISCLOSURES,
  ].join(' '),
  EOR_SAMPLE: [
    'Explanation of Review',
    'EOR',
    'John Doe',
    '123456789',
    'CL2024001',
    'Lakeside Family Medicine',
    'Office visit - demo service line',
    'Provider billed $250.00',
    'Plan discount $50.00',
    'Plan paid $160.00',
    'Your responsibility $40.00',
    'Processed for demonstration only',
    ...DOCUMENT_DISCLOSURES,
  ].join(' '),
  EOR_REMITTANCE_SAMPLE: [
    'Explanation of Review',
    'Provider Remittance Sample',
    'John Doe',
    '123456789',
    'CL2024001',
    'Jane Smith',
    '987654321',
    'CL2024002',
    'Two fictional patient remittance rows',
    ...DOCUMENT_DISCLOSURES,
  ].join(' '),
});

export const ARTIFACT_CHECKSUMS = deepFreeze({
  EOB_SAMPLE:
    '65f4d3545fd37a1b459548580956c66680494fb52d514396df8b88259f810483',
  EOR_SAMPLE:
    'fb6cc99854a50708dd6935d419cf4785c690e117132678159eb1a503093ac17e',
  EOR_REMITTANCE_SAMPLE:
    '980fa07b24b492d1e37106f9dad10cf7eb6a005e205858f0498b4da9b93aac43',
});

export const DOCUMENT_ARTIFACT_MANIFEST = deepFreeze([
  {
    artifactKey: DOCUMENT_ARTIFACT_KEYS.EOB_SAMPLE,
    documentType: DOCUMENT_TYPES.EOB,
    audienceScope: DOCUMENT_AUDIENCES.MEMBER,
    assetUrl:
      '/documents/EOB_CL2024001_123456789_20240120_v1.pdf',
    filename: 'EOB_CL2024001_123456789_20240120_v1.pdf',
    mediaType: 'application/pdf',
    checksumAlgorithm: 'SHA-256',
    checksum: ARTIFACT_CHECKSUMS.EOB_SAMPLE,
    documentDate: '2024-01-20',
    fixtureVersion: 1,
    representativeOnly: true,
    searchableText: DOCUMENT_SEARCH_TEXT.EOB_SAMPLE,
    downloadNotice: DOCUMENT_DOWNLOAD_NOTICE,
  },
  {
    artifactKey: DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
    documentType: DOCUMENT_TYPES.EOR,
    audienceScope: DOCUMENT_AUDIENCES.MEMBER,
    assetUrl:
      '/documents/EOR_CL2024001_123456789_20240122_v1.pdf',
    filename: 'EOR_CL2024001_123456789_20240122_v1.pdf',
    mediaType: 'application/pdf',
    checksumAlgorithm: 'SHA-256',
    checksum: ARTIFACT_CHECKSUMS.EOR_SAMPLE,
    documentDate: '2024-01-22',
    fixtureVersion: 1,
    representativeOnly: true,
    searchableText: DOCUMENT_SEARCH_TEXT.EOR_SAMPLE,
    downloadNotice: DOCUMENT_DOWNLOAD_NOTICE,
  },
  {
    artifactKey: DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE,
    documentType: DOCUMENT_TYPES.EOR,
    audienceScope: DOCUMENT_AUDIENCES.PROVIDER,
    assetUrl: '/documents/EOR_REMITTANCE_DEMO_20240122_v1.pdf',
    filename: 'EOR_REMITTANCE_DEMO_20240122_v1.pdf',
    mediaType: 'application/pdf',
    checksumAlgorithm: 'SHA-256',
    checksum: ARTIFACT_CHECKSUMS.EOR_REMITTANCE_SAMPLE,
    documentDate: '2024-01-22',
    fixtureVersion: 1,
    representativeOnly: true,
    searchableText: DOCUMENT_SEARCH_TEXT.EOR_REMITTANCE_SAMPLE,
    downloadNotice: DOCUMENT_DOWNLOAD_NOTICE,
  },
]);

export const DOCUMENT_ARTIFACTS_BY_KEY = deepFreeze(
  Object.fromEntries(
    DOCUMENT_ARTIFACT_MANIFEST.map((artifact) => [
      artifact.artifactKey,
      artifact,
    ]),
  ),
);

export const INITIAL_DOCUMENT_VERSIONS = deepFreeze([
  {
    documentId: 'DOC-EOB-CL2024001-V1',
    documentType: DOCUMENT_TYPES.EOB,
    claimNumber: 'CL2024001',
    memberId: '123456789',
    version: 1,
    status: DOCUMENT_STATUSES.COMPLETE,
    documentDate: '2024-01-20',
    artifactKey: DOCUMENT_ARTIFACT_KEYS.EOB_SAMPLE,
    fixtureText: DOCUMENT_SEARCH_TEXT.EOB_SAMPLE,
    createdAt: FIXTURE_TIMESTAMP,
    createdBy: 'system',
    requestId: '10000000-0000-4000-8000-000000000001',
  },
  {
    documentId: 'DOC-EOR-CL2024001-V1',
    documentType: DOCUMENT_TYPES.EOR,
    claimNumber: 'CL2024001',
    memberId: '123456789',
    version: 1,
    status: DOCUMENT_STATUSES.COMPLETE,
    documentDate: '2024-01-22',
    artifactKey: DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
    fixtureText: DOCUMENT_SEARCH_TEXT.EOR_SAMPLE,
    createdAt: FIXTURE_TIMESTAMP,
    createdBy: 'system',
    requestId: '10000000-0000-4000-8000-000000000001',
  },
]);

export const DOCUMENT_VERSION_DETAILS = deepFreeze([
  {
    documentId: 'DOC-EOB-CL2024001-V1',
    layoutId: EOB_LAYOUT.layoutId,
    audienceScope: DOCUMENT_AUDIENCES.MEMBER,
    memberName: 'John Doe',
    providerName: 'Lakeside Family Medicine',
    claimStatus: 'PROCESSED',
    serviceDateFrom: '2024-01-15',
    serviceDateTo: '2024-01-15',
    billedAmount: 250,
    allowedAmount: 200,
    discountAmount: 50,
    planPaidAmount: 160,
    memberResponsibilityAmount: 40,
    appealId: 'APL-CL2024001-EOB',
    documentNotice: DOCUMENT_DISCLOSURES[0],
    requiredDisclosures: DOCUMENT_DISCLOSURES.slice(1),
  },
  {
    documentId: 'DOC-EOR-CL2024001-V1',
    layoutId: EOR_LAYOUT.layoutId,
    audienceScope: DOCUMENT_AUDIENCES.MEMBER,
    memberName: 'John Doe',
    providerName: 'Lakeside Family Medicine',
    reviewStatus: 'COMPLETE',
    serviceDateFrom: '2024-01-15',
    serviceDateTo: '2024-01-15',
    billedAmount: 250,
    allowedAmount: 200,
    discountAmount: 50,
    planPaidAmount: 160,
    memberResponsibilityAmount: 40,
    paymentReferenceMasked: '****0001',
    appealId: 'APL-CL2024001-EOR',
    documentNotice: DOCUMENT_DISCLOSURES[0],
    requiredDisclosures: DOCUMENT_DISCLOSURES.slice(1),
  },
]);

export const DOCUMENT_VERSIONS_BY_ID = deepFreeze(
  Object.fromEntries(
    INITIAL_DOCUMENT_VERSIONS.map((document) => [
      document.documentId,
      document,
    ]),
  ),
);

export const DOCUMENT_VERSION_DETAILS_BY_ID = deepFreeze(
  Object.fromEntries(
    DOCUMENT_VERSION_DETAILS.map((document) => [
      document.documentId,
      document,
    ]),
  ),
);

export const DOCUMENTS_BY_CLAIM = deepFreeze(
  Object.fromEntries(
    [...new Set(
      INITIAL_DOCUMENT_VERSIONS.map((document) => document.claimNumber),
    )].map((claimNumber) => [
      claimNumber,
      INITIAL_DOCUMENT_VERSIONS.filter(
        (document) => document.claimNumber === claimNumber,
      ),
    ]),
  ),
);

export const DOCUMENT_ARTIFACTS = DOCUMENT_ARTIFACT_MANIFEST;
export const ARTIFACT_MANIFEST = DOCUMENT_ARTIFACT_MANIFEST;
export const ARTIFACTS_BY_KEY = DOCUMENT_ARTIFACTS_BY_KEY;
export const ARTIFACTS = DOCUMENT_ARTIFACT_MANIFEST;
export const DOCUMENT_CHECKSUMS = ARTIFACT_CHECKSUMS;
export const DOCUMENT_VERSIONS = INITIAL_DOCUMENT_VERSIONS;
export const INITIAL_VERSIONS = INITIAL_DOCUMENT_VERSIONS;
export const APPEALS = APPEAL_FIXTURES;
export const REMITTANCE_FIXTURES = REMITTANCE_ROWS;
export const SEARCHABLE_DOCUMENT_TEXT = DOCUMENT_SEARCH_TEXT;
export const AUDIENCE_SCOPES = DOCUMENT_AUDIENCE_SCOPES;
export const EOB_LAYOUT_FIXTURE = EOB_LAYOUT;
export const EOR_LAYOUT_FIXTURE = EOR_LAYOUT;
export const REMITTANCE_LAYOUT_FIXTURE = EOR_REMITTANCE_LAYOUT;

const DOCUMENT_FIXTURES = deepFreeze({
  layouts: DOCUMENT_LAYOUTS,
  appeals: APPEAL_FIXTURES,
  remittanceRows: REMITTANCE_ROWS,
  artifactManifest: DOCUMENT_ARTIFACT_MANIFEST,
  artifactChecksums: ARTIFACT_CHECKSUMS,
  initialVersions: INITIAL_DOCUMENT_VERSIONS,
  versionDetails: DOCUMENT_VERSION_DETAILS,
  searchableText: DOCUMENT_SEARCH_TEXT,
  audienceScopes: DOCUMENT_AUDIENCE_SCOPES,
  disclosures: DOCUMENT_DISCLOSURES,
});

export default DOCUMENT_FIXTURES;