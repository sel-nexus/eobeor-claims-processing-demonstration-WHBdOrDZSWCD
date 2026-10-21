import {
  STORAGE_ERROR_CODES,
  StorageGatewayError,
  calculateStorageChecksum,
  createStorageEnvelope,
  createStorageGateway,
  isStorageEnvelope,
} from './storageGateway.js';
import {
  MIGRATION_ERROR_CODES,
  PersistenceMigrationError,
  migratePlatformEnvelope,
  migrateSchema0To1,
} from './migrations.js';
import {
  PLATFORM_STORE_HYDRATION_STATUSES,
  createPlatformStore,
} from '../stores/platformStore.js';

let namespaceSequence = 0;
const activeGateways = new Set();
const activeStores = new Set();

function createMemoryStorage() {
  const values = new Map();
  let getFailure = null;
  let setFailure = null;
  let removeFailure = null;

  return {
    getItem(key) {
      if (getFailure !== null) {
        throw getFailure;
      }

      return values.has(String(key))
        ? values.get(String(key))
        : null;
    },
    setItem(key, value) {
      if (setFailure !== null) {
        throw setFailure;
      }

      values.set(String(key), String(value));
    },
    removeItem(key) {
      if (removeFailure !== null) {
        throw removeFailure;
      }

      values.delete(String(key));
    },
    getSerializedValue(key) {
      return values.get(String(key)) ?? null;
    },
    setSerializedValue(key, value) {
      values.set(String(key), String(value));
    },
    has(key) {
      return values.has(String(key));
    },
    failReads(error) {
      getFailure = error;
    },
    failWrites(error) {
      setFailure = error;
    },
    failRemovals(error) {
      removeFailure = error;
    },
    restore() {
      getFailure = null;
      setFailure = null;
      removeFailure = null;
    },
  };
}

function createGateway({
  namespace,
  storage = createMemoryStorage(),
} = {}) {
  namespaceSequence += 1;

  const gateway = createStorageGateway({
    namespace:
      namespace ??
      `storage-gateway-test-${namespaceSequence}.v1`,
    storage,
    broadcastChannelFactory: null,
  });

  activeGateways.add(gateway);
  return {
    gateway,
    storage,
  };
}

function destroyGateway(gateway) {
  gateway.destroy();
  activeGateways.delete(gateway);
}

function captureError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }

  return null;
}

afterEach(() => {
  [...activeStores].forEach((store) => {
    store.destroy();
    activeStores.delete(store);
  });

  [...activeGateways].forEach((gateway) => {
    gateway.destroy();
    activeGateways.delete(gateway);
  });
});

describe('StorageGateway', () => {
  it('persists a namespaced immutable envelope with a valid checksum and commit marker', () => {
    const { gateway, storage } = createGateway({
      namespace: 'claims-storage-test.v1',
    });
    const committed = gateway.commit(
      0,
      {
        slices: {
          settings: {
            enabled: true,
          },
        },
      },
      {
        commitId: 'commit-001',
      },
    );

    expect(gateway.rootKey).toBe(
      'claims-storage-test.v1.root',
    );
    expect(gateway.channelName).toBe(
      'claims-storage-test.v1.changes',
    );
    expect(committed).toEqual(
      expect.objectContaining({
        schemaVersion: '1.0.0',
        rootRevision: 1,
        slices: {
          settings: {
            enabled: true,
          },
        },
        checksum: expect.stringMatching(
          /^fnv1a32-[0-9a-f]{8}$/,
        ),
        commitMarker: expect.stringMatching(
          /^revision:1;checksum:fnv1a32-[0-9a-f]{8};commit:commit-001$/,
        ),
      }),
    );
    expect(isStorageEnvelope(committed)).toBe(true);
    expect(Object.isFrozen(committed)).toBe(true);
    expect(Object.isFrozen(committed.slices)).toBe(true);
    expect(Object.isFrozen(committed.slices.settings)).toBe(
      true,
    );

    const serialized = storage.getSerializedValue(
      gateway.rootKey,
    );

    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized)).toEqual(committed);
    expect(gateway.read()).toEqual(committed);
  });

  it('isolates persisted data by namespace when gateways share one storage provider', () => {
    const storage = createMemoryStorage();
    const first = createGateway({
      namespace: 'claims-storage-first.v1',
      storage,
    }).gateway;
    const second = createGateway({
      namespace: 'claims-storage-second.v1',
      storage,
    }).gateway;

    first.commit(0, {
      slices: {
        source: 'first',
      },
    });
    second.commit(0, {
      slices: {
        source: 'second',
      },
    });

    expect(first.read().slices.source).toBe('first');
    expect(second.read().slices.source).toBe('second');
    expect(first.rootKey).not.toBe(second.rootKey);
    expect(storage.has(first.rootKey)).toBe(true);
    expect(storage.has(second.rootKey)).toBe(true);
  });

  it('rejects invalid namespaces before accessing browser storage', () => {
    const error = captureError(() =>
      createStorageGateway({
        namespace: 'Invalid Namespace',
        storage: createMemoryStorage(),
        broadcastChannelFactory: null,
      }),
    );

    expect(error).toBeInstanceOf(StorageGatewayError);
    expect(error).toMatchObject({
      code: STORAGE_ERROR_CODES.INVALID_NAMESPACE,
      status: 400,
    });
  });

  it('enforces optimistic revisions across gateways sharing a namespace', () => {
    const storage = createMemoryStorage();
    const namespace = 'claims-storage-revision.v1';
    const first = createGateway({
      namespace,
      storage,
    }).gateway;
    const second = createGateway({
      namespace,
      storage,
    }).gateway;

    first.commit(0, {
      slices: {
        value: 1,
      },
    });

    const staleError = captureError(() =>
      second.commit(0, {
        slices: {
          value: 2,
        },
      }),
    );

    expect(staleError).toBeInstanceOf(StorageGatewayError);
    expect(staleError).toMatchObject({
      code: STORAGE_ERROR_CODES.REVISION_CONFLICT,
      status: 409,
      details: {
        expectedRevision: 0,
        actualRevision: 1,
      },
    });
    expect(second.read().slices.value).toBe(1);

    const updated = second.commit(1, {
      slices: {
        value: 2,
      },
    });

    expect(updated.rootRevision).toBe(2);
    expect(first.read().slices.value).toBe(2);
  });

  it('detects a corrupt envelope when persisted content no longer matches its checksum', () => {
    const { gateway, storage } = createGateway();

    gateway.commit(0, {
      slices: {
        settings: {
          retentionYears: 7,
        },
      },
    });

    const persisted = JSON.parse(
      storage.getSerializedValue(gateway.rootKey),
    );

    persisted.slices.settings.retentionYears = 9;
    storage.setSerializedValue(
      gateway.rootKey,
      JSON.stringify(persisted),
    );

    const error = captureError(() => gateway.read());

    expect(error).toBeInstanceOf(StorageGatewayError);
    expect(error).toMatchObject({
      code: STORAGE_ERROR_CODES.CORRUPT_STATE,
      status: 422,
    });

    const safeResult = gateway.safeRead();

    expect(safeResult.ok).toBe(false);
    expect(safeResult.error).toMatchObject({
      code: STORAGE_ERROR_CODES.CORRUPT_STATE,
    });
  });

  it('rejects envelopes declaring a future schema version', () => {
    const { gateway, storage } = createGateway();
    const futureEnvelopeBase = {
      schemaVersion: '2.0.0',
      rootRevision: 1,
      slices: {
        futureData: true,
      },
    };
    const checksum = calculateStorageChecksum(
      futureEnvelopeBase,
    );
    const futureEnvelope = {
      ...futureEnvelopeBase,
      checksum,
      commitMarker:
        `revision:1;checksum:${checksum};commit:future-001`,
    };

    storage.setSerializedValue(
      gateway.rootKey,
      JSON.stringify(futureEnvelope),
    );

    expect(isStorageEnvelope(futureEnvelope)).toBe(false);

    const error = captureError(() => gateway.read());

    expect(error).toBeInstanceOf(StorageGatewayError);
    expect(error.code).toBe(
      STORAGE_ERROR_CODES.CORRUPT_STATE,
    );
  });

  it('preserves the prior committed envelope when a quota error blocks a write', () => {
    const storage = createMemoryStorage();
    const { gateway } = createGateway({ storage });
    const original = gateway.commit(0, {
      slices: {
        value: 'persisted',
      },
    });

    storage.failWrites({
      name: 'QuotaExceededError',
      message: 'Quota exceeded',
    });

    const error = captureError(() =>
      gateway.commit(1, {
        slices: {
          value: 'not-persisted',
        },
      }),
    );

    expect(error).toBeInstanceOf(StorageGatewayError);
    expect(error).toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
      status: 507,
    });

    storage.restore();

    expect(gateway.read()).toEqual(original);
    expect(gateway.read().rootRevision).toBe(1);
    expect(gateway.read().slices.value).toBe('persisted');
  });

  it('normalizes denied and unavailable storage reads without throwing from safeRead', () => {
    const deniedStorage = createMemoryStorage();

    deniedStorage.failReads({
      name: 'SecurityError',
      message: 'Storage access denied',
    });

    const deniedGateway = createGateway({
      storage: deniedStorage,
    }).gateway;
    const deniedResult = deniedGateway.safeRead();

    expect(deniedResult.ok).toBe(false);
    expect(deniedResult.error).toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_DENIED,
      status: 503,
    });
    expect(deniedGateway.isAvailable()).toBe(false);

    const unavailableStorage = createMemoryStorage();

    unavailableStorage.failReads(
      new Error('Storage backend unavailable'),
    );

    const unavailableGateway = createGateway({
      storage: unavailableStorage,
    }).gateway;
    const unavailableResult = unavailableGateway.safeRead();

    expect(unavailableResult.ok).toBe(false);
    expect(unavailableResult.error).toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
    });
  });

  it('publishes same-tab commit and clear invalidations to every gateway in the namespace', () => {
    const storage = createMemoryStorage();
    const namespace = 'claims-storage-events.v1';
    const first = createGateway({
      namespace,
      storage,
    }).gateway;
    const second = createGateway({
      namespace,
      storage,
    }).gateway;
    const firstEvents = [];
    const secondEvents = [];
    const unsubscribeFirst = first.subscribe((event) => {
      firstEvents.push(event);
    });
    const unsubscribeSecond = second.subscribe((event) => {
      secondEvents.push(event);
    });

    const committed = first.commit(0, {
      slices: {
        value: 'committed',
      },
    });

    expect(firstEvents).toEqual([
      expect.objectContaining({
        type: 'committed',
        namespace,
        key: first.rootKey,
        revision: 1,
        commitMarker: committed.commitMarker,
        source: 'same-tab',
      }),
    ]);
    expect(secondEvents).toEqual([
      expect.objectContaining({
        type: 'committed',
        namespace,
        key: second.rootKey,
        revision: 1,
        commitMarker: committed.commitMarker,
        source: 'same-tab',
      }),
    ]);

    expect(second.clear(1)).toBe(true);
    expect(first.read()).toBeNull();
    expect(firstEvents.at(-1)).toEqual(
      expect.objectContaining({
        type: 'cleared',
        namespace,
        revision: 0,
        commitMarker: null,
      }),
    );
    expect(secondEvents.at(-1)).toEqual(
      expect.objectContaining({
        type: 'cleared',
        namespace,
        revision: 0,
        commitMarker: null,
      }),
    );

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('stops publishing and rejects reads after the gateway is destroyed', () => {
    const { gateway } = createGateway();

    destroyGateway(gateway);

    const error = captureError(() => gateway.read());

    expect(error).toBeInstanceOf(StorageGatewayError);
    expect(error).toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
    });
  });
});

describe('Storage envelope helpers', () => {
  it('creates deterministic self-validating envelopes while replacing stale metadata', () => {
    const envelope = createStorageEnvelope(
      {
        schemaVersion: '0.0.0',
        rootRevision: 99,
        checksum: 'stale-checksum',
        commitMarker: 'stale-marker',
        slices: {
          users: [],
        },
      },
      {
        revision: 4,
        schemaVersion: '1.0.0',
        commitId: 'commit-helper-001',
      },
    );

    expect(envelope.rootRevision).toBe(4);
    expect(envelope.schemaVersion).toBe('1.0.0');
    expect(envelope.checksum).not.toBe('stale-checksum');
    expect(envelope.commitMarker).toBe(
      `revision:4;checksum:${envelope.checksum};commit:commit-helper-001`,
    );
    expect(calculateStorageChecksum(envelope)).toBe(
      envelope.checksum,
    );
    expect(isStorageEnvelope(envelope)).toBe(true);
  });

  it('rejects non-JSON-compatible envelope data', () => {
    const error = captureError(() =>
      createStorageEnvelope(
        {
          slices: {
            invalid: undefined,
          },
        },
        {
          revision: 1,
        },
      ),
    );

    expect(error).toBeInstanceOf(StorageGatewayError);
    expect(error).toMatchObject({
      code: STORAGE_ERROR_CODES.INVALID_ENVELOPE,
      status: 422,
    });
  });
});

describe('Platform persistence hydration and migrations', () => {
  it('hydrates an existing namespaced root without overwriting its slices', () => {
    const storage = createMemoryStorage();
    const namespace = 'claims-platform-hydration.v1';
    const { gateway } = createGateway({
      namespace,
      storage,
    });
    const firstStore = createPlatformStore(gateway, {
      initialSlices: {
        fixtureLabel: 'first-baseline',
      },
    });

    activeStores.add(firstStore);

    expect(firstStore.getSnapshot()).toEqual(
      expect.objectContaining({
        hydrationStatus:
          PLATFORM_STORE_HYDRATION_STATUSES.READY,
        persisted: true,
        rootRevision: 1,
        persistedRootRevision: 1,
      }),
    );
    expect(
      firstStore.getSnapshot().slices.fixtureLabel,
    ).toBe('first-baseline');

    firstStore.destroy();
    activeStores.delete(firstStore);

    const secondStore = createPlatformStore(gateway, {
      initialSlices: {
        fixtureLabel: 'replacement-baseline',
      },
    });

    activeStores.add(secondStore);

    expect(secondStore.getSnapshot()).toEqual(
      expect.objectContaining({
        hydrationStatus:
          PLATFORM_STORE_HYDRATION_STATUSES.READY,
        persisted: true,
        rootRevision: 1,
      }),
    );
    expect(
      secondStore.getSnapshot().slices.fixtureLabel,
    ).toBe('first-baseline');
  });

  it('migrates schema-zero persistence data into the current root envelope', () => {
    const legacy = {
      schemaVersion: 0,
      revision: 3,
      users: [],
      preferences: {
        theme: 'system',
      },
      checksum: 'legacy-checksum',
      commitMarker: 'legacy-marker',
    };
    const migrated = migrateSchema0To1(legacy);

    expect(migrated).toEqual({
      schemaVersion: '1.0.0',
      rootRevision: 3,
      slices: {
        users: [],
        preferences: {
          theme: 'system',
        },
      },
    });
    expect(Object.isFrozen(migrated)).toBe(true);
    expect(Object.isFrozen(migrated.slices)).toBe(true);
    expect(legacy).toEqual({
      schemaVersion: 0,
      revision: 3,
      users: [],
      preferences: {
        theme: 'system',
      },
      checksum: 'legacy-checksum',
      commitMarker: 'legacy-marker',
    });

    const sequentiallyMigrated =
      migratePlatformEnvelope(legacy);

    expect(sequentiallyMigrated).toEqual(migrated);
  });

  it('refuses future persistence schemas without mutating the source envelope', () => {
    const futureEnvelope = {
      schemaVersion: '2.0.0',
      rootRevision: 8,
      slices: {
        futureData: {
          enabled: true,
        },
      },
    };
    const error = captureError(() =>
      migratePlatformEnvelope(futureEnvelope),
    );

    expect(error).toBeInstanceOf(PersistenceMigrationError);
    expect(error).toMatchObject({
      code: MIGRATION_ERROR_CODES.FUTURE_SCHEMA_VERSION,
      details: {
        sourceVersion: '2.0.0',
        supportedVersion: '1.0.0',
      },
    });
    expect(futureEnvelope).toEqual({
      schemaVersion: '2.0.0',
      rootRevision: 8,
      slices: {
        futureData: {
          enabled: true,
        },
      },
    });
  });
});