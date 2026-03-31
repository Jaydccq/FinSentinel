export function parseIntParam(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const parsed = raw !== undefined ? parseInt(raw, 10) : defaultValue;
  const safe = isNaN(parsed) ? defaultValue : parsed;
  return Math.min(Math.max(safe, min), max);
}
