/**
 * Cortisol unit normalization → nmol/L (design: `CortisolReading.valueNmolL` is
 * the normalized unit). Lab partners report cortisol in a handful of units;
 * every ingested value is converted to nmol/L before persistence/classification
 * so reference-range comparison (Req 8.5) is unit-consistent.
 *
 * Conversion factors (cortisol, molar mass 362.46 g/mol):
 *   1 µg/dL = 27.59 nmol/L   (serum convention)
 *   1 µg/dL = 10 ng/mL       ⇒ 1 ng/mL = 2.759 nmol/L
 *   1 nmol/L = 1 nmol/L
 *
 * Pure and dependency-free so it is trivially testable.
 */

/** Multiply a reported value by this factor to obtain nmol/L. */
const UNIT_TO_NMOL_L: Readonly<Record<string, number>> = {
  'nmol/l': 1,
  nmol: 1,
  'ug/dl': 27.59,
  'µg/dl': 27.59,
  'mcg/dl': 27.59,
  'ng/ml': 2.759,
  'ug/l': 2.759, // 1 µg/L = 1 ng/mL
  'µg/l': 2.759,
};

/** Normalize a unit string for lookup (trim + lowercase + collapse spaces). */
function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '');
}

/** True when `unit` is a cortisol unit this service knows how to normalize. */
export function isRecognizedUnit(unit: string): boolean {
  return normalizeUnit(unit) in UNIT_TO_NMOL_L;
}

/**
 * Convert a reported cortisol value to nmol/L. Returns `null` when the unit is
 * unrecognized or the value is not a finite number — callers treat this as a
 * structural-validation failure (Req 8.8).
 */
export function toNmolPerL(value: number, unit: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = UNIT_TO_NMOL_L[normalizeUnit(unit)];
  if (factor === undefined) return null;
  return value * factor;
}
