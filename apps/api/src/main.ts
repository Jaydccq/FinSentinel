import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import type { AuthRuntimeConfig } from './config/auth.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
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
