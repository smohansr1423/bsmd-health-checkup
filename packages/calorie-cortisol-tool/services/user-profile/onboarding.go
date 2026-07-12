// Task 4.1 — 5-step adaptive onboarding (Account_Module).
//
// Implements the User & Profile Service onboarding flow behind two endpoints:
//
//	POST /onboarding/step    -- submit a step's responses; validate then advance
//	GET  /onboarding/resume  -- resume at the first incomplete step
//
// The flow collects, in order (Req 16.1):
//
//	1. health goals
//	2. dietary restrictions / preferences
//	3. connected devices
//	4. cortisol testing intent
//	5. daily routine incl. wake time and meal patterns
//
// Behaviour implemented here:
//   - Goal-driven conditional fields in steps 2–5 (Req 16.3): the set of
//     required fields for a step depends on the health goals chosen in step 1.
//   - Required-field + wake-time (00:00–23:59) validation before advancing
//     (Req 16.4); on invalid input advancement is blocked, the entered
//     responses are retained, and the invalid field is identified (Req 16.5).
//   - Back-navigation retains responses (Req 16.2): responses accumulate in the
//     persisted session and are never dropped by re-visiting a prior step.
//   - Exit-before-completion resumes at the first incomplete step with prior
//     responses intact (Req 16.7).
//   - After step 5, a profile is created from the collected responses (Req 16.6);
//     on creation failure all responses are retained and the step is retryable
//     without re-entering data (Req 16.8).
//
// Persistence aligns with the migrations: onboarding_sessions (user_id,
// current_step, responses JSONB, completed) and profiles (health_goals,
// dietary_preferences, connected_devices, cortisol_testing_intent, wake_time
// TIME, meal_patterns, onboarding_completed). Two store implementations are
// provided: an in-memory store (default / tests) and a *sql.DB-backed store
// aligned to those tables.
//
// Degraded outcomes use the shared error/result contract in result.go
// (ValidationRejection for Req 16.5, AtomicFailure for Req 16.8).
//
// Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Step model
// ---------------------------------------------------------------------------

// TotalOnboardingSteps is the number of ordered steps in the flow (Req 16.1).
const TotalOnboardingSteps = 5

// Onboarding step numbers (1-indexed, ordered per Req 16.1).
const (
	StepHealthGoals    = 1
	StepDietary        = 2
	StepDevices        = 3
	StepCortisolIntent = 4
	StepDailyRoutine   = 5
)

// Response field keys accumulated across the flow. These map onto the
// profiles table columns at profile-creation time.
const (
	FieldHealthGoals           = "health_goals"            // step 1
	FieldDietaryRestrictions   = "dietary_restrictions"    // step 2
	FieldCalorieTarget         = "calorie_target"          // step 2 (conditional)
	FieldConnectedDevices      = "connected_devices"       // step 3
	FieldCortisolTestingIntent = "cortisol_testing_intent" // step 4
	FieldTestingFrequency      = "testing_frequency"       // step 4 (conditional)
	FieldWakeTime              = "wake_time"               // step 5
	FieldMealPatterns          = "meal_patterns"           // step 5
	FieldBedtime               = "bedtime"                 // step 5 (conditional)
)

// Recognised health goals selectable in step 1 (Req 16.1). The chosen goals
// drive the conditional fields shown in steps 2–5 (Req 16.3).
const (
	GoalWeightLoss       = "weight_loss"
	GoalMuscleGain       = "muscle_gain"
	GoalStressManagement = "stress_management"
	GoalCortisolTracking = "cortisol_tracking"
	GoalGeneralWellness  = "general_wellness"
)

var knownGoals = map[string]bool{
	GoalWeightLoss:       true,
	GoalMuscleGain:       true,
	GoalStressManagement: true,
	GoalCortisolTracking: true,
	GoalGeneralWellness:  true,
}

// timeFields are response fields validated as a 24h time-of-day value.
var timeFields = map[string]bool{
	FieldWakeTime: true,
	FieldBedtime:  true,
}

// ---------------------------------------------------------------------------
// Conditional-field resolution (Req 16.3)
// ---------------------------------------------------------------------------

// hasGoal reports whether goal is among the selected goals.
func hasGoal(goals []string, goal string) bool {
	for _, g := range goals {
		if g == goal {
			return true
		}
	}
	return false
}

// RequiredFields returns the ordered required fields for a step given the
// health goals selected in step 1. Steps 2–5 include goal-driven conditional
// fields (Req 16.3); step 1 always requires the health-goal selection itself.
func RequiredFields(step int, goals []string) []string {
	switch step {
	case StepHealthGoals:
		return []string{FieldHealthGoals}
	case StepDietary:
		f := []string{FieldDietaryRestrictions}
		// Calorie targeting is only relevant to weight/muscle goals.
		if hasGoal(goals, GoalWeightLoss) || hasGoal(goals, GoalMuscleGain) {
			f = append(f, FieldCalorieTarget)
		}
		return f
	case StepDevices:
		return []string{FieldConnectedDevices}
	case StepCortisolIntent:
		f := []string{FieldCortisolTestingIntent}
		// Testing frequency is only relevant to cortisol/stress goals.
		if hasGoal(goals, GoalCortisolTracking) || hasGoal(goals, GoalStressManagement) {
			f = append(f, FieldTestingFrequency)
		}
		return f
	case StepDailyRoutine:
		f := []string{FieldWakeTime, FieldMealPatterns}
		// Bedtime is only relevant to stress-management goals.
		if hasGoal(goals, GoalStressManagement) {
			f = append(f, FieldBedtime)
		}
		return f
	default:
		return nil
	}
}

// ---------------------------------------------------------------------------
// Validation (Req 16.4 / 16.5)
// ---------------------------------------------------------------------------

// obIsEmptyValue reports whether a decoded JSON value counts as "not provided".
func obIsEmptyValue(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		for _, r := range t {
			if r != ' ' && r != '\t' && r != '\n' && r != '\r' {
				return false
			}
		}
		return true
	case []any:
		return len(t) == 0
	case []string:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	default:
		return false
	}
}

// isValidWakeTime reports whether v is a zero-padded 24h "HH:MM" time in
// 00:00–23:59 (Req 16.4). Non-string or malformed values are invalid.
func isValidWakeTime(v any) bool {
	s, ok := v.(string)
	if !ok || len(s) != 5 || s[2] != ':' {
		return false
	}
	hh, err1 := strconv.Atoi(s[0:2])
	mm, err2 := strconv.Atoi(s[3:5])
	if err1 != nil || err2 != nil {
		return false
	}
	return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

// ExtractGoals returns the health goals recorded in the responses (empty when
// step 1 has not been completed).
func ExtractGoals(responses map[string]any) []string {
	raw, ok := responses[FieldHealthGoals]
	if !ok {
		return nil
	}
	switch t := raw.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// ValidateStep validates the accumulated responses against a step's
// requirements. It returns the name of the first invalid/missing field and
// ok=false when the step is not satisfiable, or ("", true) when the step is
// complete and valid (Req 16.4). The goals used for conditional-field
// resolution are read from the responses themselves.
func ValidateStep(step int, responses map[string]any) (invalidField string, ok bool) {
	goals := ExtractGoals(responses)

	// Step 1: every selected goal must be a recognised value.
	if step == StepHealthGoals {
		if obIsEmptyValue(responses[FieldHealthGoals]) {
			return FieldHealthGoals, false
		}
		for _, g := range goals {
			if !knownGoals[g] {
				return FieldHealthGoals, false
			}
		}
		return "", true
	}

	for _, field := range RequiredFields(step, goals) {
		v, present := responses[field]
		if !present || obIsEmptyValue(v) {
			return field, false
		}
		if timeFields[field] && !isValidWakeTime(v) {
			return field, false
		}
	}
	return "", true
}

// FirstIncompleteStep returns the first step (1..TotalOnboardingSteps) whose
// required fields are not yet satisfied, or TotalOnboardingSteps+1 when all
// steps are complete (Req 16.7).
func FirstIncompleteStep(responses map[string]any) int {
	for step := StepHealthGoals; step <= TotalOnboardingSteps; step++ {
		if _, ok := ValidateStep(step, responses); !ok {
			return step
		}
	}
	return TotalOnboardingSteps + 1
}

// ---------------------------------------------------------------------------
// Session model + persistence
// ---------------------------------------------------------------------------

// OnboardingSession mirrors a row of the onboarding_sessions table: the
// accumulated per-field responses, the current step, and a completion flag.
type OnboardingSession struct {
	UserID      string         `json:"userId"`
	CurrentStep int            `json:"currentStep"`
	Responses   map[string]any `json:"responses"`
	Completed   bool           `json:"completed"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// clone returns a deep-ish copy so callers cannot mutate stored state.
func (s *OnboardingSession) clone() *OnboardingSession {
	cp := *s
	cp.Responses = make(map[string]any, len(s.Responses))
	for k, v := range s.Responses {
		cp.Responses[k] = v
	}
	return &cp
}

// OnboardingStore persists in-progress onboarding sessions (Req 16.7/16.8).
type OnboardingStore interface {
	Get(userID string) (*OnboardingSession, bool, error)
	Save(session *OnboardingSession) error
}

// ProfileCreator creates the durable user profile from the collected
// onboarding responses once step 5 is complete (Req 16.6).
type ProfileCreator interface {
	CreateProfile(userID string, responses map[string]any) error
}

// ---------------------------------------------------------------------------
// In-memory implementations (default / tests)
// ---------------------------------------------------------------------------

// InMemoryOnboardingStore is a concurrency-safe in-memory OnboardingStore.
type InMemoryOnboardingStore struct {
	mu       sync.Mutex
	sessions map[string]*OnboardingSession
}

// NewInMemoryOnboardingStore constructs an empty in-memory store.
func NewInMemoryOnboardingStore() *InMemoryOnboardingStore {
	return &InMemoryOnboardingStore{sessions: make(map[string]*OnboardingSession)}
}

// Get returns a copy of the stored session for userID, if any.
func (m *InMemoryOnboardingStore) Get(userID string) (*OnboardingSession, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[userID]
	if !ok {
		return nil, false, nil
	}
	return s.clone(), true, nil
}

// Save stores a copy of the session.
func (m *InMemoryOnboardingStore) Save(session *OnboardingSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	session.UpdatedAt = time.Now().UTC()
	m.sessions[session.UserID] = session.clone()
	return nil
}

// InMemoryProfileCreator records created profiles. FailUntil forces the first
// N creation attempts to fail (used to exercise the retry-on-failure path,
// Req 16.8).
type InMemoryProfileCreator struct {
	mu        sync.Mutex
	Created   map[string]map[string]any
	FailUntil int
	attempts  int
}

// NewInMemoryProfileCreator constructs an in-memory profile creator.
func NewInMemoryProfileCreator() *InMemoryProfileCreator {
	return &InMemoryProfileCreator{Created: make(map[string]map[string]any)}
}

// CreateProfile records the profile, or returns an error while FailUntil
// attempts remain.
func (c *InMemoryProfileCreator) CreateProfile(userID string, responses map[string]any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.attempts++
	if c.attempts <= c.FailUntil {
		return errors.New("simulated profile creation failure")
	}
	cp := make(map[string]any, len(responses))
	for k, v := range responses {
		cp[k] = v
	}
	c.Created[userID] = cp
	return nil
}

// ---------------------------------------------------------------------------
// SQL implementations (aligned to migrations 000002 / 000004)
// ---------------------------------------------------------------------------

// SQLOnboardingStore persists sessions in the onboarding_sessions table.
type SQLOnboardingStore struct {
	DB *sql.DB
}

// Get loads a session row and decodes its JSONB responses.
func (s *SQLOnboardingStore) Get(userID string) (*OnboardingSession, bool, error) {
	const q = `SELECT current_step, responses, completed, updated_at
	           FROM onboarding_sessions WHERE user_id = $1`
	var (
		step      int
		raw       []byte
		completed bool
		updatedAt time.Time
	)
	err := s.DB.QueryRow(q, userID).Scan(&step, &raw, &completed, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	responses := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &responses); err != nil {
			return nil, false, err
		}
	}
	return &OnboardingSession{
		UserID:      userID,
		CurrentStep: step,
		Responses:   responses,
		Completed:   completed,
		UpdatedAt:   updatedAt,
	}, true, nil
}

// Save upserts the session row, storing responses as JSONB.
func (s *SQLOnboardingStore) Save(session *OnboardingSession) error {
	raw, err := json.Marshal(session.Responses)
	if err != nil {
		return err
	}
	const q = `INSERT INTO onboarding_sessions (user_id, current_step, responses, completed, updated_at)
	           VALUES ($1, $2, $3, $4, now())
	           ON CONFLICT (user_id) DO UPDATE
	             SET current_step = EXCLUDED.current_step,
	                 responses    = EXCLUDED.responses,
	                 completed    = EXCLUDED.completed,
	                 updated_at   = now()`
	_, err = s.DB.Exec(q, session.UserID, session.CurrentStep, raw, session.Completed)
	return err
}

// SQLProfileCreator writes the collected onboarding responses onto the
// profiles row and flips onboarding_completed (Req 16.6). Column mapping
// follows migration 000002.
type SQLProfileCreator struct {
	DB *sql.DB
}

// CreateProfile updates the profiles row for userID from the responses. The
// whole write is a single statement so it succeeds or fails atomically; on
// failure the caller retains the onboarding responses for retry (Req 16.8).
func (c *SQLProfileCreator) CreateProfile(userID string, responses map[string]any) error {
	healthGoals, err := obMarshalJSONB(responses[FieldHealthGoals], "[]")
	if err != nil {
		return err
	}
	dietary, err := obMarshalDietary(responses)
	if err != nil {
		return err
	}
	devices, err := obMarshalJSONB(responses[FieldConnectedDevices], "[]")
	if err != nil {
		return err
	}
	mealPatterns, err := obMarshalJSONB(responses[FieldMealPatterns], "{}")
	if err != nil {
		return err
	}

	var intent any
	if v, ok := responses[FieldCortisolTestingIntent].(string); ok {
		intent = v
	}
	var wake any
	if v, ok := responses[FieldWakeTime].(string); ok {
		wake = v
	}

	const q = `UPDATE profiles
	           SET health_goals            = $2,
	               dietary_preferences     = $3,
	               connected_devices       = $4,
	               cortisol_testing_intent = $5,
	               wake_time               = $6,
	               meal_patterns           = $7,
	               onboarding_completed    = TRUE,
	               updated_at              = now()
	           WHERE user_id = $1`
	res, err := c.DB.Exec(q, userID, healthGoals, dietary, devices, intent, wake, mealPatterns)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return errors.New("no profile row for user")
	}
	return nil
}

// obMarshalJSONB marshals v to JSON bytes, substituting a default when v is nil.
func obMarshalJSONB(v any, def string) ([]byte, error) {
	if v == nil {
		return []byte(def), nil
	}
	return json.Marshal(v)
}

// obMarshalDietary combines the dietary restrictions and (conditional) calorie
// target into the dietary_preferences JSONB column.
func obMarshalDietary(responses map[string]any) ([]byte, error) {
	pref := map[string]any{}
	if v, ok := responses[FieldDietaryRestrictions]; ok {
		pref[FieldDietaryRestrictions] = v
	}
	if v, ok := responses[FieldCalorieTarget]; ok {
		pref[FieldCalorieTarget] = v
	}
	return json.Marshal(pref)
}

// ---------------------------------------------------------------------------
// Handler / core flow
// ---------------------------------------------------------------------------

// OnboardingHandler serves the onboarding endpoints backed by a store and a
// profile creator.
type OnboardingHandler struct {
	Store    OnboardingStore
	Profiles ProfileCreator
}

// NewOnboardingHandler constructs a handler. Passing nil for either dependency
// falls back to in-memory implementations (useful for local/dev wiring).
func NewOnboardingHandler(store OnboardingStore, profiles ProfileCreator) *OnboardingHandler {
	if store == nil {
		store = NewInMemoryOnboardingStore()
	}
	if profiles == nil {
		profiles = NewInMemoryProfileCreator()
	}
	return &OnboardingHandler{Store: store, Profiles: profiles}
}

// StepResult is the outcome of submitting a step. Responses always reflects the
// retained accumulated state, even on failure (Req 16.5/16.8). Err is nil on
// success; InvalidField names the offending field on a validation rejection.
type StepResult struct {
	CurrentStep  int
	Completed    bool
	Responses    map[string]any
	InvalidField string
	Err          *ErrorContract
}

// SubmitStep merges the submitted fields into the user's session, validates the
// step, and either advances the flow (creating the profile after step 5) or
// blocks advancement while retaining responses.
//
//   - Invalid input → ValidationRejection, advancement blocked, responses
//     retained, invalid field identified (Req 16.4/16.5).
//   - Valid non-final step → current step advances (Req 16.4).
//   - Valid step 5 → profile creation; success completes onboarding (Req 16.6),
//     failure retains responses and is retryable (Req 16.8).
func (h *OnboardingHandler) SubmitStep(userID string, step int, fields map[string]any) StepResult {
	if userID == "" {
		e := ValidationRejection("ONBOARDING_USER_REQUIRED", "user id is required")
		return StepResult{Err: &e, InvalidField: "userId"}
	}
	if step < StepHealthGoals || step > StepDailyRoutine {
		e := ValidationRejection("ONBOARDING_STEP_RANGE", "step must be between 1 and 5")
		return StepResult{Err: &e, InvalidField: "step"}
	}

	session, found, err := h.Store.Get(userID)
	if err != nil {
		e := AtomicFailure("ONBOARDING_LOAD_FAILED", "could not load onboarding session", true)
		return StepResult{Err: &e}
	}
	if !found {
		session = &OnboardingSession{
			UserID:      userID,
			CurrentStep: StepHealthGoals,
			Responses:   map[string]any{},
		}
	}
	if session.Responses == nil {
		session.Responses = map[string]any{}
	}

	// Merge submitted fields into the accumulated responses BEFORE validating,
	// so entered responses are retained regardless of the outcome (Req 16.5).
	for k, v := range fields {
		session.Responses[k] = v
	}

	// Validate the submitted step's required fields (Req 16.4).
	if invalidField, ok := ValidateStep(step, session.Responses); !ok {
		// Persist the retained responses without advancing (Req 16.5).
		_ = h.Store.Save(session)
		e := ValidationRejection("ONBOARDING_STEP_INVALID", "field '"+invalidField+"' is missing or invalid")
		return StepResult{
			CurrentStep:  session.CurrentStep,
			Responses:    session.Responses,
			InvalidField: invalidField,
			Err:          &e,
		}
	}

	if step < StepDailyRoutine {
		// Advance to the next step; never move backwards (Req 16.2).
		if next := step + 1; next > session.CurrentStep {
			session.CurrentStep = next
		}
		if err := h.Store.Save(session); err != nil {
			e := AtomicFailure("ONBOARDING_SAVE_FAILED", "could not save onboarding progress", true)
			return StepResult{Responses: session.Responses, Err: &e}
		}
		return StepResult{CurrentStep: session.CurrentStep, Responses: session.Responses}
	}

	// Final step complete → create the profile (Req 16.6). Persist responses
	// first so they survive a creation failure (Req 16.8).
	session.CurrentStep = TotalOnboardingSteps
	_ = h.Store.Save(session)

	if err := h.Profiles.CreateProfile(userID, session.Responses); err != nil {
		// Retain all responses; report a retryable atomic failure (Req 16.8).
		e := AtomicFailure("PROFILE_CREATE_FAILED", "setup could not be saved; you can retry without re-entering data", true)
		return StepResult{
			CurrentStep: TotalOnboardingSteps,
			Responses:   session.Responses,
			Err:         &e,
		}
	}

	session.Completed = true
	_ = h.Store.Save(session)
	return StepResult{CurrentStep: TotalOnboardingSteps, Completed: true, Responses: session.Responses}
}

// Resume returns the current session state, positioning the user at the first
// incomplete step with prior responses intact (Req 16.7).
func (h *OnboardingHandler) Resume(userID string) (*OnboardingSession, error) {
	session, found, err := h.Store.Get(userID)
	if err != nil {
		return nil, err
	}
	if !found {
		return &OnboardingSession{
			UserID:      userID,
			CurrentStep: StepHealthGoals,
			Responses:   map[string]any{},
		}, nil
	}
	if session.Responses == nil {
		session.Responses = map[string]any{}
	}
	if !session.Completed {
		if s := FirstIncompleteStep(session.Responses); s <= TotalOnboardingSteps {
			session.CurrentStep = s
		}
	}
	return session, nil
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

type obStepRequestBody struct {
	UserID string         `json:"userId"`
	Step   int            `json:"step"`
	Fields map[string]any `json:"fields"`
}

type obErrorResponseBody struct {
	Code          string `json:"code"`
	Message       string `json:"message"`
	Retryable     bool   `json:"retryable"`
	RetainedState bool   `json:"retainedState"`
	InvalidField  string `json:"invalidField,omitempty"`
}

type obStepResponseBody struct {
	CurrentStep int            `json:"currentStep"`
	Completed   bool           `json:"completed"`
	Responses   map[string]any `json:"responses"`
}

// RegisterRoutes wires the onboarding endpoints onto a mux. This is additive:
// it does not touch the service bootstrap.
func (h *OnboardingHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/onboarding/step", h.handleStep)
	mux.HandleFunc("/onboarding/resume", h.handleResume)
}

func obUserID(r *http.Request, bodyUserID string) string {
	if bodyUserID != "" {
		return bodyUserID
	}
	return r.Header.Get("X-User-Id")
}

func (h *OnboardingHandler) handleStep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body obStepRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		obWriteError(w, http.StatusBadRequest, ValidationRejection("ONBOARDING_BAD_JSON", "invalid request body"), "")
		return
	}
	userID := obUserID(r, body.UserID)
	res := h.SubmitStep(userID, body.Step, body.Fields)
	if res.Err != nil {
		obWriteError(w, obStatusForError(res.Err), *res.Err, res.InvalidField)
		return
	}
	obWriteJSON(w, http.StatusOK, obStepResponseBody{
		CurrentStep: res.CurrentStep,
		Completed:   res.Completed,
		Responses:   res.Responses,
	})
}

func (h *OnboardingHandler) handleResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID := obUserID(r, r.URL.Query().Get("userId"))
	if userID == "" {
		obWriteError(w, http.StatusBadRequest, ValidationRejection("ONBOARDING_USER_REQUIRED", "user id is required"), "userId")
		return
	}
	session, err := h.Resume(userID)
	if err != nil {
		obWriteError(w, http.StatusInternalServerError, AtomicFailure("ONBOARDING_LOAD_FAILED", "could not load onboarding session", true), "")
		return
	}
	obWriteJSON(w, http.StatusOK, obStepResponseBody{
		CurrentStep: session.CurrentStep,
		Completed:   session.Completed,
		Responses:   session.Responses,
	})
}

// obStatusForError maps the structured contract to an HTTP status.
func obStatusForError(e *ErrorContract) int {
	switch e.Code {
	case "ONBOARDING_STEP_INVALID", "ONBOARDING_STEP_RANGE",
		"ONBOARDING_USER_REQUIRED", "ONBOARDING_BAD_JSON":
		return http.StatusBadRequest
	case "PROFILE_CREATE_FAILED", "ONBOARDING_SAVE_FAILED",
		"ONBOARDING_LOAD_FAILED":
		return http.StatusInternalServerError
	default:
		return http.StatusBadRequest
	}
}

func obWriteError(w http.ResponseWriter, status int, e ErrorContract, invalidField string) {
	obWriteJSON(w, status, obErrorResponseBody{
		Code:          e.Code,
		Message:       e.Message,
		Retryable:     e.Retryable,
		RetainedState: e.RetainedState,
		InvalidField:  invalidField,
	})
}

func obWriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
