import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@finsentinel/db';

/**
 * Global database module — provides `DRIZZLE_DB` to the entire application.
 *
 * Uses the `postgres` driver with Drizzle ORM. The connection URL is read
 * from the `DATABASE_URL` environment variable via ConfigService.
 */
@Global()
@Module({
  providers: [
    {
      provide: 'DRIZZLE_DB',
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('DATABASE_URL')!;
        const client = postgres(url);
        return drizzle(client, { schema });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['DRIZZLE_DB'],
})
export class DatabaseModule {}
