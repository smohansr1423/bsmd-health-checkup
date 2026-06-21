/**
 * Allergy/Contraindication Conflict Detector
 * Detects conflicts between package tests and senior citizen allergies.
 * Validates: Requirements 2.3, 2.4
 */

import type { PackageTest, Allergy } from '@health-checkup/shared';

/**
 * Represents a conflict between a test and one or more allergies.
 */
export interface AllergyConflict {
  testType: string;
  testName: string;
  conflictingAllergies: string[]; // allergy substances that match contraindications
}

/**
 * Result of conflict detection between a package's tests and a senior's allergies.
 */
export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: AllergyConflict[];
  safeTests: PackageTest[]; // tests with no conflicts
}

/**
 * Result of attempting to assign a package to a senior citizen.
 */
export interface AssignmentResult {
  success: boolean;
  packageId: string;
  seniorId: string;
  conflictDetection?: ConflictDetectionResult;
  message: string;
}

/**
 * Detects allergy/contraindication conflicts between package tests and senior citizen allergies.
 *
 * Matching is case-insensitive: a test contraindication of "Penicillin" will match
 * an allergy substance of "penicillin" or "PENICILLIN".
 */
export class AllergyConflictDetector {
  /**
   * Detect conflicts between a set of package tests and a senior citizen's allergies.
   *
   * For each test, checks if any of its contraindications match (case-insensitive)
   * any of the senior's allergy substances.
   */
  detectConflicts(tests: PackageTest[], allergies: Allergy[]): ConflictDetectionResult {
    if (allergies.length === 0) {
      return {
        hasConflicts: false,
        conflicts: [],
        safeTests: [...tests],
      };
    }

    // Normalize allergy substances for case-insensitive comparison
    const allergySubstances = allergies.map((a) => a.substance.toLowerCase().trim());

    const conflicts: AllergyConflict[] = [];
    const safeTests: PackageTest[] = [];

    for (const test of tests) {
      if (test.contraindications.length === 0) {
        safeTests.push(test);
        continue;
      }

      const conflictingAllergies: string[] = [];

      for (const contraindication of test.contraindications) {
        const normalizedContraindication = contraindication.toLowerCase().trim();

        for (let i = 0; i < allergySubstances.length; i++) {
          if (normalizedContraindication === allergySubstances[i]) {
            // Use the original allergy substance (not normalized) for reporting
            const originalSubstance = allergies[i].substance;
            if (!conflictingAllergies.includes(originalSubstance)) {
              conflictingAllergies.push(originalSubstance);
            }
          }
        }
      }

      if (conflictingAllergies.length > 0) {
        conflicts.push({
          testType: test.testType,
          testName: test.name,
          conflictingAllergies,
        });
      } else {
        safeTests.push(test);
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      safeTests,
    };
  }
}
