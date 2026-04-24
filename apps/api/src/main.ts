import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import type { AuthRuntimeConfig } from './config/auth.config';

async function bootstrap() {
  // `bufferLogs: true` lets nestjs-pino capture bootstrap-time logs that
  // would otherwise go to the default console Logger. Flushed once we
  // swap the app Logger below.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api');

  // Order matters: requestId first so every downstream log/header has it.
  app.use(requestIdMiddleware());

  const auth = app
    .get(ConfigService)
    .get<AuthRuntimeConfig>('auth')!;

  // F-8 (2026-04-24): enable CSP + HSTS.
  //
  // The API serves JSON / SSE / blob responses — not HTML documents — so
  // CSP here is defense-in-depth rather than a primary XSS barrier. Keep
  // directives strict (no inline styles/scripts) and explicitly whitelist
  // the allowed CORS origins for `connect-src` so browser-side fetch and
  // EventSource stay unblocked when a partner/frontend loads this API.
  //
  // HSTS is only meaningful over real HTTPS. Gated on AUTH_COOKIE_SECURE,
  // which the prod config turns on; dev over http stays quiet.
  const cspConnectSrc = ["'self'", ...auth.corsOrigins];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          connectSrc: cspConnectSrc,
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      hsts: auth.cookie.secure
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

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
