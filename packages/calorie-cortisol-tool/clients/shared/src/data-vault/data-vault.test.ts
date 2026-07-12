import fc from 'fast-check';
import {
  DataVault,
  InMemoryStorageBackend,
  PassthroughEncryptor,
  VAULT_MIN_FREE_BYTES,
  VaultErrorCode,
  type Encryptor,
  type VaultRecordInput,
} from './index';

/**
 * Unit and invariant tests for the on-device Data Vault storage layer (Task 2.4).
 *
 * Covers `put/get/list/delete`, sync-status handling, encryption-at-rest via the
 * injectable Encryptor port, and the 50 MB free-space precheck (Req 27.3).
 */

/** A reversible, non-identity test encryptor to prove payloads are NOT stored
 *  in the clear. (The real AES-256 per-user encryptor is task 3.1.) */
class ReversingEncryptor implements Encryptor {
  encrypt(plaintext: string): string {
    return `enc:${[...plaintext].reverse().join('')}`;
  }

  decrypt(ciphertext: string): string {
    const body = ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext;
    return [...body].reverse().join('');
  }
}

function makeVault(freeBytes?: number, encryptor?: Encryptor): {
  vault: DataVault;
  backend: InMemoryStorageBackend;
} {
  const backend = new InMemoryStorageBackend(
    freeBytes === undefined ? {} : { freeBytes },
  );
  const vault = new DataVault(backend, encryptor);
  return { vault, backend };
}

const sampleMeal = (id: string, userId = 'u1') => ({
  id,
  userId,
  kind: 'meal' as const,
  payload: { id, userId, loggedAt: '2024-01-01T12:00:00Z', items: [], calories: 0 },
});

describe('DataVault — put/get round-trip', () => {
  it('stores a record locally and reads it back with identical payload', () => {
    const { vault } = makeVault();
    const put = vault.put(sampleMeal('m1'));
    expect(put.ok).toBe(true);

    const got = vault.get('m1');
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.payload).toEqual(sampleMeal('m1').payload);
      expect(got.value.id).toBe('m1');
    }
  });

  it("defaults a new record's sync status to 'local' (Req 27.1)", () => {
    const { vault } = makeVault();
    const put = vault.put(sampleMeal('m1'));
    if (put.ok) {
      expect(put.value.syncStatus).toBe('local');
    }
  });

  it('honors an explicitly provided sync status', () => {
    const { vault } = makeVault();
    const put = vault.put({ ...sampleMeal('m1'), syncStatus: 'pending' });
    if (put.ok) {
      expect(put.value.syncStatus).toBe('pending');
    }
  });

  it('returns not-found for a missing id', () => {
    const { vault } = makeVault();
    const got = vault.get('nope');
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.error.code).toBe(VaultErrorCode.NotFound);
    }
  });
});

describe('DataVault — encryption at rest', () => {
  it('persists ciphertext, not plaintext, via the injected encryptor', () => {
    const { vault, backend } = makeVault(undefined, new ReversingEncryptor());
    vault.put(sampleMeal('m1'));

    const row = backend.read('m1');
    expect(row).toBeDefined();
    const plaintext = JSON.stringify(sampleMeal('m1').payload);
    // Stored ciphertext must differ from the serialized payload.
    expect(row?.ciphertext).not.toBe(plaintext);
    expect(row?.ciphertext.startsWith('enc:')).toBe(true);

    // ...and still decrypts back to the original payload.
    const got = vault.get('m1');
    if (got.ok) {
      expect(got.value.payload).toEqual(sampleMeal('m1').payload);
    }
  });
});

describe('DataVault — 50 MB free-space precheck (Req 27.3)', () => {
  it('uses the binary 50 MB minimum by default', () => {
    expect(VAULT_MIN_FREE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('rejects a NEW record when free space is below the minimum and retains prior records', () => {
    const { vault, backend } = makeVault();
    // Store one record with ample space.
    expect(vault.put(sampleMeal('m1')).ok).toBe(true);

    // Now simulate storage pressure below the 50 MB minimum.
    backend.setFreeBytes(VAULT_MIN_FREE_BYTES - 1);

    const rejected = vault.put(sampleMeal('m2'));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe(VaultErrorCode.InsufficientStorage);
      expect(rejected.error.retainedState).toBe(true);
    }

    // The previously stored record is unchanged and the new one was not stored.
    expect(vault.get('m1').ok).toBe(true);
    expect(vault.get('m2').ok).toBe(false);
    expect(backend.size).toBe(1);
  });

  it('accepts a new record when free space equals the minimum', () => {
    const { vault } = makeVault(VAULT_MIN_FREE_BYTES);
    expect(vault.put(sampleMeal('m1')).ok).toBe(true);
  });

  it('allows UPDATING an existing record even under storage pressure', () => {
    const { vault, backend } = makeVault();
    vault.put(sampleMeal('m1'));
    backend.setFreeBytes(0);

    // Updating the existing id requires no new space → permitted.
    const updated = vault.put({ ...sampleMeal('m1'), syncStatus: 'synced' });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.syncStatus).toBe('synced');
    }
  });
});

describe('DataVault — list & delete', () => {
  it('filters by userId, kind, and syncStatus', () => {
    const { vault } = makeVault();
    vault.put({ ...sampleMeal('m1', 'u1'), syncStatus: 'local' });
    vault.put({ ...sampleMeal('m2', 'u1'), syncStatus: 'synced' });
    vault.put({ ...sampleMeal('m3', 'u2'), syncStatus: 'local' });
    vault.put({
      id: 'c1',
      userId: 'u1',
      kind: 'cortisolReading',
      payload: { v: 1 },
      syncStatus: 'local',
    });

    expect(vault.list({ userId: 'u1' })).toHaveLength(3);
    expect(vault.list({ userId: 'u1', kind: 'meal' })).toHaveLength(2);
    expect(vault.list({ syncStatus: 'synced' })).toHaveLength(1);
    expect(vault.list()).toHaveLength(4);
  });

  it('delete removes only the target record and reports prior existence', () => {
    const { vault } = makeVault();
    vault.put(sampleMeal('m1'));
    vault.put(sampleMeal('m2'));

    const del = vault.delete('m1');
    expect(del.ok && del.value).toBe(true);
    expect(vault.get('m1').ok).toBe(false);
    expect(vault.get('m2').ok).toBe(true);

    const delMissing = vault.delete('m1');
    expect(delMissing.ok && delMissing.value).toBe(false);
  });
});

describe('DataVault — setSyncStatus', () => {
  it('transitions an existing record through the sync lifecycle', () => {
    const { vault } = makeVault();
    vault.put(sampleMeal('m1'));
    const res = vault.setSyncStatus('m1', 'conflict');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.syncStatus).toBe('conflict');
    }
    const got = vault.get('m1');
    expect(got.ok && got.value.syncStatus).toBe('conflict');
  });

  it('returns not-found for a missing record', () => {
    const { vault } = makeVault();
    const res = vault.setSyncStatus('ghost', 'synced');
    expect(res.ok).toBe(false);
  });
});

describe('DataVault — invariants (fast-check, ≥100 iterations)', () => {
  const arbSyncStatus = fc.constantFrom(
    'local',
    'pending',
    'synced',
    'conflict',
  ) as fc.Arbitrary<'local' | 'pending' | 'synced' | 'conflict'>;

  const arbRecord: fc.Arbitrary<VaultRecordInput<unknown>> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    userId: fc.constantFrom('u1', 'u2', 'u3'),
    kind: fc.constantFrom('meal', 'photo', 'cortisolReading'),
    payload: fc.jsonValue(),
    syncStatus: arbSyncStatus,
  });

  it('put→get is a lossless round-trip for arbitrary payloads and encryptors', () => {
    fc.assert(
      fc.property(
        arbRecord,
        fc.boolean(),
        (rec, useRealEncryptor) => {
          const encryptor = useRealEncryptor
            ? new ReversingEncryptor()
            : new PassthroughEncryptor();
          const { vault } = makeVault(undefined, encryptor);
          const put = vault.put(rec);
          expect(put.ok).toBe(true);
          const got = vault.get(rec.id);
          expect(got.ok).toBe(true);
          if (got.ok) {
            expect(got.value.payload).toStrictEqual(rec.payload);
            expect(got.value.syncStatus).toBe(rec.syncStatus);
            expect(got.value.userId).toBe(rec.userId);
          }
        },
      )
    );
  });

  it('below-minimum free space always rejects new records and never mutates the store', () => {
    fc.assert(
      fc.property(
        arbRecord,
        fc.integer({ min: 0, max: VAULT_MIN_FREE_BYTES - 1 }),
        (rec, freeBytes) => {
          const { vault, backend } = makeVault(freeBytes);
          const before = backend.size;
          const res = vault.put(rec);
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.error.code).toBe(VaultErrorCode.InsufficientStorage);
            expect(res.error.retainedState).toBe(true);
          }
          expect(backend.size).toBe(before);
        },
      )
    );
  });

  it('list length equals the number of stored distinct ids for a user', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
          maxLength: 15,
        }),
        (ids) => {
          const { vault } = makeVault();
          ids.forEach((id) =>
            vault.put({
              id,
              userId: 'u1',
              kind: 'meal',
              payload: { id },
            }),
          );
          expect(vault.list({ userId: 'u1' })).toHaveLength(ids.length);
        },
      )
    );
  });
});
