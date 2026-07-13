import fc from 'fast-check';

import {
  BiometricAccessGate,
  GateIndication,
  MAX_CONSECUTIVE_BIOMETRIC_FAILURES,
  type BiometricAttemptResult,
  type BiometricAuthenticator,
  type BiometricGateState,
  type Clock,
} from './index';

/**
 * Property 45: Biometric access gate and fallback.
 * Validates: Requirements 18.1, 18.3, 18.4, 18.6
 * Feature: calorie-cortisol-tool, Property 45
 *
 * For any app open / resume after ≥60 s in background with biometrics enabled
 * and available, health data stays hidden until a successful match; a single
 * (sub-threshold) failure keeps data hidden, surfaces a "not recognized"
 * indication, and allows retry (Req 18.3); 3 consecutive failures deny
 * biometrics and present the fallback (Req 18.4); and cancelling the prompt
 * keeps data hidden and presents the fallback (Req 18.6).
 *
 * The gate is driven through an arbitrary sequence of lifecycle + unlock events
 * and checked against an INDEPENDENT reference model of Req 18.1/18.3/18.4/18.6
 * (`Ref` below) restated here rather than reusing the production reducers. The
 * reference computes the expected visibility / active prompt from the event
 * stream; after every event the gate must agree with it. Two extra invariants
 * are asserted directly: (a) the gate becomes visible ONLY as the immediate
 * result of a successful match (biometric success or fallback success), never
 * spontaneously (Req 18.1); and (b) the requirement-specific indications appear
 * at the single-failure / 3-failure / cancel transitions (Req 18.3/18.4/18.6).
 */

// --- Injectable-port test doubles ------------------------------------------

/** A clock the test advances explicitly; shared with the reference model. */
class FakeClock implements Clock {
  constructor(public value = 0) {}

  now(): number {
    return this.value;
  }
}

/**
 * An authenticator whose next outcome is set by the test immediately before a
 * biometric attempt. Enabled + available throughout (this property's premise:
 * "with biometrics enabled"), so `open`/qualifying `resume` present biometrics.
 */
class ProgrammableAuthenticator implements BiometricAuthenticator {
  public next: BiometricAttemptResult = { kind: 'failure' };

  isAvailable(): boolean {
    return true;
  }

  authenticate(): BiometricAttemptResult {
    return this.next;
  }
}

// --- Abstract events -------------------------------------------------------

type BiometricOutcome = 'success' | 'failure' | 'cancelled';

type GateEvent =
  | { readonly t: 'open' }
  | { readonly t: 'background' }
  | { readonly t: 'resume'; readonly gapSeconds: number }
  | { readonly t: 'biometric'; readonly outcome: BiometricOutcome }
  | { readonly t: 'fallback'; readonly success: boolean };

const BACKGROUND_THRESHOLD_SECONDS = 60;

// --- Independent reference model (restatement of Req 18.1/18.3/18.4/18.6) --

interface Ref {
  visible: boolean;
  prompt: BiometricGateState['activePrompt'];
  consecFailures: number;
  backgroundedAt: number | null;
}

function initialRef(): Ref {
  return {
    visible: false,
    prompt: 'none',
    consecFailures: 0,
    backgroundedAt: null,
  };
}

/** A freshly locked biometric prompt (Req 18.1): hidden, biometric, no failures. */
function lockedRef(): Ref {
  return {
    visible: false,
    prompt: 'biometric',
    consecFailures: 0,
    backgroundedAt: null,
  };
}

/**
 * Fold one event into the reference model, mirroring the requirement text (not
 * the production reducer). `nowMs` is the clock value *after* any advance the
 * event implies (resume advances the clock by `gapSeconds`).
 */
function reduceRef(ref: Ref, event: GateEvent, nowMs: number): Ref {
  switch (event.t) {
    case 'open':
      // Req 18.1: opening locks the gate and presents biometrics.
      return lockedRef();

    case 'background':
      return { ...ref, backgroundedAt: nowMs };

    case 'resume': {
      // Req 18.1: re-lock iff backgrounded for ≥ 60 s; otherwise keep state.
      const reprompt =
        ref.backgroundedAt !== null &&
        nowMs - ref.backgroundedAt >= BACKGROUND_THRESHOLD_SECONDS * 1000;
      return reprompt ? lockedRef() : { ...ref, backgroundedAt: null };
    }

    case 'biometric': {
      if (ref.prompt !== 'biometric') {
        return ref; // stray attempt: gate is a no-op when biometric not active.
      }
      if (event.outcome === 'success') {
        return {
          visible: true,
          prompt: 'none',
          consecFailures: 0,
          backgroundedAt: null,
        };
      }
      if (event.outcome === 'cancelled') {
        // Req 18.6: cancel keeps data hidden and presents the fallback.
        return { ...ref, visible: false, prompt: 'fallback' };
      }
      // failure
      const consecFailures = ref.consecFailures + 1;
      if (consecFailures >= MAX_CONSECUTIVE_BIOMETRIC_FAILURES) {
        // Req 18.4: 3 consecutive failures deny biometrics, present fallback.
        return { visible: false, prompt: 'fallback', consecFailures, backgroundedAt: null };
      }
      // Req 18.3: single (sub-threshold) failure stays hidden, retry allowed.
      return { visible: false, prompt: 'biometric', consecFailures, backgroundedAt: null };
    }

    case 'fallback': {
      if (ref.prompt !== 'fallback') {
        return ref; // no-op unless the fallback is presented.
      }
      return event.success
        ? { visible: true, prompt: 'none', consecFailures: 0, backgroundedAt: null }
        : { ...ref, visible: false, prompt: 'fallback' };
    }

    default:
      return ref;
  }
}

// --- Arbitraries -----------------------------------------------------------

const arbEvent: fc.Arbitrary<GateEvent> = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ t: 'open' } as const) },
  { weight: 1, arbitrary: fc.constant({ t: 'background' } as const) },
  {
    weight: 2,
    arbitrary: fc
      // Span the 60 s threshold from both sides (0..120 s).
      .integer({ min: 0, max: 120 })
      .map((gapSeconds) => ({ t: 'resume', gapSeconds }) as const),
  },
  {
    weight: 4,
    arbitrary: fc
      .constantFrom<BiometricOutcome>('success', 'failure', 'cancelled')
      .map((outcome) => ({ t: 'biometric', outcome }) as const),
  },
  {
    weight: 2,
    arbitrary: fc.boolean().map((success) => ({ t: 'fallback', success }) as const),
  },
);

const outcomeToResult: Record<BiometricOutcome, BiometricAttemptResult> = {
  success: { kind: 'success' },
  failure: { kind: 'failure' },
  cancelled: { kind: 'cancelled' },
};

describe('Property 45: biometric access gate and fallback (Req 18.1, 18.3, 18.4, 18.6) [Feature: calorie-cortisol-tool, Property 45]', () => {
  it('agrees with an independent Req 18 model across arbitrary event sequences, and only ever reveals data on a successful match', () => {
    fc.assert(
      fc.property(
        fc.array(arbEvent, { minLength: 0, maxLength: 24 }),
        (events) => {
          const clock = new FakeClock(0);
          const authenticator = new ProgrammableAuthenticator();
          const gate = new BiometricAccessGate(
            { clock, authenticator },
            { biometricEnabled: true },
          );

          let ref = initialRef();

          // Initial agreement (before any event): hidden, no prompt.
          expect(gate.current.visibility).toBe('hidden');
          expect(gate.current.activePrompt).toBe('none');

          for (const event of events) {
            const promptBefore = gate.current.activePrompt;
            const visibleBefore = gate.healthDataVisible;

            // Drive the gate.
            switch (event.t) {
              case 'open':
                gate.open();
                break;
              case 'background':
                gate.background();
                break;
              case 'resume':
                clock.value += event.gapSeconds * 1000;
                gate.resume();
                break;
              case 'biometric':
                authenticator.next = outcomeToResult[event.outcome];
                gate.attemptBiometric();
                break;
              case 'fallback':
                gate.submitFallback(event.success);
                break;
              default:
                break;
            }

            // Drive the independent reference with the same clock value.
            ref = reduceRef(ref, event, clock.value);

            const state = gate.current;

            // (1) Gate agrees with the independent Req 18 model.
            expect(state.visibility).toBe(ref.visible ? 'visible' : 'hidden');
            expect(state.activePrompt).toBe(ref.prompt);

            // (2) Req 18.1: a hidden→visible transition happens ONLY as the
            //     immediate result of a successful match; the gate never
            //     reveals health data spontaneously.
            if (!visibleBefore && gate.healthDataVisible) {
              const successfulBiometric =
                event.t === 'biometric' &&
                event.outcome === 'success' &&
                promptBefore === 'biometric';
              const successfulFallback =
                event.t === 'fallback' &&
                event.success &&
                promptBefore === 'fallback';
              expect(successfulBiometric || successfulFallback).toBe(true);
            }

            // (3) Requirement-specific indications at the biometric transitions.
            if (event.t === 'biometric' && promptBefore === 'biometric') {
              if (event.outcome === 'failure') {
                if (state.consecutiveFailures >= MAX_CONSECUTIVE_BIOMETRIC_FAILURES) {
                  // Req 18.4: denied, fallback presented.
                  expect(state.activePrompt).toBe('fallback');
                  expect(state.biometricDenied).toBe(true);
                  expect(state.indication).toBe(GateIndication.BiometricDenied);
                  expect(state.visibility).toBe('hidden');
                } else {
                  // Req 18.3: hidden, retry allowed, "not recognized".
                  expect(state.activePrompt).toBe('biometric');
                  expect(state.biometricDenied).toBe(false);
                  expect(state.indication).toBe(
                    GateIndication.BiometricNotRecognized,
                  );
                  expect(state.visibility).toBe('hidden');
                }
              } else if (event.outcome === 'cancelled') {
                // Req 18.6: cancel keeps data hidden, presents fallback.
                expect(state.activePrompt).toBe('fallback');
                expect(state.indication).toBe(GateIndication.BiometricCancelled);
                expect(state.visibility).toBe('hidden');
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds data hidden through any number of sub-threshold failures until a success (Req 18.1, 18.3)', () => {
    fc.assert(
      fc.property(
        // 0..2 failures keep biometrics available for a retry that then succeeds.
        fc.integer({ min: 0, max: MAX_CONSECUTIVE_BIOMETRIC_FAILURES - 1 }),
        (failuresBeforeSuccess) => {
          const clock = new FakeClock(0);
          const authenticator = new ProgrammableAuthenticator();
          const gate = new BiometricAccessGate(
            { clock, authenticator },
            { biometricEnabled: true },
          );

          gate.open();
          for (let i = 0; i < failuresBeforeSuccess; i += 1) {
            authenticator.next = { kind: 'failure' };
            gate.attemptBiometric();
            // Data stays hidden and a retry remains available (Req 18.3).
            expect(gate.healthDataVisible).toBe(false);
            expect(gate.current.activePrompt).toBe('biometric');
          }
          authenticator.next = { kind: 'success' };
          gate.attemptBiometric();
          expect(gate.healthDataVisible).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
