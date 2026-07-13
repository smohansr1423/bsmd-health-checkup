/**
 * Unit tests for scrypt password hashing.
 */

import { hashPassword, verifyPassword } from './password';

describe('password.hashPassword / verifyPassword', () => {
  it('verifies a correct password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('s3cret');
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces distinct hashes for the same password (random salt)', () => {
    const a = hashPassword('same');
    const b = hashPassword('same');
    expect(a).not.toBe(b);
    expect(verifyPassword('same', a)).toBe(true);
    expect(verifyPassword('same', b)).toBe(true);
  });

  it('returns false for malformed hash strings', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$16384$8$1$only-two-parts')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$1$1$1$aaaa$bbbb')).toBe(false);
  });

  it('uses the recognizable scrypt$ format', () => {
    expect(hashPassword('p')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  });
});
