import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { users, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

const BCRYPT_ROUNDS = 10;

/**
 * Ensures a single-user "local" account exists when APP_SEED_LOCAL_USER=true.
 *
 * Desktop-mode operators (FinSentinel Tauri shell) rely on this user to
 * auto-login without presenting a registration flow. Idempotent: a second
 * boot with the same credentials is a no-op; a boot with a *changed*
 * LOCAL_USER_PASSWORD updates the stored hash so the desktop client's
 * cached credentials keep working.
 *
 * Gated by APP_SEED_LOCAL_USER — off by default. Never enable in a
 * multi-tenant deployment: it creates a well-known account.
 */
@Injectable()
export class LocalUserSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(LocalUserSeeder.name);

  constructor(
    private readonly config: ConfigService,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = this.config.get<boolean>('APP_SEED_LOCAL_USER');
    if (!enabled) return;

    const username = this.config.getOrThrow<string>('LOCAL_USER_USERNAME');
    const password = this.config.get<string | undefined>('LOCAL_USER_PASSWORD');
    const email = this.config.getOrThrow<string>('LOCAL_USER_EMAIL');

    if (!password) {
      this.logger.warn('APP_SEED_LOCAL_USER=true but LOCAL_USER_PASSWORD is unset; skipping seed.');
      return;
    }

    const [existing] = await this.db
      .select({ id: users.id, password: users.password })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const hashed = await hash(password, BCRYPT_ROUNDS);

    if (!existing) {
      // Populate every column explicitly — Drizzle+postgres.js (0.44.7 /
      // 3.4.8) scrambles parameter binding when the INSERT uses `default`
      // keywords alongside $N placeholders. Supplying every value avoids
      // the codegen path that produces `(default, $1, $2, ..., default)`.
      const now = new Date();
      await this.db.insert(users).values({
        id: randomUUID(),
        username,
        email,
        password: hashed,
        displayName: 'Local',
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log(`Seeded local user "${username}"`);
      return;
    }

    // Rehash-and-update unconditionally: if the operator rotated
    // LOCAL_USER_PASSWORD, the stored hash must follow. Comparing would
    // require decoding the old password which we don't have.
    await this.db
      .update(users)
      .set({ password: hashed, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    this.logger.log(`Refreshed credentials for local user "${username}"`);
  }
}
