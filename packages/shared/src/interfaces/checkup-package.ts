/**
 * Checkup Package interfaces
 */
import { TestCategory } from '../enums';

export interface PackageTest {
  testType: string;
  name: string;
  category: TestCategory;
  cost: number;
  contraindications: string[];
  plausibleRange: { min: number; max: number };
  unit: string;
}

export interface CheckupPackage {
  id: string;
  name: string;
  tier: 'Basic' | 'Standard' | 'Comprehensive' | 'Custom';
  tests: PackageTest[];
  totalCost: number;
  discountRate?: number; // 0-100
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
