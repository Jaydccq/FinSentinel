import { Injectable, Inject, ConflictException, UnauthorizedException } from '@nestjs/common';
import { hash, compare } from 'bcryptjs';
import { users, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@finsentinel/shared';
import { JwtService } from './jwt.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
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

  async login(request: LoginRequest): Promise<AuthResponse> {
    // 1. Find user by username
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, request.username))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Verify password
    const passwordValid = await compare(request.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Generate JWT
    const token = await this.jwtService.generateToken(user.username, user.id);

    return { token, username: user.username, email: user.email };
  }
}
