package contracts

// ---------- Food domain ----------

// NutrientUnit is the unit of a nutrient value.
type NutrientUnit string

const (
	UnitKcal NutrientUnit = "kcal"
	UnitG    NutrientUnit = "g"
	UnitMg   NutrientUnit = "mg"
)

// ReferenceObject is an object used to scale a portion estimate (Req 3.3/3.4).
type ReferenceObject string

const (
	ReferencePlate   ReferenceObject = "plate"
	ReferenceHand    ReferenceObject = "hand"
	ReferenceUtensil ReferenceObject = "utensil"
)

// MealSource is the origin of a logged meal.
type MealSource string

const (
	SourcePhoto      MealSource = "photo"
	SourceBarcode    MealSource = "barcode"
	SourceVoice      MealSource = "voice"
	SourceMenuOCR    MealSource = "menuOCR"
	SourceTextSearch MealSource = "textSearch"
	SourceManual     MealSource = "manual"
)

// SyncStatus is the local-first sync lifecycle of a record (Req 17/27).
type SyncStatus string

const (
	SyncLocal    SyncStatus = "local"
	SyncPending  SyncStatus = "pending"
	SyncSynced   SyncStatus = "synced"
	SyncConflict SyncStatus = "conflict"
)

// BoundingBox is an axis-aligned box in normalized [0,1] image coordinates.
type BoundingBox struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// FoodItem is a recognized food item (Req 2.1/2.2).
type FoodItem struct {
	ID         string       `json:"id"`
	Label      string       `json:"label"`
	Confidence float64      `json:"confidence"` // 0..100 (Req 2.2)
	BBox       *BoundingBox `json:"bbox,omitempty"`
}

// PortionEstimate is a portion/volume estimate for a food region (Req 3).
type PortionEstimate struct {
	VolumeMl        float64          `json:"volumeMl"` // >= 0
	ErrorPct        float64          `json:"errorPct"`
	Scaled          bool             `json:"scaled"` // false -> accuracy reduced (Req 3.4)
	ReferenceObject *ReferenceObject `json:"referenceObject,omitempty"`
}

// NutrientValue is a nutrient value with its confidence range (Req 4.5/4.6).
type NutrientValue struct {
	Value     float64      `json:"value"` // >= 0
	Unit      NutrientUnit `json:"unit"`
	Lower     float64      `json:"lower"` // lower <= value <= upper (Req 4.5)
	Upper     float64      `json:"upper"`
	Available bool         `json:"available"` // false -> "unavailable" (Req 4.6)
}

// MealItem is a single item within a meal.
type MealItem struct {
	FoodItem          FoodItem                 `json:"foodItem"`
	PortionMultiplier float64                  `json:"portionMultiplier"` // 0.25..3.0 step 0.25 (Req 5.1)
	Nutrition         map[string]NutrientValue `json:"nutrition"`
}

// NutritionTotals is aggregated nutrition for a meal (Req 4.1-4.4).
type NutritionTotals struct {
	Calories       NutrientValue            `json:"calories"`
	Protein        NutrientValue            `json:"protein"`
	Carbs          NutrientValue            `json:"carbs"`
	Fat            NutrientValue            `json:"fat"`
	Secondary      map[string]NutrientValue `json:"secondary"`
	Micronutrients map[string]NutrientValue `json:"micronutrients,omitempty"`
}

// Meal is a logged meal (Req 5 — totals recomputed on every correction).
type Meal struct {
	ID         string          `json:"id"`
	UserID     string          `json:"userId"`
	LoggedAt   string          `json:"loggedAt"` // ISO timestamp (local + offset)
	Items      []MealItem      `json:"items"`    // 0..20
	Totals     NutritionTotals `json:"totals"`
	Source     MealSource      `json:"source"`
	SyncStatus SyncStatus      `json:"syncStatus"`
}

// PlateCalibration is a persisted personal plate calibration (Req 3.6/3.7).
type PlateCalibration struct {
	UserID         string  `json:"userId"`
	ReferenceScale float64 `json:"referenceScale"`
	UpdatedAt      string  `json:"updatedAt"`
}

// Correction records an applied correction and its training-queue status (Req 5.5/5.8).
type Correction struct {
	MealID         string                 `json:"mealId"`
	Op             map[string]interface{} `json:"op"`
	TrainingQueued bool                   `json:"trainingQueued"`
}

// ---------- Cortisol domain ----------

// CortisolSource is the source of a cortisol reading.
type CortisolSource string

const (
	CortisolLab               CortisolSource = "lab"
	CortisolPatch             CortisolSource = "patch"
	CortisolWearableProxy     CortisolSource = "wearableProxy"
	CortisolQuestionnaireProxy CortisolSource = "questionnaireProxy"
)

// TimeOfDayBucket is a diurnal time-of-day bucket (Req 8.3).
type TimeOfDayBucket string

const (
	BucketMorning   TimeOfDayBucket = "morning"
	BucketNoon      TimeOfDayBucket = "noon"
	BucketAfternoon TimeOfDayBucket = "afternoon"
	BucketEvening   TimeOfDayBucket = "evening"
)

// Sex is the biological sex used for reference-range selection.
type Sex string

const (
	SexMale   Sex = "M"
	SexFemale Sex = "F"
	SexOther  Sex = "other"
)

// Classification is a reference-range classification of a reading (Req 8.5).
type Classification string

const (
	ClassBelow  Classification = "below"
	ClassNormal Classification = "normal"
	ClassAbove  Classification = "above"
)

// QuestionnaireType is a validated questionnaire instrument (Req 10).
type QuestionnaireType string

const (
	QuestionnairePSS10 QuestionnaireType = "PSS-10"
	QuestionnaireGAD7  QuestionnaireType = "GAD-7"
	QuestionnairePSQI  QuestionnaireType = "PSQI"
)

// BurdenTier is a deterministic cortisol burden tier (Req 10.3).
type BurdenTier string

const (
	TierLow      BurdenTier = "Low"
	TierModerate BurdenTier = "Moderate"
	TierElevated BurdenTier = "Elevated"
	TierHigh     BurdenTier = "High"
)

// ReferenceContext is age/sex/time-of-day reference context for a reading (Req 8.5).
type ReferenceContext struct {
	AgeBand        string         `json:"ageBand"`
	Sex            Sex            `json:"sex"`
	RefLower       float64        `json:"refLower"`
	RefUpper       float64        `json:"refUpper"`
	Classification Classification `json:"classification"`
}

// CortisolReading is a single normalized cortisol reading.
type CortisolReading struct {
	ID              string            `json:"id"`
	UserID          string            `json:"userId"`
	MeasuredAt      string            `json:"measuredAt"` // ISO timestamp
	ValueNmolL      float64           `json:"valueNmolL"`
	Source          CortisolSource    `json:"source"`
	SourceID        string            `json:"sourceId,omitempty"` // patch/device id (Req 9.3/9.5)
	TimeOfDayBucket TimeOfDayBucket   `json:"timeOfDayBucket"`
	Contextualized  *ReferenceContext `json:"contextualized,omitempty"` // Req 8.5
	Valid           bool              `json:"valid"`                    // Req 9.4
}

// QuestionnaireResult is the result of a scored questionnaire (Req 10).
type QuestionnaireResult struct {
	Type       QuestionnaireType `json:"type"`
	Answers    []int             `json:"answers"`    // all items required (Req 10.2)
	TotalScore int               `json:"totalScore"` // within valid range (Req 10.1)
	Tier       BurdenTier        `json:"tier"`       // deterministic map (Req 10.3)
}

// CARSample is a single timed CAR sample.
type CARSample struct {
	At    string  `json:"at"`
	Value float64 `json:"value"`
}

// CARMeasurement is a Cortisol Awakening Response measurement (Req 11).
type CARMeasurement struct {
	UserID      string     `json:"userId"`
	WakeTime    string     `json:"wakeTime"`
	Sample1     *CARSample `json:"sample1,omitempty"`     // <=35 min after wake (Req 11.1)
	Sample2     *CARSample `json:"sample2,omitempty"`     // 25..35 min after sample1 (Req 11.2)
	IncreasePct *float64   `json:"increasePct,omitempty"` // <50% -> flattened (Req 11.5)
	Status      string     `json:"status"`                // incomplete | complete | flattened
}

// LifeEvent is a user-recorded life event for trend annotation (Req 12.3/12.4).
type LifeEvent struct {
	UserID string `json:"userId"`
	Date   string `json:"date"`
	Label  string `json:"label"`
}

// ---------- Correlation / Insights ----------

// AlignedPair is a food/cortisol pair aligned within +/-180 min (Req 15.1).
type AlignedPair struct {
	MealID       string  `json:"mealId"`
	ReadingID    string  `json:"readingId"`
	DeltaMinutes float64 `json:"deltaMinutes"`
}

// CorrelationResult is the result of a correlation significance test (Req 15.3/15.4).
type CorrelationResult struct {
	Coefficient float64 `json:"coefficient"` // |r| >= 0.5 -> significant
	PValue      float64 `json:"pValue"`      // < 0.05 -> significant
	PairCount   int     `json:"pairCount"`   // >= 20 required to analyze
	Significant bool    `json:"significant"`
}

// ApprovalStatus is the clinical-advisory-board approval status of an insight (Req 13.3/29.3).
type ApprovalStatus string

const (
	ApprovalApproved ApprovalStatus = "approved"
	ApprovalDraft    ApprovalStatus = "draft"
	ApprovalPending  ApprovalStatus = "pending"
	ApprovalRevoked  ApprovalStatus = "revoked"
)

// Insight is a surfaced wellness insight/recommendation (Req 13/15/29).
type Insight struct {
	ID                string         `json:"id"`
	TemplateID        string         `json:"templateId"`
	ApprovalStatus    ApprovalStatus `json:"approvalStatus"`    // only "approved" displayed (Req 13.3/29.3)
	DisclaimerRendered bool          `json:"disclaimerRendered"` // must be true to display (Req 29.2/29.5)
	RankScore         float64        `json:"rankScore"`         // descending correlation strength (Req 15.8)
}

// ---------- Account / Compliance ----------

// FamilyRole is the role of a member within a family account (Req 19).
type FamilyRole string

const (
	RoleAdmin  FamilyRole = "admin"
	RoleMember FamilyRole = "member"
)

// AuditAction is the audit action type (Req 25.6).
type AuditAction string

const (
	ActionRead   AuditAction = "read"
	ActionCreate AuditAction = "create"
	ActionModify AuditAction = "modify"
	ActionDelete AuditAction = "delete"
)

// ConsentState is the per-category consent state (Req 17 / 30.4).
type ConsentState struct {
	UserID            string          `json:"userId"`
	Categories        map[string]bool `json:"categories"`        // per-category opt-in (Req 17)
	HealthDataConsent bool            `json:"healthDataConsent"` // affirmative consent (Req 30.4)
	UpdatedAt         string          `json:"updatedAt"`
}

// MemberProfile is a single member profile within a family account.
type MemberProfile struct {
	ID   string     `json:"id"`
	Role FamilyRole `json:"role"`
}

// FamilyAccount is a family account holding <=5 member profiles (Req 19.1).
type FamilyAccount struct {
	ID          string          `json:"id"`
	AdminUserID string          `json:"adminUserId"`
	Members     []MemberProfile `json:"members"` // <= 5
}

// AuditEntry is an append-only audit entry, retained >=6 years (Req 25.6).
type AuditEntry struct {
	ActorID   string      `json:"actorId"`
	Action    AuditAction `json:"action"`
	RecordID  string      `json:"recordId"`
	Timestamp string      `json:"timestamp"`
}

// Residency is a data-residency descriptor for a user (Req 30.6/30.7).
type Residency struct {
	UserID     string `json:"userId"`
	Region     string `json:"region"`
	EUResident bool   `json:"euResident"`
}
