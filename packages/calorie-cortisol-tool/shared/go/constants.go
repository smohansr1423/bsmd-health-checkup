// Package contracts holds the shared, language-neutral domain types and API
// contracts for the Calorie & Cortisol Tool, mirrored from the TypeScript
// source of truth (@calorie-cortisol/shared). It is consumed by the Go
// User & Profile service so all services share the same contracts.
//
// Implemented in task 1.2 ("Define shared domain types and API contracts").
package contracts

// PackageName identifies this shared contracts package.
const PackageName = "cc-contracts"

// Field-level constraints from the design's Data Models section.
const (
	// ConfidenceMin / ConfidenceMax bound per-item recognition confidence (Req 2.2).
	ConfidenceMin = 0
	ConfidenceMax = 100

	// ConfidenceAutoThreshold is the confidence at/above which a detection is
	// auto-classified (Req 2.3/2.7).
	ConfidenceAutoThreshold = 70

	// MaxMealItems is the maximum number of items in a single meal (0..20).
	MaxMealItems = 20

	// Portion multiplier bounds and step (Req 5.1).
	PortionMultiplierMin  = 0.25
	PortionMultiplierMax  = 3.0
	PortionMultiplierStep = 0.25

	// Wearable/patch reading value bounds in the reported unit (Req 9.4).
	ReadingValueMin = 0.01
	ReadingValueMax = 100.0

	// MaxFamilyMembers is the maximum members in a family account (Req 19.1).
	MaxFamilyMembers = 5

	// Consecutive-day logging streak bounds (Req 6.4/6.5).
	StreakMin = 0
	StreakMax = 3650

	// AlignmentWindowMinutes is the correlation alignment window, inclusive (Req 15.1).
	AlignmentWindowMinutes = 180

	// Correlation significance gates (Req 15.3/15.4).
	SignificanceMinPairs          = 20
	SignificanceMinAbsCoefficient = 0.5
	SignificanceMaxPValue         = 0.05

	// Guidance recommendation-card count bounds (Req 13.1).
	GuidanceMinCards = 1
	GuidanceMaxCards = 5
)

// ScoreRange is a valid inclusive score range for a questionnaire instrument.
type ScoreRange struct {
	Min int
	Max int
}

// QuestionnaireScoreRange maps each instrument to its valid total-score range (Req 10.1).
var QuestionnaireScoreRange = map[QuestionnaireType]ScoreRange{
	QuestionnairePSS10: {Min: 0, Max: 40},
	QuestionnaireGAD7:  {Min: 0, Max: 21},
	QuestionnairePSQI:  {Min: 0, Max: 21},
}

// QuestionnaireItemCount maps each instrument to its required item count (Req 10.2).
var QuestionnaireItemCount = map[QuestionnaireType]int{
	QuestionnairePSS10: 10,
	QuestionnaireGAD7:  7,
	QuestionnairePSQI:  19,
}
