/**
 * Checkup Package Service Types
 * Request/response types for checkup package CRUD operations.
 */

import type { CheckupPackage, PackageTest, CheckupSession } from '@health-checkup/shared';

/**
 * Request payload for creating a new checkup package.
 */
export interface CreatePackageRequest {
  name: string;
  tier: 'Basic' | 'Standard' | 'Comprehensive' | 'Custom';
  tests: PackageTest[];
  discountRate?: number; // 0-100
}

/**
 * Request payload for updating an existing checkup package.
 */
export interface UpdatePackageRequest {
  name?: string;
  tests?: PackageTest[];
  discountRate?: number; // 0-100
  isActive?: boolean;
}

/**
 * Repository interface for CheckupPackage persistence.
 */
export interface CheckupPackageRepository {
  save(pkg: CheckupPackage): Promise<CheckupPackage>;
  findById(id: string): Promise<CheckupPackage | null>;
  findAll(): Promise<CheckupPackage[]>;
  findByTier(tier: CheckupPackage['tier']): Promise<CheckupPackage[]>;
  update(pkg: CheckupPackage): Promise<CheckupPackage>;
  delete(id: string): Promise<void>;
}

/**
 * Repository interface for CheckupSession access (read-only for package service).
 * Used to check whether a package has completed sessions before modification.
 */
export interface CheckupSessionRepository {
  findCompletedByPackageId(packageId: string): Promise<CheckupSession[]>;
}

/**
 * Dependencies injected into CheckupPackageService for testability.
 */
export interface CheckupPackageDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  packageRepository: CheckupPackageRepository;
  sessionRepository: CheckupSessionRepository;
}
