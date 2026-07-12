/**
 * Execution-Plan Gating — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 18 across a
 * broad, generated input space. After a plan request the backend reports the
 * complete set of `requiredValues` for an endpoint. The client must *gate* the
 * execute request: while any reported value is still absent from the values the
 * User has supplied, no execute `RequestDescriptor` is produced (the caller is
 * told which values are still required); once every reported value is supplied,
 * the execute descriptor is produced.
 *
 * Feature: api-copilot-desktop
 *
 * Property 18: Execution is blocked until every required value is supplied
 * Validates: Requirements 11.2
 */

import * as fc from 'fast-check';

import type { executionEngine as executionEngineTypes } from '@health-checkup/services';
import type { RequestDescriptor } from './types';
import { API_COPILOT_BASE } from './builders';
import {
  gateExecution,
  findMissingPlanValues,
  isValuesRequired,
  type ExecutionGateResult,
  type ValuesRequired,
} from './execution-gating';

const RUNS = {} as const;

type RequiredValueRef = executionEngineTypes.RequiredValueRef;
type ParamValues = executionEngineTypes.ParamValues;
type ExecutionPlan = executionEngineTypes.ExecutionPlan;

// ---- Generators over the reported-requirement space -----------------------

/**
 * Non-authentication locations only. Authentication is handled separately
 * because the domain models it as a single boolean (`authConfigured`), so the
 * backend emits at most ONE `authentication` requirement — generating several
 * auth refs with different names would not correspond to any reachable plan.
 */
const NON_AUTH_LOCATIONS: RequiredValueRef['location'][] = [
  'path',
  'query',
  'header',
  'cookie',
  'body',
];

const nonEmptyNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

const nonAuthRefArb: fc.Arbitrary<RequiredValueRef> = fc.record({
  location: fc.constantFrom(...NON_AUTH_LOCATIONS),
  name: nonEmptyNameArb,
});

/** Canonical key so a ref set is compared independent of ordering. */
const refKey = (r: RequiredValueRef): string => `${r.location}:${r.name}`;

/**
 * A set of required refs, unique by (location, name); may be empty. Non-auth
 * refs are generated freely, then a SINGLE `authentication` ref is optionally
 * appended — never more than one — mirroring the backend's requirement model.
 */
const refSetArb = (opts: { minLength: number }): fc.Arbitrary<RequiredValueRef[]> =>
  fc
    .record({
      nonAuth: fc.uniqueArray(nonAuthRefArb, { selector: refKey, maxLength: 7 }),
      auth: fc.option(nonEmptyNameArb, { nil: undefined }),
    })
    .map(({ nonAuth, auth }) =>
      auth === undefined
        ? nonAuth
        : [...nonAuth, { location: 'authentication' as const, name: auth }],
    )
    .filter((refs) => refs.length >= opts.minLength);

/**
 * Build a `ParamValues` bag that supplies exactly the given refs (and nothing
 * else). Mirrors the backend's provide-for rule: scalars get a non-empty value,
 * body fields get a value, and `authentication` sets `authConfigured`.
 */
function provideFor(refs: RequiredValueRef[]): ParamValues {
  const provided: ParamValues = {};
  for (const ref of refs) {
    switch (ref.location) {
      case 'path':
        (provided.path ??= {})[ref.name] = 'v';
        break;
      case 'query':
        (provided.query ??= {})[ref.name] = 'v';
        break;
      case 'header':
        (provided.header ??= {})[ref.name] = 'v';
        break;
      case 'cookie':
        (provided.cookie ??= {})[ref.name] = 'v';
        break;
      case 'body':
        (provided.body ??= {})[ref.name] = 'v';
        break;
      case 'authentication':
        provided.authConfigured = true;
        break;
    }
  }
  return provided;
}

/**
 * A minimal but structurally-complete {@link ExecutionPlan} carrying the given
 * required values. Gating only reads `requiredValues`; the execute builder only
 * wraps the plan in a request body, so the remaining fields are filler.
 */
function planWith(requiredValues: RequiredValueRef[]): ExecutionPlan {
  return {
    apiSelection: { workspaceId: 'ws', apiId: 'api', version: 1 },
    endpointId: 'endpoint-1',
    target: { baseUrl: 'https://api.example.com', path: '/x', method: 'GET' },
    request: { method: 'GET', url: 'https://api.example.com/x', headers: {} },
    requiresAuth: requiredValues.some((r) => r.location === 'authentication'),
    requiredValues,
  } as unknown as ExecutionPlan;
}

function asValuesRequired(result: ExecutionGateResult): ValuesRequired {
  expect(isValuesRequired(result)).toBe(true);
  return result as ValuesRequired;
}

// ---------------------------------------------------------------------------

describe('Property 18 — execution blocked until every required value is supplied', () => {
  it('produces NO execute descriptor while any reported value is missing (Req 11.2)', () => {
    fc.assert(
      fc.property(
        refSetArb({ minLength: 1 }).chain((refs) =>
          // Withhold a non-empty subset of the reported requirements.
          fc.subarray(refs, { minLength: 1 }).map((withheld) => ({ refs, withheld })),
        ),
        ({ refs, withheld }) => {
          const withheldKeys = new Set(withheld.map(refKey));
          const supplied = provideFor(refs.filter((r) => !withheldKeys.has(refKey(r))));

          const result = gateExecution(planWith(refs), supplied);

          // No RequestDescriptor is produced.
          const gated = asValuesRequired(result);
          // Every withheld value is reported back as still-missing, nothing more.
          expect(new Set(gated.missing.map(refKey))).toEqual(withheldKeys);
          expect(gated.missing.length).toBeGreaterThan(0);
        },
      ),
      RUNS,
    );
  });

  it('produces the execute descriptor once every reported value is supplied (Req 11.2)', () => {
    fc.assert(
      fc.property(refSetArb({ minLength: 0 }), (refs) => {
        const supplied = provideFor(refs);

        const result = gateExecution(planWith(refs), supplied);

        // A real descriptor — not a gating result — is produced.
        expect(isValuesRequired(result)).toBe(false);
        const d = result as RequestDescriptor;
        expect(d.method).toBe('POST');
        expect(d.path).toBe(`${API_COPILOT_BASE}/execution-engine/execute`);
        expect(d.requiresAuth).toBe(true);
        expect(findMissingPlanValues(planWith(refs), supplied)).toHaveLength(0);
      }),
      RUNS,
    );
  });

  it('a plan with no required values is never gated (Req 11.2)', () => {
    fc.assert(
      fc.property(
        // Arbitrary supplied values must not matter when nothing is required.
        fc.record({
          path: fc.dictionary(nonEmptyNameArb, fc.string()),
          authConfigured: fc.boolean(),
        }),
        (supplied) => {
          const result = gateExecution(planWith([]), supplied as ParamValues);
          expect(isValuesRequired(result)).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it('supplying strictly more values never re-blocks an already-satisfied plan (Req 11.2)', () => {
    fc.assert(
      fc.property(refSetArb({ minLength: 0 }), refSetArb({ minLength: 0 }), (required, extra) => {
        const suppliedKeys = new Set([...required, ...extra].map(refKey));
        const supplied = provideFor([...required, ...extra]);

        const result = gateExecution(planWith(required), supplied);

        // All required keys are a subset of supplied keys, so it must pass.
        expect(required.every((r) => suppliedKeys.has(refKey(r)))).toBe(true);
        expect(isValuesRequired(result)).toBe(false);
      }),
      RUNS,
    );
  });
});
