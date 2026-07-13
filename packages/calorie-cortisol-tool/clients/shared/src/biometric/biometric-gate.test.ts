import {
  BACKGROUND_REPROMPT_THRESHOLD_SECONDS,
  BiometricAccessGate,
  GateIndication,
  MAX_CONSECUTIVE_BIOMETRIC_FAILURES,
  applyBiometricResult,
  applyFallbackResult,
  initialGateState,
  isHealthDataVisible,
  lockedForBiometric,
  shouldRepromptOnResume,
  type BiometricAttemptResult,
  type BiometricAuthenticator,
  type Clock,
} from './index';

/**
 * Unit tests for the biometric access gate (Task 14.19).
 *
 * Covers the Requirement 18 acceptance criteria: hide health data on app
 * open / resume-after-≥60s (18.1), single-failure retry (18.3), deny after 3
 * consecutive failures (18.4), unavailable-hardware fallback (18.5), and
 * cancel fallback (18.6).
 */

// --- Test doubles for the injectable ports ---------------------------------

/** A clock whose value the test controls explicitly. */
class FakeClock implements Clock {
  constructor(public value = 0) {}

  now(): number {
    return this.value;
  }

  advanceSeconds(seconds: number): void {
    this.value += seconds * 1000;
  }
}

/**
 * A scripted authenticator: `available` controls {@link isAvailable}, and each
 * `authenticate()` call returns the next queued outcome (defaulting to failure
 * when the script is exhausted so tests must be explicit about successes).
 */
class ScriptedAuthenticator implements BiometricAuthenticator {
  private queue: BiometricAttemptResult[];

  constructor(
    private available: boolean,
    outcomes: BiometricAttemptResult[] = [],
  ) {
    this.queue = [...outcomes];
  }

  isAvailable(): boolean {
    return this.available;
  }

  authenticate(): BiometricAttemptResult {
    return this.queue.shift() ?? { kind: 'failure' };
  }
}

const success: BiometricAttemptResult = { kind: 'success' };
const failure: BiometricAttemptResult = { kind: 'failure' };
const cancelled: BiometricAttemptResult = { kind: 'cancelled' };

function makeGate(
  outcomes: BiometricAttemptResult[],
  opts: { available?: boolean; enabled?: boolean; clock?: FakeClock } = {},
): { gate: BiometricAccessGate; clock: FakeClock } {
  const clock = opts.clock ?? new FakeClock(0);
  const authenticator = new ScriptedAuthenticator(
    opts.available ?? true,
    outcomes,
  );
  const gate = new BiometricAccessGate(
    { clock, authenticator },
    { biometricEnabled: opts.enabled ?? true },
  );
  return { gate, clock };
}

// --- Pure reducers ----------------------------------------------------------

describe('pure gate reducers', () => {
  it('starts hidden with no prompt (initial state)', () => {
    const state = initialGateState();
    expect(state.visibility).toBe('hidden');
    expect(state.activePrompt).toBe('none');
    expect(isHealthDataVisible(state)).toBe(false);
  });

  it('grants visibility on a successful biometric match (Req 18.1)', () => {
    const next = applyBiometricResult(lockedForBiometric(), success);
    expect(next.visibility).toBe('visible');
    expect(next.activePrompt).toBe('none');
    expect(next.consecutiveFailures).toBe(0);
    expect(isHealthDataVisible(next)).toBe(true);
  });

  it('keeps data hidden and allows retry on a single failure (Req 18.3)', () => {
    const next = applyBiometricResult(lockedForBiometric(), failure);
    expect(next.visibility).toBe('hidden');
    expect(next.activePrompt).toBe('biometric');
    expect(next.consecutiveFailures).toBe(1);
    expect(next.biometricDenied).toBe(false);
    expect(next.indication).toBe(GateIndication.BiometricNotRecognized);
  });

  it('denies biometrics and presents fallback after 3 failures (Req 18.4)', () => {
    let state = lockedForBiometric();
    for (let i = 0; i < MAX_CONSECUTIVE_BIOMETRIC_FAILURES; i += 1) {
      state = applyBiometricResult(state, failure);
    }
    expect(state.consecutiveFailures).toBe(MAX_CONSECUTIVE_BIOMETRIC_FAILURES);
    expect(state.visibility).toBe('hidden');
    expect(state.activePrompt).toBe('fallback');
    expect(state.biometricDenied).toBe(true);
    expect(state.indication).toBe(GateIndication.BiometricDenied);
  });

  it('presents fallback on cancel while keeping data hidden (Req 18.6)', () => {
    const next = applyBiometricResult(lockedForBiometric(), cancelled);
    expect(next.visibility).toBe('hidden');
    expect(next.activePrompt).toBe('fallback');
    expect(next.indication).toBe(GateIndication.BiometricCancelled);
  });

  it('presents fallback with an unavailable indication (Req 18.5)', () => {
    const next = applyBiometricResult(lockedForBiometric(), {
      kind: 'unavailable',
    });
    expect(next.activePrompt).toBe('fallback');
    expect(next.biometricDenied).toBe(true);
    expect(next.indication).toBe(GateIndication.BiometricUnavailable);
  });

  it('ignores a stray biometric result when biometric is not the active prompt', () => {
    const fallbackState = applyBiometricResult(lockedForBiometric(), cancelled);
    const unchanged = applyBiometricResult(fallbackState, success);
    expect(unchanged).toEqual(fallbackState);
    expect(isHealthDataVisible(unchanged)).toBe(false);
  });

  it('unlocks on a successful fallback attempt', () => {
    const fallbackState = applyBiometricResult(lockedForBiometric(), cancelled);
    const next = applyFallbackResult(fallbackState, true);
    expect(next.visibility).toBe('visible');
    expect(next.activePrompt).toBe('none');
  });

  it('re-presents fallback and stays hidden on a failed fallback attempt', () => {
    const fallbackState = applyBiometricResult(lockedForBiometric(), cancelled);
    const next = applyFallbackResult(fallbackState, false);
    expect(next.visibility).toBe('hidden');
    expect(next.activePrompt).toBe('fallback');
    expect(next.indication).toBe(GateIndication.FallbackNotRecognized);
  });
});

// --- Resume threshold (Req 18.1) -------------------------------------------

describe('shouldRepromptOnResume (Req 18.1)', () => {
  it('does not reprompt when the app was never backgrounded', () => {
    expect(shouldRepromptOnResume(null, 999_999)).toBe(false);
  });

  it('reprompts at exactly the 60s threshold', () => {
    const bg = 0;
    const now = BACKGROUND_REPROMPT_THRESHOLD_SECONDS * 1000;
    expect(shouldRepromptOnResume(bg, now)).toBe(true);
  });

  it('does not reprompt just under the threshold', () => {
    const bg = 0;
    const now = BACKGROUND_REPROMPT_THRESHOLD_SECONDS * 1000 - 1;
    expect(shouldRepromptOnResume(bg, now)).toBe(false);
  });
});

// --- Stateful gate façade ---------------------------------------------------

describe('BiometricAccessGate lifecycle', () => {
  it('hides health data and presents the biometric prompt on open (Req 18.1)', () => {
    const { gate } = makeGate([]);
    const state = gate.open();
    expect(state.visibility).toBe('hidden');
    expect(state.activePrompt).toBe('biometric');
    expect(gate.healthDataVisible).toBe(false);
  });

  it('reveals health data after a successful biometric match (Req 18.1)', () => {
    const { gate } = makeGate([success]);
    gate.open();
    gate.attemptBiometric();
    expect(gate.healthDataVisible).toBe(true);
  });

  it('allows retry after a single failure, then unlocks (Req 18.3)', () => {
    const { gate } = makeGate([failure, success]);
    gate.open();
    const afterFail = gate.attemptBiometric();
    expect(afterFail.activePrompt).toBe('biometric');
    expect(gate.healthDataVisible).toBe(false);
    gate.attemptBiometric();
    expect(gate.healthDataVisible).toBe(true);
  });

  it('presents the fallback after 3 consecutive failures (Req 18.4)', () => {
    const { gate } = makeGate([failure, failure, failure]);
    gate.open();
    gate.attemptBiometric();
    gate.attemptBiometric();
    const state = gate.attemptBiometric();
    expect(state.activePrompt).toBe('fallback');
    expect(state.biometricDenied).toBe(true);
    // A further biometric attempt is a no-op once biometrics are denied.
    const afterDenied = gate.attemptBiometric();
    expect(afterDenied).toEqual(state);
    // Fallback unlocks health data.
    gate.submitFallback(true);
    expect(gate.healthDataVisible).toBe(true);
  });

  it('locks straight to fallback when hardware is unavailable (Req 18.5)', () => {
    const { gate } = makeGate([], { available: false });
    const state = gate.open();
    expect(state.activePrompt).toBe('fallback');
    expect(state.indication).toBe(GateIndication.BiometricUnavailable);
  });

  it('locks straight to fallback when biometrics are disabled', () => {
    const { gate } = makeGate([], { enabled: false });
    const state = gate.open();
    expect(state.activePrompt).toBe('fallback');
    expect(gate.healthDataVisible).toBe(false);
  });

  it('re-locks on resume after ≥60s in background (Req 18.1)', () => {
    const clock = new FakeClock(0);
    const { gate } = makeGate([success], { clock });
    gate.open();
    gate.attemptBiometric();
    expect(gate.healthDataVisible).toBe(true);

    gate.background();
    clock.advanceSeconds(BACKGROUND_REPROMPT_THRESHOLD_SECONDS);
    const resumed = gate.resume();
    expect(resumed.visibility).toBe('hidden');
    expect(resumed.activePrompt).toBe('biometric');
    expect(gate.healthDataVisible).toBe(false);
  });

  it('keeps access on resume before the 60s threshold (Req 18.1)', () => {
    const clock = new FakeClock(0);
    const { gate } = makeGate([success], { clock });
    gate.open();
    gate.attemptBiometric();

    gate.background();
    clock.advanceSeconds(BACKGROUND_REPROMPT_THRESHOLD_SECONDS - 1);
    const resumed = gate.resume();
    expect(resumed.visibility).toBe('visible');
    expect(gate.healthDataVisible).toBe(true);
    expect(resumed.backgroundedAtMs).toBeNull();
  });

  it('presents fallback when the biometric prompt is cancelled (Req 18.6)', () => {
    const { gate } = makeGate([cancelled]);
    gate.open();
    const state = gate.attemptBiometric();
    expect(state.activePrompt).toBe('fallback');
    expect(state.indication).toBe(GateIndication.BiometricCancelled);
    expect(gate.healthDataVisible).toBe(false);
  });
});
