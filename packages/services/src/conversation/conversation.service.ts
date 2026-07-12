/**
 * Conversation History Service
 *
 * Records each Q&A entry produced by the Query_Engine and exposes a workspace's
 * Conversation_History to authorized members.
 *
 * Business rules:
 * - Record each entry carrying the submitting user's identity and the answer
 *   timestamp; the in-memory path completes within the 2s target (Req 15.1,
 *   15.6). On a persistence failure, surface a save error that still preserves
 *   the answer for display (Req 15.2).
 * - List a workspace's history most-recent-first for authorized members
 *   (Req 15.3); return an empty list without error when there are none
 *   (Req 15.5); deny unauthorized readers while disclosing no content (Req 15.4).
 * - Entries are retained indefinitely by the default store, satisfying the
 *   ≥ 365-day minimum retention (Req 15.7).
 *
 * Integration seam: `QueryEngine.ask` (task 8.1) calls {@link record} right
 * after producing an answer. On {@link ConversationRecordError} it can still
 * return the preserved answer to the user. This service does NOT create or
 * depend on the Query_Engine.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */

import {
  InMemoryConversationRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  ConversationEntry,
  ConversationRepository,
  DateProvider,
  IdGenerator,
  UserRef,
} from '../api-copilot-shared';
import { WorkspaceService } from '../workspace';
import {
  RETENTION_MINIMUM_DAYS,
  RETENTION_MINIMUM_MS,
  type ConversationDependencies,
  type NewConversationEntry,
  type WorkspaceAuthorizer,
} from './conversation.types';
import { validateNewEntry } from './conversation.validators';
import {
  ConversationAccessError,
  ConversationRecordError,
} from './conversation.errors';

export { RETENTION_MINIMUM_DAYS, RETENTION_MINIMUM_MS };

/**
 * ConversationService implementation.
 *
 * Uses dependency injection for id generation, clock, the conversation
 * repository, and the workspace access-control seam, matching the repo's
 * `Partial<{Domain}Dependencies>` convention with in-memory defaults.
 */
export class ConversationService {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly conversationRepository: ConversationRepository;
  private readonly workspaceAuthorizer: WorkspaceAuthorizer;

  constructor(deps?: Partial<ConversationDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.conversationRepository =
      deps?.conversationRepository ?? new InMemoryConversationRepository();
    // Structurally satisfied by WorkspaceService.authorize; the composition
    // root injects the authoritative, state-sharing Workspace service.
    this.workspaceAuthorizer =
      deps?.workspaceAuthorizer ?? new WorkspaceService();
  }

  /**
   * Record a Q&A entry produced by the Query_Engine.
   *
   * Requirement 15.1: Persist the question and answer as a Conversation_History
   * entry in the current Workspace (within the 2s target for the default path).
   * Requirement 15.6: Stamp the entry with the submitting user's identity and
   * the time the answer was produced (defaulting to the injected clock).
   * Requirement 15.2: If persistence fails, throw a {@link ConversationRecordError}
   * that carries the produced answer so the caller can still display it to the
   * requesting user without loss.
   *
   * @throws ConversationRecordError when the entry cannot be saved.
   */
  async record(entry: NewConversationEntry): Promise<ConversationEntry> {
    const validation = validateNewEntry(entry);
    if (!validation.valid) {
      throw new ConversationRecordError(
        entry.workspaceId,
        entry.userId,
        entry.question,
        entry.answer,
        new Error(`invalid conversation entry: ${validation.reason}`)
      );
    }

    const record: ConversationEntry = {
      entryId: this.idGenerator(),
      workspaceId: entry.workspaceId,
      userId: entry.userId,
      question: entry.question,
      answer: entry.answer,
      answeredAt: entry.answeredAt ?? this.dateProvider(),
    };

    try {
      return await this.conversationRepository.save(record);
    } catch (cause) {
      // Preserve the answer for display despite the save failure (Req 15.2).
      throw new ConversationRecordError(
        entry.workspaceId,
        entry.userId,
        entry.question,
        entry.answer,
        cause
      );
    }
  }

  /**
   * List a workspace's Conversation_History for an authorized requester.
   *
   * Requirement 15.4: Deny a requester who is not an authorized member, throwing
   * {@link ConversationAccessError} and disclosing no history content.
   * Requirement 15.3: Return entries ordered by answer time, most recent first.
   * Requirement 15.5: Return an empty list (never an error) when the workspace
   * has no entries.
   *
   * @throws ConversationAccessError when the requester is not authorized.
   */
  async list(
    workspaceId: string,
    requester: UserRef
  ): Promise<ConversationEntry[]> {
    const decision = await this.workspaceAuthorizer.authorize(
      requester,
      workspaceId
    );
    if (!decision.allowed) {
      // Disclose nothing: no entries are read or returned (Req 15.4).
      throw new ConversationAccessError(workspaceId, requester.userId);
    }

    // Repository returns entries most-recent-first (Req 15.3); empty when none
    // without error (Req 15.5).
    return this.conversationRepository.list(workspaceId);
  }
}
