/**
 * Coerces various types to a numeric string representation.
 *
 * - null / undefined -> "0"
 * - number -> String(number)
 * - string -> validated as numeric, returned as-is
 * - Throws on non-numeric strings
 *
 * @param value - the value to coerce
 * @returns a string guaranteed to represent a valid number
 */
export function toNumericString(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '0';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  // Validate string is numeric (matches optional sign, digits, optional decimal)
  const trimmed = value.trim();
  if (trimmed === '' || isNaN(Number(trimmed))) {
    throw new Error(`Cannot convert non-numeric string to number: "${value}"`);
  }

  return trimmed;
}
