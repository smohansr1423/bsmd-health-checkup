/**
 * Conversation History Service — Property-Based Tests
 * Uses fast-check to validate universal correctness properties from the design document.
 *
 * These property tests complement any example-based unit tests: they exercise
 * the public API (`ConversationService.record`, `ConversationService.list`)
 * across a broad, generated input space using deterministic id/clock injection,
 * an in-memory conversation repository, and a workspace access-control seam.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 15.1, 15.2, 15.3, 15.6
 */

import * as fc from 'fast-check';

import {
  ConversationService,
  ConversationRecordError,
  ConversationAccessError,
} from './index';
import type {
  NewConversationEntry,
  WorkspaceAuthorizer,
  ConversationEntry,
  UserRef,
} from './index';
import {
  InMemoryConversationRepository,
} from '../api-copilot-shared';
import type { Answer, ConversationRepository } from '../api-copilot-shared';
import type { AccessDecision } from '../workspace';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic, monotonically increasing id generator for stable entry ids. */
function makeIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `entry_${counter}`;
  };
}

/**
 * A WorkspaceAuthorizer fake that grants access to every requester. Used by the
 * round-trip property, which is scoped to an authorized member (the isolation /
 * denial behaviour is covered by Property 40 in the workspace domain).
 */
function allowingAuthorizer(): WorkspaceAuthorizer {
  return {
    authorize: (requester: UserRef, workspaceId: string): AccessDecision => ({
      allowed: true,
      workspaceId,
      userId: requester.userId,
      role: 'member',
    }),
  };
}

/** A WorkspaceAuthorizer fake that denies every requester. */
function denyingAuthorizer(): WorkspaceAuthorizer {
  return {
    authorize: (requester: UserRef, workspaceId: string): AccessDecision => ({
      allowed: false,
      workspaceId,
      userId: requester.userId,
      role: null,
      reason: 'not_authorized',
    }),
  };
}

/** A ConversationRepository fake whose `save` always fails. */
function failingRepository(cause: Error): ConversationRepository {
  return {
    save: async (): Promise<ConversationEntry> => {
      throw cause;
    },
    list: async (): Promise<ConversationEntry[]> => [],
  };
}

// ─── Arbitraries ───────────────────────────────────────────────────────────────

/** A produced Answer with a text body, grounding flag, and citations. */
const answerArb: fc.Arbitrary<Answer> = fc.record({
  text: fc.string(),
  grounded: fc.boolean(),
  citations: fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
    maxLength: 5,
  }),
});

/** A non-empty submitting-user id. */
const userIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => `u:${s}`);

/**
 * A set of entries to record in a single workspace. Each entry gets a unique
 * question (index-tagged) so listed entries can be matched back one-to-one, and
 * an explicit `answeredAt` derived from a generated millisecond offset so the
 * ordering guarantee (most-recent-first) can be exercised with varied — and
 * frequently tied — timestamps.
 */
const entrySpecsArb = fc.array(
  fc.record({
    userId: userIdArb,
    baseQuestion: fc.string({ maxLength: 20 }),
    answer: answerArb,
    tMs: fc.integer({ min: 0, max: 5_000 }),
  }),
  { minLength: 0, maxLength: 12 }
);

// ─── Property 43: Conversation history round-trip and ordering ──────────────────
// Feature: api-copilot-ai, Property 43: For any set of recorded question/answer
// entries in a Workspace, listing the history for an authorized member returns
// exactly those entries, each carrying the submitting user's identity and the
// answer timestamp, ordered from most recent to oldest.
// Validates: Requirements 15.1, 15.3, 15.6

describe('Property 43: Conversation history round-trip and ordering', () => {
  it('lists exactly the recorded entries, most-recent-first, with identity and timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(entrySpecsArb, async (specs) => {
        const workspaceId = 'ws:conv';
        const service = new ConversationService({
          idGenerator: makeIdGenerator(),
          dateProvider: () => new Date('2024-01-01T00:00:00.000Z'),
          conversationRepository: new InMemoryConversationRepository(),
          workspaceAuthorizer: allowingAuthorizer(),
        });

        // Build the concrete entries with unique, index-tagged questions and
        // explicit answer timestamps.
        const inputs: NewConversationEntry[] = specs.map((s, i) => ({
          workspaceId,
          userId: s.userId,
          question: `q-${i}-${s.baseQuestion}`,
          answer: s.answer,
          answeredAt: new Date(s.tMs),
        }));

        for (const input of inputs) {
          await service.record(input);
        }

        const requester: UserRef = { userId: 'reader', accountId: 'acct' };
        const listed = await service.list(workspaceId, requester);

        // Returns exactly those entries — same count, one-to-one on question.
        expect(listed).toHaveLength(inputs.length);

        const byQuestion = new Map<string, NewConversationEntry>(
          inputs.map((e) => [e.question, e])
        );
        for (const entry of listed) {
          const source = byQuestion.get(entry.question);
          expect(source).toBeDefined();
          // Each carries the submitting user's identity (Req 15.6)...
          expect(entry.userId).toBe(source!.userId);
          // ...and the answer timestamp (Req 15.6)...
          expect(entry.answeredAt.getTime()).toBe(source!.answeredAt!.getTime());
          // ...and preserves the recorded answer (Req 15.1).
          expect(entry.answer).toEqual(source!.answer);
          expect(entry.workspaceId).toBe(workspaceId);
        }

        // Ordered from most recent to oldest (non-increasing answer time) (Req 15.3).
        for (let i = 1; i < listed.length; i += 1) {
          expect(listed[i - 1].answeredAt.getTime()).toBeGreaterThanOrEqual(
            listed[i].answeredAt.getTime()
          );
        }
      })
    );
  });

  it('returns an empty history without error when nothing was recorded', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        const service = new ConversationService({
          idGenerator: makeIdGenerator(),
          dateProvider: () => new Date('2024-01-01T00:00:00.000Z'),
          conversationRepository: new InMemoryConversationRepository(),
          workspaceAuthorizer: allowingAuthorizer(),
        });

        const listed = await service.list('ws:empty', {
          userId,
          accountId: 'acct',
        });
        expect(listed).toEqual([]);
      })
    );
  });

  it('denies an unauthorized reader disclosing no history content', async () => {
    await fc.assert(
      fc.asyncProperty(entrySpecsArb, userIdArb, async (specs, userId) => {
        const workspaceId = 'ws:conv';
        const service = new ConversationService({
          idGenerator: makeIdGenerator(),
          dateProvider: () => new Date('2024-01-01T00:00:00.000Z'),
          conversationRepository: new InMemoryConversationRepository(),
          workspaceAuthorizer: denyingAuthorizer(),
        });

        for (const [i, s] of specs.entries()) {
          await service.record({
            workspaceId,
            userId: s.userId,
            question: `q-${i}-${s.baseQuestion}`,
            answer: s.answer,
            answeredAt: new Date(s.tMs),
          });
        }

        await expect(
          service.list(workspaceId, { userId, accountId: 'acct' })
        ).rejects.toBeInstanceOf(ConversationAccessError);
      })
    );
  });
});

// ─── Property 44: Record failure preserves the answer ───────────────────────────
// Feature: api-copilot-ai, Property 44: For any answer whose Conversation_History
// recording fails, a save error is returned and the answer is still preserved for
// display to the requesting user without loss.
// Validates: Requirements 15.2

describe('Property 44: Record failure preserves the answer', () => {
  it('throws a ConversationRecordError carrying the produced answer without loss', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.string({ minLength: 1, maxLength: 30 }),
        answerArb,
        async (userId, question, answer) => {
          const cause = new Error('persistence layer unavailable');
          const service = new ConversationService({
            idGenerator: makeIdGenerator(),
            dateProvider: () => new Date('2024-01-01T00:00:00.000Z'),
            conversationRepository: failingRepository(cause),
            workspaceAuthorizer: allowingAuthorizer(),
          });

          const entry: NewConversationEntry = {
            workspaceId: 'ws:conv',
            userId,
            question,
            answer,
          };

          // A save error is returned...
          const error = await service.record(entry).then(
            () => {
              throw new Error('expected record to reject');
            },
            (e: unknown) => e
          );

          expect(error).toBeInstanceOf(ConversationRecordError);
          const recordError = error as ConversationRecordError;

          // ...and the answer is preserved for display without loss (Req 15.2).
          expect(recordError.answer).toEqual(answer);
          expect(recordError.answer.text).toBe(answer.text);
          expect(recordError.question).toBe(question);
          expect(recordError.workspaceId).toBe('ws:conv');
          expect(recordError.userId).toBe(userId);
          // The underlying failure is retained for diagnostics.
          expect(recordError.cause).toBe(cause);
        }
      )
    );
  });
});
