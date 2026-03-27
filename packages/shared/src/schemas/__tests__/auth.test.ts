import { describe, it, expect } from 'vitest';
import { loginRequestSchema, registerRequestSchema, authResponseSchema } from '../auth';

describe('loginRequestSchema', () => {
  it('accepts valid login', () => {
    const result = loginRequestSchema.safeParse({
      username: 'testuser',
      password: 'secret123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty username', () => {
    const result = loginRequestSchema.safeParse({
      username: '',
      password: 'secret123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginRequestSchema.safeParse({
      username: 'testuser',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing username', () => {
    const result = loginRequestSchema.safeParse({
      password: 'secret123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = loginRequestSchema.safeParse({
      username: 'testuser',
    });
    expect(result.success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  const validRegister = {
    username: 'newuser',
    email: 'user@example.com',
    password: 'Secret1pass',
  };

  it('accepts valid registration', () => {
    const result = registerRequestSchema.safeParse(validRegister);
    expect(result.success).toBe(true);
  });

  it('accepts registration with displayName', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      displayName: 'New User',
    });
    expect(result.success).toBe(true);
  });

  it('accepts registration without displayName', () => {
    const result = registerRequestSchema.safeParse(validRegister);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBeUndefined();
    }
  });

  it('rejects username shorter than 3 chars', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      username: 'ab',
    });
    expect(result.success).toBe(false);
  });

  it('rejects username longer than 50 chars', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      username: 'a'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 chars', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      password: 'Aa1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password longer than 100 chars', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      password: 'Aa1' + 'x'.repeat(98),
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without uppercase', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      password: 'alllowercase1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without lowercase', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      password: 'ALLUPPERCASE1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without digit', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      password: 'NoDigitsHere',
    });
    expect(result.success).toBe(false);
  });
});

describe('authResponseSchema', () => {
  it('accepts valid auth response', () => {
    const result = authResponseSchema.safeParse({
      token: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
      username: 'testuser',
      email: 'test@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing token', () => {
    const result = authResponseSchema.safeParse({
      username: 'testuser',
      email: 'test@example.com',
    });
    expect(result.success).toBe(false);
  });
});
