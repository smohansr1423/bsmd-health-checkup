/**
 * Account Auth — Property-Based Tests
 *
 * Uses fast-check to validate universal correctness properties from the
 * API Copilot AI design document (Correctness Properties: Properties 34–38).
 * Global iteration count is configured in jest.setup.fast-check.ts (numRuns=25);
 * no inline numRuns overrides are used.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import * as fc from 'fast-check';

import {
  AccountAuthService,
  SESSION_INACTIVITY_MS,
  LOCKOUT_THRESHOLD,
  LOCKOUT_DURATION_MS,
} from './account-auth.service';
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRegistrationError,
} from './account-auth.errors';
import { isValidEmail } from './account-auth.validators';
import type { PasswordHasher, SignUpRequest } from './account-auth.types';
import {
  InMemoryAccountRepository,
  InMemorySessionRepository,
  type Account,
  type PlanTier,
  type ProductSession,
} from '../api-copilot-shared';

// ─── Test doubles ─────────────────────────────────────────────────────────────

/**
 * Fast, deterministic password hasher for property tests. Hashing correctness
 * (salted scrypt, Req 18.1) is covered separately; these properties exercise
 * sign-up/sign-in/session/lockout behaviour, so a cheap non-plaintext transform
 * keeps thousands of hash/verify calls fast while preserving verify semantics.
 */
class FakePasswordHasher implements PasswordHasher {
  hash(password: string): string {
    return `hashed:${password}`;
  }

  verify(password: string, storedHash: string): boolean {
    return storedHash === `hashed:${password}`;
  }
}

/** Account repository that counts persisted accounts, to assert non-creation. */
class CountingAccountRepository extends InMemoryAccountRepository {
  public saveCount = 0;

  async save(account: Account): Promise<Account> {
    this.saveCount += 1;
    return super.save(account);
  }
}

/** Session repository that counts persisted sessions, to assert non-creation. */
class CountingSessionRepository extends InMemorySessionRepository {
  public saveCount = 0;

  async save(session: ProductSession): Promise<ProductSession> {
    this.saveCount += 1;
    return super.save(session);
  }
}

// ─── Controllable clock ─────────────────────────────────────────────────────────

interface Clock {
  provider: () => Date;
  advance: (ms: number) => void;
  set: (d: Date) => void;
  now: () => Date;
}

function makeClock(start: Date = new Date('2024-01-01T00:00:00.000Z')): Clock {
  let currentMs = start.getTime();
  return {
    provider: () => new Date(currentMs),
    advance: (ms: number) => {
      currentMs += ms;
    },
    set: (d: Date) => {
      currentMs = d.getTime();
    },
    now: () => new Date(currentMs),
  };
}

// ─── Service factory ──────────────────────────────────────────────────────────

interface Harness {
  service: AccountAuthService;
  accountRepository: CountingAccountRepository;
  sessionRepository: CountingSessionRepository;
  clock: Clock;
}

function makeService(clock: Clock = makeClock()): Harness {
  const accountRepository = new CountingAccountRepository();
  const sessionRepository = new CountingSessionRepository();
  let counter = 0;
  const service = new AccountAuthService({
    accountRepository,
    sessionRepository,
    passwordHasher: new FakePasswordHasher(),
    idGenerator: () => `AC_TEST_${(counter += 1)}`,
    dateProvider: clock.provider,
  });
  return { service, accountRepository, sessionRepository, clock };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

const alnumArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...ALNUM), { minLength: min, maxLength: max }).map((a) => a.join(''));

const letterArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...LOWER), { minLength: min, maxLength: max }).map((a) => a.join(''));

/** Syntactically valid email: local@domain.tld with no whitespace or stray '@'. */
const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(alnumArb(1, 10), alnumArb(1, 10), letterArb(2, 4))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Password within the accepted 8..128 length range. */
const validPasswordArb: fc.Arbitrary<string> = fc.string({ minLength: 8, maxLength: 128 });

const tierArb: fc.Arbitrary<PlanTier> = fc.constantFrom('starter', 'pro', 'enterprise');

/** A fully valid sign-up request (tier optionally supplied). */
const validSignUpArb: fc.Arbitrary<SignUpRequest> = fc
  .tuple(validEmailArb, validPasswordArb, fc.option(tierArb, { nil: undefined }))
  .map(([email, password, tier]) =>
    tier === undefined ? { email, password } : { email, password, tier }
  );

/** Non-empty strings that are NOT syntactically valid emails. */
const malformedEmailArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0 && !isValidEmail(s));

/** Passwords too short (0..7) — always outside the 8..128 range. */
const shortPasswordArb: fc.Arbitrary<string> = fc.string({ maxLength: 7 });

/** Passwords too long (129..160) — always outside the 8..128 range. */
const longPasswordArb: fc.Arbitrary<string> = fc.string({ minLength: 129, maxLength: 160 });

/** An invalid sign-up paired with the registration field expected to be flagged. */
const invalidSignUpArb: fc.Arbitrary<{ req: SignUpRequest; field: string }> = fc.oneof(
  // Missing required field: empty / whitespace email.
  validPasswordArb.map((password) => ({ req: { email: '', password }, field: 'email' })),
  validPasswordArb.map((password) => ({ req: { email: '   ', password }, field: 'email' })),
  // Missing required field: empty password.
  validEmailArb.map((email) => ({ req: { email, password: '' }, field: 'password' })),
  // Malformed email (with an otherwise valid password).
  fc
    .tuple(malformedEmailArb, validPasswordArb)
    .map(([email, password]) => ({ req: { email, password }, field: 'email' })),
  // Password too short / too long (with an otherwise valid email).
  fc
    .tuple(validEmailArb, shortPasswordArb)
    .map(([email, password]) => ({ req: { email, password }, field: 'password' })),
  fc
    .tuple(validEmailArb, longPasswordArb)
    .map(([email, password]) => ({ req: { email, password }, field: 'password' }))
);

// ─── Property 34 ────────────────────────────────────────────────────────────────

describe('Property 34: Valid sign-up creates a retrievable account', () => {
  // Feature: api-copilot-ai, Property 34: For any sign-up with a syntactically
  // valid email, a password of length 8..128, and all required fields, an account
  // is created, is retrievable, and a creation confirmation is returned.
  // Validates: Requirements 13.1
  it('creates a retrievable account and returns a confirmation', async () => {
    await fc.assert(
      fc.asyncProperty(validSignUpArb, async (req) => {
        const { service, accountRepository } = makeService();

        const account = await service.signUp(req);

        // A creation confirmation (the persisted account) is returned.
        expect(typeof account.accountId).toBe('string');
        expect(account.accountId.length).toBeGreaterThan(0);
        expect(account.email).toBe(req.email.trim());
        expect(account.tier).toBe(req.tier ?? 'starter');
        // Password is stored hashed, never as plaintext.
        expect(account.passwordHash).not.toBe(req.password);

        // The account was persisted exactly once and is retrievable.
        expect(accountRepository.saveCount).toBe(1);
        const byId = await accountRepository.findById(account.accountId);
        expect(byId).toEqual(account);
        const byEmail = await accountRepository.findByEmail(req.email);
        expect(byEmail).toEqual(account);
      })
    );
  });
});

// ─── Property 35 ────────────────────────────────────────────────────────────────

describe('Property 35: Email uniqueness is enforced', () => {
  // Feature: api-copilot-ai, Property 35: For any sign-up using an email already
  // associated with an account, the sign-up is rejected, an "already registered"
  // error is returned, and no new account is created.
  // Validates: Requirements 13.2
  it('rejects a duplicate email and creates no new account', async () => {
    await fc.assert(
      fc.asyncProperty(
        validSignUpArb,
        validPasswordArb,
        fc.boolean(),
        async (first, secondPassword, upperCase) => {
          const { service, accountRepository } = makeService();

          await service.signUp(first);
          expect(accountRepository.saveCount).toBe(1);

          // Same email (optionally case-varied — uniqueness is case-insensitive)
          // with a possibly different password must be rejected.
          const duplicate: SignUpRequest = {
            email: upperCase ? first.email.toUpperCase() : first.email,
            password: secondPassword,
          };

          await expect(service.signUp(duplicate)).rejects.toBeInstanceOf(
            EmailAlreadyRegisteredError
          );

          // No second account was created.
          expect(accountRepository.saveCount).toBe(1);
        }
      )
    );
  });
});

// ─── Property 36 ────────────────────────────────────────────────────────────────

describe('Property 36: Invalid registrations are rejected with the offending detail', () => {
  // Feature: api-copilot-ai, Property 36: For any sign-up with a missing required
  // field, malformed email, or password outside 8..128 characters, the sign-up is
  // rejected, no account is created, and the error identifies which detail is invalid.
  // Validates: Requirements 13.3
  it('rejects invalid sign-ups, names the bad detail, and creates no account', async () => {
    await fc.assert(
      fc.asyncProperty(invalidSignUpArb, async ({ req, field }) => {
        const { service, accountRepository } = makeService();

        let thrown: unknown;
        try {
          await service.signUp(req);
        } catch (err) {
          thrown = err;
        }

        // Rejected with an error that identifies the offending detail.
        expect(thrown).toBeInstanceOf(InvalidRegistrationError);
        expect((thrown as InvalidRegistrationError).field).toBe(field);

        // No account was created.
        expect(accountRepository.saveCount).toBe(0);
      })
    );
  });
});

// ─── Property 37 ────────────────────────────────────────────────────────────────

describe('Property 37: Session validity follows the inactivity rule', () => {
  // Feature: api-copilot-ai, Property 37: For any successful sign-in, the
  // established session grants access to the account's workspaces and is valid
  // until 30 minutes elapse without activity, after which it is expired; sign-in
  // with non-matching credentials establishes no session.
  // Validates: Requirements 13.4, 13.5
  it('keeps a session valid within 30 minutes of inactivity and expires it after', async () => {
    await fc.assert(
      fc.asyncProperty(
        validSignUpArb,
        fc.integer({ min: 0, max: 60 * 60 * 1000 }),
        async (req, inactivityMs) => {
          const clock = makeClock();
          const { service } = makeService(clock);

          const account = await service.signUp(req);
          const session = await service.signIn({ email: req.email, password: req.password });

          // A session was established for the account.
          expect(session.accountId).toBe(account.accountId);
          expect(session.expiresAt.getTime()).toBe(
            session.issuedAt.getTime() + SESSION_INACTIVITY_MS
          );

          // Advance the clock by the sampled inactivity gap.
          clock.advance(inactivityMs);
          const resolved = await service.validateSession(session.sessionId);

          if (inactivityMs <= SESSION_INACTIVITY_MS) {
            // Still within the inactivity window: session remains valid.
            expect(resolved).not.toBeNull();
            expect(resolved!.sessionId).toBe(session.sessionId);
          } else {
            // Beyond 30 minutes of inactivity: session has expired.
            expect(resolved).toBeNull();
          }
        }
      )
    );
  });

  it('establishes no session when credentials do not match', async () => {
    await fc.assert(
      fc.asyncProperty(
        validSignUpArb,
        validPasswordArb,
        fc.boolean(),
        async (req, wrongPassword, unknownEmail) => {
          // Ensure the attempted password genuinely differs from the real one.
          fc.pre(wrongPassword !== req.password);

          const { service, sessionRepository } = makeService();
          await service.signUp(req);

          // Either a wrong password for the real email, or an unknown email.
          const attempt = unknownEmail
            ? { email: `no-${req.email}`, password: req.password }
            : { email: req.email, password: wrongPassword };

          await expect(service.signIn(attempt)).rejects.toBeInstanceOf(
            InvalidCredentialsError
          );

          // No session was established.
          expect(sessionRepository.saveCount).toBe(0);
        }
      )
    );
  });
});

// ─── Property 38 ────────────────────────────────────────────────────────────────

describe('Property 38: Lockout after repeated failures', () => {
  // Feature: api-copilot-ai, Property 38: For any account with 5 consecutive
  // failed sign-ins within 15 minutes, the account is locked for 15 minutes,
  // sign-in attempts during the lock are rejected with a locked indication, and
  // sign-in is accepted again only after the lock elapses.
  // Validates: Requirements 13.6
  it('locks after the threshold, rejects during the lock, and reopens after it elapses', async () => {
    await fc.assert(
      fc.asyncProperty(
        validSignUpArb,
        validPasswordArb,
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: LOCKOUT_DURATION_MS - 1 }),
        async (req, wrongPassword, stepMs, duringLockMs) => {
          fc.pre(wrongPassword !== req.password);

          const clock = makeClock();
          const { service } = makeService(clock);
          const account = await service.signUp(req);

          // First (threshold - 1) failures are rejected as invalid credentials.
          for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i += 1) {
            await expect(
              service.signIn({ email: req.email, password: wrongPassword })
            ).rejects.toBeInstanceOf(InvalidCredentialsError);
            clock.advance(stepMs);
          }

          // The threshold-th consecutive failure trips the lock.
          let lockErr: unknown;
          try {
            await service.signIn({ email: req.email, password: wrongPassword });
          } catch (err) {
            lockErr = err;
          }
          expect(lockErr).toBeInstanceOf(AccountLockedError);
          const lockedUntil = (lockErr as AccountLockedError).lockedUntil;

          // During the lock, even correct credentials are rejected with a lock.
          clock.advance(duringLockMs);
          await expect(
            service.signIn({ email: req.email, password: req.password })
          ).rejects.toBeInstanceOf(AccountLockedError);

          // Once the lock elapses, a correct sign-in succeeds.
          clock.set(new Date(lockedUntil.getTime() + 1));
          const session = await service.signIn({
            email: req.email,
            password: req.password,
          });
          expect(session.accountId).toBe(account.accountId);
        }
      )
    );
  });
});
