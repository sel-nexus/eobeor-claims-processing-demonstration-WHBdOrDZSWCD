import {
  SEEDED_ACCOUNTS,
} from '../../fixtures/accounts.js';
import {
  DOCUMENT_ARTIFACT_KEYS,
  DOCUMENT_ARTIFACT_MANIFEST,
  DOCUMENT_AUDIENCES,
  DOCUMENT_DISCLOSURES,
  DOCUMENT_LAYOUTS,
  DOCUMENT_VERSION_DETAILS,
  INITIAL_DOCUMENT_VERSIONS,
  REMITTANCE_ROWS,
} from '../../fixtures/documents.js';
import {
  DISPLAY_TOKEN_REQUIREMENTS,
  REPRESENTATIVE_ARTIFACTS,
} from '../../fixtures/fixtureManifest.js';
import {
  ASSISTANT_SCRIPT_LIST,
  INTEGRATION_INVENTORY_FIXTURE,
  MONITORING_DASHBOARD_FIXTURE,
} from '../../fixtures/insights.js';
import {
  CLAIM_NUMBERS,
  CLAIMS,
  COVERAGES,
  MEMBERS,
  PROVIDERS,
  REASON_CODES,
  SERVICE_LINES,
} from '../../fixtures/membersClaims.js';
import {
  INITIAL_OPERATIONS_ENVELOPE,
} from '../../fixtures/operations.js';
import {
  REQUIRED_DISCLOSURES,
} from '../config/constants.js';
import {
  FixtureIntegrityError,
  REQUIRED_EXACT_FIXTURE_LABELS,
  assertFixtureIntegrity,
  validateFixtures,
} from './fixtureValidator.js';

function indexBy(values, field) {
  return new Map(
    values.map((value) => [value[field], value]),
  );
}

describe('FixtureSchemaValidator', () => {
  it('accepts the canonical fixture baseline without integrity errors', () => {
    const report = validateFixtures();

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.manifestVersion).toBeTruthy();
    expect(Object.isFrozen(report)).toBe(true);
    expect(assertFixtureIntegrity()).toEqual(report);
  });

  it('preserves seed relationships across accounts, claims, services, documents, and operations', () => {
    const membersById = indexBy(MEMBERS, 'memberId');
    const coveragesById = indexBy(COVERAGES, 'coverageId');
    const providersById = indexBy(PROVIDERS, 'providerId');
    const claimsByNumber = indexBy(CLAIMS, 'claimNumber');
    const reasonCodesById = indexBy(
      REASON_CODES,
      'reasonCodeId',
    );
    const requests =
      INITIAL_OPERATIONS_ENVELOPE.requests;

    SEEDED_ACCOUNTS.forEach((account) => {
      if (account.memberId !== null) {
        expect(membersById.has(account.memberId)).toBe(true);
      }
    });

    CLAIMS.forEach((claim) => {
      expect(membersById.has(claim.memberId)).toBe(true);
      expect(coveragesById.has(claim.coverageId)).toBe(true);
      expect(providersById.has(claim.providerId)).toBe(true);
      expect(
        coveragesById.get(claim.coverageId)?.memberId,
      ).toBe(claim.memberId);

      claim.serviceLineIds.forEach((serviceLineId) => {
        const serviceLine = SERVICE_LINES.find(
          (line) => line.serviceLineId === serviceLineId,
        );

        expect(serviceLine?.claimNumber).toBe(
          claim.claimNumber,
        );
      });
    });

    SERVICE_LINES.forEach((line) => {
      expect(claimsByNumber.has(line.claimNumber)).toBe(true);

      line.reasonCodeIds.forEach((reasonCodeId) => {
        expect(reasonCodesById.has(reasonCodeId)).toBe(true);
      });
    });

    INITIAL_DOCUMENT_VERSIONS.forEach((document) => {
      const claim = claimsByNumber.get(document.claimNumber);

      expect(claim).toBeDefined();
      expect(document.memberId).toBe(claim.memberId);
      expect(requests[document.requestId]).toBeDefined();
      expect(
        requests[document.requestId].documentReferences,
      ).toContain(document.documentId);
    });
  });

  it('keeps the required fictional claim scenarios in the seed', () => {
    const claimNumbers = new Set(
      CLAIMS.map((claim) => claim.claimNumber),
    );

    expect(claimNumbers).toEqual(
      new Set(Object.values(CLAIM_NUMBERS)),
    );
    expect(claimNumbers).toEqual(
      expect.objectContaining({
        size: 6,
      }),
    );
    expect(claimNumbers).toContain('CL2024001');
    expect(claimNumbers).toContain('CL2024002');
    expect(claimNumbers).toContain('CL2024003');
    expect(claimNumbers).toContain('CL2024004');
    expect(claimNumbers).toContain('CL2020001');
    expect(claimNumbers).toContain('CL2024999');
  });

  it('keeps EOB and EOR financial totals balanced and aligned with the source claim', () => {
    const sourceClaim = CLAIMS.find(
      (claim) => claim.claimNumber === 'CL2024001',
    );
    const documents = DOCUMENT_VERSION_DETAILS.filter(
      (document) =>
        [
          'DOC-EOB-CL2024001-V1',
          'DOC-EOR-CL2024001-V1',
        ].includes(document.documentId),
    );

    expect(sourceClaim).toBeDefined();
    expect(documents).toHaveLength(2);

    documents.forEach((document) => {
      expect(document.billedAmount).toBe(250);
      expect(document.discountAmount).toBe(50);
      expect(document.allowedAmount).toBe(200);
      expect(document.planPaidAmount).toBe(160);
      expect(document.memberResponsibilityAmount).toBe(40);
      expect(
        document.billedAmount - document.discountAmount,
      ).toBe(document.allowedAmount);
      expect(
        document.planPaidAmount +
          document.memberResponsibilityAmount,
      ).toBe(document.allowedAmount);

      expect(document.billedAmount).toBe(
        sourceClaim.billedAmount,
      );
      expect(document.discountAmount).toBe(
        sourceClaim.discountAmount,
      );
      expect(document.allowedAmount).toBe(
        sourceClaim.allowedAmount,
      );
      expect(document.planPaidAmount).toBe(
        sourceClaim.planPaidAmount,
      );
      expect(document.memberResponsibilityAmount).toBe(
        sourceClaim.memberResponsibilityAmount,
      );
    });
  });

  it('preserves exact EOB, EOR, disclosure, monitoring, and integration labels', () => {
    const displayTokens = new Map(
      DISPLAY_TOKEN_REQUIREMENTS.map((requirement) => [
        requirement.tokenId,
        requirement.token,
      ]),
    );

    expect(DOCUMENT_LAYOUTS.EOB.title).toBe(
      REQUIRED_EXACT_FIXTURE_LABELS.EOB_TITLE,
    );
    expect(DOCUMENT_LAYOUTS.EOR.title).toBe(
      REQUIRED_EXACT_FIXTURE_LABELS.EOR_TITLE,
    );
    expect(DOCUMENT_LAYOUTS.EOR_REMITTANCE.subtitle).toBe(
      REQUIRED_EXACT_FIXTURE_LABELS.REMITTANCE_SUBTITLE,
    );
    expect(
      displayTokens.get('REPRESENTATIVE_DOCUMENT'),
    ).toBe(
      REQUIRED_EXACT_FIXTURE_LABELS.REPRESENTATIVE_DOCUMENT,
    );
    expect(ASSISTANT_SCRIPT_LIST).toHaveLength(5);
    expect(
      ASSISTANT_SCRIPT_LIST.every(
        (script) =>
          script.disclosure ===
          REQUIRED_EXACT_FIXTURE_LABELS.SCRIPTED_ASSISTANT_DISCLOSURE,
      ),
    ).toBe(true);
    expect(MONITORING_DASHBOARD_FIXTURE.disclosure).toBe(
      REQUIRED_EXACT_FIXTURE_LABELS.MONITORING_DISCLOSURE,
    );
    expect(INTEGRATION_INVENTORY_FIXTURE.disclosure).toBe(
      REQUIRED_EXACT_FIXTURE_LABELS.INTEGRATION_DISCLOSURE,
    );

    REQUIRED_DISCLOSURES.forEach((disclosure) => {
      expect(DOCUMENT_DISCLOSURES).toContain(disclosure);
    });
  });

  it('isolates the dedicated provider remittance EOR from member EOR versions', () => {
    const memberEorArtifact = DOCUMENT_ARTIFACT_MANIFEST.find(
      (artifact) =>
        artifact.artifactKey ===
        DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
    );
    const remittanceArtifact =
      DOCUMENT_ARTIFACT_MANIFEST.find(
        (artifact) =>
          artifact.artifactKey ===
          DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE,
      );
    const memberEorVersions =
      INITIAL_DOCUMENT_VERSIONS.filter(
        (document) => document.documentType === 'EOR',
      );
    const remittanceMemberIds = new Set(
      REMITTANCE_ROWS.map((row) => row.memberId),
    );

    expect(memberEorArtifact?.audienceScope).toBe(
      DOCUMENT_AUDIENCES.MEMBER,
    );
    expect(remittanceArtifact?.audienceScope).toBe(
      DOCUMENT_AUDIENCES.PROVIDER,
    );
    expect(remittanceArtifact?.artifactKey).not.toBe(
      memberEorArtifact?.artifactKey,
    );
    expect(remittanceArtifact?.assetUrl).not.toBe(
      memberEorArtifact?.assetUrl,
    );
    expect(remittanceMemberIds.size).toBeGreaterThan(1);
    expect(memberEorVersions).toHaveLength(1);
    expect(
      memberEorVersions.every(
        (document) =>
          document.artifactKey ===
          DOCUMENT_ARTIFACT_KEYS.EOR_SAMPLE,
      ),
    ).toBe(true);
    expect(
      memberEorVersions.some(
        (document) =>
          document.artifactKey ===
          DOCUMENT_ARTIFACT_KEYS.EOR_REMITTANCE_SAMPLE,
      ),
    ).toBe(false);
    expect(
      DOCUMENT_VERSION_DETAILS.every(
        (document) =>
          !Object.prototype.hasOwnProperty.call(
            document,
            'remittanceRows',
          ),
      ),
    ).toBe(true);
  });

  it('keeps the representative artifact manifest unique and internally resolvable', () => {
    const artifactKeys = DOCUMENT_ARTIFACT_MANIFEST.map(
      (artifact) => artifact.artifactKey,
    );
    const assetUrls = DOCUMENT_ARTIFACT_MANIFEST.map(
      (artifact) => artifact.assetUrl,
    );
    const filenames = DOCUMENT_ARTIFACT_MANIFEST.map(
      (artifact) => artifact.filename,
    );
    const manifestByKey = indexBy(
      DOCUMENT_ARTIFACT_MANIFEST,
      'artifactKey',
    );

    expect(new Set(artifactKeys).size).toBe(
      artifactKeys.length,
    );
    expect(new Set(assetUrls).size).toBe(assetUrls.length);
    expect(new Set(filenames).size).toBe(filenames.length);
    expect(REPRESENTATIVE_ARTIFACTS).toHaveLength(
      DOCUMENT_ARTIFACT_MANIFEST.length,
    );

    DOCUMENT_ARTIFACT_MANIFEST.forEach((artifact) => {
      expect(artifact.assetUrl).toMatch(
        /^\/documents\/[A-Za-z0-9_.-]+\.pdf$/,
      );
      expect(artifact.filename).toMatch(/\.pdf$/);
      expect(artifact.mediaType).toBe('application/pdf');
      expect(artifact.checksumAlgorithm).toBe('SHA-256');
      expect(artifact.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.representativeOnly).toBe(true);
      expect(artifact.searchableText).toContain(
        'FICTIONAL DEMO DATA',
      );
    });

    INITIAL_DOCUMENT_VERSIONS.forEach((document) => {
      const artifact = manifestByKey.get(
        document.artifactKey,
      );

      expect(artifact).toBeDefined();
      expect(artifact.documentType).toBe(
        document.documentType,
      );
      expect(artifact.audienceScope).toBe(
        DOCUMENT_AUDIENCES.MEMBER,
      );
    });
  });

  it('creates immutable structured errors for failed integrity assertions', () => {
    const errors = [
      {
        code: 'RECORD_COUNT_MISMATCH',
        message: 'A fixture count did not match.',
        path: 'fixtures.CLAIMS',
      },
    ];
    const error = new FixtureIntegrityError(
      'Fixture integrity validation failed.',
      errors,
    );

    errors[0].message = 'Changed after construction';

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('FIXTURE_SCHEMA_INVALID');
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0].message).toBe(
      'A fixture count did not match.',
    );
    expect(Object.isFrozen(error.errors)).toBe(true);
    expect(Object.isFrozen(error.errors[0])).toBe(true);
  });
});