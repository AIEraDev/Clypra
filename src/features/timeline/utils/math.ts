/**
 * Math utility functions for Timeline Engine v1
 */

/**
 * Clamps a value between a minimum and maximum
 * @param value - The value to clamp
 * @param min - The minimum allowed value
 * @param max - The maximum allowed value
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds a number to a specified number of decimal places
 * @param value - The value to round
 * @param decimals - Number of decimal places
 * @returns The rounded value
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Checks if two numbers are approximately equal within a tolerance
 * @param a - First number
 * @param b - Second number
 * @param tolerance - Maximum difference to consider equal (default: 0.001)
 * @returns True if numbers are approximately equal
 */
export function approximatelyEqual(a: number, b: number, tolerance: number = 0.001): boolean {
  return Math.abs(a - b) <= tolerance;
}
