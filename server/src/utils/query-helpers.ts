/**
 * Parse a query parameter string to an integer, clamped to [min, max].
 * Returns `defaultVal` if the value is missing, NaN, or out of range.
 */
export function clampedInt(
  val: string | undefined | null,
  defaultVal: number,
  min: number,
  max: number,
): number {
  if (val == null || val === '') return defaultVal;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}
