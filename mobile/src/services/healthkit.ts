/**
 * Apple HealthKit integration service.
 * Reads vitals from Apple Health (synced from Apple Watch and other devices).
 * Falls back gracefully on Android or when permissions are denied.
 */

import { Platform } from 'react-native';

let AppleHealthKit: any = null;

if (Platform.OS === 'ios') {
  try {
    AppleHealthKit = require('react-native-health').default;
  } catch {
    // Not available — will use manual input
  }
}

export interface HealthVitals {
  heartRate?: number;
  systolic?: number;
  diastolic?: number;
  weight?: number;
  height?: number;
  glucose?: number;
  activeCalories?: number;
  restingCalories?: number;
  steps?: number;
}

const PERMISSIONS = {
  permissions: {
    read: [
      'HeartRate',
      'BloodPressureSystolic',
      'BloodPressureDiastolic',
      'Weight',
      'Height',
      'BloodGlucose',
      'ActiveEnergyBurned',
      'BasalEnergyBurned',
      'StepCount',
    ],
    write: [] as string[],
  },
};

class HealthKitService {
  private initialized = false;
  private available = false;

  /** Request HealthKit authorization. Returns true if granted. */
  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'ios' || !AppleHealthKit) {
      this.available = false;
      return false;
    }

    return new Promise((resolve) => {
      AppleHealthKit.isAvailable((err: any, available: boolean) => {
        if (err || !available) {
          this.available = false;
          resolve(false);
          return;
        }

        AppleHealthKit.initHealthKit(PERMISSIONS, (initErr: any) => {
          if (initErr) {
            this.available = false;
            resolve(false);
            return;
          }
          this.initialized = true;
          this.available = true;
          resolve(true);
        });
      });
    });
  }

  get isAvailable(): boolean {
    return this.available && this.initialized;
  }

  /** Get the most recent heart rate sample. */
  async getHeartRate(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    return new Promise((resolve) => {
      AppleHealthKit.getHeartRateSamples(
        { limit: 1, ascending: false },
        (err: any, results: any[]) => {
          if (err || !results?.length) return resolve(undefined);
          resolve(Math.round(results[0].value));
        },
      );
    });
  }

  /** Get the most recent blood pressure reading. */
  async getBloodPressure(): Promise<{ systolic: number; diastolic: number } | undefined> {
    if (!this.isAvailable) return undefined;
    return new Promise((resolve) => {
      AppleHealthKit.getBloodPressureSamples(
        { limit: 1, ascending: false },
        (err: any, results: any[]) => {
          if (err || !results?.length) return resolve(undefined);
          resolve({
            systolic: Math.round(results[0].bloodPressureSystolicValue),
            diastolic: Math.round(results[0].bloodPressureDiastolicValue),
          });
        },
      );
    });
  }

  /** Get the most recent weight in kg. */
  async getWeight(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    return new Promise((resolve) => {
      AppleHealthKit.getLatestWeight(
        { unit: 'kg' },
        (err: any, result: any) => {
          if (err || !result) return resolve(undefined);
          resolve(Math.round(result.value * 10) / 10);
        },
      );
    });
  }

  /** Get height in cm. */
  async getHeight(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    return new Promise((resolve) => {
      AppleHealthKit.getLatestHeight(
        { unit: 'cm' },
        (err: any, result: any) => {
          if (err || !result) return resolve(undefined);
          resolve(Math.round(result.value));
        },
      );
    });
  }

  /** Get the most recent fasting glucose in mg/dL. */
  async getGlucose(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    return new Promise((resolve) => {
      AppleHealthKit.getBloodGlucoseSamples(
        { limit: 1, ascending: false, unit: 'mgPerdL' },
        (err: any, results: any[]) => {
          if (err || !results?.length) return resolve(undefined);
          resolve(Math.round(results[0].value));
        },
      );
    });
  }

  /** Get today's active calories burned. */
  async getActiveCalories(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Promise((resolve) => {
      AppleHealthKit.getActiveEnergyBurned(
        { startDate: today.toISOString(), ascending: false },
        (err: any, results: any[]) => {
          if (err || !results?.length) return resolve(undefined);
          const total = results.reduce((sum: number, r: any) => sum + r.value, 0);
          resolve(Math.round(total));
        },
      );
    });
  }

  /** Get today's resting/basal calories. */
  async getRestingCalories(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Promise((resolve) => {
      AppleHealthKit.getBasalEnergyBurned(
        { startDate: today.toISOString(), ascending: false },
        (err: any, results: any[]) => {
          if (err || !results?.length) return resolve(undefined);
          const total = results.reduce((sum: number, r: any) => sum + r.value, 0);
          resolve(Math.round(total));
        },
      );
    });
  }

  /** Get today's step count. */
  async getSteps(): Promise<number | undefined> {
    if (!this.isAvailable) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Promise((resolve) => {
      AppleHealthKit.getStepCount(
        { startDate: today.toISOString() },
        (err: any, result: any) => {
          if (err || !result) return resolve(undefined);
          resolve(Math.round(result.value));
        },
      );
    });
  }

  /** Fetch all available vitals at once. */
  async getAllVitals(): Promise<HealthVitals> {
    const [heartRate, bp, weight, height, glucose, activeCalories, restingCalories, steps] =
      await Promise.all([
        this.getHeartRate(),
        this.getBloodPressure(),
        this.getWeight(),
        this.getHeight(),
        this.getGlucose(),
        this.getActiveCalories(),
        this.getRestingCalories(),
        this.getSteps(),
      ]);

    return {
      heartRate,
      systolic: bp?.systolic,
      diastolic: bp?.diastolic,
      weight,
      height,
      glucose,
      activeCalories,
      restingCalories,
      steps,
    };
  }
}

export const healthKit = new HealthKitService();
