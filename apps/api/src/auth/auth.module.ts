import { Module, forwardRef } from '@nestjs/common';
import { jwtConfig } from '../config/jwt.config';
import { CommonModule } from '../common/common.module';
import { JwtService } from './jwt.service';
import { JwtGuard } from './jwt.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalUserSeeder } from './local-user.seeder';
import { CsrfMiddleware } from './csrf.middleware';
import { LoginProtectionService } from './login-protection.service';

@Module({
  // forwardRef avoids the AuthModule ⇄ CommonModule circular import.
  // CommonModule provides the shared 'REDIS' ioredis client + RateLimitGuard;
  // AuthModule consumes both for the login lockout service and the login
  // route's per-IP throttle.
  imports: [forwardRef(() => CommonModule)],
  controllers: [AuthController],
  providers: [
    JwtService,
    JwtGuard,
    AuthService,
    LocalUserSeeder,
    CsrfMiddleware,
    LoginProtectionService,
  ],
  exports: [JwtService, JwtGuard, CsrfMiddleware, LoginProtectionService],
})
export class AuthModule {}
