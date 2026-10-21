import {
  SEEDED_USERS,
} from '../../fixtures/accounts.js';
import {
  INITIAL_OPERATIONS_ENVELOPE,
} from '../../fixtures/operations.js';
import {
  CANONICAL_SEED_BUNDLE,
  INITIAL_SETTINGS,
} from '../../fixtures/seedBundle.js';
import {
  ACTIONS,
} from '../contracts/capabilities.js';
import {
  calculateSnapshotChecksum,
  SNAPSHOT_NOTICE,
} from '../validation/snapshotValidator.js';
import {
  ADMIN_FACADE_ERROR_CODES,
  createAdminFacade,
} from './adminFacade.js';
import {
  AUDIT_EXPORT_NOTICE,
  createAuditFacade,
} from './auditFacade.js';
import {
  SNAPSHOT_CONFIRMATIONS,
  SNAPSHOT_FACADE_ERROR_CODES,
  createSnapshotFacade,
} from './snapshotFacade.js';

const ADMIN_SESSION = Object.freeze({
  sessionId: 'session-admin',
  userId: 'usr_admin',
  displayName: 'Administrator',
  role: 'ADMIN',
  memberId: null,
  createdAt: '2024-01-22T12:00:00.000Z',
  lastActivityAt: '2024-01-22T12:00:00.000Z',
  expiresAt: '2024-01-22T12:30:00.000Z',
});

const ITS_SESSION = Object.freeze({
  sessionId: 'session-its',
  userId: 'usr_its',
  displayName: 'IT Support Specialist',
  role: 'ITS',
  memberId: null,
  createdAt: '2024-01-22T12:00:00.000Z',
  lastActivityAt: '2024-01-22T12:00:00.000Z',
  expiresAt: '2024-01-22T12:30:00.000Z',
});

const FIXED_TIME = '2024-01-22T12:00:00.000Z';

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIdGenerator(prefix = 'test') {
  let sequence = 0;

  return () => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

function createClock() {
  return {
    now() {
      return new Date(FIXED_TIME);
    },
    nowIso() {
      return FIXED_TIME;
    },
  };
}

function createPermissionService({
  session = ADMIN_SESSION,
  deniedActions = [],
} = {}) {
  const denied = new Set(deniedActions);

  return {
    sessionProvider: {
      getSession() {
        return session;
      },
    },
    evaluate: vi.fn(async ({ action }) => ({
      allowed: !denied.has(action),
      role: session.role,
      userId: session.userId,
      reasonCode: denied.has(action)
        ? 'ROLE_NOT_ALLOWED'
        : 'ROLE_ALLOWED',
    })),
  };
}

function createAdminRepositories() {
  let users = cloneValue(SEEDED_USERS);
  let settings = cloneValue(INITIAL_SETTINGS);
  let rootRevision = 1;
  let userSequence = 0;

  const userRepository = {
    query: vi.fn((query = {}) => {
      const items = users.filter((user) => {
        if (
          typeof query.role === 'string' &&
          query.role.length > 0 &&
          user.role !== query.role
        ) {
          return false;
        }

        if (
          typeof query.active === 'boolean' &&
          user.active !== query.active
        ) {
          return false;
        }

        return true;
      });

      return {
        items: cloneValue(items),
        page: 1,
        limit: query.limit ?? 25,
        total: items.length,
        totalPages: items.length === 0 ? 0 : 1,
        revision: rootRevision,
      };
    }),
    getById: vi.fn(
      (userId) =>
        cloneValue(
          users.find((user) => user.userId === userId) ??
            null,
        ),
    ),
    create: vi.fn((value) => {
      if (
        users.some(
          (user) => user.username === value.username,
        )
      ) {
        const error = new Error(
          'A user with this username already exists.',
        );

        error.code = 'USERNAME_EXISTS';
        throw error;
      }

      userSequence += 1;

      const user = {
        ...cloneValue(value),
        userId: `usr_local_${userSequence}`,
        systemSeed: false,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
        revision: 1,
      };

      users.push(user);
      rootRevision += 1;
      return cloneValue(user);
    }),
    update: vi.fn((userId, changes, options) => {
      const index = users.findIndex(
        (user) => user.userId === userId,
      );

      if (index < 0) {
        const error = new Error('User was not found.');

        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      if (users[index].revision !== options.expectedRevision) {
        const error = new Error(
          'User changed before the mutation.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      users[index] = {
        ...users[index],
        ...cloneValue(changes),
        updatedAt: FIXED_TIME,
        revision: users[index].revision + 1,
      };
      rootRevision += 1;

      return cloneValue(users[index]);
    }),
    delete: vi.fn((userId, options) => {
      const index = users.findIndex(
        (user) => user.userId === userId,
      );

      if (index < 0) {
        const error = new Error('User was not found.');

        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      const user = users[index];

      if (user.revision !== options.expectedRevision) {
        const error = new Error(
          'User changed before the mutation.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      if (user.systemSeed) {
        const error = new Error(
          'Seeded users cannot be deleted.',
        );

        error.code = 'SYSTEM_USER_PROTECTED';
        throw error;
      }

      users.splice(index, 1);
      rootRevision += 1;

      return {
        deletedUserId: user.userId,
        deletedRevision: user.revision,
      };
    }),
  };

  const settingsRepository = {
    get: vi.fn(() => cloneValue(settings)),
    update: vi.fn((changes, options) => {
      if (settings.revision !== options.expectedRevision) {
        const error = new Error(
          'Settings changed before the mutation.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      settings = {
        ...settings,
        ...cloneValue(changes),
        revision: settings.revision + 1,
        updatedBy: options.updatedBy,
        updatedAt: FIXED_TIME,
      };
      rootRevision += 1;

      return cloneValue(settings);
    }),
    restore: vi.fn((defaults, options) => {
      if (settings.revision !== options.expectedRevision) {
        const error = new Error(
          'Settings changed before the mutation.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      settings = {
        ...cloneValue(defaults),
        revision: settings.revision + 1,
        updatedBy: options.updatedBy,
        updatedAt: FIXED_TIME,
      };
      rootRevision += 1;

      return cloneValue(settings);
    }),
  };

  return {
    userRepository,
    settingsRepository,
    getUsers() {
      return cloneValue(users);
    },
    getSettings() {
      return cloneValue(settings);
    },
  };
}

function createAdminHarness({
  session = ADMIN_SESSION,
  deniedActions = [],
} = {}) {
  const repositories = createAdminRepositories();
  const permissionService = createPermissionService({
    session,
    deniedActions,
  });
  const auditService = {
    append: vi.fn(async (_context, event) => event),
  };
  const sessionProvider = {
    getSession() {
      return session;
    },
  };
  const facade = createAdminFacade(
    repositories.userRepository,
    {
      settingsRepository: repositories.settingsRepository,
      permissionService,
      auditService,
      sessionProvider,
      defaultSettings: INITIAL_SETTINGS,
      idGenerator: createIdGenerator('admin-correlation'),
    },
  );

  return {
    ...repositories,
    auditService,
    facade,
    permissionService,
  };
}

async function readBlobText(blob) {
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();

    reader.onerror = () => {
      reject(
        reader.error ??
          new Error('The local Blob could not be read.'),
      );
    };
    reader.onload = () => {
      resolve(String(reader.result ?? ''));
    };
    reader.readAsText(blob);
  });
}

function createAuditEvents() {
  return [
    {
      eventId: 'AUDIT-ADMIN-001',
      occurredAt: '2024-01-22T11:59:00.000Z',
      actor: {
        userId: 'usr_admin',
        displayName: 'Administrator',
        role: 'ADMIN',
      },
      action: 'USER_UPDATED',
      entity: {
        type: 'USER',
        id: 'usr_member_john',
      },
      before: {
        memberId: '123456789',
        displayName: 'John Doe',
      },
      after: {
        memberId: '123456789',
        displayName: 'John Example',
        formulaText: '=SUM(1,1)',
      },
      outcome: 'SUCCESS',
      correlationId: 'corr-admin-001',
    },
    {
      eventId: 'AUDIT-MONITORING-001',
      occurredAt: '2024-01-22T11:58:00.000Z',
      actor: {
        userId: 'usr_its',
        displayName: 'IT Support Specialist',
        role: 'ITS',
      },
      action: 'MONITORING_REFRESHED',
      entity: {
        type: 'MONITORING',
        id: 'simulated',
      },
      before: null,
      after: {
        queueDepth: 23,
      },
      outcome: 'SUCCESS',
      correlationId: 'corr-monitoring-001',
    },
  ];
}

function createAuditRepository(events) {
  return {
    query: vi.fn((filters = {}) => {
      const actions = new Set(
        filters.actions ?? [],
      );
      const outcomes = new Set(
        filters.outcomes ?? [],
      );
      const filtered = events.filter((event) => {
        if (
          actions.size > 0 &&
          !actions.has(event.action)
        ) {
          return false;
        }

        if (
          outcomes.size > 0 &&
          !outcomes.has(event.outcome)
        ) {
          return false;
        }

        if (
          typeof filters.actorRole === 'string' &&
          event.actor.role !== filters.actorRole
        ) {
          return false;
        }

        return true;
      });

      return {
        items: cloneValue(filtered),
        page: filters.page ?? 1,
        limit: filters.limit ?? 100,
        total: filtered.length,
        totalPages: filtered.length === 0 ? 0 : 1,
        revision: 7,
        masked: false,
      };
    }),
  };
}

function createPlatformStore(initialSlices = {}) {
  let rootRevision = 3;
  let slices = cloneValue({
    users: SEEDED_USERS,
    settings: INITIAL_SETTINGS,
    operationsEnvelope: INITIAL_OPERATIONS_ENVELOPE,
    ...initialSlices,
  });

  const store = {
    getSnapshot() {
      return {
        schemaVersion: '1.0.0',
        rootRevision,
        persistedRootRevision: rootRevision,
        slices,
        operationsEnvelope:
          slices.operationsEnvelope ?? null,
      };
    },
    getRootRevision() {
      return rootRevision;
    },
    execute: vi.fn((command, options = {}) => {
      if (
        options.expectedRootRevision !== undefined &&
        options.expectedRootRevision !== rootRevision
      ) {
        const error = new Error(
          'Platform state changed before the command.',
        );

        error.code = 'REVISION_CONFLICT';
        throw error;
      }

      const draft = cloneValue(slices);
      const result = command(draft, {
        rootRevision,
      });

      slices = draft;
      rootRevision += 1;
      return result;
    }),
  };

  return store;
}

function createSnapshotCandidate() {
  const base = {
    formatVersion: 1,
    schemaVersion: '1.0.0',
    exportedAt: FIXED_TIME,
    referenceDate: '2024-01-22',
    notice: SNAPSHOT_NOTICE,
    rootRevision: 3,
    fixtureVersion: '1',
    metadata: {
      scope: 'ALL_DEMO_DATA',
      sessionIncluded: false,
      representativeOnly: true,
    },
    slices: {
      operationsEnvelope: cloneValue(
        INITIAL_OPERATIONS_ENVELOPE,
      ),
    },
  };

  return {
    ...base,
    checksumAlgorithm: 'SHA-256',
    sha256: calculateSnapshotChecksum(base, 'SHA-256'),
  };
}

function createSnapshotHarness({
  session = ADMIN_SESSION,
} = {}) {
  const platformStore = createPlatformStore();
  const permissionService = createPermissionService({
    session,
  });
  const participantRegistry = {
    validateAll: vi.fn(async () => ({
      valid: true,
      participantCount: 1,
      participantIds: ['operations'],
      results: [],
      errors: [],
      warnings: [],
    })),
    stageRestore: vi.fn(async () => ({
      stageId: 'snapshot-stage-1',
      participantCount: 1,
      participantIds: ['operations'],
    })),
    commitRestore: vi.fn(async () => ({
      status: 'COMMITTED',
      participantCount: 1,
      participantIds: ['operations'],
    })),
  };
  const facade = createSnapshotFacade(platformStore, {
    permissionService,
    participantRegistry,
    sessionProvider: {
      getSession() {
        return session;
      },
    },
    seedBundle: CANONICAL_SEED_BUNDLE,
    clock: createClock(),
    idGenerator: createIdGenerator('snapshot'),
  });

  return {
    facade,
    participantRegistry,
    permissionService,
    platformStore,
  };
}

describe('AdminFacade governance operations', () => {
  it('creates, updates, and removes a fictional user with masked audit coverage', async () => {
    const harness = createAdminHarness();
    const created = await harness.facade.createUser({
      username: 'demo.bos2',
      displayName: 'Demo Operations Two',
      role: 'BOS',
      memberId: null,
      active: true,
    });

    expect(created.ok).toBe(true);
    expect(created.status).toBe(201);
    expect(created.data.user).toEqual(
      expect.objectContaining({
        userId: 'usr_local_1',
        username: 'demo.bos2',
        displayName: 'Demo Operations Two',
        role: 'BOS',
        systemSeed: false,
        revision: 1,
      }),
    );

    const updated = await harness.facade.updateUser(
      created.data.user.userId,
      {
        displayName: 'Demo Operations Lead',
        role: 'ADMIN',
        memberId: null,
        active: true,
        expectedRevision: 1,
      },
    );

    expect(updated.ok).toBe(true);
    expect(updated.data.user).toEqual(
      expect.objectContaining({
        displayName: 'Demo Operations Lead',
        role: 'ADMIN',
        revision: 2,
      }),
    );

    const removed = await harness.facade.deleteUser(
      created.data.user.userId,
      {
        expectedRevision: 2,
        confirmation: 'REMOVE demo.bos2',
      },
    );

    expect(removed.ok).toBe(true);
    expect(removed.data.deletedUserId).toBe('usr_local_1');
    expect(
      harness.getUsers().some(
        (user) => user.userId === 'usr_local_1',
      ),
    ).toBe(false);
    expect(
      harness.auditService.append.mock.calls.map(
        ([context]) => context.action,
      ),
    ).toEqual([
      'USER_CREATED',
      'USER_UPDATED',
      'USER_DELETED',
    ]);
  });

  it('rejects duplicate usernames, stale revisions, and seeded-user deletion', async () => {
    const harness = createAdminHarness();
    const duplicate = await harness.facade.createUser({
      username: 'bos',
      displayName: 'Duplicate Operations User',
      role: 'BOS',
      memberId: null,
      active: true,
    });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.status).toBe(409);
    expect(duplicate.error.code).toBe(
      ADMIN_FACADE_ERROR_CODES.USERNAME_EXISTS,
    );

    const stale = await harness.facade.updateUser(
      'usr_bos',
      {
        displayName: 'Changed Operations User',
        expectedRevision: 99,
      },
    );

    expect(stale.ok).toBe(false);
    expect(stale.status).toBe(409);
    expect(stale.error.code).toBe(
      ADMIN_FACADE_ERROR_CODES.REVISION_CONFLICT,
    );

    const protectedResult = await harness.facade.deleteUser(
      'usr_bos',
      {
        expectedRevision: 1,
        confirmation: 'REMOVE bos',
      },
    );

    expect(protectedResult.ok).toBe(false);
    expect(protectedResult.status).toBe(409);
    expect(protectedResult.error.code).toBe(
      ADMIN_FACADE_ERROR_CODES.SYSTEM_USER_PROTECTED,
    );
    expect(harness.auditService.append).not.toHaveBeenCalled();
  });

  it('allows ITS to update permitted settings but denies default restoration', async () => {
    const harness = createAdminHarness({
      session: ITS_SESSION,
      deniedActions: [ACTIONS.SETTINGS_RESTORE],
    });
    const updated = await harness.facade.updateSettings({
      changes: {
        retentionYears: 8,
        autoApproveAmount: 750,
        sessionTimeoutMinutes: 45,
      },
      expectedRevision: 1,
    });

    expect(updated.ok).toBe(true);
    expect(updated.data.settings).toEqual(
      expect.objectContaining({
        retentionYears: 8,
        autoApproveAmount: 750,
        sessionTimeoutMinutes: 45,
        revision: 2,
        updatedBy: ITS_SESSION.userId,
      }),
    );

    const restored = await harness.facade.restoreSettings({
      expectedRevision: 2,
      confirmation: 'RESTORE DEFAULT SETTINGS',
    });

    expect(restored.ok).toBe(false);
    expect(restored.status).toBe(403);
    expect(restored.error.code).toBe(
      ADMIN_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    );
    expect(harness.getSettings().retentionYears).toBe(8);
    expect(
      harness.auditService.append.mock.calls.map(
        ([context]) => context.action,
      ),
    ).toEqual(['SETTINGS_UPDATED']);
  });
});

describe('AuditFacade governance evidence', () => {
  it('filters audit events and masks sensitive values before presentation', async () => {
    const events = createAuditEvents();
    const repository = createAuditRepository(events);
    const permissionService = createPermissionService();
    const facade = createAuditFacade(repository, {
      permissionService,
      sessionProvider: {
        getSession() {
          return ADMIN_SESSION;
        },
      },
      clock: createClock(),
      idGenerator: createIdGenerator('audit'),
    });
    const result = await facade.query({
      actions: ['USER_UPDATED'],
      outcomes: ['SUCCESS'],
      page: 1,
      limit: 25,
      direction: 'DESC',
    });

    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.masked).toBe(true);
    expect(result.data.items[0]).toEqual(
      expect.objectContaining({
        action: 'USER_UPDATED',
        outcome: 'SUCCESS',
      }),
    );
    expect(result.data.items[0].after.memberId).toBe(
      '*****6789',
    );
    expect(result.data.items[0].after.displayName).not.toBe(
      'John Example',
    );
    expect(repository.query).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: ['USER_UPDATED'],
        outcomes: ['SUCCESS'],
        page: 1,
        limit: 100,
      }),
    );
  });

  it('exports filtered fictional audit evidence without exposing raw identifiers', async () => {
    const events = createAuditEvents();
    const repository = createAuditRepository(events);
    const permissionService = createPermissionService();
    const auditService = {
      append: vi.fn(async (_context, event) => event),
    };
    const facade = createAuditFacade(repository, {
      permissionService,
      auditService,
      sessionProvider: {
        getSession() {
          return ADMIN_SESSION;
        },
      },
      clock: createClock(),
      idGenerator: createIdGenerator('audit-export'),
    });
    const result = await facade.export({
      format: 'CSV',
      filters: {
        actions: ['USER_UPDATED'],
        outcomes: ['SUCCESS'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        format: 'CSV',
        rowCount: 1,
        notice: AUDIT_EXPORT_NOTICE,
        masked: true,
        blob: expect.any(globalThis.Blob),
      }),
    );

    const content = await readBlobText(result.data.blob);

    expect(content).toContain(`# ${AUDIT_EXPORT_NOTICE}`);
    expect(content).toContain('USER_UPDATED');
    expect(content).not.toContain('123456789');
    expect(content).not.toContain('John Example');
    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUDIT_EXPORTED',
      }),
      expect.objectContaining({
        outcome: 'SUCCESS',
        after: expect.objectContaining({
          format: 'CSV',
          rowCount: 1,
          notice: AUDIT_EXPORT_NOTICE,
        }),
      }),
    );
  });

  it('rejects invalid audit date ranges before querying the repository', async () => {
    const repository = createAuditRepository(
      createAuditEvents(),
    );
    const facade = createAuditFacade(repository, {
      permissionService: createPermissionService(),
      sessionProvider: {
        getSession() {
          return ADMIN_SESSION;
        },
      },
      idGenerator: createIdGenerator('audit-invalid'),
    });
    const result = await facade.query({
      from: '2024-01-23',
      to: '2024-01-22',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'from',
          code: 'INVALID_DATE_RANGE',
        }),
      ]),
    );
    expect(repository.query).not.toHaveBeenCalled();
  });
});

describe('SnapshotFacade coordinated governance', () => {
  it('validates and destructively applies a snapshot through every restore participant', async () => {
    const harness = createSnapshotHarness();
    const candidate = createSnapshotCandidate();
    const validation =
      await harness.facade.validateSnapshot(candidate);

    expect(validation.ok).toBe(true);
    expect(validation.data).toEqual(
      expect.objectContaining({
        valid: true,
        validationToken: expect.stringMatching(/^val_/),
        replacementSlices: ['operationsEnvelope'],
        checksum: candidate.sha256,
      }),
    );
    expect(
      harness.participantRegistry.validateAll,
    ).toHaveBeenCalledWith(
      candidate,
      expect.objectContaining({
        platformStore: harness.platformStore,
      }),
    );

    const applied = await harness.facade.applySnapshot({
      validationToken: validation.data.validationToken,
      confirmation: SNAPSHOT_CONFIRMATIONS.APPLY,
      expectedRootRevision: 3,
    });

    expect(applied.ok).toBe(true);
    expect(applied.data).toEqual(
      expect.objectContaining({
        applied: true,
        rootRevision: 4,
        replacementSlices: ['operationsEnvelope'],
        checksum: candidate.sha256,
        reloadRequired: true,
      }),
    );
    expect(harness.platformStore.execute).toHaveBeenCalledTimes(1);
    expect(
      harness.platformStore.getSnapshot().operationsEnvelope,
    ).toEqual(INITIAL_OPERATIONS_ENVELOPE);
    expect(
      harness.participantRegistry.stageRestore,
    ).toHaveBeenCalledWith(
      candidate,
      expect.objectContaining({
        expectedRootRevision: 3,
      }),
    );
    expect(
      harness.participantRegistry.commitRestore,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        participantCount: 1,
      }),
      expect.objectContaining({
        expectedRootRevision: 4,
      }),
    );

    const replay = await harness.facade.applySnapshot({
      validationToken: validation.data.validationToken,
      confirmation: SNAPSHOT_CONFIRMATIONS.APPLY,
      expectedRootRevision: 4,
    });

    expect(replay.ok).toBe(false);
    expect(replay.error.code).toBe(
      SNAPSHOT_FACADE_ERROR_CODES.VALIDATION_TOKEN_INVALID,
    );
    expect(harness.platformStore.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed imports and destructive replacement without exact confirmation', async () => {
    const harness = createSnapshotHarness();
    const malformed =
      await harness.facade.validateSnapshot('{invalid json');

    expect(malformed.ok).toBe(false);
    expect(malformed.status).toBe(400);
    expect(malformed.error.code).toBe(
      SNAPSHOT_FACADE_ERROR_CODES.INVALID_JSON,
    );

    const validation = await harness.facade.validateSnapshot(
      createSnapshotCandidate(),
    );

    expect(validation.ok).toBe(true);

    const rejected = await harness.facade.applySnapshot({
      validationToken: validation.data.validationToken,
      confirmation: 'REPLACE DATA',
      expectedRootRevision: 3,
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.status).toBe(422);
    expect(rejected.error.code).toBe(
      SNAPSHOT_FACADE_ERROR_CODES.CONFIRMATION_REQUIRED,
    );
    expect(harness.platformStore.execute).not.toHaveBeenCalled();
    expect(
      harness.participantRegistry.stageRestore,
    ).not.toHaveBeenCalled();
  });

  it('restores the full canonical baseline with coordinated participant staging and commit', async () => {
    const harness = createSnapshotHarness();
    const restored = await harness.facade.restoreSample({
      confirmation: SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE,
      expectedRootRevision: 3,
    });

    expect(restored.ok).toBe(true);
    expect(restored.data).toEqual(
      expect.objectContaining({
        restored: true,
        seedVersion:
          CANONICAL_SEED_BUNDLE.fixtureVersion,
        rootRevision: 4,
        sessionPreserved: true,
        reloadRequired: true,
      }),
    );

    const snapshot = harness.platformStore.getSnapshot();

    expect(snapshot.slices.users).toEqual(
      CANONICAL_SEED_BUNDLE.platform.users,
    );
    expect(snapshot.slices.settings).toEqual(
      CANONICAL_SEED_BUNDLE.platform.settings,
    );
    expect(snapshot.slices.auditEvents).toEqual(
      CANONICAL_SEED_BUNDLE.auditEvents,
    );
    expect(snapshot.slices.operationsEnvelope).toEqual(
      CANONICAL_SEED_BUNDLE.operationsEnvelope,
    );
    expect(snapshot.slices.membersClaims).toEqual(
      CANONICAL_SEED_BUNDLE.membersClaims,
    );
    expect(snapshot.slices.documents).toEqual(
      CANONICAL_SEED_BUNDLE.documents,
    );
    expect(snapshot.slices.insights).toEqual(
      CANONICAL_SEED_BUNDLE.insights,
    );
    expect(
      harness.participantRegistry.stageRestore,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        notice: SNAPSHOT_NOTICE,
        slices: expect.objectContaining({
          operationsEnvelope:
            CANONICAL_SEED_BUNDLE.operationsEnvelope,
        }),
      }),
      expect.objectContaining({
        expectedRootRevision: 3,
      }),
    );
    expect(
      harness.participantRegistry.commitRestore,
    ).toHaveBeenCalledTimes(1);
  });

  it('does not mutate local data when canonical restore confirmation is missing', async () => {
    const harness = createSnapshotHarness();
    const before = cloneValue(
      harness.platformStore.getSnapshot().slices,
    );
    const result = await harness.facade.restoreSample({
      confirmation: 'RESTORE',
      expectedRootRevision: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error.code).toBe(
      SNAPSHOT_FACADE_ERROR_CODES.CONFIRMATION_REQUIRED,
    );
    expect(
      harness.platformStore.getSnapshot().slices,
    ).toEqual(before);
    expect(harness.platformStore.execute).not.toHaveBeenCalled();
    expect(
      harness.participantRegistry.stageRestore,
    ).not.toHaveBeenCalled();
    expect(
      harness.participantRegistry.commitRestore,
    ).not.toHaveBeenCalled();
  });
});