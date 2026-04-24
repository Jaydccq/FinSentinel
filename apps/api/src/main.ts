import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import type { AuthRuntimeConfig } from './config/auth.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // Order matters: requestId first so every downstream log/header has it.
  app.use(requestIdMiddleware());
  app.use(
    helmet({
      // CSP + HSTS deferred until web + desktop QA passes — see
      // docs/exec-plans/2026-04-23-platform-bootstrap.md.
      contentSecurityPolicy: false,
      hsts: false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  const auth = app
    .get(ConfigService)
    .get<AuthRuntimeConfig>('auth')!;
  app.enableCors({
    origin: auth.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
