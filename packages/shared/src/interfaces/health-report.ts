/**
 * Health Report interfaces
 */
import { RiskCategory, SupportedLanguage } from '../enums';
import { ReferenceRange, TestResult } from './test-result';

export interface HealthScore {
  score: number; // 0-100
  breakdown: ScoreBreakdown[];
  normalCount: number;
  borderlineCount: number;
  criticalCount: number;
}

export interface ScoreBreakdown {
  testType: string;
  category: RiskCategory;
  weightedScore: number;
}

export interface CategorizedTestResult {
  testResult: TestResult;
  category: RiskCategory;
  interpretation: string;
}

export interface CriticalFinding {
  testType: string;
  measuredValue: number;
  referenceRange: ReferenceRange;
  urgency: 'immediate' | 'urgent';
}

export interface TrendDataPoint {
  sessionDate: Date;
  testType: string;
  value: number;
  category: RiskCategory;
}

export interface ReportContent {
  title: string;
  sections: ReportSection[];
}

export interface ReportSection {
  heading: string;
  content: string;
}

export interface HealthReport {
  id: string;
  checkupSessionId: string;
  seniorId: string;
  healthScore: HealthScore;
  testResults: CategorizedTestResult[];
  criticalFindings: CriticalFinding[];
  physicianRecommendations: string[];
  trendData?: TrendDataPoint[];
  pendingTests: string[];
  generatedAt: Date;
  regeneratedAt?: Date;
  language: SupportedLanguage;
  versions: {
    clinical: ReportContent;
    simplified: ReportContent;
  };
}
