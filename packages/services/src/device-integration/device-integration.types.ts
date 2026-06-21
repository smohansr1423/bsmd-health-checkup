/**
 * Device Integration Service Types
 * Domain types, interfaces, and constants for the daily health device readings feature.
 * Validates: Requirements 1.5, 2.1, 2.5, 4.4, 5.1, 10.1
 */

// ─── Device Registry ───────────────────────────────────────────────────────────

export type DeviceType =
  | 'blood_pressure_monitor'
  | 'glucometer'
  | 'pulse_oximeter'
  | 'thermometer'
  | 'weight_scale';

export interface DeviceRegistryEntry {
  id: string;
  serialNumber: string;
  deviceType: DeviceType;
  seniorId: string;
  registrationDate: Date;
  connectionProtocol: 'bluetooth' | 'wifi';
  isActive: boolean;
  lastSyncTimestamp: Date | null;
}

export interface DeviceRegistrationRequest {
  serialNumber: string;
  deviceType: DeviceType;
  seniorId: string;
  connectionProtocol: 'bluetooth' | 'wifi';
}

// ─── Health Readings ───────────────────────────────────────────────────────────

export type ReadingType =
  | 'blood_pressure'
  | 'blood_glucose'
  | 'heart_rate'
  | 'spo2'
  | 'temperature'
  | 'weight';

export type ReadingUnit = 'mmHg' | 'mg/dL' | 'bpm' | 'percent' | 'celsius' | 'kg';

export interface HealthReading {
  id: string;
  deviceId: string;
  seniorId: string;
  dailyRecordId: string;
  readingType: ReadingType;
  measuredValue: number;
  secondaryValue?: number; // diastolic for blood_pressure
  unit: ReadingUnit;
  timestamp: Date;
  createdAt: Date;
}

export interface HealthReadingRequest {
  deviceId: string;
  timestamp: string; // ISO 8601
  readingType: ReadingType;
  measuredValue: number;
  secondaryValue?: number; // e.g., diastolic for blood pressure
  unit: ReadingUnit;
}

// ─── Daily Health Record ───────────────────────────────────────────────────────

export interface DailyHealthRecord {
  id: string;
  seniorId: string;
  date: string; // YYYY-MM-DD
  readings: HealthReading[];
  latestReadings: LatestReadingSummary[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LatestReadingSummary {
  readingType: ReadingType;
  measuredValue: number;
  secondaryValue?: number;
  unit: ReadingUnit;
  timestamp: Date;
}

// ─── Reading Alerts ────────────────────────────────────────────────────────────

export interface ReadingAlert {
  id: string;
  seniorId: string;
  readingId: string;
  readingType: ReadingType;
  measuredValue: number;
  thresholdBreached: number;
  severity: 'warning' | 'critical';
  direction: 'above' | 'below';
  createdAt: Date;
}

export interface AlertResult {
  triggered: boolean;
  severity?: 'warning' | 'critical';
  thresholdBreached?: number;
  direction?: 'above' | 'below';
}

export interface AlertFilters {
  severity?: 'warning' | 'critical';
  readingType?: ReadingType;
  startDate?: string;
  endDate?: string;
}

// ─── Normal Range ──────────────────────────────────────────────────────────────

export type AgeGroup = '60-69' | '70-79' | '80-89' | '90+';

export interface NormalRange {
  id: string;
  readingType: ReadingType;
  ageGroup: AgeGroup;
  criticalLow: number;
  borderlineLow: number;
  normalLow: number;
  normalHigh: number;
  borderlineHigh: number;
  criticalHigh: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NormalRangeRequest {
  readingType: ReadingType;
  ageGroup: AgeGroup;
  criticalLow: number;
  borderlineLow: number;
  normalLow: number;
  normalHigh: number;
  borderlineHigh: number;
  criticalHigh: number;
}

// ─── Trend Analysis ────────────────────────────────────────────────────────────

export interface TrendSummary {
  readingType: ReadingType;
  period: 'daily' | '7day' | '30day';
  mean: number;
  min: number;
  max: number;
  count: number;
  startDate: string;
  endDate: string;
}

// ─── Validation ────────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  received?: unknown;
}

// ─── Plausible Ranges ──────────────────────────────────────────────────────────

/**
 * Physically plausible value ranges per reading type.
 * Values outside these ranges are rejected as implausible.
 */
export const PLAUSIBLE_RANGES: Record<ReadingType, { min: number; max: number }> = {
  blood_pressure: { min: 40, max: 300 }, // systolic mmHg
  blood_glucose: { min: 20, max: 800 }, // mg/dL
  heart_rate: { min: 20, max: 300 }, // bpm
  spo2: { min: 50, max: 100 }, // percent
  temperature: { min: 30, max: 45 }, // celsius
  weight: { min: 20, max: 300 }, // kg
};

// ─── Pagination ────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
