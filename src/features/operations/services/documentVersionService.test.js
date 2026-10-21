import {
  DOCUMENT_ARTIFACT_KEYS,
  DOCUMENT_ARTIFACTS_BY_KEY,
  DOCUMENT_AUDIENCES,
  DOCUMENT_LAYOUTS,
  REMITTANCE_ROWS,
} from '../../../fixtures/documents.js';
import {
  CLAIMS,
  COVERAGES,
  MEMBERS,
  PROVIDERS,
  SERVICE_LINES,
} from '../../../fixtures/membersClaims.js';
import {
  INITIAL_OPERATIONS_ENVELOPE,
} from '../../../fixtures/operations.js';
import {
  createStorageGateway,
} from '../../../platform/persistence/storageGateway.js';
import {
  createTestClock,
} from '../../../platform/time/clock.js';
import {
  createOperationsRepository,
} from '../repositories/operationsRepository.js';
import {
  DOCUMENT_VERSION_AUDIT_ACTIONS,
  DOCUMENT_VERSION_SERVICE_ERROR_CODES,
  createDocumentVersionService,
} from './documentVersionService.js';

const BOS_ACTOR = Object.freeze({
  actorId: 'usr_bos',
  userId: 'usr_bos',
  displayName: 'Business Operations Specialist',
  role: 'BOS',
  memberId: null,
});

const CSR_ACTOR = Object.freeze({
  actorId: 'usr_csr',
  userId: 'usr_csr',
  displayName: 'Customer Service Representative',
  role: 'CSR',
  memberId: null,
});

const JOHN_MEMBER_ACTOR = Object.freeze({
  actorId: 'usr_member_john',
  userId: 'usr_member_john',
  displayName: 'John Doe',
  role: 'MEMBER',
  memberId: '123456789',
});

const JANE_MEMBER_ACTOR = Object.freeze({
  actorId: 'usr_member_jane',
  userId: 'usr_member_jane',
  displayName: 'Jane Smith',
  role: 'MEMBER',
  memberId: '987654321',
});

const SECOND_REQUEST_ID =
  '10000000-0000-4000-8000-000000000006';

const activeHarnesses = new Set();
let namespaceSequence = 0;

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(String(key))
        ? values.get(String(key))
        : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
  };
}

function createUuidGenerator(namespace = '90000000') {
  let sequence = 0;

  return () => {
    sequence += 1;

    return `${namespace}-0000-4000-8000-${sequence
      .toString(16)
      .padStart(12, '0')}`;
  };
}

function cloneFixture(value) {
  return JSON.parse(JSON.stringify(value));
}

function createOperationsEnvelope({
  includeSecondRequest = false,
} = {}) {
  const envelope = cloneFixture(
    INITIAL_OPERATIONS_ENVELOPE,
  );
  const officeVisitLine = SERVICE_LINES.find(
    (line) => line.claimNumber === 'CL2024001',
  );
  const searchableProcedureText = [
    officeVisitLine?.procedureCode,
    officeVisitLine?.procedureDescription,
  ]
    .filter(Boolean)
    .join(' ');

  Object.values(envelope.documents).forEach((document) => {
    if (document.claimNumber === 'CL2024001') {
      document.fixtureText =
        `${document.fixtureText} ${searchableProcedureText}`;
    }
  });

  if (includeSecondRequest) {
    envelope.requests[SECOND_REQUEST_ID] = {
      requestId: SECOND_REQUEST_ID,
      displayId: 'REQ-000006',
      claimNumber: 'CL2024001',
      memberId: '123456789',
      requestType: 'BOTH',
      priority: 'NORMAL',
      sourceType: 'REWORK',
      sourceDetail: 'Document version increment test',
      status: 'PENDING',
      createdAt: '2024-01-22T12:00:00.000Z',
      startedAt: null,
      completedAt: null,
      processingTimeMs: null,
      result: null,
      documentReferences: [],
      errorReportId: null,
      currentStep: 'REQUEST',
      faxStatus: 'NOT_REQUESTED',
      requestedBy: BOS_ACTOR.actorId,
      version: 1,
    };
  }

  return envelope;
}

function createFixtureGateway() {
  const membersById = Object.fromEntries(
    MEMBERS.map((member) => [member.memberId, member]),
  );
  const claimsByNumber = Object.fromEntries(
    CLAIMS.map((claim) => [claim.claimNumber, claim]),
  );
  const providersById = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider.providerId,
      provider,
    ]),
  );
  const coveragesById = Object.fromEntries(
    COVERAGES.map((coverage) => [
      coverage.coverageId,
      coverage,
    ]),
  );

  return {
    getSnapshot() {
      return {
        members: MEMBERS,
        membersById,
        claims: CLAIMS,
        claimsByNumber,
        providers: PROVIDERS,
        providersById,
        coverages: COVERAGES,
        coveragesById,
        serviceLines: SERVICE_LINES,
      };
    },
    getClaimByNumber(claimNumber) {
      return claimsByNumber[claimNumber] ?? null;
    },
    getMemberById(memberId) {
      return membersById[memberId] ?? null;
    },
    getProviderById(providerId) {
      return providersById[providerId] ?? null;
    },
    getCoverageById(coverageId) {
      return coveragesById[coverageId] ?? null;
    },
    getServiceLinesByClaim(claimNumber) {
      return SERVICE_LINES.filter(
        (line) => line.claimNumber === claimNumber,
      );
    },
  };
}

function createHarness({
  includeSecondRequest = false,
  permissionDecision = {
    allowed: true,
  },
} = {}) {
  namespaceSequence += 1;

  const clock = createTestClock(
    '2024-01-22T12:00:00.000Z',
  );
  const gateway = createStorageGateway({
    namespace:
      `document-version-service-test-${namespaceSequence}.v1`,
    storage: createMemoryStorage(),
    broadcastChannelFactory: null,
  });
  const repository = createOperationsRepository(gateway, {
    initialEnvelope: createOperationsEnvelope({
      includeSecondRequest,
    }),
    clock,
    idGenerator: createUuidGenerator('91000000'),
  });
  const fixtureGateway = createFixtureGateway();
  const permissionGateway = {
    evaluate: vi.fn(async () => permissionDecision),
  };
  const auditService = {
    append: vi.fn(async (_context, event) => event),
  };
  const service = createDocumentVersionService(repository, {
    fixtureGateway,
    permissionGateway,
    auditService,
    clock,
    idGenerator: createUuidGenerator('92000000'),
  });
  const harness = {
    auditService,
    clock,
    fixtureGateway,
    gateway,
    permissionGateway,
    repository,
    service,
    destroy() {
      gateway.destroy();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
}

afterEach(() => {
  [...activeHarnesses].forEach((harness) => {
    harness.destroy();
  });
});

describe('DocumentVersionService', () => {
  it('preserves the seeded member layouts and segregates the provider remittance layout', () => {
    expect(DOCUMENT_LAYOUTS.EOB).toEqual(
      expect.objectContaining({
        layoutId: 'LAYOUT-EOB-001',
        documentType: 'EOB',
        title: 'Explanation of Benefits',
        audienceScope: DOCUMENT_AUDIENCES.MEMBER,
      }),
    );
    expect(DOCUMENT_LAYOUTS.EOR).toEqual(
      expect.objectContaining({
        layoutId: 'LAYOUT-EOR-001',
        documentType: 'EOR',
        title: 'Explanation of Review',
        audienceScope: DOCUMENT_AUDIENCES.MEMBER,
      }),
    );
    expect(
      DOCUMENT_LAYOUTS.EOB.sections.map(
        (section) => section.sectionId,
      ),
    ).toEqual([
      'HEADER',
      'CLAIM_SUMMARY',
      'FINANCIAL_SUMMARY',
      'SERVICE_DETAILS',
      'APPEAL_RIGHTS',
      'DISCLOSURES',
    ]);
    expect(
      DOCUMENT_LAYOUTS.EOR.sections.map(
        (section) => section.sectionId,
      ),
    ).toEqual([
      'HEADER',
      'REVIEW_SUMMARY',
      'FINANCIAL_SUMMARY',
      'REVIEW_DETAILS',
      'APPEAL_RIGHTS',
      'DISCLOSURES',
    ]);
    expect(
      DOCUMENT_LAYOUTS.EOR_REMITTANCE.audienceScope,
    ).toBe(DOCUMENT_AUDIENCES.PROVIDER);
    expect(
      DOCUMENT_LAYOUTS.EOR_REMITTANCE.subtitle,
    ).toBe('Provider Remittance Sample');
    expect(
      DOCUMENT_ARTIFACTS_BY_KEY[
        DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE
      ].audienceScope,
    ).toBe(DOCUMENT_AUDIENCES.MEMBER);
    expect(
      DOCUMENT_ARTIFACTS_BY_KEY[
        DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE
      ].audienceScope,
    ).toBe(DOCUMENT_AUDIENCES.PROVIDER);
    expect(
      new Set(
        REMITTANCE_ROWS.map((row) => row.memberId),
      ).size,
    ).toBeGreaterThan(1);
  });

  it('opens a CSR preview with member identifiers redacted and safe document metadata retained', async () => {
    const harness = createHarness();
    const result = await harness.service.openDocument(
      {
        documentId: 'DOC-EOB-CL2024001-V1',
      },
      CSR_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(
      expect.objectContaining({
        documentId: 'DOC-EOB-CL2024001-V1',
        documentType: 'EOB',
        documentTitle: 'Explanation of Benefits',
        claimNumber: 'CL2024001',
        memberId: '*****6789',
        representativeOnly: true,
        audienceScope: DOCUMENT_AUDIENCES.MEMBER,
      }),
    );
    expect(result.data.memberId).not.toBe('123456789');
    expect(result.data.details).toEqual(
      expect.objectContaining({
        memberName: 'John Doe',
        providerName: 'Lakeside Family Medicine',
        paymentReferenceMasked: null,
      }),
    );
    expect(result.data.artifact).not.toHaveProperty(
      'assetUrl',
    );
    expect(harness.auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: DOCUMENT_VERSION_AUDIT_ACTIONS.VIEWED,
        entity: {
          type: 'DOCUMENT',
          id: 'DOC-EOB-CL2024001-V1',
        },
      }),
      expect.objectContaining({
        action: DOCUMENT_VERSION_AUDIT_ACTIONS.VIEWED,
        outcome: 'SUCCESS',
      }),
    );
  });

  it('returns the member EOR without exposing provider remittance rows', async () => {
    const harness = createHarness();
    const result = await harness.service.openDocument(
      {
        documentId: 'DOC-EOR-CL2024001-V1',
      },
      JOHN_MEMBER_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        documentId: 'DOC-EOR-CL2024001-V1',
        documentType: 'EOR',
        documentTitle: 'Explanation of Review',
        memberId: '123456789',
        audienceScope: DOCUMENT_AUDIENCES.MEMBER,
      }),
    );
    expect(result.data.layout.layoutId).toBe(
      DOCUMENT_LAYOUTS.EOR.layoutId,
    );
    expect(result.data.layout.layoutId).not.toBe(
      DOCUMENT_LAYOUTS.EOR_REMITTANCE.layoutId,
    );
    expect(result.data.details).not.toHaveProperty(
      'remittanceRows',
    );
    expect(result.data.artifact.artifactKey).toBe(
      DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
    );
    expect(result.data.artifact.artifactKey).not.toBe(
      DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE,
    );
  });

  it('allocates the next immutable EOB and EOR versions for a later BOTH request', async () => {
    const harness = createHarness({
      includeSecondRequest: true,
    });
    const result = await harness.service.createVersions(
      {
        requestId: SECOND_REQUEST_ID,
        documentDate: '2024-01-22',
      },
      BOS_ACTOR,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data.replayed).toBe(false);
    expect(result.data.documents).toHaveLength(2);
    expect(
      result.data.documents.map((document) => ({
        documentType: document.documentType,
        version: document.version,
      })),
    ).toEqual([
      {
        documentType: 'EOB',
        version: 2,
      },
      {
        documentType: 'EOR',
        version: 2,
      },
    ]);
    expect(result.data.documentIds).toEqual([
      'DOC-EOB-CL2024001-V2',
      'DOC-EOR-CL2024001-V2',
    ]);

    const snapshot = harness.repository.getSnapshot();
    const storedRequest =
      snapshot.requests[SECOND_REQUEST_ID];

    expect(storedRequest.documentReferences).toEqual(
      result.data.documentIds,
    );
    expect(
      snapshot.documents['DOC-EOB-CL2024001-V1'].version,
    ).toBe(1);
    expect(
      snapshot.documents['DOC-EOR-CL2024001-V1'].version,
    ).toBe(1);
    expect(
      snapshot.documents['DOC-EOB-CL2024001-V2'].version,
    ).toBe(2);
    expect(
      snapshot.documents['DOC-EOR-CL2024001-V2'].version,
    ).toBe(2);
    expect(
      harness.auditService.append.mock.calls.filter(
        ([context]) =>
          context.action ===
          DOCUMENT_VERSION_AUDIT_ACTIONS.VERSION_CREATED,
      ),
    ).toHaveLength(2);
  });

  it('searches retained document fixture text and CPT values without returning artifact paths', async () => {
    const harness = createHarness();
    const textResult =
      await harness.service.searchDocuments(
        {
          search: 'office visit',
          memberId: '123456789',
          limit: 20,
        },
        JOHN_MEMBER_ACTOR,
      );
    const cptResult =
      await harness.service.searchDocuments(
        {
          search: '99213',
          memberId: '123456789',
          limit: 20,
        },
        JOHN_MEMBER_ACTOR,
      );

    expect(textResult.ok).toBe(true);
    expect(cptResult.ok).toBe(true);
    expect(
      textResult.data.items.map(
        (document) => document.documentId,
      ),
    ).toEqual(
      expect.arrayContaining([
        'DOC-EOB-CL2024001-V1',
        'DOC-EOR-CL2024001-V1',
      ]),
    );
    expect(
      cptResult.data.items.map(
        (document) => document.documentId,
      ),
    ).toEqual(
      expect.arrayContaining([
        'DOC-EOB-CL2024001-V1',
        'DOC-EOR-CL2024001-V1',
      ]),
    );

    [
      ...textResult.data.items,
      ...cptResult.data.items,
    ].forEach((document) => {
      expect(document).not.toHaveProperty('assetUrl');
      expect(document).not.toHaveProperty('artifactKey');
      expect(document).not.toHaveProperty('fixtureText');
    });
  });

  it('denies an unowned member document without disclosing preview details', async () => {
    const harness = createHarness();
    const result = await harness.service.openDocument(
      {
        documentId: 'DOC-EOB-CL2024001-V1',
      },
      JANE_MEMBER_ACTOR,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toEqual(
      expect.objectContaining({
        code:
          DOCUMENT_VERSION_SERVICE_ERROR_CODES.FORBIDDEN,
        message:
          'This demo role cannot access the representative document.',
        fieldErrors: [],
        retryable: false,
      }),
    );
    expect(result).not.toHaveProperty('data');
    expect(harness.permissionGateway.evaluate).not.toHaveBeenCalled();
    expect(harness.auditService.append).not.toHaveBeenCalled();
  });

  it('resolves downloads to the approved static artifact with a safe versioned filename and records an audit', async () => {
    const harness = createHarness();
    const result = await harness.service.downloadDocument(
      {
        documentId: 'DOC-EOR-CL2024001-V1',
      },
      JOHN_MEMBER_ACTOR,
    );
    const artifact =
      DOCUMENT_ARTIFACTS_BY_KEY[
        DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE
      ];

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(
      expect.objectContaining({
        documentId: 'DOC-EOR-CL2024001-V1',
        documentType: 'EOR',
        memberId: '123456789',
        artifactKey: DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
        assetUrl: artifact.assetUrl,
        mediaType: 'application/pdf',
        checksumAlgorithm: 'SHA-256',
        checksum: artifact.checksum,
        representativeOnly: true,
        notice:
          'Representative demo document generated from a static sample; not an authoritative claim document.',
      }),
    );
    expect(result.data.assetUrl).toMatch(
      /^\/documents\/[A-Za-z0-9_.-]+\.pdf$/,
    );
    expect(result.data.filename).toBe(
      'EOR_CL2024001_123456789_20240122_v1.pdf',
    );
    expect(result.data.filename).toMatch(
      /^EOR_CL2024001_123456789_\d{8}_v1\.pdf$/,
    );
    expect(harness.auditService.append).toHaveBeenCalledTimes(1);
    expect(harness.auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action:
          DOCUMENT_VERSION_AUDIT_ACTIONS.DOWNLOAD_REQUESTED,
        entity: {
          type: 'DOCUMENT',
          id: 'DOC-EOR-CL2024001-V1',
        },
      }),
      expect.objectContaining({
        action:
          DOCUMENT_VERSION_AUDIT_ACTIONS.DOWNLOAD_REQUESTED,
        after: expect.objectContaining({
          documentId: 'DOC-EOR-CL2024001-V1',
          artifactKey: DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
          version: 1,
        }),
        outcome: 'SUCCESS',
      }),
    );
  });
});