/**
 * Local domain types for the Questionnaire_Engine (Req 10).
 *
 * These mirror the shared contract `@calorie-cortisol/shared`
 * ({@link QuestionnaireResult}, {@link BurdenTier}, and the
 * `{ code, message, retryable, retainedState }` error shape). They are declared
 * locally so this module stays pure and dependency-free — the scoring, tier
 * mapping, framing, and re-prompt logic can be unit-tested in isolation without
 * runtime resolution of the shared package. The shapes are structurally
 * compatible with the shared definitions.
 */

/** Validated questionnaire instrument (Req 10). */
export type QuestionnaireType = 'PSS-10' | 'GAD-7' | 'PSQI';

/** Deterministic cortisol burden tier (Req 10.3). */
export type BurdenTier = 'Low' | 'Moderate' | 'Elevated' | 'High';

/**
 * A raw answer to a single questionnaire item. `null`/`undefined`/`NaN`
 * represent an unanswered item (Req 10.2).
 */
export type Answer = number | null | undefined;

/** A questionnaire submission as received by `POST /questionnaire`. */
export interface QuestionnaireSubmission {
  readonly type: QuestionnaireType;
  /** One entry per item; unanswered items are `null`/`undefined`/`NaN`. */
  readonly answers: ReadonlyArray<Answer>;
  /** Owning user (used for re-prompt scheduling); optional for pure scoring. */
  readonly userId?: string;
}

/**
 * A scored questionnaire result (structurally compatible with the shared
 * `QuestionnaireResult`).
 */
export interface QuestionnaireResult {
  readonly type: QuestionnaireType;
  /** All items required and normalized to their scoring scale (Req 10.2). */
  readonly answers: number[];
  /** Within the instrument's valid range (Req 10.1). */
  readonly totalScore: number;
  /** Deterministic map from score (Req 10.3). */
  readonly tier: BurdenTier;
}

/**
 * The structured error shape, matching the shared `ErrorContract`
 * `{ code, message, retryable, retainedState }`.
 */
export interface QuestionnaireError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly retainedState: boolean;
}

/**
 * Ordered presentation of a burden tier. The non-clinical framing text is
 * always the first segment, guaranteeing it precedes the tier value (Req 10.4).
 */
export type TierPresentationSegment =
  | { readonly kind: 'framing'; readonly text: string }
  | { readonly kind: 'tier'; readonly value: BurdenTier };

export interface TierPresentation {
  readonly segments: readonly TierPresentationSegment[];
  /** Convenience accessors (mirrors segments). */
  readonly framingText: string;
  readonly tier: BurdenTier;
}

/** Successful scoring outcome, including the ordered presentation. */
export interface QuestionnaireScored {
  readonly ok: true;
  readonly result: QuestionnaireResult;
  readonly presentation: TierPresentation;
}

/**
 * Rejected submission (Req 10.2): the entered answers are retained and the
 * incomplete/invalid item indices are reported so the client can highlight them.
 */
export interface QuestionnaireRejected {
  readonly ok: false;
  readonly error: QuestionnaireError;
  /** 0-based indices of items that are unanswered or out of range. */
  readonly incompleteItems: number[];
  /** The submitted answers, retained unchanged (Req 10.2). */
  readonly retainedAnswers: ReadonlyArray<Answer>;
}

export type QuestionnaireOutcome = QuestionnaireScored | QuestionnaireRejected;
