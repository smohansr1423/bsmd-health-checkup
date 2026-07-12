/**
 * Pre-send Validators — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 3 across a
 * broad, generated input space. These property tests complement example-based
 * unit tests by exercising every validator over both invalid inputs (which must
 * be rejected with the offending field identified and no descriptor produced)
 * and valid inputs (which must pass).
 *
 * Feature: api-copilot-desktop
 *
 * Property 3: Invalid form input is rejected before any request is sent
 * Validates: Requirements 2.3, 3.3, 5.3, 6.3, 8.2, 9.4
 */

import * as fc from 'fast-check';

import {
  validateSignUp,
  validateSignIn,
  validateWorkspaceName,
  validateUpload,
  validateQuestion,
  validateSearchQuery,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  TEXT_QUERY_MIN_LENGTH,
  TEXT_QUERY_MAX_LENGTH,
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_CONTENT_TYPES,
} from './validation';
import type { SignUpInput, SignInInput, UploadFile } from './types';

const RUNS = {} as const;

/**
 * A validator returning a non-null result models "no RequestDescriptor is
 * produced" — the caller only builds a descriptor when validation returns null.
 * This helper asserts the rejection shape: a field-identified validation_error.
 */
function expectRejectedWithField(
  result: { kind: string; field?: string; message: string } | null,
  expectedField: string,
): void {
  expect(result).not.toBeNull();
  expect(result?.kind).toBe('validation_error');
  expect(result?.field).toBe(expectedField);
  expect(typeof result?.message).toBe('string');
  expect((result?.message ?? '').length).toBeGreaterThan(0);
}

// ---- Generators over the input space ----

/** A non-whitespace-trimmable string of a bounded length (never all-blank). */
const nonBlankArb = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc
    .string({ minLength, maxLength })
    .filter((s) => s.trim().length > 0 && s.length >= minLength && s.length <= maxLength);

/** A valid email: contains "@" and is non-blank. */
const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('@') && s.trim().length > 0),
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('@') && s.trim().length > 0),
  )
  .map(([local, domain]) => `${local}@${domain}`);

/** A valid password: length within [MIN, MAX] and not all-whitespace. */
const validPasswordArb: fc.Arbitrary<string> = fc
  .string({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  .filter((s) => s.trim().length > 0);

describe('validateSignUp — Property 3 (Req 2.3)', () => {
  it('rejects an email lacking "@" and identifies the email field', () => {
    const arb = fc.record({
      email: fc
        .string({ minLength: 1, maxLength: 40 })
        .filter((s) => !s.includes('@') && s.trim().length > 0),
      password: validPasswordArb,
    });
    fc.assert(
      fc.property(arb, (input) => {
        expectRejectedWithField(validateSignUp(input as SignUpInput), 'email');
      }),
      RUNS,
    );
  });

  it('rejects a password whose length is outside [8, 128] and identifies the password field', () => {
    const shortPw = fc
      .string({ minLength: 1, maxLength: PASSWORD_MIN_LENGTH - 1 })
      .filter((s) => s.trim().length > 0);
    const longPw = fc
      .string({ minLength: PASSWORD_MAX_LENGTH + 1, maxLength: PASSWORD_MAX_LENGTH + 50 })
      .filter((s) => s.trim().length > 0);
    const arb = fc.record({
      email: validEmailArb,
      password: fc.oneof(shortPw, longPw),
    });
    fc.assert(
      fc.property(arb, (input) => {
        expectRejectedWithField(validateSignUp(input as SignUpInput), 'password');
      }),
      RUNS,
    );
  });

  it('rejects a blank required field and identifies that field', () => {
    const blank = fc.constantFrom('', '   ', '\t', '\n', '  \t ');
    // email is inserted first, so a blank email is reported as the email field;
    // a valid email with a blank password reports the password field.
    const blankEmailArb = fc
      .record({ email: blank, password: validPasswordArb })
      .map((input) => ({ input, field: 'email' }));
    const blankPasswordArb = fc
      .record({ email: validEmailArb, password: blank })
      .map((input) => ({ input, field: 'password' }));
    fc.assert(
      fc.property(fc.oneof(blankEmailArb, blankPasswordArb), ({ input, field }) => {
        expectRejectedWithField(validateSignUp(input as SignUpInput), field);
      }),
      RUNS,
    );
  });

  it('accepts a well-formed sign-up (returns null)', () => {
    const arb = fc.record({ email: validEmailArb, password: validPasswordArb });
    fc.assert(
      fc.property(arb, (input) => {
        expect(validateSignUp(input as SignUpInput)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe('validateSignIn — Property 3 (Req 3.3)', () => {
  it('rejects a blank email and identifies the email field', () => {
    const arb = fc.record({
      email: fc.constantFrom('', '   ', '\t', '\n'),
      password: fc.string({ minLength: 1, maxLength: 40 }),
    });
    fc.assert(
      fc.property(arb, (input) => {
        expectRejectedWithField(validateSignIn(input as SignInInput), 'email');
      }),
      RUNS,
    );
  });

  it('rejects an empty password (with a valid email) and identifies the password field', () => {
    const arb = fc.record({ email: validEmailArb, password: fc.constant('') });
    fc.assert(
      fc.property(arb, (input) => {
        expectRejectedWithField(validateSignIn(input as SignInInput), 'password');
      }),
      RUNS,
    );
  });

  it('accepts non-empty email and password (returns null)', () => {
    const arb = fc.record({
      email: validEmailArb,
      password: fc.string({ minLength: 1, maxLength: 40 }),
    });
    fc.assert(
      fc.property(arb, (input) => {
        expect(validateSignIn(input as SignInInput)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe('validateWorkspaceName — Property 3 (Req 5.3)', () => {
  it('rejects an empty or over-long name and identifies the name field', () => {
    const tooLong = fc.string({
      minLength: WORKSPACE_NAME_MAX_LENGTH + 1,
      maxLength: WORKSPACE_NAME_MAX_LENGTH + 50,
    });
    const arb = fc.oneof(fc.constant(''), tooLong);
    fc.assert(
      fc.property(arb, (name) => {
        expectRejectedWithField(validateWorkspaceName(name), 'name');
      }),
      RUNS,
    );
  });

  it('accepts a name within [1, 100] (returns null)', () => {
    const arb = fc.string({
      minLength: WORKSPACE_NAME_MIN_LENGTH,
      maxLength: WORKSPACE_NAME_MAX_LENGTH,
    });
    fc.assert(
      fc.property(arb, (name) => {
        expect(validateWorkspaceName(name)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe('validateUpload — Property 3 (Req 6.3)', () => {
  const bytesArb = fc.uint8Array({ maxLength: 8 }).map((a) => a as Uint8Array);

  it('rejects a file exceeding 25 MB and identifies the file field', () => {
    const arb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      contentType: fc.constantFrom(...SUPPORTED_UPLOAD_CONTENT_TYPES),
      sizeBytes: fc.integer({ min: MAX_UPLOAD_BYTES + 1, max: MAX_UPLOAD_BYTES * 4 }),
      bytes: bytesArb,
    });
    fc.assert(
      fc.property(arb, (file) => {
        expectRejectedWithField(validateUpload(file as UploadFile), 'file');
      }),
      RUNS,
    );
  });

  it('rejects an unsupported content type and identifies the file field', () => {
    const supported = new Set<string>(SUPPORTED_UPLOAD_CONTENT_TYPES);
    const arb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      contentType: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !supported.has(s)),
      sizeBytes: fc.integer({ min: 0, max: MAX_UPLOAD_BYTES }),
      bytes: bytesArb,
    });
    fc.assert(
      fc.property(arb, (file) => {
        expectRejectedWithField(validateUpload(file as unknown as UploadFile), 'file');
      }),
      RUNS,
    );
  });

  it('accepts a supported file within the size limit (returns null)', () => {
    const arb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      contentType: fc.constantFrom(...SUPPORTED_UPLOAD_CONTENT_TYPES),
      sizeBytes: fc.integer({ min: 0, max: MAX_UPLOAD_BYTES }),
      bytes: bytesArb,
    });
    fc.assert(
      fc.property(arb, (file) => {
        expect(validateUpload(file as UploadFile)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe('validateQuestion / validateSearchQuery — Property 3 (Req 8.2, 9.4)', () => {
  const tooLongArb = fc.string({
    minLength: TEXT_QUERY_MAX_LENGTH + 1,
    maxLength: TEXT_QUERY_MAX_LENGTH + 100,
  });
  const invalidTextArb = fc.oneof(fc.constant(''), tooLongArb);
  const validTextArb = fc.string({
    minLength: TEXT_QUERY_MIN_LENGTH,
    maxLength: TEXT_QUERY_MAX_LENGTH,
  });

  it('rejects an empty or over-long question and identifies the question field', () => {
    fc.assert(
      fc.property(invalidTextArb, (text) => {
        expectRejectedWithField(validateQuestion(text), 'question');
      }),
      RUNS,
    );
  });

  it('rejects an empty or over-long search query and identifies the query field', () => {
    fc.assert(
      fc.property(invalidTextArb, (text) => {
        expectRejectedWithField(validateSearchQuery(text), 'query');
      }),
      RUNS,
    );
  });

  it('accepts a question within [1, 1000] (returns null)', () => {
    fc.assert(
      fc.property(validTextArb, (text) => {
        expect(validateQuestion(text)).toBeNull();
      }),
      RUNS,
    );
  });

  it('accepts a search query within [1, 1000] (returns null)', () => {
    fc.assert(
      fc.property(validTextArb, (text) => {
        expect(validateSearchQuery(text)).toBeNull();
      }),
      RUNS,
    );
  });
});
