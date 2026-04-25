import { routes } from './registry';
import { typedFetch } from './typed-client';
import type { AuthResponse } from '@finsentinel/shared';

/**
 * Auth client. As of 2026-04-25 these calls flow through `typedFetch` so
 * malformed `AuthResponse` payloads from the API surface as
 * `ResponseValidationError` instead of letting downstream code deref a
 * missing `token`.
 */
export function login(username: string, password: string): Promise<AuthResponse> {
  return typedFetch({ ...routes.auth.login, body: { username, password } });
}

export function register(
  username: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  return typedFetch({ ...routes.auth.register, body: { username, email, password } });
}

export function logout(): Promise<void> {
  return typedFetch({ ...routes.auth.logout }) as Promise<void>;
}

export type { AuthResponse };
