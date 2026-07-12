import {
  isQuestionnaireComplete,
  isValidConfidence,
  isValidFoodItem,
  isValidMeal,
  isValidNutrientValue,
  isValidPortionMultiplier,
  isValidQuestionnaireScore,
  isValidReadingValue,
  isValidStreak,
  isValidWakeTime,
  isWithinAlignmentWindow,
  isWithinFamilyCapacity,
  meetsSignificanceGate,
} from './guards';
import type {
  AlignedPair,
  CorrelationResult,
  FamilyAccount,
  FoodItem,
  Meal,
  MealItem,
  MemberProfile,
  NutrientValue,
  NutritionTotals,
} from './domain';

const nv = (over: Partial<NutrientValue> = {}): NutrientValue => ({
  value: 100,
  unit: 'kcal',
  lower: 90,
  upper: 110,
  available: true,
  ...over,
});

const totals = (): NutritionTotals => ({
  calories: nv(),
  protein: nv({ unit: 'g', value: 10, lower: 9, upper: 11 }),
  carbs: nv({ unit: 'g', value: 20, lower: 18, upper: 22 }),
  fat: nv({ unit: 'g', value: 5, lower: 4, upper: 6 }),
  secondary: {},
});

const foodItem = (over: Partial<FoodItem> = {}): FoodItem => ({
  id: 'f1',
  label: 'apple',
  confidence: 88,
  ...over,
});

const mealItem = (over: Partial<MealItem> = {}): MealItem => ({
  foodItem: foodItem(),
  portionMultiplier: 1,
  nutrition: {},
  ...over,
});

const meal = (items: MealItem[]): Meal => ({
  id: 'm1',
  userId: 'u1',
  loggedAt: '2024-01-01T08:00:00Z',
  items,
  totals: totals(),
  source: 'photo',
  syncStatus: 'local',
});

describe('confidence guards (Req 2.2)', () => {
  it('accepts boundary values 0 and 100', () => {
    expect(isValidConfidence(0)).toBe(true);
    expect(isValidConfidence(100)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidConfidence(-1)).toBe(false);
    expect(isValidConfidence(101)).toBe(false);
    expect(isValidConfidence(Number.NaN)).toBe(false);
  });

  it('validates a food item end to end', () => {
    expect(isValidFoodItem(foodItem())).toBe(true);
    expect(isValidFoodItem(foodItem({ label: '' }))).toBe(false);
    expect(isValidFoodItem(foodItem({ confidence: 120 }))).toBe(false);
  });
});

describe('nutrient value guard (Req 4.5)', () => {
  it('requires lower <= value <= upper and value >= 0', () => {
    expect(isValidNutrientValue(nv())).toBe(true);
    expect(isValidNutrientValue(nv({ lower: 101 }))).toBe(false);
    expect(isValidNutrientValue(nv({ upper: 99 }))).toBe(false);
    expect(isValidNutrientValue(nv({ value: -1, lower: -2 }))).toBe(false);
  });
});

describe('portion multiplier guard (Req 5.1)', () => {
  it('accepts the 0.25-step grid within 0.25..3.0', () => {
    for (const m of [0.25, 0.5, 1, 1.75, 3]) {
      expect(isValidPortionMultiplier(m)).toBe(true);
    }
  });

  it('rejects off-grid and out-of-range multipliers', () => {
    expect(isValidPortionMultiplier(0)).toBe(false);
    expect(isValidPortionMultiplier(0.1)).toBe(false);
    expect(isValidPortionMultiplier(3.25)).toBe(false);
    expect(isValidPortionMultiplier(0.3)).toBe(false);
  });
});

describe('meal guard (0..20 items)', () => {
  it('accepts an empty meal and a full 20-item meal', () => {
    expect(isValidMeal(meal([]))).toBe(true);
    expect(isValidMeal(meal(Array.from({ length: 20 }, () => mealItem())))).toBe(
      true,
    );
  });

  it('rejects a meal with more than 20 items', () => {
    expect(
      isValidMeal(meal(Array.from({ length: 21 }, () => mealItem()))),
    ).toBe(false);
  });
});

describe('reading value guard (Req 9.4)', () => {
  it('accepts the inclusive [0.01, 100] boundaries', () => {
    expect(isValidReadingValue(0.01)).toBe(true);
    expect(isValidReadingValue(100)).toBe(true);
  });

  it('rejects values outside the range', () => {
    expect(isValidReadingValue(0)).toBe(false);
    expect(isValidReadingValue(100.01)).toBe(false);
  });
});

describe('streak guard (Req 6.4/6.5)', () => {
  it('accepts whole numbers within [0, 3650]', () => {
    expect(isValidStreak(0)).toBe(true);
    expect(isValidStreak(3650)).toBe(true);
  });

  it('rejects fractional or out-of-range values', () => {
    expect(isValidStreak(1.5)).toBe(false);
    expect(isValidStreak(-1)).toBe(false);
    expect(isValidStreak(3651)).toBe(false);
  });
});

describe('questionnaire guards (Req 10.1/10.2)', () => {
  it('requires the exact item count per instrument', () => {
    expect(isQuestionnaireComplete('PSS-10', new Array(10).fill(1))).toBe(true);
    expect(isQuestionnaireComplete('PSS-10', new Array(9).fill(1))).toBe(false);
    expect(isQuestionnaireComplete('GAD-7', new Array(7).fill(0))).toBe(true);
  });

  it('bounds total scores to the instrument range', () => {
    expect(isValidQuestionnaireScore('PSS-10', 40)).toBe(true);
    expect(isValidQuestionnaireScore('PSS-10', 41)).toBe(false);
    expect(isValidQuestionnaireScore('GAD-7', 21)).toBe(true);
    expect(isValidQuestionnaireScore('GAD-7', 22)).toBe(false);
  });
});

describe('alignment and significance guards (Req 15)', () => {
  it('accepts pairs within the +/-180 min window', () => {
    const pair = (delta: number): AlignedPair => ({
      mealId: 'm',
      readingId: 'r',
      deltaMinutes: delta,
    });
    expect(isWithinAlignmentWindow(pair(180))).toBe(true);
    expect(isWithinAlignmentWindow(pair(-180))).toBe(true);
    expect(isWithinAlignmentWindow(pair(181))).toBe(false);
  });

  it('gates significance on pairs, coefficient, and p-value', () => {
    const base: CorrelationResult = {
      coefficient: 0.6,
      pValue: 0.01,
      pairCount: 20,
      significant: true,
    };
    expect(meetsSignificanceGate(base)).toBe(true);
    expect(meetsSignificanceGate({ ...base, pairCount: 19 })).toBe(false);
    expect(meetsSignificanceGate({ ...base, coefficient: 0.49 })).toBe(false);
    expect(meetsSignificanceGate({ ...base, pValue: 0.05 })).toBe(false);
  });
});

describe('family capacity guard (Req 19.1)', () => {
  const member = (id: string): MemberProfile => ({ id, role: 'member' });
  const account = (n: number): FamilyAccount => ({
    id: 'fam',
    adminUserId: 'admin',
    members: Array.from({ length: n }, (_, i) => member(`m${i}`)),
  });

  it('accepts up to 5 members and rejects 6', () => {
    expect(isWithinFamilyCapacity(account(5))).toBe(true);
    expect(isWithinFamilyCapacity(account(6))).toBe(false);
  });
});

describe('wake time guard (Req 16.5)', () => {
  it('accepts valid 24h times including boundaries', () => {
    expect(isValidWakeTime('00:00')).toBe(true);
    expect(isValidWakeTime('23:59')).toBe(true);
  });

  it('rejects malformed or out-of-range times', () => {
    expect(isValidWakeTime('24:00')).toBe(false);
    expect(isValidWakeTime('12:60')).toBe(false);
    expect(isValidWakeTime('7:30')).toBe(false);
    expect(isValidWakeTime('noon')).toBe(false);
  });
});
