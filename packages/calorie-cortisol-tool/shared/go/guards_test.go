package contracts

import "testing"

func TestPackageName(t *testing.T) {
	if PackageName != "cc-contracts" {
		t.Fatalf("expected package name %q, got %q", "cc-contracts", PackageName)
	}
}

func TestIsValidConfidence(t *testing.T) {
	valid := []float64{0, 50, 100}
	for _, c := range valid {
		if !IsValidConfidence(c) {
			t.Errorf("expected confidence %v to be valid", c)
		}
	}
	invalid := []float64{-1, 101}
	for _, c := range invalid {
		if IsValidConfidence(c) {
			t.Errorf("expected confidence %v to be invalid", c)
		}
	}
}

func TestIsValidNutrientValue(t *testing.T) {
	ok := NutrientValue{Value: 100, Unit: UnitKcal, Lower: 90, Upper: 110, Available: true}
	if !IsValidNutrientValue(ok) {
		t.Error("expected bracketed nutrient value to be valid")
	}
	bad := NutrientValue{Value: 100, Unit: UnitKcal, Lower: 101, Upper: 110, Available: true}
	if IsValidNutrientValue(bad) {
		t.Error("expected out-of-bracket nutrient value to be invalid")
	}
}

func TestIsValidPortionMultiplier(t *testing.T) {
	for _, m := range []float64{0.25, 0.5, 1.0, 1.75, 3.0} {
		if !IsValidPortionMultiplier(m) {
			t.Errorf("expected multiplier %v to be valid", m)
		}
	}
	for _, m := range []float64{0, 0.1, 0.3, 3.25} {
		if IsValidPortionMultiplier(m) {
			t.Errorf("expected multiplier %v to be invalid", m)
		}
	}
}

func TestIsValidReadingValue(t *testing.T) {
	if !IsValidReadingValue(0.01) || !IsValidReadingValue(100.0) {
		t.Error("expected boundary reading values to be valid")
	}
	if IsValidReadingValue(0) || IsValidReadingValue(100.01) {
		t.Error("expected out-of-range reading values to be invalid")
	}
}

func TestQuestionnaireGuards(t *testing.T) {
	if !IsQuestionnaireComplete(QuestionnairePSS10, make([]int, 10)) {
		t.Error("expected 10-item PSS-10 to be complete")
	}
	if IsQuestionnaireComplete(QuestionnairePSS10, make([]int, 9)) {
		t.Error("expected 9-item PSS-10 to be incomplete")
	}
	if !IsValidQuestionnaireScore(QuestionnaireGAD7, 21) {
		t.Error("expected GAD-7 score 21 to be valid")
	}
	if IsValidQuestionnaireScore(QuestionnaireGAD7, 22) {
		t.Error("expected GAD-7 score 22 to be invalid")
	}
}

func TestMeetsSignificanceGate(t *testing.T) {
	base := CorrelationResult{Coefficient: 0.6, PValue: 0.01, PairCount: 20, Significant: true}
	if !MeetsSignificanceGate(base) {
		t.Error("expected base correlation to meet the significance gate")
	}
	if MeetsSignificanceGate(CorrelationResult{Coefficient: 0.6, PValue: 0.01, PairCount: 19}) {
		t.Error("expected <20 pairs to fail the gate")
	}
	if MeetsSignificanceGate(CorrelationResult{Coefficient: 0.49, PValue: 0.01, PairCount: 20}) {
		t.Error("expected |r|<0.5 to fail the gate")
	}
}

func TestIsWithinFamilyCapacity(t *testing.T) {
	members := make([]MemberProfile, 5)
	if !IsWithinFamilyCapacity(FamilyAccount{Members: members}) {
		t.Error("expected 5 members to be within capacity")
	}
	if IsWithinFamilyCapacity(FamilyAccount{Members: make([]MemberProfile, 6)}) {
		t.Error("expected 6 members to exceed capacity")
	}
}

func TestIsValidWakeTime(t *testing.T) {
	for _, ok := range []string{"00:00", "23:59", "07:30"} {
		if !IsValidWakeTime(ok) {
			t.Errorf("expected wake time %q to be valid", ok)
		}
	}
	for _, bad := range []string{"24:00", "12:60", "7:30", "noon"} {
		if IsValidWakeTime(bad) {
			t.Errorf("expected wake time %q to be invalid", bad)
		}
	}
}
