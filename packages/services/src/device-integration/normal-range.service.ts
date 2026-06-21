/**
 * Normal Range Configuration Service
 * Manages CRUD operations for Normal Range definitions with ordering validation.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import type {
  NormalRange,
  NormalRangeRequest,
  ReadingType,
  AgeGroup,
} from './device-integration.types';
import { RangeOrderInvalidError } from './device-integration.errors';

// ─── Repository Interface ──────────────────────────────────────────────────────

/**
 * Repository interface for NormalRange persistence.
 * Implementations can be in-memory (testing) or database-backed (production).
 */
export interface NormalRangeRepository {
  findById(id: string): Promise<NormalRange | null>;
  findByReadingTypeAndAgeGroup(
    readingType: ReadingType,
    ageGroup: AgeGroup
  ): Promise<NormalRange | null>;
  findAll(): Promise<NormalRange[]>;
  create(range: NormalRange): Promise<NormalRange>;
  update(range: NormalRange): Promise<NormalRange>;
}

// ─── In-Memory Repository ──────────────────────────────────────────────────────

/**
 * In-memory implementation of NormalRangeRepository.
 * Suitable for development and testing; replace with database-backed
 * implementation for production.
 */
export class InMemoryNormalRangeRepository implements NormalRangeRepository {
  private ranges: NormalRange[] = [];

  async findById(id: string): Promise<NormalRange | null> {
    return this.ranges.find((r) => r.id === id) ?? null;
  }

  async findByReadingTypeAndAgeGroup(
    readingType: ReadingType,
    ageGroup: AgeGroup
  ): Promise<NormalRange | null> {
    return (
      this.ranges.find(
        (r) => r.readingType === readingType && r.ageGroup === ageGroup
      ) ?? null
    );
  }

  async findAll(): Promise<NormalRange[]> {
    return [...this.ranges];
  }

  async create(range: NormalRange): Promise<NormalRange> {
    this.ranges.push(range);
    return range;
  }

  async update(range: NormalRange): Promise<NormalRange> {
    const index = this.ranges.findIndex((r) => r.id === range.id);
    if (index === -1) {
      throw new Error(`Normal range not found: ${range.id}`);
    }
    this.ranges[index] = range;
    return range;
  }

  /** Utility for testing: clear all stored ranges */
  clear(): void {
    this.ranges = [];
  }
}

// ─── Service Dependencies ──────────────────────────────────────────────────────

export interface NormalRangeServiceDependencies {
  repository: NormalRangeRepository;
  idGenerator: () => string;
  dateProvider: () => Date;
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `NR_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

// ─── Default Normal Ranges ─────────────────────────────────────────────────────

/**
 * Default normal range definitions for all supported reading types.
 * These are seeded on initial deployment (Requirement 5.3).
 */
export const DEFAULT_NORMAL_RANGES: Record<
  ReadingType,
  Omit<NormalRangeRequest, 'readingType' | 'ageGroup'>
> = {
  blood_pressure: {
    criticalLow: 60,
    borderlineLow: 80,
    normalLow: 90,
    normalHigh: 140,
    borderlineHigh: 160,
    criticalHigh: 180,
  },
  blood_glucose: {
    criticalLow: 40,
    borderlineLow: 60,
    normalLow: 70,
    normalHigh: 130,
    borderlineHigh: 180,
    criticalHigh: 250,
  },
  heart_rate: {
    criticalLow: 40,
    borderlineLow: 50,
    normalLow: 60,
    normalHigh: 100,
    borderlineHigh: 120,
    criticalHigh: 150,
  },
  spo2: {
    criticalLow: 85,
    borderlineLow: 90,
    normalLow: 95,
    normalHigh: 100,
    borderlineHigh: 100,
    criticalHigh: 100,
  },
  temperature: {
    criticalLow: 34,
    borderlineLow: 35.5,
    normalLow: 36.1,
    normalHigh: 37.2,
    borderlineHigh: 38.5,
    criticalHigh: 40,
  },
  weight: {
    criticalLow: 30,
    borderlineLow: 40,
    normalLow: 45,
    normalHigh: 120,
    borderlineHigh: 150,
    criticalHigh: 200,
  },
};

/** All supported reading types */
const ALL_READING_TYPES: ReadingType[] = [
  'blood_pressure',
  'blood_glucose',
  'heart_rate',
  'spo2',
  'temperature',
  'weight',
];

/** All supported age groups */
const ALL_AGE_GROUPS: AgeGroup[] = ['60-69', '70-79', '80-89', '90+'];

// ─── Ordering Validation ───────────────────────────────────────────────────────

/**
 * Validates the ordering constraint for Normal Range thresholds.
 * criticalLow ≤ borderlineLow ≤ normalLow ≤ normalHigh ≤ borderlineHigh ≤ criticalHigh
 *
 * @throws RangeOrderInvalidError when any ordering constraint is violated
 */
export function validateRangeOrdering(
  criticalLow: number,
  borderlineLow: number,
  normalLow: number,
  normalHigh: number,
  borderlineHigh: number,
  criticalHigh: number
): void {
  const violations: string[] = [];

  if (criticalLow > borderlineLow) {
    violations.push(
      `criticalLow (${criticalLow}) must be ≤ borderlineLow (${borderlineLow})`
    );
  }
  if (borderlineLow > normalLow) {
    violations.push(
      `borderlineLow (${borderlineLow}) must be ≤ normalLow (${normalLow})`
    );
  }
  if (normalLow > normalHigh) {
    violations.push(
      `normalLow (${normalLow}) must be ≤ normalHigh (${normalHigh})`
    );
  }
  if (normalHigh > borderlineHigh) {
    violations.push(
      `normalHigh (${normalHigh}) must be ≤ borderlineHigh (${borderlineHigh})`
    );
  }
  if (borderlineHigh > criticalHigh) {
    violations.push(
      `borderlineHigh (${borderlineHigh}) must be ≤ criticalHigh (${criticalHigh})`
    );
  }

  if (violations.length > 0) {
    throw new RangeOrderInvalidError(violations.join('; '));
  }
}

// ─── Service Implementation ────────────────────────────────────────────────────

/**
 * NormalRangeService implementation.
 *
 * Manages Normal Range CRUD operations with ordering validation.
 * Updates are non-retroactive — they apply only to subsequent readings.
 */
export class NormalRangeService {
  private readonly repository: NormalRangeRepository;
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;

  constructor(deps?: Partial<NormalRangeServiceDependencies>) {
    this.repository = deps?.repository ?? new InMemoryNormalRangeRepository();
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
  }

  /**
   * Configure a new Normal Range.
   *
   * Requirement 5.1: Store Normal_Range definitions with all threshold fields.
   * Requirement 5.2: Validate ordering constraint before storing.
   *
   * @throws RangeOrderInvalidError when ordering constraint is violated
   */
  async configure(request: NormalRangeRequest): Promise<NormalRange> {
    // Validate ordering constraint (Req 5.2)
    validateRangeOrdering(
      request.criticalLow,
      request.borderlineLow,
      request.normalLow,
      request.normalHigh,
      request.borderlineHigh,
      request.criticalHigh
    );

    const now = this.dateProvider();
    const range: NormalRange = {
      id: this.idGenerator(),
      readingType: request.readingType,
      ageGroup: request.ageGroup,
      criticalLow: request.criticalLow,
      borderlineLow: request.borderlineLow,
      normalLow: request.normalLow,
      normalHigh: request.normalHigh,
      borderlineHigh: request.borderlineHigh,
      criticalHigh: request.criticalHigh,
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.create(range);
  }

  /**
   * Update an existing Normal Range.
   *
   * Requirement 5.2: Validate ordering of the merged result.
   * Requirement 5.4: Apply to subsequent readings only (non-retroactive).
   *   Updates modify the stored range in-place; existing alerts generated
   *   under the previous range are NOT modified.
   *
   * @throws RangeOrderInvalidError when merged ordering constraint is violated
   * @throws Error when range ID is not found
   */
  async update(rangeId: string, request: Partial<NormalRangeRequest>): Promise<NormalRange> {
    const existing = await this.repository.findById(rangeId);
    if (!existing) {
      throw new Error(`Normal range not found: ${rangeId}`);
    }

    // Merge existing values with the partial update
    const merged = {
      criticalLow: request.criticalLow ?? existing.criticalLow,
      borderlineLow: request.borderlineLow ?? existing.borderlineLow,
      normalLow: request.normalLow ?? existing.normalLow,
      normalHigh: request.normalHigh ?? existing.normalHigh,
      borderlineHigh: request.borderlineHigh ?? existing.borderlineHigh,
      criticalHigh: request.criticalHigh ?? existing.criticalHigh,
    };

    // Validate ordering constraint on merged result (Req 5.2)
    validateRangeOrdering(
      merged.criticalLow,
      merged.borderlineLow,
      merged.normalLow,
      merged.normalHigh,
      merged.borderlineHigh,
      merged.criticalHigh
    );

    // Apply update non-retroactively (Req 5.4)
    const updated: NormalRange = {
      ...existing,
      ...merged,
      readingType: request.readingType ?? existing.readingType,
      ageGroup: request.ageGroup ?? existing.ageGroup,
      updatedAt: this.dateProvider(),
    };

    return this.repository.update(updated);
  }

  /**
   * Retrieve a Normal Range by reading type and age group.
   *
   * @returns The matching NormalRange, or null if not configured
   */
  async getRange(readingType: ReadingType, ageGroup: AgeGroup): Promise<NormalRange | null> {
    return this.repository.findByReadingTypeAndAgeGroup(readingType, ageGroup);
  }

  /**
   * Retrieve all configured Normal Ranges.
   *
   * @returns Array of all NormalRange entries
   */
  async getAllRanges(): Promise<NormalRange[]> {
    return this.repository.findAll();
  }

  /**
   * Seed default Normal Range values for all supported reading types and age groups.
   *
   * Requirement 5.3: Provide default Normal_Range values upon initial deployment.
   * Seeds only if a range does not already exist for a given type+ageGroup combination.
   */
  async seedDefaults(): Promise<void> {
    for (const readingType of ALL_READING_TYPES) {
      const defaults = DEFAULT_NORMAL_RANGES[readingType];
      for (const ageGroup of ALL_AGE_GROUPS) {
        const existing = await this.repository.findByReadingTypeAndAgeGroup(
          readingType,
          ageGroup
        );
        if (!existing) {
          await this.configure({
            readingType,
            ageGroup,
            ...defaults,
          });
        }
      }
    }
  }
}
