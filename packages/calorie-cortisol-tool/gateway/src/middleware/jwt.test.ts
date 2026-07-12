import { HmacJwtVerifier, mintHs256, signHs256 } from './jwt';

const SECRET = 'test-signing-secret';

describe('HmacJwtVerifier', () => {
  it('verifies a well-formed, unexpired HS256 token', () => {
    const clock = () => 1_000_000; // ms
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock });
    const token = mintHs256(
      { sub: 'user-1', exp: 2000, roles: ['member'], region: 'EU' },
      SECRET,
    );
    const result = verifier.verify(token);
    expect(result.valid).toBe(true);
    expect(result.principal).toEqual({
      userId: 'user-1',
      roles: ['member'],
      region: 'EU',
    });
  });

  it('rejects a token with a tampered payload (signature mismatch)', () => {
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock: () => 0 });
    const token = mintHs256({ sub: 'user-1' }, SECRET);
    const [h, , s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const forged = `${h}.${forgedPayload}.${s}`;
    const result = verifier.verify(forged);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('rejects a token signed with the wrong secret', () => {
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock: () => 0 });
    const token = mintHs256({ sub: 'user-1' }, 'other-secret');
    expect(verifier.verify(token).valid).toBe(false);
  });

  it('rejects an expired token using the injected clock', () => {
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock: () => 5_000_000 });
    const token = mintHs256({ sub: 'user-1', exp: 1000 }, SECRET); // exp=1000s
    const result = verifier.verify(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('token expired');
  });

  it('honours clock-skew tolerance at the expiry boundary', () => {
    // now = 1010s, exp = 1000s, skew = 30s -> still valid
    const verifier = new HmacJwtVerifier({
      secret: SECRET,
      clock: () => 1_010_000,
      clockSkewSeconds: 30,
    });
    const token = mintHs256({ sub: 'user-1', exp: 1000 }, SECRET);
    expect(verifier.verify(token).valid).toBe(true);
  });

  it('rejects a not-yet-valid (nbf) token', () => {
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock: () => 500_000 });
    const token = mintHs256({ sub: 'user-1', nbf: 1000 }, SECRET); // nbf=1000s > 500s
    expect(verifier.verify(token).valid).toBe(false);
  });

  it('rejects alg: none and algorithm confusion', () => {
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock: () => 0 });
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/, '');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1' }))
      .toString('base64')
      .replace(/=+$/, '');
    const result = verifier.verify(`${header}.${payload}.`);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('unsupported alg');
  });

  it('rejects malformed tokens and missing subjects', () => {
    const verifier = new HmacJwtVerifier({ secret: SECRET, clock: () => 0 });
    expect(verifier.verify('').valid).toBe(false);
    expect(verifier.verify('a.b').valid).toBe(false);
    const noSub = mintHs256({ sub: '' }, SECRET);
    expect(verifier.verify(noSub).valid).toBe(false);
  });

  it('signHs256 is deterministic for the same input', () => {
    expect(signHs256('a.b', SECRET)).toBe(signHs256('a.b', SECRET));
    expect(signHs256('a.b', SECRET)).not.toBe(signHs256('a.c', SECRET));
  });
});
