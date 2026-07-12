/**
 * Cortisol domain types — language-neutral core model (design: Data Models).
 */

/** Source of a cortisol reading. */
export type CortisolSource =
  | 'lab'
  | 'patch'
  | 'wearableProxy'
  | 'questionnaireProxy';

/** Diurnal time-of-day bucket (Req 8.3). */
export type TimeOfDayBucket = 'morning' | 'noon' | 'afternoon' | 'evening';

/** Biological sex used for reference-range selection. */
export type Sex = 'M' | 'F' | 'other';

/** Reference-range classification of a reading (Req 8.5). */
export type Classification = 'below' | 'normal' | 'above';

/** Age/sex/time-of-day reference context for a reading (Req 8.5). */
export interface ReferenceContext {
  ageBand: string;
  sex: Sex;
  refLower: number;
  refUpper: number;
  classification: Classification;
}

/** A single normalized cortisol reading. */
export interface CortisolReading {
  id: string;
  userId: string;
  /** ISO timestamp. */
  measuredAt: string;
  /** Normalized unit (nmol/L). */
  valueNmolL: number;
  source: CortisolSource;
  /** Patch/device id (Req 9.3/9.5). */
  sourceId?: string;
  timeOfDayBucket: TimeOfDayBucket;
  /** Contextualized vs age/sex/time (Req 8.5). */
  contextualized?: ReferenceContext;
  /** false → excluded from proxy calculations (Req 9.4). */
  valid: boolean;
}

/** Validated questionnaire instrument (Req 10). */
export type QuestionnaireType = 'PSS-10' | 'GAD-7' | 'PSQI';

/** Deterministic cortisol burden tier (Req 10.3). */
export type BurdenTier = 'Low' | 'Moderate' | 'Elevated' | 'High';

/** Result of a scored questionnaire (Req 10). */
export interface QuestionnaireResult {
  type: QuestionnaireType;
  /** All items required (Req 10.2). */
  answers: number[];
  /** Within the instrument's valid range (Req 10.1). */
  totalScore: number;
  /** Deterministic map from score (Req 10.3). */
  tier: BurdenTier;
}

/** A single timed CAR sample. */
export interface CARSample {
  at: string;
  value: number;
}

/** Cortisol Awakening Response measurement (Req 11). */
export interface CARMeasurement {
  userId: string;
  wakeTime: string;
  /** ≤35 min after wake (Req 11.1). */
  sample1?: CARSample;
  /** 25..35 min after sample1 (Req 11.2). */
  sample2?: CARSample;
  /** <50% → flattened (Req 11.5). */
  increasePct?: number;
  status: 'incomplete' | 'complete' | 'flattened';
}

/** A user-recorded life event for trend annotation (Req 12.3/12.4). */
export interface LifeEvent {
  userId: string;
  date: string;
  label: string;
}
