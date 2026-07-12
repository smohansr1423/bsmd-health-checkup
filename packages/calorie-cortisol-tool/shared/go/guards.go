package contracts

import (
	"math"
	"regexp"
	"strconv"
)

var wakeTimeRe = regexp.MustCompile(`^([0-9]{2}):([0-9]{2})$`)

func isFinite(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0)
}

// IsValidConfidence reports whether confidence lies within the inclusive
// 0..100 range (Req 2.2).
func IsValidConfidence(confidence float64) bool {
	return isFinite(confidence) && confidence >= ConfidenceMin && confidence <= ConfidenceMax
}

// IsValidFoodItem reports whether a FoodItem has a non-empty id/label and an
// in-range confidence (Req 2.2).
func IsValidFoodItem(item FoodItem) bool {
	return item.ID != "" && item.Label != "" && IsValidConfidence(item.Confidence)
}

// IsValidPortionEstimate reports whether a portion volume is finite and >= 0 (Req 3).
func IsValidPortionEstimate(estimate PortionEstimate) bool {
	return isFinite(estimate.VolumeMl) && estimate.VolumeMl >= 0 && isFinite(estimate.ErrorPct)
}

// IsValidNutrientValue reports whether lower <= value <= upper with value >= 0 (Req 4.5).
func IsValidNutrientValue(nv NutrientValue) bool {
	return isFinite(nv.Value) && isFinite(nv.Lower) && isFinite(nv.Upper) &&
		nv.Value >= 0 && nv.Lower <= nv.Value && nv.Value <= nv.Upper
}

// IsValidPortionMultiplier reports whether the multiplier is within 0.25..3.0
// and on a 0.25 step (Req 5.1).
func IsValidPortionMultiplier(multiplier float64) bool {
	if !isFinite(multiplier) {
		return false
	}
	if multiplier < PortionMultiplierMin || multiplier > PortionMultiplierMax {
		return false
	}
	steps := multiplier / PortionMultiplierStep
	return math.Abs(steps-math.Round(steps)) < 1e-9
}

// IsValidMealItem reports whether a meal item has a valid food item and portion
// multiplier (Req 5.1).
func IsValidMealItem(item MealItem) bool {
	return IsValidFoodItem(item.FoodItem) && IsValidPortionMultiplier(item.PortionMultiplier)
}

// IsValidMeal reports whether a meal holds 0..20 valid items.
func IsValidMeal(meal Meal) bool {
	if len(meal.Items) > MaxMealItems {
		return false
	}
	for _, item := range meal.Items {
		if !IsValidMealItem(item) {
			return false
		}
	}
	return true
}

// IsValidReadingValue reports whether a reading value is within [0.01, 100] (Req 9.4).
func IsValidReadingValue(value float64) bool {
	return isFinite(value) && value >= ReadingValueMin && value <= ReadingValueMax
}

// IsValidStreak reports whether a streak is a whole number in [0, 3650] (Req 6.4/6.5).
func IsValidStreak(streak int) bool {
	return streak >= StreakMin && streak <= StreakMax
}

// IsQuestionnaireComplete reports whether all required items are answered (Req 10.2).
func IsQuestionnaireComplete(qType QuestionnaireType, answers []int) bool {
	count, ok := QuestionnaireItemCount[qType]
	if !ok {
		return false
	}
	return len(answers) == count
}

// IsValidQuestionnaireScore reports whether a total score lies within the
// instrument's valid range (Req 10.1).
func IsValidQuestionnaireScore(qType QuestionnaireType, totalScore int) bool {
	rng, ok := QuestionnaireScoreRange[qType]
	if !ok {
		return false
	}
	return totalScore >= rng.Min && totalScore <= rng.Max
}

// IsWithinAlignmentWindow reports whether an aligned pair falls within the
// +/-180 min window (Req 15.1).
func IsWithinAlignmentWindow(pair AlignedPair) bool {
	return isFinite(pair.DeltaMinutes) && math.Abs(pair.DeltaMinutes) <= AlignmentWindowMinutes
}

// MeetsSignificanceGate reports whether a correlation result meets the gate:
// >=20 aligned pairs AND |r| >= 0.5 AND p < 0.05 (Req 15.3/15.4).
func MeetsSignificanceGate(result CorrelationResult) bool {
	return result.PairCount >= SignificanceMinPairs &&
		math.Abs(result.Coefficient) >= SignificanceMinAbsCoefficient &&
		result.PValue < SignificanceMaxPValue
}

// IsWithinFamilyCapacity reports whether a family account holds no more than 5
// members (Req 19.1).
func IsWithinFamilyCapacity(account FamilyAccount) bool {
	return len(account.Members) <= MaxFamilyMembers
}

// IsValidWakeTime reports whether a wall-clock time string is a valid 24h
// "HH:MM" in 00:00..23:59 (Req 16.5).
func IsValidWakeTime(t string) bool {
	match := wakeTimeRe.FindStringSubmatch(t)
	if match == nil {
		return false
	}
	hours, err := strconv.Atoi(match[1])
	if err != nil {
		return false
	}
	minutes, err := strconv.Atoi(match[2])
	if err != nil {
		return false
	}
	return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}
