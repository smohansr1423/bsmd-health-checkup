/**
 * Conversation History (`conversation`) — barrel export.
 *
 * Records each Q&A entry produced by the Query_Engine and exposes a workspace's
 * Conversation_History to authorized members, most-recent-first.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */

export {
  ConversationService,
  RETENTION_MINIMUM_DAYS,
  RETENTION_MINIMUM_MS,
} from './conversation.service';

export {
  ConversationRecordError,
  ConversationAccessError,
} from './conversation.errors';

export { validateNewEntry } from './conversation.validators';
export type { EntryValidationResult } from './conversation.validators';

export { RECORD_DEADLINE_MS } from './conversation.types';

export type {
  NewConversationEntry,
  WorkspaceAuthorizer,
  ConversationDependencies,
  ConversationEntry,
  UserRef,
} from './conversation.types';
