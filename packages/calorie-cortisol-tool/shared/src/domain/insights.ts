/**
 * Correlation & insights domain types — language-neutral core model
 * (design: Data Models).
 */

/** A food/cortisol pair aligned within ±180 min (Req 15.1). */
export interface AlignedPair {
  mealId: string;
  readingId: string;
  /** |deltaMinutes| ≤ 180 (Req 15.1). */
  deltaMinutes: number;
}

/** Result of a correlation significance test (Req 15.3/15.4). */
export interface CorrelationResult {
  /** |coefficient| ≥ 0.5 → significant (Req 15.3). */
  coefficient: number;
  /** < 0.05 → significant. */
  pValue: number;
  /** ≥ 20 aligned pairs required to analyze (Req 15.4). */
  pairCount: number;
  significant: boolean;
}

/** Clinical-advisory-board approval status of an insight (Req 13.3/29.3). */
export type ApprovalStatus = 'approved' | 'draft' | 'pending' | 'revoked';

/** A surfaced wellness insight/recommendation (Req 13/15/29). */
export interface Insight {
  id: string;
  templateId: string;
  /** Only "approved" is ever displayed (Req 13.3/29.3). */
  approvalStatus: ApprovalStatus;
  /** Must be true for the insight to display (Req 29.2/29.5). */
  disclaimerRendered: boolean;
  /** Descending correlation strength for ranking (Req 15.8). */
  rankScore: number;
}
