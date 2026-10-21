import {
  DEMO_CREDENTIAL_NOTICE,
  DEMO_MFA_CODE,
  DEMO_PASSWORD,
  SEEDED_ACCOUNTS,
} from '../../fixtures/accounts.js';
import {
  AUTH_FACADE_ERROR_CODES,
  createAuthFacade,
} from './authFacade.js';
import {
  createAuditRepository,
} from '../repositories/auditRepository.js';
import { createAuditService } from './auditService.js';
import {
  createStorageGateway,
} from '../persistence/storageGateway.js';
import {
  SESSION_EVENT_TYPES,
  SESSION_SIGN_OUT_REASONS,
  SESSION_STATUSES,
  createSessionManager,
} from './sessionManager.js';
import { createTestClock } from '../time/clock.js';

let namespaceSequence = 0;
const activeHarnesses = new Set();

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    getSerializedValue(key) {
      return values.get(key) ?? null;
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

function createHarness({
  storage = createMemoryStorage(),
  namespace,
  clock = createTestClock('2024-01-22T12:00:00.000Z'),
} = {}) {
  namespaceSequence += 1;

  const resolvedNamespace =
    namespace ?? `auth-facade-test-${namespaceSequence}.v1`;
  const gateway = createStorageGateway({
    namespace: resolvedNamespace,
    storage,
    broadcastChannelFactory: null,
  });
  const auditRepository = createAuditRepository(gateway);
  const auditService = createAuditService(auditRepository, {
    clock,
    idGenerator: createUuidGenerator('91000000'),
  });
  const sessionManager = createSessionManager(gateway, {
    clock,
    idGenerator: createUuidGenerator('92000000'),
    activityThrottleMs: 0,
  });
  const authFacade = createAuthFacade(sessionManager, {
    auditService,
    clock,
    idGenerator: createUuidGenerator('93000000'),
  });
  const harness = {
    storage,
    namespace: resolvedNamespace,
    gateway,
    auditRepository,
    auditService,
    sessionManager,
    authFacade,
    clock,
    destroy() {
      sessionManager.destroy();
      gateway.destroy();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
}

function createSignInCommand(account, overrides = {}) {
  return {
    username: account.username,
    password: DEMO_PASSWORD,
    mfaCode: DEMO_MFA_CODE,
    requestedRole: account.role,
    ...overrides,
  };
}

afterEach(() => {
  [...activeHarnesses].forEach((harness) => {
    harness.destroy();
  });
});

describe('AuthFacade', () => {
  it('signs in every seeded persona with the printed password and MFA code', async () => {
    const harness = createHarness();

    for (const account of SEEDED_ACCOUNTS) {
      const result = await harness.authFacade.signIn(
        createSignInCommand(account),
      );

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.disclosure).toBe(
        DEMO_CREDENTIAL_NOTICE,
      );
      expect(result.data.session).toEqual(
        expect.objectContaining({
          userId: account.userId,
          displayName: account.displayName,
          role: account.role,
        }),
      );
      expect(result.data.session.sessionId).toMatch(/^ses_/);
      expect(
        Date.parse(result.data.session.expiresAt) -
          Date.parse(result.data.session.lastActivityAt),
      ).toBe(30 * 60 * 1000);
      expect(harness.authFacade.getSession()).toEqual(
        result.data.session,
      );

      const signOutResult = await harness.authFacade.signOut();

      expect(signOutResult).toEqual(
        expect.objectContaining({
          ok: true,
          status: 200,
          data: {
            signedOut: true,
          },
        }),
      );
      expect(harness.authFacade.getSession()).toBeNull();
    }

    const auditEvents = harness.auditRepository.getAll();

    expect(auditEvents).toHaveLength(SEEDED_ACCOUNTS.length);
    expect(
      auditEvents.every(
        (event) =>
          event.action === 'SIGN_IN' &&
          event.outcome === 'SUCCESS' &&
          event.entity.type === 'SESSION',
      ),
    ).toBe(true);
  });

  it('returns the same generic failure for invalid password, MFA, username, and role', async () => {
    const harness = createHarness();
    const account = SEEDED_ACCOUNTS[0];
    const attempts = [
      createSignInCommand(account, {
        password: 'incorrect',
      }),
      createSignInCommand(account, {
        mfaCode: '123456',
      }),
      createSignInCommand(account, {
        username: 'unknown.persona',
      }),
      createSignInCommand(account, {
        requestedRole: 'ADMIN',
      }),
    ];

    for (const command of attempts) {
      const result = await harness.authFacade.signIn(command);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toEqual(
        expect.objectContaining({
          code:
            AUTH_FACADE_ERROR_CODES.INVALID_DEMO_CREDENTIALS,
          message:
            'The demo credentials could not be validated.',
          fieldErrors: [],
          retryable: false,
        }),
      );
    }

    expect(harness.authFacade.getSession()).toBeNull();
    expect(harness.auditRepository.getAll()).toEqual([]);
  });

  it('applies the in-memory demo throttle after repeated failed sign-ins', async () => {
    const harness = createHarness();
    const account = SEEDED_ACCOUNTS[0];
    const invalidCommand = createSignInCommand(account, {
      password: 'incorrect',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await harness.authFacade.signIn(
        invalidCommand,
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe(
        AUTH_FACADE_ERROR_CODES.INVALID_DEMO_CREDENTIALS,
      );
    }

    const throttled = await harness.authFacade.signIn(
      createSignInCommand(account),
    );

    expect(throttled.ok).toBe(false);
    expect(throttled.status).toBe(429);
    expect(throttled.error.code).toBe(
      AUTH_FACADE_ERROR_CODES.DEMO_THROTTLED,
    );
    expect(throttled.error.retryable).toBe(true);
    expect(throttled.error.retryAfterMs).toBe(30_000);
    expect(harness.authFacade.getSession()).toBeNull();
  });

  it('stores a masked sign-in audit without persisting credentials', async () => {
    const harness = createHarness();
    const account = SEEDED_ACCOUNTS.find(
      (candidate) => candidate.role === 'ADMIN',
    );

    expect(account).toBeDefined();

    const result = await harness.authFacade.signIn(
      createSignInCommand(account),
    );

    expect(result.ok).toBe(true);

    const auditEvents = harness.auditRepository.getAll();

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toEqual(
      expect.objectContaining({
        action: 'SIGN_IN',
        actor: {
          userId: account.userId,
          displayName: 'A.',
          role: account.role,
        },
        entity: {
          type: 'SESSION',
          id: result.data.session.sessionId,
        },
        before: null,
        after: {
          role: account.role,
          status: 'ACTIVE',
        },
        outcome: 'SUCCESS',
      }),
    );

    const persisted = harness.storage.getSerializedValue(
      harness.gateway.rootKey,
    );

    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain('"password"');
    expect(persisted).not.toContain('"mfaCode"');
    expect(persisted).not.toContain('"credentials"');
  });

  it('resets inactivity on activity, warns during the final minute, and expires the session', async () => {
    const harness = createHarness();
    const account = SEEDED_ACCOUNTS[0];
    const events = [];

    harness.sessionManager.subscribe((event) => {
      events.push(event);
    });

    const signInResult = await harness.authFacade.signIn(
      createSignInCommand(account),
    );

    expect(signInResult.ok).toBe(true);
    expect(
      harness.sessionManager.getSnapshot().status,
    ).toBe(SESSION_STATUSES.ACTIVE);

    harness.clock.advance(20_000);

    const updatedSession =
      harness.sessionManager.recordActivity();

    expect(updatedSession.lastActivityAt).toBe(
      '2024-01-22T12:00:20.000Z',
    );
    expect(updatedSession.expiresAt).toBe(
      '2024-01-22T12:30:20.000Z',
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: SESSION_EVENT_TYPES.CREATED,
          status: SESSION_STATUSES.ACTIVE,
        }),
        expect.objectContaining({
          type: SESSION_EVENT_TYPES.ACTIVITY_RECORDED,
          status: SESSION_STATUSES.ACTIVE,
        }),
      ]),
    );

    harness.clock.set('2024-01-22T12:29:30.000Z');

    expect(harness.sessionManager.tick()).toBe(
      SESSION_STATUSES.WARNING,
    );
    expect(
      harness.sessionManager.getSnapshot().remainingMs,
    ).toBe(50_000);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: SESSION_EVENT_TYPES.WARNING,
          status: SESSION_STATUSES.WARNING,
        }),
      ]),
    );

    harness.clock.set('2024-01-22T12:30:21.000Z');

    expect(harness.sessionManager.tick()).toBe(
      SESSION_STATUSES.EXPIRED,
    );
    expect(harness.authFacade.getSession()).toBeNull();
    expect(
      harness.sessionManager.getSnapshot().status,
    ).toBe(SESSION_STATUSES.SIGNED_OUT);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: SESSION_EVENT_TYPES.EXPIRED,
          status: SESSION_STATUSES.SIGNED_OUT,
          reason: SESSION_SIGN_OUT_REASONS.EXPIRED,
          session: null,
        }),
      ]),
    );
  });

  it('propagates sign-in and sign-out across gateways sharing the same namespace', async () => {
    const storage = createMemoryStorage();
    const namespace =
      `auth-cross-tab-${++namespaceSequence}.v1`;
    const clock = createTestClock(
      '2024-01-22T12:00:00.000Z',
    );
    const firstTab = createHarness({
      storage,
      namespace,
      clock,
    });
    const secondTab = createHarness({
      storage,
      namespace,
      clock,
    });
    const secondTabEvents = [];
    const account = SEEDED_ACCOUNTS.find(
      (candidate) => candidate.role === 'MEMBER',
    );

    expect(account).toBeDefined();

    secondTab.sessionManager.subscribe((event) => {
      secondTabEvents.push(event);
    });

    const signInResult = await firstTab.authFacade.signIn(
      createSignInCommand(account),
    );

    expect(signInResult.ok).toBe(true);
    expect(secondTab.authFacade.getSession()).toEqual(
      signInResult.data.session,
    );
    expect(secondTabEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: SESSION_EVENT_TYPES.CHANGED,
          status: SESSION_STATUSES.ACTIVE,
          session: expect.objectContaining({
            userId: account.userId,
            role: account.role,
          }),
        }),
      ]),
    );

    const signOutResult = await firstTab.authFacade.signOut(
      SESSION_SIGN_OUT_REASONS.USER_REQUESTED,
    );

    expect(signOutResult.ok).toBe(true);
    expect(secondTab.authFacade.getSession()).toBeNull();
    expect(secondTabEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: SESSION_EVENT_TYPES.SIGNED_OUT,
          reason: SESSION_SIGN_OUT_REASONS.EXTERNAL,
          status: SESSION_STATUSES.SIGNED_OUT,
          session: null,
        }),
      ]),
    );
  });
});