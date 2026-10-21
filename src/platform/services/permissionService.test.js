import {
  ACCESS_DECISION_REASONS,
  PERMISSION_POLICIES,
  createPermissionService,
} from './permissionService.js';
import {
  ACTIONS,
  ACTION_VALUES,
} from '../contracts/capabilities.js';
import { createTestClock } from '../time/clock.js';

const ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

const ALL_ROLES = Object.freeze([...ROLES]);
const INTERNAL_ROLES = Object.freeze([
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);
const ADMIN_ROLES = Object.freeze(['ADMIN']);
const ADMIN_AND_ITS_ROLES = Object.freeze([
  'ITS',
  'ADMIN',
]);
const BOS_AND_ADMIN_ROLES = Object.freeze([
  'BOS',
  'ADMIN',
]);
const CSR_AND_ADMIN_ROLES = Object.freeze([
  'CSR',
  'ADMIN',
]);
const CLAIM_SUPPORT_ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
]);

const EXPECTED_ACTION_ROLES = Object.freeze({
  [ACTIONS.USER_LIST]: ADMIN_ROLES,
  [ACTIONS.USER_CREATE]: ADMIN_ROLES,
  [ACTIONS.USER_UPDATE]: ADMIN_ROLES,
  [ACTIONS.USER_DELETE]: ADMIN_ROLES,

  [ACTIONS.SETTINGS_VIEW]: ADMIN_AND_ITS_ROLES,
  [ACTIONS.SETTINGS_UPDATE]: ADMIN_AND_ITS_ROLES,
  [ACTIONS.SETTINGS_RESTORE]: ADMIN_ROLES,

  [ACTIONS.SNAPSHOT_EXPORT]: ADMIN_AND_ITS_ROLES,
  [ACTIONS.SNAPSHOT_VALIDATE]: ADMIN_ROLES,
  [ACTIONS.SNAPSHOT_APPLY]: ADMIN_ROLES,
  [ACTIONS.SNAPSHOT_RESTORE_SAMPLE]: ADMIN_ROLES,

  [ACTIONS.AUDIT_VIEW]: ADMIN_AND_ITS_ROLES,
  [ACTIONS.AUDIT_EXPORT]: ADMIN_AND_ITS_ROLES,

  [ACTIONS.MONITORING_VIEW]: ADMIN_AND_ITS_ROLES,
  [ACTIONS.MONITORING_PREFERENCE_UPDATE]:
    ADMIN_AND_ITS_ROLES,

  [ACTIONS.INTEGRATION_INVENTORY_VIEW]:
    ADMIN_AND_ITS_ROLES,

  [ACTIONS.ASSISTANT_RESPOND]: CSR_AND_ADMIN_ROLES,
  [ACTIONS.ASSISTANT_ATTACH_RESPONSE]:
    CSR_AND_ADMIN_ROLES,

  [ACTIONS.EXECUTIVE_INSIGHTS_VIEW]:
    BOS_AND_ADMIN_ROLES,
  [ACTIONS.PRODUCTIVITY_INSIGHTS_VIEW]:
    BOS_AND_ADMIN_ROLES,

  [ACTIONS.COMPLIANCE_STATUS_VIEW]: INTERNAL_ROLES,

  [ACTIONS.PLATFORM_ACCESS_CONTEXT_VIEW]: ALL_ROLES,
  [ACTIONS.PLATFORM_AUDIT_SUMMARY_VIEW]:
    ADMIN_AND_ITS_ROLES,
  [ACTIONS.PLATFORM_SETTINGS_VIEW]:
    ADMIN_AND_ITS_ROLES,

  [ACTIONS.CLAIM_VIEW]: CLAIM_SUPPORT_ROLES,
  [ACTIONS.DOCUMENT_VIEW]: CLAIM_SUPPORT_ROLES,
  [ACTIONS.DOCUMENT_DOWNLOAD]: CLAIM_SUPPORT_ROLES,
  [ACTIONS.REPRINT_REQUEST]: CLAIM_SUPPORT_ROLES,
  [ACTIONS.REPRINT_APPROVE]: BOS_AND_ADMIN_ROLES,
  [ACTIONS.REPRINT_REJECT]: BOS_AND_ADMIN_ROLES,
  [ACTIONS.OPERATIONAL_SUMMARY_VIEW]: INTERNAL_ROLES,
});

const OWNERSHIP_ACTIONS = new Set([
  ACTIONS.CLAIM_VIEW,
  ACTIONS.DOCUMENT_VIEW,
  ACTIONS.DOCUMENT_DOWNLOAD,
  ACTIONS.REPRINT_REQUEST,
]);

function createSession(role, overrides = {}) {
  return {
    sessionId: `session-${role.toLowerCase()}`,
    userId: `user-${role.toLowerCase()}`,
    displayName: `${role} User`,
    role,
    memberId: role === 'MEMBER' ? 'MEMBER-001' : null,
    createdAt: '2024-01-22T12:00:00.000Z',
    lastActivityAt: '2024-01-22T12:00:00.000Z',
    expiresAt: '2024-01-22T12:30:00.000Z',
    ...overrides,
  };
}

function createService(options = {}) {
  return createPermissionService({
    clock: createTestClock('2024-01-22T12:00:00.000Z'),
    ...options,
  });
}

describe('PermissionService', () => {
  it('enforces the exhaustive role matrix for every permission action', async () => {
    expect(Object.keys(EXPECTED_ACTION_ROLES).sort()).toEqual(
      [...ACTION_VALUES].sort(),
    );
    expect(Object.keys(PERMISSION_POLICIES).sort()).toEqual(
      [...ACTION_VALUES].sort(),
    );

    const service = createService();

    for (const action of ACTION_VALUES) {
      const allowedRoles = EXPECTED_ACTION_ROLES[action];

      for (const role of ROLES) {
        const decision = await service.evaluate({
          action,
          session: createSession(role),
          resource: OWNERSHIP_ACTIONS.has(action)
            ? {
                type:
                  action === ACTIONS.CLAIM_VIEW ||
                  action === ACTIONS.REPRINT_REQUEST
                    ? 'CLAIM'
                    : 'DOCUMENT',
                id: 'RESOURCE-001',
                owned: true,
              }
            : {
                type: 'PLATFORM_RESOURCE',
                id: 'RESOURCE-001',
              },
        });
        const expectedAllowed = allowedRoles.includes(role);

        expect(
          decision.allowed,
          `${role} access for ${action}`,
        ).toBe(expectedAllowed);
        expect(decision.action).toBe(action);
        expect(decision.role).toBe(role);
        expect(decision.reasonCode).toBe(
          expectedAllowed
            ? OWNERSHIP_ACTIONS.has(action) &&
              role === 'MEMBER'
              ? ACCESS_DECISION_REASONS.OWNERSHIP_CONFIRMED
              : ACCESS_DECISION_REASONS.ROLE_ALLOWED
            : ACCESS_DECISION_REASONS.ROLE_NOT_ALLOWED,
        );
      }
    }
  });

  it('confirms member ownership through the relationship provider', async () => {
    const isClaimOwnedByMember = vi.fn(() => true);
    const service = createService({
      relationshipProvider: {
        isClaimOwnedByMember,
      },
    });
    const resource = {
      type: 'CLAIM',
      id: 'CL2024001',
      claimNumber: 'CL2024001',
    };

    const decision = await service.evaluate({
      action: ACTIONS.CLAIM_VIEW,
      resource,
      session: createSession('MEMBER'),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: true,
        reasonCode:
          ACCESS_DECISION_REASONS.OWNERSHIP_CONFIRMED,
        action: ACTIONS.CLAIM_VIEW,
        role: 'MEMBER',
      }),
    );
    expect(isClaimOwnedByMember).toHaveBeenCalledTimes(1);
    expect(isClaimOwnedByMember).toHaveBeenCalledWith(
      'MEMBER-001',
      resource,
      expect.objectContaining({
        action: ACTIONS.CLAIM_VIEW,
        session: expect.objectContaining({
          role: 'MEMBER',
          memberId: 'MEMBER-001',
        }),
      }),
    );
  });

  it('denies a member when the relationship provider reports an ownership mismatch', async () => {
    const isDocumentOwnedByMember = vi.fn(() => false);
    const service = createService({
      relationshipProvider: {
        isDocumentOwnedByMember,
      },
    });

    const decision = await service.evaluate({
      action: ACTIONS.DOCUMENT_DOWNLOAD,
      resource: {
        type: 'DOCUMENT',
        id: 'DOC-EOB-001',
        documentId: 'DOC-EOB-001',
      },
      session: createSession('MEMBER'),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: false,
        reasonCode:
          ACCESS_DECISION_REASONS.OWNERSHIP_MISMATCH,
        action: ACTIONS.DOCUMENT_DOWNLOAD,
        role: 'MEMBER',
      }),
    );
    expect(isDocumentOwnedByMember).toHaveBeenCalledTimes(1);
  });

  it('denies a directly mismatched resource without consulting the relationship provider', async () => {
    const isResourceOwnedByMember = vi.fn(() => true);
    const service = createService({
      relationshipProvider: {
        isResourceOwnedByMember,
      },
    });

    const decision = await service.evaluate({
      action: ACTIONS.REPRINT_REQUEST,
      resource: {
        type: 'CLAIM',
        id: 'CL2024002',
        ownerMemberId: 'MEMBER-OTHER',
      },
      session: createSession('MEMBER'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(
      ACCESS_DECISION_REASONS.OWNERSHIP_MISMATCH,
    );
    expect(isResourceOwnedByMember).not.toHaveBeenCalled();
  });

  it('denies ownership-sensitive access when no ownership dependency is available', async () => {
    const service = createService();

    const decision = await service.evaluate({
      action: ACTIONS.DOCUMENT_VIEW,
      resource: {
        type: 'DOCUMENT',
        id: 'DOC-EOB-001',
      },
      session: createSession('MEMBER'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(
      ACCESS_DECISION_REASONS.DEPENDENCY_UNAVAILABLE,
    );
    expect(decision.details).toEqual({
      dependency: 'SEEDED_RELATIONSHIP_PROVIDER',
    });
  });

  it('denies CSR access to restricted claim resources while preserving BOS access', async () => {
    const service = createService();
    const resource = {
      type: 'CLAIM',
      id: 'CL2024999',
      claimNumber: 'CL2024999',
      restricted: true,
    };

    const csrDecision = await service.evaluate({
      action: ACTIONS.CLAIM_VIEW,
      resource,
      session: createSession('CSR'),
    });
    const bosDecision = await service.evaluate({
      action: ACTIONS.CLAIM_VIEW,
      resource,
      session: createSession('BOS'),
    });

    expect(csrDecision).toEqual(
      expect.objectContaining({
        allowed: false,
        reasonCode:
          ACCESS_DECISION_REASONS.RESTRICTED_MEMBER,
        role: 'CSR',
      }),
    );
    expect(bosDecision).toEqual(
      expect.objectContaining({
        allowed: true,
        reasonCode: ACCESS_DECISION_REASONS.ROLE_ALLOWED,
        role: 'BOS',
      }),
    );
  });

  it('honors restriction allowlists for CSR claim access', async () => {
    const service = createService();

    const decision = await service.evaluate({
      action: ACTIONS.DOCUMENT_VIEW,
      resource: {
        type: 'DOCUMENT',
        id: 'DOC-EOB-001',
        restrictions: [
          {
            active: true,
            allowedRoles: ['CSR'],
            blockedActions: [ACTIONS.DOCUMENT_VIEW],
          },
        ],
      },
      session: createSession('CSR'),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe(
      ACCESS_DECISION_REASONS.ROLE_ALLOWED,
    );
  });

  it('keeps user administration and destructive snapshot actions Admin-only', async () => {
    const service = createService();
    const adminOnlyActions = [
      ACTIONS.USER_LIST,
      ACTIONS.USER_CREATE,
      ACTIONS.USER_UPDATE,
      ACTIONS.USER_DELETE,
      ACTIONS.SETTINGS_RESTORE,
      ACTIONS.SNAPSHOT_VALIDATE,
      ACTIONS.SNAPSHOT_APPLY,
      ACTIONS.SNAPSHOT_RESTORE_SAMPLE,
    ];

    for (const action of adminOnlyActions) {
      const adminDecision = await service.evaluate({
        action,
        resource: {
          type: 'ADMINISTRATION',
          id: 'local',
        },
        session: createSession('ADMIN'),
      });

      expect(adminDecision.allowed, action).toBe(true);

      for (const role of ['MEMBER', 'CSR', 'BOS', 'ITS']) {
        const decision = await service.evaluate({
          action,
          resource: {
            type: 'ADMINISTRATION',
            id: 'local',
          },
          session: createSession(role),
        });

        expect(
          decision.allowed,
          `${role} must be denied ${action}`,
        ).toBe(false);
        expect(decision.reasonCode).toBe(
          ACCESS_DECISION_REASONS.ROLE_NOT_ALLOWED,
        );
      }
    }
  });

  it('prohibits ITS from claim operations and CSR from governance or approval actions', async () => {
    const service = createService();
    const itsProhibitedActions = [
      ACTIONS.CLAIM_VIEW,
      ACTIONS.DOCUMENT_VIEW,
      ACTIONS.DOCUMENT_DOWNLOAD,
      ACTIONS.REPRINT_REQUEST,
      ACTIONS.REPRINT_APPROVE,
      ACTIONS.REPRINT_REJECT,
    ];
    const csrProhibitedActions = [
      ACTIONS.USER_LIST,
      ACTIONS.SETTINGS_VIEW,
      ACTIONS.SNAPSHOT_EXPORT,
      ACTIONS.AUDIT_VIEW,
      ACTIONS.MONITORING_VIEW,
      ACTIONS.INTEGRATION_INVENTORY_VIEW,
      ACTIONS.REPRINT_APPROVE,
      ACTIONS.REPRINT_REJECT,
    ];

    for (const action of itsProhibitedActions) {
      const decision = await service.evaluate({
        action,
        resource: {
          type: 'CLAIM',
          id: 'CL2024001',
          owned: true,
        },
        session: createSession('ITS'),
      });

      expect(decision.allowed, `ITS ${action}`).toBe(false);
      expect(decision.reasonCode).toBe(
        ACCESS_DECISION_REASONS.ROLE_NOT_ALLOWED,
      );
    }

    for (const action of csrProhibitedActions) {
      const decision = await service.evaluate({
        action,
        resource: {
          type: 'PLATFORM_RESOURCE',
          id: 'local',
        },
        session: createSession('CSR'),
      });

      expect(decision.allowed, `CSR ${action}`).toBe(false);
      expect(decision.reasonCode).toBe(
        ACCESS_DECISION_REASONS.ROLE_NOT_ALLOWED,
      );
    }
  });

  it('denies missing, expired, invalid, and unknown access requests by default', async () => {
    const service = createService();

    const missingSession = await service.evaluate({
      action: ACTIONS.SETTINGS_VIEW,
      resource: {
        type: 'SETTINGS',
        id: 'global',
      },
      session: null,
    });
    const expiredSession = await service.evaluate({
      action: ACTIONS.SETTINGS_VIEW,
      resource: {
        type: 'SETTINGS',
        id: 'global',
      },
      session: createSession('ADMIN', {
        expiresAt: '2024-01-22T11:59:59.000Z',
      }),
    });
    const unknownAction = await service.evaluate({
      action: 'UNDECLARED_ACTION',
      session: createSession('ADMIN'),
    });
    const invalidRequest = await service.evaluate(null);

    expect(missingSession.reasonCode).toBe(
      ACCESS_DECISION_REASONS.NO_ACTIVE_SESSION,
    );
    expect(expiredSession.reasonCode).toBe(
      ACCESS_DECISION_REASONS.SESSION_EXPIRED,
    );
    expect(unknownAction.reasonCode).toBe(
      ACCESS_DECISION_REASONS.UNKNOWN_ACTION,
    );
    expect(invalidRequest.reasonCode).toBe(
      ACCESS_DECISION_REASONS.INVALID_REQUEST,
    );
    expect(
      [
        missingSession,
        expiredSession,
        unknownAction,
        invalidRequest,
      ].every((decision) => decision.allowed === false),
    ).toBe(true);
  });

  it('throws AccessDeniedError when require receives a denied decision', async () => {
    const service = createService();

    await expect(
      service.require({
        action: ACTIONS.USER_CREATE,
        resource: {
          type: 'USER_COLLECTION',
          id: 'users',
        },
        session: createSession('CSR'),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'AccessDeniedError',
        code: 'ACCESS_DENIED',
        decision: expect.objectContaining({
          allowed: false,
          reasonCode:
            ACCESS_DECISION_REASONS.ROLE_NOT_ALLOWED,
        }),
      }),
    );
  });
});