import { createHash } from 'node:crypto';

/**
 * Computes a truncated SHA-256 hex digest (first 7 characters) of the input string.
 *
 * Used for idempotency keys and commit hashes.
 *
 * @param input - the string to hash
 * @returns the first 7 hex characters of the SHA-256 digest
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 7);
}
