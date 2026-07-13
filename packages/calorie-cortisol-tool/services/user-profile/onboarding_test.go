// Focused unit tests for the 5-step adaptive onboarding flow (Task 4.1).
//
// These cover the endpoint/validation logic directly. The named property-based
// tests (Property 42 / 43) are implemented separately in optional tasks
// 4.2 / 4.3.
//
// Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --- Conditional-field resolution (Req 16.3) ------------------------------

func TestRequiredFieldsAreGoalDriven(t *testing.T) {
	// Weight-loss adds a calorie target to the dietary step.
	if got := RequiredFields(StepDietary, []string{GoalWeightLoss}); !obContains(got, FieldCalorieTarget) {
		t.Fatalf("weight_loss should require %q in step 2, got %v", FieldCalorieTarget, got)
	}
	// General wellness alone does not.
	if got := RequiredFields(StepDietary, []string{GoalGeneralWellness}); obContains(got, FieldCalorieTarget) {
		t.Fatalf("general_wellness should not require %q in step 2, got %v", FieldCalorieTarget, got)
	}
	// Cortisol tracking adds testing frequency to step 4.
	if got := RequiredFields(StepCortisolIntent, []string{GoalCortisolTracking}); !obContains(got, FieldTestingFrequency) {
		t.Fatalf("cortisol_tracking should require %q in step 4, got %v", FieldTestingFrequency, got)
	}
	// Stress management adds bedtime to step 5.
	if got := RequiredFields(StepDailyRoutine, []string{GoalStressManagement}); !obContains(got, FieldBedtime) {
		t.Fatalf("stress_management should require %q in step 5, got %v", FieldBedtime, got)
	}
	if got := RequiredFields(StepDailyRoutine, []string{GoalGeneralWellness}); obContains(got, FieldBedtime) {
		t.Fatalf("general_wellness should not require bedtime, got %v", got)
	}
}

// --- Wake-time validation (Req 16.4) --------------------------------------

func TestWakeTimeBoundaries(t *testing.T) {
	valid := []string{"00:00", "23:59", "07:30", "12:00"}
	for _, v := range valid {
		if !isValidWakeTime(v) {
			t.Fatalf("expected %q to be a valid wake time", v)
		}
	}
	invalid := []any{"24:00", "23:60", "7:30", "0730", "-1:00", "aa:bb", 730, nil, ""}
	for _, v := range invalid {
		if isValidWakeTime(v) {
			t.Fatalf("expected %v to be an invalid wake time", v)
		}
	}
}

// --- Validation gate blocks & identifies invalid field (Req 16.4/16.5) ----

func TestValidateStepIdentifiesMissingAndInvalidFields(t *testing.T) {
	// Step 1 requires health goals.
	if f, ok := ValidateStep(StepHealthGoals, map[string]any{}); ok || f != FieldHealthGoals {
		t.Fatalf("expected step 1 to fail on %q, got field=%q ok=%v", FieldHealthGoals, f, ok)
	}
	// Unknown goal value is rejected.
	if f, ok := ValidateStep(StepHealthGoals, map[string]any{FieldHealthGoals: []any{"teleportation"}}); ok || f != FieldHealthGoals {
		t.Fatalf("expected unknown goal to fail, got field=%q ok=%v", f, ok)
	}
	// Step 5 with weight-loss goal: invalid wake time is identified.
	responses := map[string]any{
		FieldHealthGoals:  []any{GoalWeightLoss},
		FieldWakeTime:     "24:00",
		FieldMealPatterns: map[string]any{"breakfast": "08:00"},
	}
	if f, ok := ValidateStep(StepDailyRoutine, responses); ok || f != FieldWakeTime {
		t.Fatalf("expected wake_time to be flagged invalid, got field=%q ok=%v", f, ok)
	}
	// Fix the wake time → step is valid.
	responses[FieldWakeTime] = "06:30"
	if f, ok := ValidateStep(StepDailyRoutine, responses); !ok {
		t.Fatalf("expected step 5 to validate, got field=%q ok=%v", f, ok)
	}
}

// --- Advancement blocked while responses retained (Req 16.5) --------------

func TestSubmitStepBlocksAndRetainsResponsesOnInvalidInput(t *testing.T) {
	h := NewOnboardingHandler(nil, nil)
	const uid = "user-1"

	// Complete steps 1-3 so the first incomplete step is step 4. This isolates
	// the "advancement blocked" behavior under test from the resume-at-first-
	// incomplete-step rule (Req 16.7): skipping steps 2/3 would legitimately
	// make Resume land on step 2, not step 4.
	if r := h.SubmitStep(uid, StepHealthGoals, map[string]any{FieldHealthGoals: []any{GoalStressManagement}}); r.Err != nil {
		t.Fatalf("step 1 should succeed, got %+v", r.Err)
	}
	if r := h.SubmitStep(uid, StepDietary, map[string]any{FieldDietaryRestrictions: []any{"none"}}); r.Err != nil {
		t.Fatalf("step 2 should succeed, got %+v", r.Err)
	}
	if r := h.SubmitStep(uid, StepDevices, map[string]any{FieldConnectedDevices: []any{"none"}}); r.Err != nil {
		t.Fatalf("step 3 should succeed, got %+v", r.Err)
	}

	// Step 4 for a stress goal requires testing_frequency; omit it.
	r := h.SubmitStep(uid, StepCortisolIntent, map[string]any{FieldCortisolTestingIntent: "monthly"})
	if r.Err == nil {
		t.Fatal("expected validation rejection for missing testing_frequency")
	}
	if r.InvalidField != FieldTestingFrequency {
		t.Fatalf("expected invalid field %q, got %q", FieldTestingFrequency, r.InvalidField)
	}
	if r.Err.Retryable {
		t.Fatal("validation rejection must not be marked retryable")
	}
	if !r.Err.RetainedState {
		t.Fatal("validation rejection must retain prior state")
	}
	// The entered response must be retained despite the block.
	if r.Responses[FieldCortisolTestingIntent] != "monthly" {
		t.Fatalf("entered response should be retained, got %v", r.Responses[FieldCortisolTestingIntent])
	}
	// Advancement is blocked: resume still sits at step 4.
	session, _ := h.Resume(uid)
	if session.CurrentStep != StepCortisolIntent {
		t.Fatalf("expected to remain on step %d, got %d", StepCortisolIntent, session.CurrentStep)
	}
}

// --- Resume at first incomplete step with responses intact (Req 16.7) -----

func TestResumeAtFirstIncompleteStep(t *testing.T) {
	h := NewOnboardingHandler(nil, nil)
	const uid = "user-2"

	h.SubmitStep(uid, StepHealthGoals, map[string]any{FieldHealthGoals: []any{GoalGeneralWellness}})
	h.SubmitStep(uid, StepDietary, map[string]any{FieldDietaryRestrictions: []any{"none"}})

	// Exit here. Resume should land on step 3 (devices) with prior data intact.
	session, err := h.Resume(uid)
	if err != nil {
		t.Fatalf("resume error: %v", err)
	}
	if session.CurrentStep != StepDevices {
		t.Fatalf("expected resume at step %d, got %d", StepDevices, session.CurrentStep)
	}
	if session.Responses[FieldHealthGoals] == nil || session.Responses[FieldDietaryRestrictions] == nil {
		t.Fatalf("prior responses must survive resume, got %v", session.Responses)
	}
}

// --- Back-navigation retains responses (Req 16.2) -------------------------

func TestBackNavigationRetainsResponses(t *testing.T) {
	h := NewOnboardingHandler(nil, nil)
	const uid = "user-3"

	h.SubmitStep(uid, StepHealthGoals, map[string]any{FieldHealthGoals: []any{GoalGeneralWellness}})
	h.SubmitStep(uid, StepDietary, map[string]any{FieldDietaryRestrictions: []any{"vegetarian"}})

	// Re-submit step 1 (navigating back) must not drop step-2 data or regress.
	r := h.SubmitStep(uid, StepHealthGoals, map[string]any{FieldHealthGoals: []any{GoalGeneralWellness}})
	if r.Err != nil {
		t.Fatalf("re-submitting step 1 should succeed, got %+v", r.Err)
	}
	if r.Responses[FieldDietaryRestrictions] == nil {
		t.Fatal("step-2 response must be retained after navigating back to step 1")
	}
	if r.CurrentStep < StepDietary {
		t.Fatalf("current step should not regress below %d, got %d", StepDietary, r.CurrentStep)
	}
}

// --- Full completion creates a profile (Req 16.6) -------------------------

func TestFullFlowCreatesProfile(t *testing.T) {
	store := NewInMemoryOnboardingStore()
	profiles := NewInMemoryProfileCreator()
	h := NewOnboardingHandler(store, profiles)
	const uid = "user-4"

	obCompleteFullFlow(t, h, uid)

	if _, ok := profiles.Created[uid]; !ok {
		t.Fatal("expected a profile to be created after step 5")
	}
	session, _ := h.Resume(uid)
	if !session.Completed {
		t.Fatal("session should be marked completed")
	}
}

// --- Profile-creation failure retains responses & is retryable (Req 16.8) -

func TestProfileCreationFailureRetainsResponsesForRetry(t *testing.T) {
	store := NewInMemoryOnboardingStore()
	profiles := NewInMemoryProfileCreator()
	profiles.FailUntil = 1 // first creation attempt fails
	h := NewOnboardingHandler(store, profiles)
	const uid = "user-5"

	// Drive steps 1..4.
	h.SubmitStep(uid, StepHealthGoals, map[string]any{FieldHealthGoals: []any{GoalGeneralWellness}})
	h.SubmitStep(uid, StepDietary, map[string]any{FieldDietaryRestrictions: []any{"none"}})
	h.SubmitStep(uid, StepDevices, map[string]any{FieldConnectedDevices: []any{"none"}})
	h.SubmitStep(uid, StepCortisolIntent, map[string]any{FieldCortisolTestingIntent: "none"})

	// Step 5: first attempt fails during profile creation.
	r := h.SubmitStep(uid, StepDailyRoutine, map[string]any{
		FieldWakeTime:     "06:45",
		FieldMealPatterns: map[string]any{"lunch": "13:00"},
	})
	if r.Err == nil || r.Err.Code != "PROFILE_CREATE_FAILED" {
		t.Fatalf("expected PROFILE_CREATE_FAILED, got %+v", r.Err)
	}
	if !r.Err.Retryable || !r.Err.RetainedState {
		t.Fatalf("profile-creation failure must be retryable and retain state, got %+v", r.Err)
	}
	if r.Responses[FieldWakeTime] != "06:45" {
		t.Fatalf("responses must be retained for retry, got %v", r.Responses)
	}

	// Retry step 5 without re-entering data (responses already persisted).
	retry := h.SubmitStep(uid, StepDailyRoutine, map[string]any{})
	if retry.Err != nil {
		t.Fatalf("retry should succeed, got %+v", retry.Err)
	}
	if !retry.Completed {
		t.Fatal("retry should complete onboarding")
	}
	if _, ok := profiles.Created[uid]; !ok {
		t.Fatal("profile should exist after successful retry")
	}
}

// --- HTTP endpoints (Req 16.1) --------------------------------------------

func TestHTTPStepAndResumeEndpoints(t *testing.T) {
	h := NewOnboardingHandler(nil, nil)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// POST a valid step 1.
	body, _ := json.Marshal(obStepRequestBody{
		UserID: "http-user",
		Step:   StepHealthGoals,
		Fields: map[string]any{FieldHealthGoals: []any{GoalGeneralWellness}},
	})
	resp, err := http.Post(srv.URL+"/onboarding/step", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /onboarding/step failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var stepResp obStepResponseBody
	json.NewDecoder(resp.Body).Decode(&stepResp)
	resp.Body.Close()
	if stepResp.CurrentStep != StepDietary {
		t.Fatalf("expected to advance to step %d, got %d", StepDietary, stepResp.CurrentStep)
	}

	// POST an invalid step (missing required field) → 400 + invalidField.
	badBody, _ := json.Marshal(obStepRequestBody{UserID: "http-user", Step: StepDietary, Fields: map[string]any{}})
	badResp, _ := http.Post(srv.URL+"/onboarding/step", "application/json", bytes.NewReader(badBody))
	if badResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid step, got %d", badResp.StatusCode)
	}
	var errBody obErrorResponseBody
	json.NewDecoder(badResp.Body).Decode(&errBody)
	badResp.Body.Close()
	if errBody.InvalidField != FieldDietaryRestrictions {
		t.Fatalf("expected invalidField %q, got %q", FieldDietaryRestrictions, errBody.InvalidField)
	}

	// GET resume → still at the dietary step with responses intact.
	getResp, err := http.Get(srv.URL + "/onboarding/resume?userId=http-user")
	if err != nil {
		t.Fatalf("GET /onboarding/resume failed: %v", err)
	}
	var resumeBody obStepResponseBody
	json.NewDecoder(getResp.Body).Decode(&resumeBody)
	getResp.Body.Close()
	if resumeBody.CurrentStep != StepDietary {
		t.Fatalf("expected resume at step %d, got %d", StepDietary, resumeBody.CurrentStep)
	}
	if resumeBody.Responses[FieldHealthGoals] == nil {
		t.Fatal("resume should return retained responses")
	}
}

// --- helpers --------------------------------------------------------------

func obCompleteFullFlow(t *testing.T, h *OnboardingHandler, uid string) {
	t.Helper()
	steps := []struct {
		step   int
		fields map[string]any
	}{
		{StepHealthGoals, map[string]any{FieldHealthGoals: []any{GoalGeneralWellness}}},
		{StepDietary, map[string]any{FieldDietaryRestrictions: []any{"none"}}},
		{StepDevices, map[string]any{FieldConnectedDevices: []any{"none"}}},
		{StepCortisolIntent, map[string]any{FieldCortisolTestingIntent: "none"}},
		{StepDailyRoutine, map[string]any{
			FieldWakeTime:     "07:00",
			FieldMealPatterns: map[string]any{"breakfast": "08:00"},
		}},
	}
	for _, s := range steps {
		if r := h.SubmitStep(uid, s.step, s.fields); r.Err != nil {
			t.Fatalf("step %d should succeed, got %+v", s.step, r.Err)
		}
	}
}

func obContains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
