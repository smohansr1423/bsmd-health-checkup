/**
 * Version / Workspace Gating — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 12 across a
 * broad, generated input space. The version-scoped operations (ask, search,
 * generate) and the workspace-scoped operation (upload) must be *gated*: when
 * the required selection is absent they produce no `RequestDescriptor` and
 * instead surface a selection-required indication, so nothing is ever sent.
 *
 * Feature: api-copilot-desktop
 *
 * Property 12: Operations requiring an API version are gated when none is selected
 * Validates: Requirements 6.2, 7.5, 8.3, 13.4
 */

// Feature: api-copilot-desktop, Property 12: Operations requiring an API version are gated when none is selected
// Validates: Requirements 6.2, 7.5, 8.3, 13.4

import * as fc from 'fast-check';

import {
  knowledgeEngine,
  queryEngine,
  codeGenerator,
  isSelectionRequired,
} from './builders';
import type { GatedDescriptor, SelectionRequired } from './builders';
import {
  gateUpload,
  gateApiVersionOperation,
  hasActiveWorkspace,
  hasActiveApiVersion,
  isSelectionRequired as isSelectionRequiredIndication,
} from './validation';
import type { RequestDescriptor, UploadFile } from './types';

const RUNS = {} as const;

// ---- Generators over the valid input space ----

/** A non-empty string usable as an identifier or free-text field. */
const nonEmptyStringArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.length > 0);

/** A valid ApiSelection scope (an Active_API_Version is present). */
const apiSelectionArb = fc.record({
  workspaceId: nonEmptyStringArb,
  apiId: nonEmptyStringArb,
  version: fc.integer({ min: 1, max: 1000 }),
});

/** A valid upload file within limits. */
const uploadFileArb: fc.Arbitrary<UploadFile> = fc.record({
  name: nonEmptyStringArb,
  contentType: fc.constantFrom<'yaml' | 'json'>('yaml', 'json'),
  sizeBytes: fc.integer({ min: 0, max: 25 * 1024 * 1024 }),
  bytes: fc.uint8Array({ maxLength: 32 }).map((a) => a as Uint8Array),
});

/**
 * Assert that a gated result is a selection-required indication of the given
 * kind, carries a non-empty message, and is *not* a descriptor.
 */
function expectGated(
  result: GatedDescriptor,
  requires: SelectionRequired['requires'],
): void {
  // The core invariant: no RequestDescriptor is produced.
  expect(isSelectionRequired(result)).toBe(true);
  const gated = result as SelectionRequired;
  expect(gated.kind).toBe('selection_required');
  expect(gated.requires).toBe(requires);
  // A selection-required indication is surfaced to the User.
  expect(typeof gated.message).toBe('string');
  expect(gated.message.length).toBeGreaterThan(0);
  // Defensive: none of the descriptor fields leak through.
  expect((result as Partial<RequestDescriptor>).path).toBeUndefined();
  expect((result as Partial<RequestDescriptor>).method).toBeUndefined();
}

// ---------------------------------------------------------------------------
// Version-scoped operations are gated when no Active_API_Version is set.
// selection === null models "no Active_API_Version". (Req 7.5, 8.3, 13.4)
// ---------------------------------------------------------------------------

describe('Property 12 — version-scoped operations gated with no Active_API_Version', () => {
  it('queryEngine.ask → selection_required(apiVersion), no descriptor (Req 8.3, 7.5)', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (question) => {
        const result = queryEngine.ask(null, question);
        expectGated(result, 'apiVersion');
      }),
      RUNS,
    );
  });

  it('queryEngine.search → selection_required(apiVersion), no descriptor (Req 7.5)', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (query) => {
        const result = queryEngine.search(null, query);
        expectGated(result, 'apiVersion');
      }),
      RUNS,
    );
  });

  it('codeGenerator.generate → selection_required(apiVersion), no descriptor (Req 13.4, 7.5)', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, nonEmptyStringArb, (endpointId, language) => {
        const result = codeGenerator.generate(null, endpointId, language);
        expectGated(result, 'apiVersion');
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Workspace-scoped upload is gated when no Active_Workspace is set.
// activeWorkspaceId === null models "no Active_Workspace". (Req 6.2)
// ---------------------------------------------------------------------------

describe('Property 12 — upload gated with no Active_Workspace', () => {
  it('knowledgeEngine.upload → selection_required(workspace), no descriptor (Req 6.2)', () => {
    fc.assert(
      fc.property(uploadFileArb, fc.option(nonEmptyStringArb, { nil: undefined }), (file, apiId) => {
        const result = knowledgeEngine.upload(null, file, apiId);
        expectGated(result, 'workspace');
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Complement: gating triggers *only* on the absent selection. When the required
// selection is present, a real descriptor (not a gating result) is produced.
// This confirms the gate is precise, not blanket. (Req 6.2, 7.5, 8.3, 13.4)
// ---------------------------------------------------------------------------

describe('Property 12 — required selection present yields a descriptor (gate is precise)', () => {
  it('ask/search/generate produce a descriptor when an Active_API_Version is set', () => {
    fc.assert(
      fc.property(
        apiSelectionArb,
        nonEmptyStringArb,
        nonEmptyStringArb,
        (selection, text, language) => {
          expect(isSelectionRequired(queryEngine.ask(selection, text))).toBe(false);
          expect(isSelectionRequired(queryEngine.search(selection, text))).toBe(false);
          expect(
            isSelectionRequired(codeGenerator.generate(selection, text, language)),
          ).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it('upload produces a descriptor when an Active_Workspace is set', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, uploadFileArb, (workspaceId, file) => {
        expect(isSelectionRequired(knowledgeEngine.upload(workspaceId, file))).toBe(false);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// The pure gating predicates in validation.ts back the gated builders above.
// Model "no selection" with both null and undefined to cover the full absent
// input space. (Req 6.2, 7.5, 8.3, 13.4)
// ---------------------------------------------------------------------------

/** Both ways an absent selection can be expressed. */
const absentArb = fc.constantFrom<null | undefined>(null, undefined);

describe('Property 12 — gating predicates reject when the selection is absent', () => {
  it('gateApiVersionOperation → selection_required(apiVersion) for any absent version', () => {
    fc.assert(
      fc.property(absentArb, (absent) => {
        expect(hasActiveApiVersion(absent)).toBe(false);
        const result = gateApiVersionOperation(absent);
        expect(isSelectionRequiredIndication(result)).toBe(true);
        expect(result?.requires).toBe('apiVersion');
        expect((result?.message.length ?? 0)).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it('gateUpload → selection_required(workspace) for any absent/empty workspace id', () => {
    fc.assert(
      fc.property(
        fc.oneof(absentArb, fc.constant('')),
        (absentWorkspace) => {
          expect(hasActiveWorkspace(absentWorkspace)).toBe(false);
          const result = gateUpload(absentWorkspace);
          expect(isSelectionRequiredIndication(result)).toBe(true);
          expect(result?.requires).toBe('workspace');
          expect((result?.message.length ?? 0)).toBeGreaterThan(0);
        },
      ),
      RUNS,
    );
  });
});

describe('Property 12 — gating predicates pass when the selection is present (gate is precise)', () => {
  it('gateApiVersionOperation → null when an Active_API_Version is present', () => {
    fc.assert(
      fc.property(apiSelectionArb, (selection) => {
        expect(hasActiveApiVersion(selection)).toBe(true);
        expect(gateApiVersionOperation(selection)).toBeNull();
      }),
      RUNS,
    );
  });

  it('gateUpload → null when an Active_Workspace id is present', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (workspaceId) => {
        expect(hasActiveWorkspace(workspaceId)).toBe(true);
        expect(gateUpload(workspaceId)).toBeNull();
      }),
      RUNS,
    );
  });
});
