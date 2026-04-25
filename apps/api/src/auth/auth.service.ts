import {
  Injectable,
  Inject,
  ConflictException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { hash, compare } from 'bcryptjs';
import { users, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@finsentinel/shared';
import { JwtService } from './jwt.service';
import { LoginProtectionService } from './login-protection.service';

const BCRYPT_ROUNDS = 10;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly loginProtection: LoginProtectionService,
  ) {}

  async register(request: RegisterRequest): Promise<AuthResponse> {
    const hashedPassword = await hash(request.password, BCRYPT_ROUNDS);

    let created;
    try {
      const rows = await this.db
        .insert(users)
        .values({
          username: request.username,
          email: request.email,
          password: hashedPassword,
          displayName: request.displayName ?? null,
        })
        .returning();
      created = rows[0]!;
    } catch (err) {
      // Postgres unique_violation. The DB-side UNIQUE constraints on
      // users.username and users.email already exist (V1 schema), so this
      // is the authoritative race-free check. We deliberately do NOT pre-SELECT —
      // the previous read-then-insert pattern had a race window between the two
      // checks and the insert.
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        throw new ConflictException('Username or email already exists');
      }
      throw err;
    }

    const token = await this.jwtService.generateToken(created.username, created.id);

    return { token, username: created.username, email: created.email };
  }

  /**
   * Login flow with per-(username, ip) consecutive-failure protection:
   *
   *   1. If (username, ip) is locked → 423 Locked, BEFORE the password check
   *      (a correct password during a lockout window still returns 423).
   *   2. Verify password. On failure → INCR fail counter, await an exponential
   *      soft delay, then throw 401.
   *   3. On success → reset the fail counter + lock key and return the token.
   *
   * `clientIp` is required so the lockout key can be scoped per-IP. Pass
   * `'unknown'` only as a last resort — it collapses everyone behind the same
   * counter.
   */
  async login(request: LoginRequest, clientIp: string): Promise<AuthResponse> {
    // 0. Lockout takes precedence over everything else.
    const locked = await this.loginProtection.checkLocked(request.username, clientIp);
    if (locked) {
      throw new HttpException('Account temporarily locked', HttpStatus.LOCKED);
    }

    // 1. Find user by username
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, request.username))
      .limit(1);

    const passwordValid = user
      ? await compare(request.password, user.password)
      : false;

    if (!user || !passwordValid) {
      // Same failure path for missing user vs wrong password — keeps the
      // response shape uniform and prevents username enumeration.
      const { fails } = await this.loginProtection.recordFailure(request.username, clientIp);
      const delay = this.loginProtection.computeDelayMs(fails);
      await sleep(delay);

      // If recordFailure just crossed the threshold, the next attempt will
      // see checkLocked() return true. We still surface 401 here because
      // *this* attempt's password was wrong; the 423 starts on the next call.
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Successful login — clear fail counter + lock key for this pair.
    await this.loginProtection.resetOnSuccess(request.username, clientIp);

    // 3. Generate JWT
    const token = await this.jwtService.generateToken(user.username, user.id);

    return { token, username: user.username, email: user.email };
  }
}
