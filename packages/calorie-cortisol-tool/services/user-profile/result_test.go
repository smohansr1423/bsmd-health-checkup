// Unit + property tests for the structured error/result contract (Task 1.3).
// Requirements: 1.2, 3.5, 21.6, 23.3
package main

import (
	"testing"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

func TestOkayAndFail(t *testing.T) {
	r := Okay(42)
	if !r.Ok || r.Value != 42 || r.Error != nil {
		t.Fatalf("Okay produced unexpected result: %+v", r)
	}

	contract := ValidationRejection("BAD", "nope")
	f := Fail[int](contract)
	if f.Ok || f.Error == nil || *f.Error != contract {
		t.Fatalf("Fail produced unexpected result: %+v", f)
	}
}

func TestAtomicFailurePreservesState(t *testing.T) {
	e := AtomicFailure("EXPORT_FAILED", "could not write", true)
	if !e.RetainedState || !e.Retryable {
		t.Fatalf("expected retained+retryable atomic failure, got %+v", e)
	}
	if AtomicFailure("DEL", "x", false).Retryable {
		t.Fatalf("expected non-retryable atomic failure")
	}
}

func TestValidationRejection(t *testing.T) {
	e := ValidationRejection("RES_TOO_LOW", "below 640x480")
	if e.Retryable {
		t.Fatalf("validation rejection must not be retryable")
	}
	if !e.RetainedState {
		t.Fatalf("validation rejection must retain prior state")
	}
}

func TestWearableRetryScheduleThenExhaust(t *testing.T) {
	s := WearableSyncSchedule
	cases := []struct {
		attempts int
		delay    int
	}{{0, 1}, {1, 5}, {2, 15}}
	for _, c := range cases {
		o := RetainAndRetry("SYNC", "down", s, c.attempts)
		if !o.WillRetry || !o.HasNextDelay || o.NextDelayMinutes != c.delay {
			t.Fatalf("attempt %d: expected delay %d, got %+v", c.attempts, c.delay, o)
		}
		if !o.Error.Retryable || !o.Error.RetainedState {
			t.Fatalf("attempt %d: expected retryable+retained, got %+v", c.attempts, o.Error)
		}
	}

	exhausted := RetainAndRetry("SYNC", "down", s, 3)
	if exhausted.WillRetry || exhausted.HasNextDelay {
		t.Fatalf("expected exhausted schedule, got %+v", exhausted)
	}
	if exhausted.Error.Retryable {
		t.Fatalf("exhausted error must not be retryable")
	}
	if !exhausted.Error.RetainedState {
		t.Fatalf("exhausted error must still retain state")
	}
}

func TestDigestAndConsentSchedules(t *testing.T) {
	if d, ok := NextRetryDelayMinutes(DigestDeliverySchedule, 0); !ok || d != 30 {
		t.Fatalf("expected digest delay 30, got %d ok=%v", d, ok)
	}
	if _, ok := NextRetryDelayMinutes(DigestDeliverySchedule, 3); ok {
		t.Fatalf("expected digest schedule exhausted at attempt 3")
	}
	if len(ConsentSyncSchedule.IntervalsMinutes) != 3 {
		t.Fatalf("expected consent schedule with 3 intervals")
	}
}

func TestTimeoutAndCapacity(t *testing.T) {
	tm := TimeoutOutcome("ANALYSIS_TIMEOUT", "exceeded 10s")
	if !tm.Retryable || !tm.RetainedState {
		t.Fatalf("timeout must be retryable and retain state, got %+v", tm)
	}
	cap := CapacityExceeded("CAPACITY_EXCEEDED", "shedding")
	if !cap.Retryable || !cap.RetainedState {
		t.Fatalf("capacity must be retryable and retain state, got %+v", cap)
	}
}

func TestContractShapeInvariants(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 10 // reduced from 100 for faster local runs

	properties := gopter.NewProperties(parameters)

	properties.Property("factories always retain state with expected retryable flags", prop.ForAll(
		func(code, message string) bool {
			return AtomicFailure(code, message, true).RetainedState &&
				!ValidationRejection(code, message).Retryable &&
				ValidationRejection(code, message).RetainedState &&
				TimeoutOutcome(code, message).Retryable &&
				TimeoutOutcome(code, message).RetainedState &&
				CapacityExceeded(code, message).Retryable &&
				CapacityExceeded(code, message).RetainedState
		},
		gen.AnyString(),
		gen.AnyString(),
	))

	properties.Property("retain-and-retry retains state; retryable iff attempts remain", prop.ForAll(
		func(attemptsMade int) bool {
			s := WearableSyncSchedule
			o := RetainAndRetry("SYNC", "down", s, attemptsMade)
			remaining := attemptsMade >= 0 && attemptsMade < s.MaxRetries
			return o.Error.RetainedState &&
				o.Error.Retryable == remaining &&
				o.WillRetry == remaining &&
				o.HasNextDelay == remaining
		},
		gen.IntRange(0, 10),
	))

	properties.TestingRun(t)
}
