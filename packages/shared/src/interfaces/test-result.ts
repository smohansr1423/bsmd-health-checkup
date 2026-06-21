/**
 * Test Result interfaces
 */
import { AgeGroup, RiskCategory } from '../enums';

export interface Amendment {
  previousValue: number;
  newValue: number;
  amendedBy: string;
  amendedAt: Date;
  reason?: string;
}

export interface ReferenceRange {
  min: number;
  max: number;
  borderlineLow: number;
  borderlineHigh: number;
  criticalLow: number;
  criticalHigh: number;
  ageGroup: AgeGroup;
}

export interface TestResult {
  id: string;
  checkupSessionId: string;
  seniorId: string;
  testType: string;
  measuredValue: number;
  unit: string;
  collectionTimestamp: Date;
  technicianId: string;
  riskCategory?: RiskCategory;
  ageAdjustedRange?: ReferenceRange;
  amendmentHistory: Amendment[];
  createdAt: Date;
}
