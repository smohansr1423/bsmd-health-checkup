/**
 * Account Auth — Service
 *
 * Sign-up, sign-in, authenticated-session lifecycle, and account lockout.
 *
 * Key rules:
 * - Validate email syntax, password length 8..128, and required fields on
 *   sign-up (Req 13.1, 13.3); reject a duplicate email (Req 13.2).
 * - Store passwords as salted hashes, never plaintext (Req 18.1).
 * - Establish sessions that expire after 30 minutes of inactivity (Req 13.4);
 *   reject mismatching credentials without a session (Req 13.5).
 * - Lock an account for 15 minutes after 5 consecutive failed sign-in attempts
 *   within a 15-minute window (Req 13.6).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 18.1
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

import {
  InMemoryAccountRepository,
  InMemorySessionRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  Account,
  AccountRepository,
  DateProvider,
  IdGenerator,
  ProductSession,
  SessionRepository,
} from '../api-copilot-shared';

import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from './account-auth.errors';
import type {
  AccountAuthDependencies,
  PasswordHasher,
  SignInRequest,
  SignUpRequest,
} from './account-auth.types';
import { validateSignUp } from './account-auth.validators';

// ---------------------------------------------------------------------------
// Constants (Req 13.4, 13.6)
// ---------------------------------------------------------------------------

/** A session expires after this much inactivity (30 minutes) — Req 13.4. */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
/** Consecutive failures that trigger a lockout — Req 13.6. */
export const LOCKOUT_THRESHOLD = 5;
/** Sliding window over which consecutive failures are counted — Req 13.6. */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
/** How long an account stays locked once tripped (15 minutes) — Req 13.6. */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Default password hasher — salted scrypt (Req 18.1)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Default {@link PasswordHasher} using salted scrypt. Each hash embeds a fresh
 * random salt, and verification is constant-time. Plaintext passwords are never
 * stored (Req 18.1). The stored form is `"<saltHex>:<derivedHex>"`.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  hash(password: string): string {
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
    return `${salt}:${derived}`;
  }

  verify(password: string, storedHash: string): boolean {
    if (typeof storedHash !== 'string') {
      return false;
    }
    const [salt, derivedHex] = storedHash.split(':');
    if (!salt || !derivedHex) {
      return false;
    }
    const expected = Buffer.from(derivedHex, 'hex');
    const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface ResolvedDependencies {
  accountRepository: AccountRepository;
  sessionRepository: SessionRepository;
  passwordHasher: PasswordHasher;
  idGenerator: IdGenerator;
  dateProvider: DateProvider;
}

export class AccountAuthService {
  private readonly deps: ResolvedDependencies;

  /** Recent failed sign-in timestamps per account, for lockout accounting. */
  private readonly failedAttempts: Map<string, Date[]> = new Map();
  /** Active lockouts: account id → time the lock lifts. */
  private readonly lockouts: Map<string, Date> = new Map();

  constructor(deps: Partial<AccountAuthDependencies> = {}) {
    this.deps = {
      accountRepository: deps.accountRepository ?? new InMemoryAccountRepository(),
      sessionRepository: deps.sessionRepository ?? new InMemorySessionRepository(),
      passwordHasher: deps.passwordHasher ?? new ScryptPasswordHasher(),
      idGenerator: deps.idGenerator ?? defaultIdGenerator,
      dateProvider: deps.dateProvider ?? defaultDateProvider,
    };
  }

  /**
   * Create a new account (Req 13.1–13.3).
   *
   * Validates the registration details, rejects a duplicate email, hashes the
   * password with a salt, and persists the account.
   *
   * @throws InvalidRegistrationError when a registration detail is invalid.
   * @throws EmailAlreadyRegisteredError when the email is already in use.
   */
  async signUp(req: SignUpRequest): Promise<Account> {
    validateSignUp(req);

    const email = req.email.trim();
    const existing = await this.deps.accountRepository.findByEmail(email);
    if (existing) {
      // Reject and create no new account (Req 13.2).
      throw new EmailAlreadyRegisteredError(email);
    }

    const account: Account = {
      accountId: this.deps.idGenerator(),
      email,
      passwordHash: this.deps.passwordHasher.hash(req.password),
      tier: req.tier ?? 'starter',
    };

    return this.deps.accountRepository.save(account);
  }

  /**
   * Authenticate an existing account and establish a session (Req 13.4–13.6).
   *
   * @throws AccountLockedError when the account is within a lock period.
   * @throws InvalidCredentialsError when the credentials do not match.
   */
  async signIn(req: SignInRequest): Promise<ProductSession> {
    const now = this.deps.dateProvider();
    const email = typeof req.email === 'string' ? req.email.trim() : '';
    const account = await this.deps.accountRepository.findByEmail(email);

    // Enforce an active lockout before any credential check (Req 13.6).
    if (account) {
      const activeLock = this.activeLockUntil(account.accountId, now);
      if (activeLock) {
        throw new AccountLockedError(account.accountId, activeLock);
      }
    }

    const passwordMatches =
      account !== null &&
      this.deps.passwordHasher.verify(req.password, account.passwordHash);

    if (!account || !passwordMatches) {
      if (account) {
        // Record the failure and lock the account if the threshold is reached.
        const lockedUntil = this.registerFailure(account.accountId, now);
        if (lockedUntil) {
          throw new AccountLockedError(account.accountId, lockedUntil);
        }
      }
      // Reject with a generic authentication error; establish no session.
      throw new InvalidCredentialsError();
    }

    // Successful sign-in clears prior failure accounting (Req 13.6).
    this.failedAttempts.delete(account.accountId);
    this.lockouts.delete(account.accountId);

    const session: ProductSession = {
      sessionId: this.deps.idGenerator(),
      accountId: account.accountId,
      issuedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + SESSION_INACTIVITY_MS),
    };
    return this.deps.sessionRepository.save(session);
  }

  /**
   * Return a session only if it is still valid under the 30-minute inactivity
   * rule (Req 13.4), refreshing its activity window when valid. Expired
   * sessions are deleted and reported as `null`.
   */
  async validateSession(sessionId: string): Promise<ProductSession | null> {
    const session = await this.deps.sessionRepository.findById(sessionId);
    if (!session) {
      return null;
    }
    const now = this.deps.dateProvider();
    if (now.getTime() > session.expiresAt.getTime()) {
      // Inactivity expiry (Req 13.4).
      await this.deps.sessionRepository.delete(sessionId);
      return null;
    }
    const refreshed: ProductSession = {
      ...session,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + SESSION_INACTIVITY_MS),
    };
    return this.deps.sessionRepository.update(refreshed);
  }

  /** Pure check: is `session` still within its inactivity window at `now`? */
  isSessionValid(session: ProductSession, now: Date = this.deps.dateProvider()): boolean {
    return now.getTime() <= session.expiresAt.getTime();
  }

  /**
   * Return the time an active lock lifts, or `null` if the account is not
   * currently locked. A lapsed lock is cleared as a side effect.
   */
  private activeLockUntil(accountId: string, now: Date): Date | null {
    const lockedUntil = this.lockouts.get(accountId);
    if (!lockedUntil) {
      return null;
    }
    if (now.getTime() < lockedUntil.getTime()) {
      return lockedUntil;
    }
    // Lock period has elapsed: clear it and the failure history.
    this.lockouts.delete(accountId);
    this.failedAttempts.delete(accountId);
    return null;
  }

  /**
   * Record a failed sign-in within the sliding window and, if the failure count
   * reaches the threshold, lock the account (Req 13.6).
   *
   * @returns the lock-until time when this failure triggered a lockout, else null.
   */
  private registerFailure(accountId: string, now: Date): Date | null {
    const windowStart = now.getTime() - LOCKOUT_WINDOW_MS;
    const recent = (this.failedAttempts.get(accountId) ?? []).filter(
      (at) => at.getTime() >= windowStart
    );
    recent.push(now);
    this.failedAttempts.set(accountId, recent);

    if (recent.length >= LOCKOUT_THRESHOLD) {
      const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
      this.lockouts.set(accountId, lockedUntil);
      return lockedUntil;
    }
    return null;
  }
}
