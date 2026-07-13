// Property-based test for the 5-step adaptive onboarding flow (Task 4.2).
//
// Property 42: Onboarding step validation gate
// For any onboarding step submission, advancement to the next step occurs if
// and only if all required fields for that step are provided and wake time is
// a valid time in 00:00-23:59; blocked advances retain entered responses and
// identify the invalid field.
//
// Feature: calorie-cortisol-tool, Property 42
// **Validates: Requirements 16.4, 16.5**
package main

import (
	"fmt"
	"testing"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// obAllGoals is the ordered set of recognised goals used to decode a bitmask
// into a concrete (non-empty) goal selection for a scenario.
var obAllGoals = []string{
	GoalWeightLoss,
	GoalMuscleGain,
	GoalStressManagement,
	GoalCortisolTracking,
	GoalGeneralWellness,
}

// obDecodeGoals turns a 1..31 bitmask into a non-empty slice of known goals.
func obDecodeGoals(mask int) []string {
	goals := make([]string, 0, len(obAllGoals))
	for i, g := range obAllGoals {
		if mask&(1<<uint(i)) != 0 {
			goals = append(goals, g)
		}
	}
	if len(goals) == 0 { // guard: mask range is 1..31 so this should not happen
		goals = append(goals, GoalGeneralWellness)
	}
	return goals
}

func obGoalsAsAny(goals []string) []any {
	out := make([]any, len(goals))
	for i, g := range goals {
		out[i] = g
	}
	return out
}

// TestProperty42OnboardingStepValidationGate exercises the validation gate over
// randomly generated step submissions, asserting that advancement happens
// exactly when the step's required fields are present and any time field is a
// valid 00:00-23:59 value, and that blocked advances retain responses and name
// the offending field.
func TestProperty42OnboardingStepValidationGate(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // Task 4.2 requires >=100 iterations

	properties := gopter.NewProperties(parameters)

	properties.Property("advancement occurs iff required fields present and wake time valid", prop.ForAll(
		func(goalMask, step, fieldBits, hh, mm int) bool {
			goals := obDecodeGoals(goalMask)

			h := NewOnboardingHandler(nil, nil)
			const uid = "prop42-user"

			// For steps 2..5, record the health goals first so conditional-field
			// resolution (Req 16.3) is driven by a completed step 1. Step 1 with a
			// non-empty set of known goals must always be accepted.
			prevStep := StepHealthGoals // session.CurrentStep before this submission
			if step != StepHealthGoals {
				r1 := h.SubmitStep(uid, StepHealthGoals, map[string]any{
					FieldHealthGoals: obGoalsAsAny(goals),
				})
				if r1.Err != nil {
					return false // seeding step 1 must succeed
				}
				prevStep = r1.CurrentStep // == StepDietary (2)
			}

			// Build the submission for the target step, deciding per required field
			// whether to include a (valid) value, and computing the independently
			// expected validity + first offending field.
			required := RequiredFields(step, goals)
			fields := map[string]any{}
			expectValid := true
			expectedInvalid := ""

			for i, field := range required {
				include := fieldBits&(1<<uint(i)) != 0

				if timeFields[field] {
					if !include {
						if expectValid {
							expectValid = false
							expectedInvalid = field
						}
						continue
					}
					timeStr := fmt.Sprintf("%02d:%02d", hh, mm)
					fields[field] = timeStr
					if !(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) && expectValid {
						expectValid = false
						expectedInvalid = field
					}
					continue
				}

				if !include {
					if expectValid {
						expectValid = false
						expectedInvalid = field
					}
					continue
				}
				// Non-empty, valid value for a non-time field.
				if field == FieldHealthGoals {
					fields[field] = obGoalsAsAny(goals)
				} else {
					fields[field] = "provided"
				}
			}

			res := h.SubmitStep(uid, step, fields)

			// Every submitted field must be retained regardless of outcome (Req 16.5).
			for k, v := range fields {
				got, ok := res.Responses[k]
				if !ok {
					return false
				}
				if _, isSlice := v.([]any); !isSlice {
					if got != v {
						return false
					}
				}
			}

			if expectValid {
				// Advancement: no error; non-final steps move to step+1 without
				// completing, the final step completes onboarding (Req 16.4/16.6).
				if res.Err != nil {
					return false
				}
				if step < StepDailyRoutine {
					return res.CurrentStep == step+1 && !res.Completed
				}
				return res.Completed
			}

			// Blocked advance: validation rejection, the invalid field is named,
			// and the flow does not advance to step+1 (Req 16.5).
			if res.Err == nil {
				return false
			}
			if res.Err.Code != "ONBOARDING_STEP_INVALID" {
				return false
			}
			if res.InvalidField != expectedInvalid {
				return false
			}
			if !res.Err.RetainedState {
				return false
			}
			// Not advanced: current step stays at the pre-submission position.
			return res.CurrentStep == prevStep && res.CurrentStep < step+1
		},
		gen.IntRange(1, 31),   // goalMask: non-empty subset of known goals
		gen.IntRange(1, 5),    // step
		gen.IntRange(0, 1023), // per-required-field inclusion bits
		gen.IntRange(0, 25),   // wake/bed hour (allows out-of-range 24,25)
		gen.IntRange(0, 61),   // wake/bed minute (allows out-of-range 60,61)
	))

	properties.TestingRun(t)
}
