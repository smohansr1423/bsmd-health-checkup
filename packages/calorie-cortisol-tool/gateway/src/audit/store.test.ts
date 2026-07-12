import { InMemoryAuditStore } from './store';
import type { AuditRecord } from './types';

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    actorId: 'u1',
    action: 'read',
    recordId: 'r1',
    timestamp: '2024-01-01T00:00:00.000Z',
    requestId: 'req-1',
    outcome: 'allowed',
    expiresAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryAuditStore', () => {
  it('appends records in order and reports size', () => {
    const store = new InMemoryAuditStore();
    store.append(record({ recordId: 'a' }));
    store.append(record({ recordId: 'b' }));

    expect(store.size).toBe(2);
    expect(store.list().map((r) => r.recordId)).toEqual(['a', 'b']);
  });

  it('returns a defensive snapshot from list()', () => {
    const store = new InMemoryAuditStore();
    store.append(record());
    const snapshot = store.list() as AuditRecord[];
    snapshot.push(record({ recordId: 'injected' }));

    expect(store.size).toBe(1);
  });

  it('never purges entries still within their retention window', () => {
    const store = new InMemoryAuditStore();
    store.append(record({ recordId: 'keep', expiresAt: '2030-01-01T00:00:00.000Z' }));

    const purged = store.purgeExpired(new Date('2029-01-01T00:00:00.000Z'));

    expect(purged).toHaveLength(0);
    expect(store.size).toBe(1);
  });

  it('purges only entries whose retention has fully elapsed', () => {
    const store = new InMemoryAuditStore();
    store.append(record({ recordId: 'expired', expiresAt: '2025-01-01T00:00:00.000Z' }));
    store.append(record({ recordId: 'active', expiresAt: '2031-01-01T00:00:00.000Z' }));

    const purged = store.purgeExpired(new Date('2030-01-01T00:00:00.000Z'));

    expect(purged.map((r) => r.recordId)).toEqual(['expired']);
    expect(store.list().map((r) => r.recordId)).toEqual(['active']);
  });
});
