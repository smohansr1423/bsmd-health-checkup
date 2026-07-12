/**
 * Property-based tests for HTTPS-only base-URL acceptance.
 *
 * Property 2: Base URL is accepted, stored, and used iff it is HTTPS
 *   For any candidate base-URL string, it is accepted and stored (and used as
 *   the prefix of every subsequently resolved request URL) if and only if it
 *   is a non-empty HTTPS URL; any empty or non-HTTPS candidate is rejected,
 *   the previously stored base URL is left unchanged, and no request is
 *   transmitted against the rejected value.
 *
 * Validates: Requirements 1.2, 1.3, 4.5
 */

import * as fc from 'fast-check';
import {
  AppConfigStore,
  ConfigPersistence,
  isValidBaseUrl,
  resolveApiUrl,
} from './app-config';


/** In-memory persistence so the property runs never touch the filesystem. */
function inMemoryPersistence(
  initial: string | null = null,
): ConfigPersistence & { peek(): string | null; writes(): number } {
  let store = initial;
  let writeCount = 0;
  return {
    read: () => store,
    write: (serialized: string) => {
      store = serialized;
      writeCount += 1;
    },
    peek: () => store,
    writes: () => writeCount,
  };
}

/**
 * Independent oracle (derived straight from the requirements, not from the
 * implementation): a candidate is a valid base URL iff, after trimming, it is
 * non-empty and parses as a URL whose scheme is HTTPS.
 */
function isNonEmptyHttps(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    return new URL(trimmed).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Known-valid HTTPS base URLs (optionally padded with surrounding whitespace). */
const httpsUrlArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.webUrl({ validSchemes: ['https'] }),
    fc.constantFrom('', ' ', '  ', '\t'),
    fc.constantFrom('', ' ', '  ', '\n'),
  )
  .map(([url, lpad, rpad]) => `${lpad}${url}${rpad}`);

/** Known-invalid candidates: non-HTTPS schemes, empty/whitespace, malformed. */
const invalidUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.webUrl({ validSchemes: ['http'] }),
  fc.webUrl({ validSchemes: ['ftp'] }),
  fc.constantFrom('', '   ', '\t', '\n  \n'),
  fc.constantFrom('not a url', 'example.com', '://missing-scheme', 'https//nope'),
);

/** Relative backend paths that should be prefixed by the stored base URL. */
const relativePathArb: fc.Arbitrary<string> = fc
  .array(
    fc.stringMatching(/^[a-z0-9-]+$/).filter((s) => s.length > 0),
    { minLength: 1, maxLength: 4 },
  )
  .map((segments) => `/api/copilot/${segments.join('/')}`);

describe('Property 2: Base URL is accepted, stored, and used iff it is HTTPS', () => {
  it('acceptance matches the non-empty-HTTPS oracle for arbitrary candidates', () => {
    fc.assert(
      fc.property(
        fc.oneof(httpsUrlArb, invalidUrlArb, fc.string()),
        (candidate) => {
          const store = new AppConfigStore(inMemoryPersistence());
          const result = store.setBaseUrl(candidate);

          expect(result.accepted).toBe(isNonEmptyHttps(candidate));
          // The convenience predicate agrees with acceptance.
          expect(isValidBaseUrl(candidate)).toBe(isNonEmptyHttps(candidate));
        },
      )
    );
  });

  it('stores the trimmed HTTPS URL and uses it as the prefix of resolved URLs', () => {
    fc.assert(
      fc.property(httpsUrlArb, relativePathArb, (candidate, relativePath) => {
        const persistence = inMemoryPersistence();
        const store = new AppConfigStore(persistence);

        const result = store.setBaseUrl(candidate);
        expect(result.accepted).toBe(true);

        const trimmed = candidate.trim();
        expect(store.getBaseUrl()).toBe(trimmed);

        // The stored value was persisted.
        expect(persistence.peek()).not.toBeNull();
        const persisted = JSON.parse(persistence.peek() as string) as {
          backendBaseUrl: string | null;
        };
        expect(persisted.backendBaseUrl).toBe(trimmed);

        // Every resolved request URL is prefixed by the stored base URL
        // (trailing slashes are collapsed by the resolver).
        const prefix = trimmed.replace(/\/+$/, '');
        const resolved = store.resolve(relativePath);
        expect(resolved).not.toBeNull();
        expect(resolved).toBe(resolveApiUrl(trimmed, relativePath));
        expect((resolved as string).startsWith(prefix)).toBe(true);
      })
    );
  });

  it('rejects invalid candidates, leaves the prior value unchanged, and persists nothing new', () => {
    fc.assert(
      fc.property(
        httpsUrlArb,
        invalidUrlArb,
        relativePathArb,
        (validCandidate, invalidCandidate, relativePath) => {
          const persistence = inMemoryPersistence();
          const store = new AppConfigStore(persistence);

          // Establish a known-good stored base URL first.
          store.setBaseUrl(validCandidate);
          const storedBefore = store.getBaseUrl();
          const persistedBefore = persistence.peek();
          const writesBefore = persistence.writes();

          // Attempt to overwrite it with an invalid candidate.
          const result = store.setBaseUrl(invalidCandidate);

          // Rejected, with the previously stored value reported back.
          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            expect(result.baseUrl).toBe(storedBefore);
          }

          // The previously stored base URL is left unchanged...
          expect(store.getBaseUrl()).toBe(storedBefore);
          // ...and nothing was persisted for the rejected value.
          expect(persistence.peek()).toBe(persistedBefore);
          expect(persistence.writes()).toBe(writesBefore);

          // Resolution still uses the prior (valid) base URL, never the
          // rejected candidate: no request is transmitted against it.
          const resolved = store.resolve(relativePath);
          expect(resolved).toBe(
            resolveApiUrl(storedBefore as string, relativePath),
          );
          // The rejected candidate never appears in a resolved URL. (Guarded
          // for non-empty candidates: every string trivially "contains" "".)
          const rejected = invalidCandidate.trim();
          if (rejected.length > 0) {
            expect(resolved).not.toContain(rejected);
          }
        },
      )
    );
  });

  it('rejects an invalid candidate on a fresh store without configuring any base URL', () => {
    fc.assert(
      fc.property(invalidUrlArb, relativePathArb, (invalidCandidate, relativePath) => {
        const persistence = inMemoryPersistence();
        const store = new AppConfigStore(persistence);

        const result = store.setBaseUrl(invalidCandidate);

        expect(result.accepted).toBe(false);
        expect(store.getBaseUrl()).toBeNull();
        // Nothing was ever persisted for a rejected value on a fresh install.
        expect(persistence.peek()).toBeNull();
        // With no base URL configured, no request URL can be resolved.
        expect(store.resolve(relativePath)).toBeNull();
      })
    );
  });
});
