import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { JwtService } from '../jwt.service';

// ── Mock Drizzle DB ─────────────────────────────────────────────────────────
// We inject a plain object with `.select()`, `.insert()` chains that we can
// control per test.
const MOCK_DB = 'DRIZZLE_DB';

function createMockDb() {
  // Chainable query builders — each test configures the terminal method
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: '11111111-2222-3333-4444-555555555555',
        username: 'alice',
        email: 'alice@example.com',
        password: '$2a$10$hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            generateToken: vi.fn().mockResolvedValue('mock.jwt.token'),
          },
        },
        {
          provide: MOCK_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    jwtService = module.get(JwtService);
  });

  // ── register ────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates user with hashed password and returns token', async () => {
      // No existing user
      mockDb._selectChain.limit.mockResolvedValue([]);

      const result = await authService.register({
        username: 'alice',
        email: 'alice@example.com',
        password: 'Password1',
      });

      expect(result.token).toBe('mock.jwt.token');
      expect(result.username).toBe('alice');
      expect(result.email).toBe('alice@example.com');
      expect(jwtService.generateToken).toHaveBeenCalledWith(
        'alice',
        '11111111-2222-3333-4444-555555555555',
      );

      // Verify the password stored is NOT plaintext
      const insertedValues = mockDb._insertChain.values.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedValues.password).not.toBe('Password1');
      // bcrypt hashes start with $2a$ or $2b$
      expect(insertedValues.password).toMatch(/^\$2[ab]\$/);
    });

    it('throws ConflictException on duplicate username', async () => {
      // Username check returns a match
      mockDb._selectChain.limit.mockResolvedValueOnce([
        { id: 'existing-id', username: 'alice' },
      ]);

      await expect(
        authService.register({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password1',
        }),
      ).rejects.toThrow(new ConflictException('Username already exists'));
    });

    it('throws ConflictException on duplicate email', async () => {
      // First select (username check) returns empty
      mockDb._selectChain.limit.mockResolvedValueOnce([]);
      // Second select (email check) returns a match
      mockDb._selectChain.limit.mockResolvedValueOnce([
        { id: 'existing-id', email: 'alice@example.com' },
      ]);

      await expect(
        authService.register({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── login ──────────────────────────────────────────────────────────────

  describe('login', () => {
    // Pre-computed bcrypt hash for 'Password1' (4 rounds for speed)
    const HASHED_PASSWORD =
      '$2b$04$F5ZKmcKJPeGcMr2ToeYQoeNlIiPDA2VB9O45uychu.6100m09eWIu';

    it('returns token for valid credentials', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([
        {
          id: '11111111-2222-3333-4444-555555555555',
          username: 'alice',
          email: 'alice@example.com',
          password: HASHED_PASSWORD,
        },
      ]);

      const result = await authService.login({
        username: 'alice',
        password: 'Password1',
      });

      expect(result.token).toBe('mock.jwt.token');
      expect(result.username).toBe('alice');
      expect(result.email).toBe('alice@example.com');
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([
        {
          id: '11111111-2222-3333-4444-555555555555',
          username: 'alice',
          email: 'alice@example.com',
          password: HASHED_PASSWORD,
        },
      ]);

      await expect(
        authService.login({ username: 'alice', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on non-existent user', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      await expect(
        authService.login({ username: 'ghost', password: 'Password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
