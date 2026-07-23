/**
 * Unit tests for the HS256 JWT sign/verify utility.
 */

import { signToken, verifyToken } from './jwt';

const SECRET = 'test-secret-at-least-16-chars-long';

describe('jwt.signToken / verifyToken', () => {
  it('round-trips claims for a valid token', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const { token, issuedAt, expiresAt } = signToken(
      { sub: 'user-1', role: 'Administrator', sid: 'sess-1' },
      SECRET,
      60_000,
      now
    );

    expect(issuedAt.getTime()).toBe(now.getTime());
    expect(expiresAt.getTime()).toBe(now.getTime() + 60_000);

    const claims = verifyToken(token, SECRET, new Date(now.getTime() + 1_000));
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('user-1');
    expect(claims!.role).toBe('Administrator');
    expect(claims!.sid).toBe('sess-1');
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = signToken({ sub: 'u', role: 'Physician', sid: 's' }, SECRET, 60_000);
    expect(verifyToken(token, 'a-different-secret-value')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const { token } = signToken({ sub: 'u', role: 'Physician', sid: 's' }, SECRET, 60_000);
    const [h, , sig] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', role: 'Administrator', sid: 's', iat: 1, exp: 9999999999 })
    ).toString('base64url');
    expect(verifyToken(`${h}.${forgedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const { token } = signToken({ sub: 'u', role: 'Caregiver', sid: 's' }, SECRET, 1_000, now);
    // Evaluate one second past expiry.
    expect(verifyToken(token, SECRET, new Date(now.getTime() + 1_001))).toBeNull();
  });

  it('rejects the alg:none downgrade', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u', role: 'Administrator', sid: 's', iat: 1, exp: 9999999999 })
    ).toString('base64url');
    // Empty signature — a naive verifier accepting alg:none would pass this.
    expect(verifyToken(`${header}.${payload}.`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken('', SECRET)).toBeNull();
    expect(verifyToken('a.b', SECRET)).toBeNull();
    expect(verifyToken('a.b.c.d', SECRET)).toBeNull();
    expect(verifyToken('not-a-token', SECRET)).toBeNull();
  });
});
