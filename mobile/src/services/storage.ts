/**
 * Local persistence service using AsyncStorage.
 * Stores checkup records, calorie logs, and copilot conversations offline.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  CHECKUPS: 'health-suite:checkups',
  CALORIE_LOGS: 'health-suite:calorie-logs',
  COPILOT_HISTORY: 'health-suite:copilot-history',
};

export interface CheckupRecord {
  id: string;
  name: string;
  age: number;
  systolic: number;
  diastolic: number;
  heartRate: number;
  glucose: number;
  weight: number;
  height: number;
  overall: { level: string; label: string };
  findings: Array<{ label: string; level: string; metric: string; value?: number }>;
  recommendations: string[];
  timestamp: string;
}

export interface CalorieLog {
  id: string;
  date: string;
  activeCalories: number;
  restingCalories: number;
  totalCalories: number;
  steps: number;
  cortisolLevel?: 'low' | 'normal' | 'elevated' | 'high';
  notes?: string;
  timestamp: string;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

class StorageService {
  // ---- Checkups ----

  async getCheckups(): Promise<CheckupRecord[]> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.CHECKUPS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async saveCheckup(record: CheckupRecord): Promise<void> {
    const existing = await this.getCheckups();
    existing.unshift(record);
    await AsyncStorage.setItem(KEYS.CHECKUPS, JSON.stringify(existing));
  }

  async deleteCheckup(id: string): Promise<void> {
    const existing = await this.getCheckups();
    const filtered = existing.filter((r) => r.id !== id);
    await AsyncStorage.setItem(KEYS.CHECKUPS, JSON.stringify(filtered));
  }

  async clearCheckups(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.CHECKUPS);
  }

  // ---- Calorie Logs ----

  async getCalorieLogs(): Promise<CalorieLog[]> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.CALORIE_LOGS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async saveCalorieLog(log: CalorieLog): Promise<void> {
    const existing = await this.getCalorieLogs();
    existing.unshift(log);
    await AsyncStorage.setItem(KEYS.CALORIE_LOGS, JSON.stringify(existing));
  }

  async clearCalorieLogs(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.CALORIE_LOGS);
  }

  // ---- Copilot History ----

  async getCopilotHistory(): Promise<CopilotMessage[]> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.COPILOT_HISTORY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async saveCopilotMessage(message: CopilotMessage): Promise<void> {
    const existing = await this.getCopilotHistory();
    existing.push(message);
    await AsyncStorage.setItem(KEYS.COPILOT_HISTORY, JSON.stringify(existing));
  }

  async clearCopilotHistory(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.COPILOT_HISTORY);
  }
}

export const storage = new StorageService();
