import { computeSignature, verifyHmacSignature } from './hmac';

const SECRET = 'lab-partner-shared-secret';

describe('HMAC verification (Req 8.4 — HMAC-verified webhook)', () => {
  const body = JSON.stringify({ orderId: 'ord_1', labPartnerId: 'lab_1', format: 'JSON' });

  it('accepts a correct signature', () => {
    const sig = computeSignature(body, SECRET);
    expect(verifyHmacSignature(body, sig, SECRET)).toBe(true);
  });

  it('accepts a correct signature with the sha256= scheme prefix', () => {
    const sig = `sha256=${computeSignature(body, SECRET)}`;
    expect(verifyHmacSignature(body, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = computeSignature(body, SECRET);
    expect(verifyHmacSignature(body + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = computeSignature(body, SECRET);
    expect(verifyHmacSignature(body, sig, 'other-secret')).toBe(false);
  });

  it('rejects a missing/empty signature or secret without throwing', () => {
    expect(verifyHmacSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyHmacSignature(body, '', SECRET)).toBe(false);
    expect(verifyHmacSignature(body, computeSignature(body, SECRET), '')).toBe(false);
  });

  it('rejects a non-hex / wrong-length signature without throwing', () => {
    expect(verifyHmacSignature(body, 'zzzz', SECRET)).toBe(false);
  });
});
