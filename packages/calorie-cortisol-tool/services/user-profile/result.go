// Structured error / degraded-outcome result contract (Task 1.3).
//
// Go equivalent of the shared TypeScript contract (shared/src/result.ts). The
// design ("Error Handling") standardises every degraded outcome on the shape:
//
//	{ code, message, retryable, retainedState }
//
// and defines four error-handling patterns:
//
//  1. Atomic Failure       -- no partial artifact, prior state preserved.
//  2. Validation Rejection -- reject at the boundary with a reason, prior
//     state preserved.
//  3. Retain-and-Retry     -- retain affected data, retry on a bounded backoff
//     schedule, then notify.
//  4. Timeout & Capacity   -- cancel/shed, retain input, offer retry.
//
// Requirements: 1.2, 3.5, 21.6, 23.3
package main

// ErrorContract is the structured error shape returned by every degraded outcome.
type ErrorContract struct {
	// Code is a stable, machine-readable identifier for the error condition.
	Code string
	// Message is a human-readable explanation of what went wrong.
	Message string
	// Retryable reports whether re-attempting the same operation may succeed.
	Retryable bool
	// RetainedState reports whether the caller's prior/local state was
	// preserved unchanged (no partial artifact produced).
	RetainedState bool
}

// Result is a success-or-failure value. On success Ok is true and Value holds
// the result; on failure Ok is false and Error holds the structured contract.
type Result[T any] struct {
	Ok    bool
	Value T
	Error *ErrorContract
}

// Okay constructs a successful result.
func Okay[T any](value T) Result[T] {
	return Result[T]{Ok: true, Value: value}
}

// Fail constructs a failed result from a structured error contract.
func Fail[T any](e ErrorContract) Result[T] {
	return Result[T]{Ok: false, Error: &e}
}

// ---------------------------------------------------------------------------
// Pattern 1: Atomic Failure (no partial artifacts)
// ---------------------------------------------------------------------------

// AtomicFailure builds an atomic-failure contract. No partial artifact was
// produced and prior state is unchanged (RetainedState=true). The retryable
// flag is caller-controlled (atomic failures are often re-attemptable).
//
// Requirements: 3.7, 14.2, 14.3, 14.5, 14.7, 20.3, 20.7
func AtomicFailure(code, message string, retryable bool) ErrorContract {
	return ErrorContract{
		Code:          code,
		Message:       message,
		Retryable:     retryable,
		RetainedState: true,
	}
}

// ---------------------------------------------------------------------------
// Pattern 2: Validation Rejection (input rejected at the boundary)
// ---------------------------------------------------------------------------

// ValidationRejection builds a validation-rejection contract. The input is
// rejected before any state mutation, so prior state is preserved
// (RetainedState=true). The same input will fail again, so it is not retryable
// as-is.
//
// Requirements: 1.7, 3.5, 9.4, 10.2, 11.2, 14.2, 16.5, 27.3
func ValidationRejection(code, message string) ErrorContract {
	return ErrorContract{
		Code:          code,
		Message:       message,
		Retryable:     false,
		RetainedState: true,
	}
}

// ---------------------------------------------------------------------------
// Pattern 3: Retain-and-Retry with bounded backoff
// ---------------------------------------------------------------------------

// RetrySchedule is a bounded retry schedule: retry at most MaxRetries times,
// waiting IntervalsMinutes[i] minutes before retry attempt i+1.
type RetrySchedule struct {
	MaxRetries       int
	IntervalsMinutes []int
}

// WearableSyncSchedule: 3 retries at 1, 5, 15 minutes (Req 9.7).
var WearableSyncSchedule = RetrySchedule{MaxRetries: 3, IntervalsMinutes: []int{1, 5, 15}}

// ConsentSyncSchedule: 3 retries, exponential backoff (Req 17.5, 27.5).
var ConsentSyncSchedule = RetrySchedule{MaxRetries: 3, IntervalsMinutes: []int{1, 2, 4}}

// DigestDeliverySchedule: 3 retries at 30-minute intervals (Req 15.7).
var DigestDeliverySchedule = RetrySchedule{MaxRetries: 3, IntervalsMinutes: []int{30, 30, 30}}

// ShouldRetry reports whether another retry should be attempted given the
// number of attempts already made.
func ShouldRetry(s RetrySchedule, attemptsMade int) bool {
	return attemptsMade >= 0 && attemptsMade < s.MaxRetries
}

// NextRetryDelayMinutes returns the delay (minutes) before the next retry and
// true, or (0, false) when the schedule is exhausted.
func NextRetryDelayMinutes(s RetrySchedule, attemptsMade int) (int, bool) {
	if !ShouldRetry(s, attemptsMade) {
		return 0, false
	}
	idx := attemptsMade
	if idx > len(s.IntervalsMinutes)-1 {
		idx = len(s.IntervalsMinutes) - 1
	}
	return s.IntervalsMinutes[idx], true
}

// RetainAndRetryOutcome is the outcome of a retain-and-retry step.
type RetainAndRetryOutcome struct {
	Error            ErrorContract
	WillRetry        bool
	NextDelayMinutes int
	// HasNextDelay is false when the schedule is exhausted (no further retry).
	HasNextDelay bool
}

// RetainAndRetry builds a retain-and-retry outcome. Affected data is always
// retained (RetainedState=true). While retries remain, Retryable is true; once
// exhausted it is false so the caller surfaces the notification / in-app
// fallback.
//
// Requirements: 9.7, 15.7, 17.5, 27.5
func RetainAndRetry(code, message string, s RetrySchedule, attemptsMade int) RetainAndRetryOutcome {
	willRetry := ShouldRetry(s, attemptsMade)
	delay, hasDelay := NextRetryDelayMinutes(s, attemptsMade)
	return RetainAndRetryOutcome{
		Error: ErrorContract{
			Code:          code,
			Message:       message,
			Retryable:     willRetry,
			RetainedState: true,
		},
		WillRetry:        willRetry,
		NextDelayMinutes: delay,
		HasNextDelay:     hasDelay,
	}
}

// ---------------------------------------------------------------------------
// Pattern 4: Timeout & Capacity
// ---------------------------------------------------------------------------

// TimeoutOutcome builds a timeout contract: the in-flight operation was
// cancelled, the input is retained, and the caller is offered a retry.
//
// Requirements: 1.2, 21.6
func TimeoutOutcome(code, message string) ErrorContract {
	return ErrorContract{
		Code:          code,
		Message:       message,
		Retryable:     true,
		RetainedState: true,
	}
}

// CapacityExceeded builds a capacity-exceeded contract: excess load is rejected
// or queued while accepted in-progress work is preserved; the caller may retry.
//
// Requirements: 23.3
func CapacityExceeded(code, message string) ErrorContract {
	return ErrorContract{
		Code:          code,
		Message:       message,
		Retryable:     true,
		RetainedState: true,
	}
}
