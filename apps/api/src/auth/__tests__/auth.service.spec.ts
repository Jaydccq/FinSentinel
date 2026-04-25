import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { JwtService } from '../jwt.service';
import { LoginProtectionService } from '../login-protection.service';

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

function createMockLoginProtection() {
  return {
    checkLocked: vi.fn().mockResolvedValue(false),
    recordFailure: vi.fn().mockResolvedValue({ fails: 1 }),
    computeDelayMs: vi.fn().mockReturnValue(0), // skip the soft-delay during unit tests
    resetOnSuccess: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockProtection: ReturnType<typeof createMockLoginProtection>;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockProtection = createMockLoginProtection();

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
        {
          provide: LoginProtectionService,
          useValue: mockProtection,
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
      const insertedValues = mockDb._insertChain.values.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(insertedValues.password).not.toBe('Password1');
      // bcrypt hashes start with $2a$ or $2b$
      expect(insertedValues.password).toMatch(/^\$2[ab]\$/);
    });

    it('does NOT pre-SELECT for username/email — only INSERTs (race-free, P0-3)', async () => {
      await authService.register({
        username: 'alice',
        email: 'alice@example.com',
        password: 'Password1',
      });

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('translates a Postgres unique-violation (23505) into a ConflictException', async () => {
      const pgUniqueErr = Object.assign(new Error('duplicate key value'), {
        code: '23505',
      });
      mockDb._insertChain.returning.mockRejectedValueOnce(pgUniqueErr);

      await expect(
        authService.register({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password1',
        }),
      ).rejects.toThrow(new ConflictException('Username or email already exists'));
    });

    it('rethrows non-23505 DB errors unchanged', async () => {
      const otherErr = Object.assign(new Error('connection refused'), {
        code: '08006',
      });
      mockDb._insertChain.returning.mockRejectedValueOnce(otherErr);

      await expect(
        authService.register({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password1',
        }),
      ).rejects.toThrow('connection refused');
    });
  });

  // ── login ──────────────────────────────────────────────────────────────

  describe('login', () => {
    // Pre-computed bcrypt hash for 'Password1' (4 rounds for speed)
    const HASHED_PASSWORD = '$2b$04$F5ZKmcKJPeGcMr2ToeYQoeNlIiPDA2VB9O45uychu.6100m09eWIu';
    const IP = '1.2.3.4';

    it('returns token for valid credentials and resets the fail counter', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([
        {
          id: '11111111-2222-3333-4444-555555555555',
          username: 'alice',
          email: 'alice@example.com',
          password: HASHED_PASSWORD,
        },
      ]);

      const result = await authService.login(
        { username: 'alice', password: 'Password1' },
        IP,
      );

      expect(result.token).toBe('mock.jwt.token');
      expect(result.username).toBe('alice');
      expect(result.email).toBe('alice@example.com');
      expect(mockProtection.resetOnSuccess).toHaveBeenCalledWith('alice', IP);
      expect(mockProtection.recordFailure).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException on wrong password and records a failure', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([
        {
          id: '11111111-2222-3333-4444-555555555555',
          username: 'alice',
          email: 'alice@example.com',
          password: HASHED_PASSWORD,
        },
      ]);

      await expect(
        authService.login({ username: 'alice', password: 'WrongPass1' }, IP),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockProtection.recordFailure).toHaveBeenCalledWith('alice', IP);
      expect(mockProtection.computeDelayMs).toHaveBeenCalled();
      expect(mockProtection.resetOnSuccess).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException on non-existent user and records a failure', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      await expect(
        authService.login({ username: 'ghost', password: 'Password1' }, IP),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockProtection.recordFailure).toHaveBeenCalledWith('ghost', IP);
    });

    it('throws 423 Locked BEFORE the password check when (username, ip) is locked', async () => {
      mockProtection.checkLocked.mockResolvedValueOnce(true);

      const promise = authService.login(
        { username: 'alice', password: 'Password1' }, // even with the right password
        IP,
      );

      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await expect(promise).rejects.toMatchObject({ status: 423 });
      // Crucial: lockout short-circuits the DB lookup.
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockProtection.recordFailure).not.toHaveBeenCalled();
    });

    it('awaits the soft delay before throwing UnauthorizedException', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([]);
      mockProtection.recordFailure.mockResolvedValueOnce({ fails: 3 });
      mockProtection.computeDelayMs.mockReturnValueOnce(50);

      const start = Date.now();
      await expect(
        authService.login({ username: 'ghost', password: 'whatever' }, IP),
      ).rejects.toThrow(UnauthorizedException);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(50);
    });
  });

  // ── End-to-end lockout flow: real LoginProtectionService + mock Redis ──
  // This wires the actual LoginProtectionService to the AuthService so we
  // exercise the full counter→lock→reset cycle without going through HTTP.
  describe('login lockout flow (real LoginProtectionService)', () => {
    const HASHED_PASSWORD = '$2b$04$F5ZKmcKJPeGcMr2ToeYQoeNlIiPDA2VB9O45uychu.6100m09eWIu';
    const USERNAME = 'alice';
    const IP = '1.2.3.4';

    let realService: AuthService;
    let realDb: ReturnType<typeof createMockDb>;
    let mockRedis: {
      _store: Map<string, string>;
      incr: ReturnType<typeof vi.fn>;
      expire: ReturnType<typeof vi.fn>;
      exists: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      del: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      realDb = createMockDb();
      const store = new Map<string, string>();
      mockRedis = {
        _store: store,
        incr: vi.fn(async (key: string) => {
          const next = parseInt(store.get(key) ?? '0', 10) + 1;
          store.set(key, String(next));
          return next;
        }),
        expire: vi.fn(async () => 1),
        exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
        set: vi.fn(async (key: string, val: string) => {
          store.set(key, val);
          return 'OK';
        }),
        del: vi.fn(async (key: string) => {
          const had = store.has(key);
          store.delete(key);
          return had ? 1 : 0;
        }),
      };

      const mod = await Test.createTestingModule({
        providers: [
          AuthService,
          LoginProtectionService,
          {
            provide: JwtService,
            useValue: { generateToken: vi.fn().mockResolvedValue('jwt') },
          },
          { provide: MOCK_DB, useValue: realDb },
          { provide: 'REDIS', useValue: mockRedis },
        ],
      }).compile();

      realService = mod.get(AuthService);
    });

    it('10 failures → 11th call with the CORRECT password returns 423; clearing the lock key restores access', async () => {
      // The DB has the user with the correct hashed password.
      realDb._selectChain.limit.mockResolvedValue([
        {
          id: 'uuid',
          username: USERNAME,
          email: 'a@x',
          password: HASHED_PASSWORD,
        },
      ]);

      // Spin through 10 failed attempts. We patch sleep to be a no-op by
      // using a wrong password and accepting the (small) real delays — the
      // service's computeDelayMs caps at 5s, so 10 failures stay under the
      // test timeout. To keep this fast we shrink the delay via a spy: not
      // strictly needed, but makes test runtime predictable.
      const proto = LoginProtectionService.prototype;
      const origDelay = proto.computeDelayMs;
      proto.computeDelayMs = () => 0;

      try {
        for (let i = 0; i < 10; i++) {
          await expect(
            realService.login({ username: USERNAME, password: 'WrongPass1' }, IP),
          ).rejects.toThrow(UnauthorizedException);
        }

        // 11th attempt — use the CORRECT password. Lockout must take
        // precedence even though credentials are valid.
        const promise = realService.login(
          { username: USERNAME, password: 'Password1' },
          IP,
        );
        await expect(promise).rejects.toBeInstanceOf(HttpException);
        await expect(promise).rejects.toMatchObject({ status: 423 });

        // ── Simulate the 15-min TTL elapsing by deleting the lock key
        // directly (per the test plan — we don't wait for real time).
        mockRedis._store.delete(`login:lock:${USERNAME}:${IP}`);

        // After the lock clears, the correct password must work again.
        const ok = await realService.login(
          { username: USERNAME, password: 'Password1' },
          IP,
        );
        expect(ok.token).toBe('jwt');
        // resetOnSuccess should have wiped the fail counter too.
        expect(mockRedis._store.has(`login:fails:${USERNAME}:${IP}`)).toBe(false);
      } finally {
        proto.computeDelayMs = origDelay;
      }
    }, 15_000);
  });
});
