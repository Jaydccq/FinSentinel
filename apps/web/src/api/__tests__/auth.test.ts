import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client', () => ({
  resolveBase: () => '/api',
  authHeaders: () => ({}),
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const { apiFetch } = await import('../client');
const { login, register, logout } = await import('../auth');
const { ResponseValidationError } = await import('../typed-client');

const validAuth = { token: 'jwt', username: 'alice', email: 'a@b.co' };

describe('auth client', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('login() POSTs /auth/login and validates the response', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validAuth);
    const out = await login('alice', 'pw');
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/auth/login');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'alice', password: 'pw' });
    expect(out).toEqual(validAuth);
  });

  it('login() throws ResponseValidationError when token is missing', async () => {
    // Real wire-shape drift: server omitted `token` from the payload.
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      username: 'alice',
      email: 'a@b.co',
    });
    await expect(login('alice', 'pw')).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it('register() POSTs /auth/register with the JSON body', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validAuth);
    await register('alice', 'a@b.co', 'Password1');
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/auth/register');
    expect((call[1] as RequestInit).method).toBe('POST');
  });

  it('logout() POSTs /auth/logout and resolves on 204 (undefined)', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(logout()).resolves.toBeUndefined();
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/auth/logout');
    expect((call[1] as RequestInit).method).toBe('POST');
  });
});
