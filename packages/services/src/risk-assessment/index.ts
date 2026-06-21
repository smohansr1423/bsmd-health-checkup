/**
 * Risk Assessment Engine barrel export
 */
export {
  RiskAssessmentEngine,
  RiskDefaultReferenceRangeProvider,
} from './risk-assessment.service';
export {
  NoReferenceRangeError,
  CriticalAlertPublishError,
  NoScoreableResultsError,
} from './risk-assessment.errors';
export type {
  IRiskAssessmentEngine,
  RiskAssessmentDependencies,
  RiskReferenceRangeProvider,
  HealthScore,
  ScoreBreakdown,
  DeteriorationFlag,
} from './risk-assessment.types';
