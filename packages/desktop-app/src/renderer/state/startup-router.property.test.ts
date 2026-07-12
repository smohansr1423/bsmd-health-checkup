/**
 * Startup Router — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 1 across a
 * broad, generated input space. These property tests complement any
 * example-based unit tests by exercising `routeStartup` over every combination
 * of (Session_Token present/absent) and (base URL configured/absent/invalid).
 *
 * Feature: api-copilot-desktop
 *
 * Property 1: Startup routing is a total function of stored state
 * Validates: Requirements 1.1, 1.4, 1.5
 */

import * as fc from 'fast-check';

import { routeStartup } from './startup-router';
import type { StartupDestination, StartupState } from './startup-router';

const ALL_DESTINATIONS: readonly StartupDestination[] = [
  'base-url-prompt',
  'authenticated-home',
  'sign-in',
];

/**
 * Local, independent oracle for what counts as a "configured" base URL.
 *
 * A base URL is configured iff it is a non-empty HTTPS URL (Req 1.2, 1.3). This
 * mirrors the router's internal check but is written separately here so the
 * test does not simply restate the implementation.
 */
function isConfiguredHttps(value: string | null): boolean {
  if (value === null || value.trim() === '') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Generator for base-URL candidates spanning the full input space:
 * `null`, empty/whitespace strings, valid HTTPS URLs, http/other-scheme URLs,
 * and arbitrary garbage strings that are not URLs at all.
 */
const baseUrlArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  fc.constantFrom('', '   ', '\t', '\n'),
  // Valid HTTPS URLs.
  fc
    .webUrl({ validSchemes: ['https'] })
    .map((u) => (u.startsWith('https://') ? u : `https://${u}`)),
  fc.constantFrom(
    'https://api.example.com',
    'https://localhost:3000/api',
    'https://10.0.0.1',
  ),
  // Non-HTTPS URLs.
  fc.webUrl({ validSchemes: ['http'] }),
  fc.constantFrom('http://insecure.example.com', 'ftp://host', 'ws://host'),
  // Arbitrary strings (mostly not URLs).
  fc.string(),
);

const startupStateArb: fc.Arbitrary<StartupState> = fc.record({
  configuredBaseUrl: baseUrlArb,
  hasToken: fc.boolean(),
});

describe('routeStartup — Property 1: total function of stored state', () => {
  it('always returns exactly one of the three known destinations', () => {
    fc.assert(
      fc.property(startupStateArb, (state) => {
        const dest = routeStartup(state);
        expect(ALL_DESTINATIONS).toContain(dest);
      })
    );
  });

  it('is deterministic: the same state always maps to the same destination', () => {
    fc.assert(
      fc.property(startupStateArb, (state) => {
        expect(routeStartup(state)).toBe(routeStartup({ ...state }));
      })
    );
  });

  it('routes to base-url-prompt whenever no valid HTTPS base URL is configured (Req 1.1)', () => {
    fc.assert(
      fc.property(startupStateArb, (state) => {
        fc.pre(!isConfiguredHttps(state.configuredBaseUrl));
        expect(routeStartup(state)).toBe('base-url-prompt');
      })
    );
  });

  it('routes to authenticated-home when a base URL is configured and a token is present (Req 1.4)', () => {
    fc.assert(
      fc.property(startupStateArb, (state) => {
        fc.pre(isConfiguredHttps(state.configuredBaseUrl) && state.hasToken);
        expect(routeStartup(state)).toBe('authenticated-home');
      })
    );
  });

  it('routes to sign-in when a base URL is configured but no token is present (Req 1.5)', () => {
    fc.assert(
      fc.property(startupStateArb, (state) => {
        fc.pre(isConfiguredHttps(state.configuredBaseUrl) && !state.hasToken);
        expect(routeStartup(state)).toBe('sign-in');
      })
    );
  });

  it('gates on base URL first: token presence never overrides an unconfigured base URL (Req 1.1)', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasToken) => {
        // For any unconfigured base-URL candidate, the destination is the
        // prompt regardless of whether a token exists.
        for (const configuredBaseUrl of [null, '', '   ', 'http://x', 'not-a-url']) {
          expect(routeStartup({ configuredBaseUrl, hasToken })).toBe('base-url-prompt');
        }
      })
    );
  });
});
