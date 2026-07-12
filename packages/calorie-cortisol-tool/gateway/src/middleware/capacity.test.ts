import { ConcurrencyCapacityController } from './capacity';
import type { GatewayRequest } from '../types';

const req: GatewayRequest = {
  id: '1',
  kind: 'rest',
  method: 'POST',
  path: '/recognize',
  headers: {},
};

describe('ConcurrencyCapacityController', () => {
  it('admits up to maxConcurrent, then sheds', () => {
    const c = new ConcurrencyCapacityController({ maxConcurrent: 2 });
    const a1 = c.tryAdmit(req);
    const a2 = c.tryAdmit(req);
    expect(a1.admitted).toBe(true);
    expect(a2.admitted).toBe(true);
    expect(c.inFlightCount).toBe(2);

    const a3 = c.tryAdmit(req);
    expect(a3.admitted).toBe(false);
    expect(a3.queued).toBe(false); // no queue configured -> rejected
  });

  it('queues excess when queue headroom remains', () => {
    const c = new ConcurrencyCapacityController({ maxConcurrent: 1, maxQueue: 1 });
    c.tryAdmit(req); // fills concurrency
    const shed = c.tryAdmit(req);
    expect(shed.admitted).toBe(false);
    expect(shed.queued).toBe(true); // queued rather than rejected
  });

  it('frees a slot on release, preserving in-progress admissions', () => {
    const c = new ConcurrencyCapacityController({ maxConcurrent: 1 });
    const a1 = c.tryAdmit(req);
    expect(c.tryAdmit(req).admitted).toBe(false);
    a1.release();
    expect(c.inFlightCount).toBe(0);
    expect(c.tryAdmit(req).admitted).toBe(true);
  });

  it('release is idempotent (double release cannot corrupt counts)', () => {
    const c = new ConcurrencyCapacityController({ maxConcurrent: 2 });
    const a = c.tryAdmit(req);
    c.tryAdmit(req);
    a.release();
    a.release();
    expect(c.inFlightCount).toBe(1);
  });

  it('rejects invalid configuration', () => {
    expect(() => new ConcurrencyCapacityController({ maxConcurrent: 0 })).toThrow();
  });
});
