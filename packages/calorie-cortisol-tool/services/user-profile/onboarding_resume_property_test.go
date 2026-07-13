// Property-based test for onboarding state preservation and resume (Task 4.3).
//
// Property 43: Onboarding preserves and resumes state
// For any onboarding session, navigating back preserves already-entered
// responses, and exiting before completion resumes at the first incomplete
// step with prior responses intact; a post-step-5 profile-creation failure
// retains all responses for retry.
//
// Feature: calorie-cortisol-tool, Property 43
// **Validates: Requirements 16.2, 16.7, 16.8**
package main

import (
	"testing"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// obValidStepFields builds a submission that satisfies every required field for
// a step given the selected goals: the goal slice for step 1, a valid 24h time
// for time fields, and a non-empty placeholder for everything else. It mirrors
// the required-field resolution used by ValidateStep (Req 16.3/16.4).
func obValidStepFields(step int, goals []string) map[string]any {
	fields := map[string]any{}
	for _, f := range RequiredFields(step, goals) {
		switch {
		case f == FieldHealthGoals:
			fields[f] = obGoalsAsAny(goals)
		case timeFields[f]:
			fields[f] = "07:30"
		default:
			fields[f] = "provided"
		}
	}
	return fields
}

// obKeysPresent reports whether every key of want is present in got. Values are
// compared for scalar (non-slice) fields; slice-valued fields (goals) are
// checked for presence only, since []any is not directly comparable.
func obKeysPresent(got, want map[string]any) bool {
	for k, v := range want {
		gv, ok := got[k]
		if !ok {
			return false
		}
		if _, isSlice := v.([]any); !isSlice {
			if gv != v {
				return false
			}
		}
	}
	return true
}

// TestProperty43OnboardingPreservesAndResumesState generates random onboarding
// scenarios and asserts three invariants hold for every one:
//
//   - Back navigation preserves already-entered responses and never rewinds the
//     current step (Req 16.2).
//   - Exiting before completion resumes at the first incomplete step with all
//     prior responses intact (Req 16.7).
//   - A profile-creation failure after step 5 retains every collected response
//     and is retryable without re-entering data (Req 16.8).
func TestProperty43OnboardingPreservesAndResumesState(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // ≥100 iterations per Task 4.3

	properties := gopter.NewProperties(parameters)

	properties.Property("back-navigation retention, resume at first incomplete step, and failure retention", prop.ForAll(
		func(goalMask, fillN, backSeed int) bool {
			goals := obDecodeGoals(goalMask)

			// ---------------------------------------------------------------
			// Part A + B: back navigation retention (16.2) and resume at the
			// first incomplete step with responses intact (16.7).
			//
			// fillN in 0..4 keeps the session strictly before completion.
			// ---------------------------------------------------------------
			h := NewOnboardingHandler(nil, nil)
			const uid = "prop43-resume"

			entered := map[string]any{}
			for step := StepHealthGoals; step <= fillN; step++ {
				fields := obValidStepFields(step, goals)
				res := h.SubmitStep(uid, step, fields)
				if res.Err != nil {
					return false // seeding a valid step must always succeed
				}
				for k, v := range fields {
					entered[k] = v
				}
				// A valid non-final step advances exactly to step+1 (Req 16.4).
				if res.CurrentStep != step+1 {
					return false
				}
			}

			// After filling steps 1..fillN, the current step is fillN+1.
			curStep := fillN + 1

			// Back navigation: re-submit an already-completed earlier step and
			// confirm nothing is lost and the flow does not rewind (Req 16.2).
			if fillN >= 1 {
				back := 1 + (backSeed % fillN)
				res := h.SubmitStep(uid, back, obValidStepFields(back, goals))
				if res.Err != nil {
					return false
				}
				// Every previously entered response is still present.
				if !obKeysPresent(res.Responses, entered) {
					return false
				}
				// Re-visiting a prior step never moves the flow backward and,
				// since back < curStep, never advances it either (Req 16.2).
				if res.CurrentStep != curStep {
					return false
				}
			}

			// Resume before completion: positioned at the first incomplete step
			// with all prior responses intact (Req 16.7).
			sess, err := h.Resume(uid)
			if err != nil {
				return false
			}
			if sess.Completed {
				return false // fillN <= 4 => onboarding is not complete
			}
			if sess.CurrentStep != FirstIncompleteStep(sess.Responses) {
				return false
			}
			// With steps 1..fillN satisfied in order, the first incomplete step
			// is exactly fillN+1.
			if sess.CurrentStep != curStep {
				return false
			}
			if !obKeysPresent(sess.Responses, entered) {
				return false
			}

			// ---------------------------------------------------------------
			// Part C: post-step-5 profile-creation failure retains all
			// responses and is retryable without re-entering data (Req 16.8).
			// ---------------------------------------------------------------
			creator := NewInMemoryProfileCreator()
			creator.FailUntil = 1 // first creation attempt fails
			hf := NewOnboardingHandler(nil, creator)
			const uid2 = "prop43-failure"

			all := map[string]any{}
			for step := StepHealthGoals; step < StepDailyRoutine; step++ {
				fields := obValidStepFields(step, goals)
				if res := hf.SubmitStep(uid2, step, fields); res.Err != nil {
					return false
				}
				for k, v := range fields {
					all[k] = v
				}
			}

			// Submit the final step: profile creation fails this first time.
			step5Fields := obValidStepFields(StepDailyRoutine, goals)
			for k, v := range step5Fields {
				all[k] = v
			}
			failRes := hf.SubmitStep(uid2, StepDailyRoutine, step5Fields)
			if failRes.Err == nil {
				return false
			}
			if failRes.Err.Code != "PROFILE_CREATE_FAILED" {
				return false
			}
			// Retryable and state retained, with every collected response kept.
			if !failRes.Err.Retryable || !failRes.Err.RetainedState {
				return false
			}
			if failRes.Completed {
				return false
			}
			if !obKeysPresent(failRes.Responses, all) {
				return false
			}

			// Resume after the failure still holds every response and remains at
			// the final step (nothing to re-enter).
			afterFail, err := hf.Resume(uid2)
			if err != nil {
				return false
			}
			if afterFail.Completed {
				return false
			}
			if !obKeysPresent(afterFail.Responses, all) {
				return false
			}

			// Retry the final step without re-entering data: it now succeeds and
			// onboarding completes with responses intact (Req 16.8).
			retryRes := hf.SubmitStep(uid2, StepDailyRoutine, step5Fields)
			if retryRes.Err != nil {
				return false
			}
			if !retryRes.Completed {
				return false
			}
			return obKeysPresent(retryRes.Responses, all)
		},
		gen.IntRange(1, 31), // goalMask: non-empty subset of known goals
		gen.IntRange(0, 4),  // fillN: steps completed before checking resume (pre-completion)
		gen.IntRange(0, 3),  // backSeed: selects which earlier step to re-visit
	))

	properties.TestingRun(t)
}
