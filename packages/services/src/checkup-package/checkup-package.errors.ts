/**
 * Custom errors for Checkup Package Service
 */

/**
 * Thrown when a custom package has an invalid test count (outside 1-50 range).
 */
export class InvalidTestCountError extends Error {
  public readonly testCount: number;
  public readonly min = 1;
  public readonly max = 50;

  constructor(testCount: number) {
    super(
      `Custom package must contain between 1 and 50 tests, but received ${testCount}.`
    );
    this.name = 'InvalidTestCountError';
    this.testCount = testCount;
  }
}

/**
 * Thrown when a package modification would affect completed checkup sessions.
 */
export class PackageModificationBlockedError extends Error {
  public readonly packageId: string;
  public readonly completedSessionCount: number;

  constructor(packageId: string, completedSessionCount: number) {
    super(
      `Cannot modify package "${packageId}" because it has ${completedSessionCount} completed checkup session(s). ` +
        `Modifications to packages with completed sessions are not allowed.`
    );
    this.name = 'PackageModificationBlockedError';
    this.packageId = packageId;
    this.completedSessionCount = completedSessionCount;
  }
}

/**
 * Thrown when a package is not found.
 */
export class PackageNotFoundError extends Error {
  public readonly packageId: string;

  constructor(packageId: string) {
    super(`Checkup package not found: ${packageId}`);
    this.name = 'PackageNotFoundError';
    this.packageId = packageId;
  }
}

/**
 * Thrown when a package assignment is blocked due to allergy/contraindication conflicts.
 * Validates: Requirements 2.3, 2.4
 */
export class AllergyConflictError extends Error {
  public readonly packageId: string;
  public readonly conflicts: Array<{
    testType: string;
    testName: string;
    conflictingAllergies: string[];
  }>;

  constructor(
    packageId: string,
    conflicts: Array<{ testType: string; testName: string; conflictingAllergies: string[] }>
  ) {
    const conflictSummary = conflicts
      .map((c) => `${c.testName} (conflicts with: ${c.conflictingAllergies.join(', ')})`)
      .join('; ');
    super(
      `Cannot assign package "${packageId}" due to allergy conflicts: ${conflictSummary}`
    );
    this.name = 'AllergyConflictError';
    this.packageId = packageId;
    this.conflicts = conflicts;
  }
}
