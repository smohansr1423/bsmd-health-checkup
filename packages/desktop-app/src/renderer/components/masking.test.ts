/**
 * Unit tests for credential masking (Task 13.1 — Req 10.3, 10.4).
 */

import {
  MASK_CHARACTER,
  MASK_LENGTH,
  maskSecret,
  toMaskedCredential,
} from './masking';

describe('maskSecret', () => {
  it('returns a fixed-length bullet run for a non-empty secret', () => {
    expect(maskSecret('super-secret-token')).toBe(
      MASK_CHARACTER.repeat(MASK_LENGTH),
    );
  });

  it('masks short and long secrets to the same fixed length (no length leak)', () => {
    expect(maskSecret('a')).toBe(maskSecret('a-very-long-api-key-value-1234567890'));
  });

  it('returns an empty string for an empty secret', () => {
    expect(maskSecret('')).toBe('');
  });

  it('never includes any character of the original secret', () => {
    const secret = 'abcXYZ123!@#';
    const masked = maskSecret(secret);
    for (const ch of masked) {
      expect(ch).toBe(MASK_CHARACTER);
      expect(secret.includes(ch)).toBe(false);
    }
  });
});

describe('toMaskedCredential', () => {
  it('carries non-secret scheme/label and never the raw secret', () => {
    const view = toMaskedCredential({
      scheme: 'bearer',
      label: 'Production key',
      secret: 'plaintext-secret',
    });
    expect(view.scheme).toBe('bearer');
    expect(view.label).toBe('Production key');
    expect(view.masked).toBe(MASK_CHARACTER.repeat(MASK_LENGTH));
    expect(JSON.stringify(view)).not.toContain('plaintext-secret');
  });
});
