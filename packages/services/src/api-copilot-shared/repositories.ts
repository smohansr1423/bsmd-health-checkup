/**
 * API Copilot AI — Per-Domain Repository Interfaces
 *
 * Persistence is abstracted behind repository interfaces with `InMemory*`
 * implementations for development and tests; production swaps in Prisma-backed
 * repositories. Each domain service accepts its repository via constructor
 * injection and falls back to the in-memory default.
 *
 * Validates: Requirements 1.1, 6.1, 16.1, 17.1
 */

import type {
  Account,
  ApiVersion,
  ConversationEntry,
  HistoryEntry,
  ProductSession,
  QuotaState,
  StoredCredential,
  UsageEvent,
  Workspace,
} from './shared.types';

// ---------------------------------------------------------------------------
// account-auth — Req 13
// ---------------------------------------------------------------------------

export interface AccountRepository {
  save(account: Account): Promise<Account>;
  findById(accountId: string): Promise<Account | null>;
  findByEmail(email: string): Promise<Account | null>;
  update(account: Account): Promise<Account>;
}

export class InMemoryAccountRepository implements AccountRepository {
  private accounts: Map<string, Account> = new Map();

  async save(account: Account): Promise<Account> {
    this.accounts.set(account.accountId, account);
    return account;
  }

  async findById(accountId: string): Promise<Account | null> {
    return this.accounts.get(accountId) ?? null;
  }

  async findByEmail(email: string): Promise<Account | null> {
    const normalized = email.trim().toLowerCase();
    for (const account of this.accounts.values()) {
      if (account.email.trim().toLowerCase() === normalized) {
        return account;
      }
    }
    return null;
  }

  async update(account: Account): Promise<Account> {
    if (!this.accounts.has(account.accountId)) {
      throw new Error(`Account not found: ${account.accountId}`);
    }
    this.accounts.set(account.accountId, account);
    return account;
  }

  clear(): void {
    this.accounts.clear();
  }
}

export interface SessionRepository {
  save(session: ProductSession): Promise<ProductSession>;
  findById(sessionId: string): Promise<ProductSession | null>;
  update(session: ProductSession): Promise<ProductSession>;
  delete(sessionId: string): Promise<void>;
}

export class InMemorySessionRepository implements SessionRepository {
  private sessions: Map<string, ProductSession> = new Map();

  async save(session: ProductSession): Promise<ProductSession> {
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async findById(sessionId: string): Promise<ProductSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async update(session: ProductSession): Promise<ProductSession> {
    if (!this.sessions.has(session.sessionId)) {
      throw new Error(`Session not found: ${session.sessionId}`);
    }
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }
}

// ---------------------------------------------------------------------------
// workspace — Req 14
// ---------------------------------------------------------------------------

export interface WorkspaceRepository {
  save(workspace: Workspace): Promise<Workspace>;
  findById(workspaceId: string): Promise<Workspace | null>;
  listByOwner(ownerAccountId: string): Promise<Workspace[]>;
  update(workspace: Workspace): Promise<Workspace>;
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private workspaces: Map<string, Workspace> = new Map();

  async save(workspace: Workspace): Promise<Workspace> {
    this.workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  async findById(workspaceId: string): Promise<Workspace | null> {
    return this.workspaces.get(workspaceId) ?? null;
  }

  async listByOwner(ownerAccountId: string): Promise<Workspace[]> {
    return [...this.workspaces.values()].filter(
      (w) => w.ownerAccountId === ownerAccountId
    );
  }

  async update(workspace: Workspace): Promise<Workspace> {
    if (!this.workspaces.has(workspace.workspaceId)) {
      throw new Error(`Workspace not found: ${workspace.workspaceId}`);
    }
    this.workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  clear(): void {
    this.workspaces.clear();
  }
}

// ---------------------------------------------------------------------------
// plan-quota — Req 17
// ---------------------------------------------------------------------------

export interface QuotaStateRepository {
  save(state: QuotaState): Promise<QuotaState>;
  findByAccount(accountId: string): Promise<QuotaState | null>;
  update(state: QuotaState): Promise<QuotaState>;
}

export class InMemoryQuotaStateRepository implements QuotaStateRepository {
  private states: Map<string, QuotaState> = new Map();

  async save(state: QuotaState): Promise<QuotaState> {
    this.states.set(state.accountId, state);
    return state;
  }

  async findByAccount(accountId: string): Promise<QuotaState | null> {
    return this.states.get(accountId) ?? null;
  }

  async update(state: QuotaState): Promise<QuotaState> {
    this.states.set(state.accountId, state);
    return state;
  }

  clear(): void {
    this.states.clear();
  }
}

// ---------------------------------------------------------------------------
// knowledge-engine — Req 1, 2
// ---------------------------------------------------------------------------

export interface ApiVersionRepository {
  /** Persist a new immutable version record. */
  save(version: ApiVersion): Promise<ApiVersion>;
  /** All versions of an API, ascending by version number. */
  listVersions(workspaceId: string, apiId: string): Promise<ApiVersion[]>;
  findVersion(
    workspaceId: string,
    apiId: string,
    version: number
  ): Promise<ApiVersion | null>;
  /** Distinct api ids stored in a workspace (for tier API-count checks). */
  listApiIds(workspaceId: string): Promise<string[]>;
}

export class InMemoryApiVersionRepository implements ApiVersionRepository {
  private versions: ApiVersion[] = [];

  async save(version: ApiVersion): Promise<ApiVersion> {
    this.versions.push(version);
    return version;
  }

  async listVersions(workspaceId: string, apiId: string): Promise<ApiVersion[]> {
    return this.versions
      .filter((v) => v.workspaceId === workspaceId && v.apiId === apiId)
      .sort((a, b) => a.version - b.version);
  }

  async findVersion(
    workspaceId: string,
    apiId: string,
    version: number
  ): Promise<ApiVersion | null> {
    return (
      this.versions.find(
        (v) =>
          v.workspaceId === workspaceId &&
          v.apiId === apiId &&
          v.version === version
      ) ?? null
    );
  }

  async listApiIds(workspaceId: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const v of this.versions) {
      if (v.workspaceId === workspaceId) {
        ids.add(v.apiId);
      }
    }
    return [...ids];
  }

  clear(): void {
    this.versions = [];
  }
}

// ---------------------------------------------------------------------------
// auth-assistant — Req 6
// ---------------------------------------------------------------------------

export interface CredentialRepository {
  save(credential: StoredCredential): Promise<StoredCredential>;
  findById(credentialId: string): Promise<StoredCredential | null>;
  findByTarget(targetApiRef: string): Promise<StoredCredential | null>;
  update(credential: StoredCredential): Promise<StoredCredential>;
}

export class InMemoryCredentialRepository implements CredentialRepository {
  private credentials: Map<string, StoredCredential> = new Map();

  async save(credential: StoredCredential): Promise<StoredCredential> {
    this.credentials.set(credential.credentialId, credential);
    return credential;
  }

  async findById(credentialId: string): Promise<StoredCredential | null> {
    return this.credentials.get(credentialId) ?? null;
  }

  async findByTarget(targetApiRef: string): Promise<StoredCredential | null> {
    for (const c of this.credentials.values()) {
      if (c.targetApiRef === targetApiRef) {
        return c;
      }
    }
    return null;
  }

  async update(credential: StoredCredential): Promise<StoredCredential> {
    this.credentials.set(credential.credentialId, credential);
    return credential;
  }

  clear(): void {
    this.credentials.clear();
  }
}

// ---------------------------------------------------------------------------
// testing-console — Req 8 (per-workspace ring buffer capped at 500)
// ---------------------------------------------------------------------------

export const MAX_HISTORY_ENTRIES = 500;

export interface HistoryRepository {
  /** Append an entry, evicting the oldest beyond the per-workspace cap. */
  append(entry: HistoryEntry): Promise<void>;
  findById(workspaceId: string, historyId: string): Promise<HistoryEntry | null>;
  /** Entries for a workspace, most-recent-first. */
  list(workspaceId: string): Promise<HistoryEntry[]>;
}

export class InMemoryHistoryRepository implements HistoryRepository {
  private byWorkspace: Map<string, HistoryEntry[]> = new Map();

  constructor(private readonly cap: number = MAX_HISTORY_ENTRIES) {}

  async append(entry: HistoryEntry): Promise<void> {
    const list = this.byWorkspace.get(entry.workspaceId) ?? [];
    list.push(entry);
    // Evict oldest beyond the cap (Req 8.3).
    while (list.length > this.cap) {
      list.shift();
    }
    this.byWorkspace.set(entry.workspaceId, list);
  }

  async findById(
    workspaceId: string,
    historyId: string
  ): Promise<HistoryEntry | null> {
    const list = this.byWorkspace.get(workspaceId) ?? [];
    return list.find((e) => e.historyId === historyId) ?? null;
  }

  async list(workspaceId: string): Promise<HistoryEntry[]> {
    const list = this.byWorkspace.get(workspaceId) ?? [];
    return [...list].reverse();
  }

  clear(): void {
    this.byWorkspace.clear();
  }
}

// ---------------------------------------------------------------------------
// conversation — Req 15
// ---------------------------------------------------------------------------

export interface ConversationRepository {
  save(entry: ConversationEntry): Promise<ConversationEntry>;
  /** Entries for a workspace, most-recent-first (Req 15.3). */
  list(workspaceId: string): Promise<ConversationEntry[]>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private entries: ConversationEntry[] = [];

  async save(entry: ConversationEntry): Promise<ConversationEntry> {
    this.entries.push(entry);
    return entry;
  }

  async list(workspaceId: string): Promise<ConversationEntry[]> {
    return this.entries
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime());
  }

  clear(): void {
    this.entries = [];
  }
}

// ---------------------------------------------------------------------------
// usage-analytics — Req 16
// ---------------------------------------------------------------------------

export interface UsageRepository {
  record(event: UsageEvent): Promise<void>;
  /** All recorded events for a workspace. */
  list(workspaceId: string): Promise<UsageEvent[]>;
}

export class InMemoryUsageRepository implements UsageRepository {
  private events: UsageEvent[] = [];

  async record(event: UsageEvent): Promise<void> {
    this.events.push(event);
  }

  async list(workspaceId: string): Promise<UsageEvent[]> {
    return this.events.filter((e) => e.workspaceId === workspaceId);
  }

  clear(): void {
    this.events = [];
  }
}
