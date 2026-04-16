import { Module } from '@nestjs/common';
import { jwtConfig } from '../config/jwt.config';
import { JwtService } from './jwt.service';
import { JwtGuard } from './jwt.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalUserSeeder } from './local-user.seeder';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [JwtService, JwtGuard, AuthService, LocalUserSeeder],
  exports: [JwtService, JwtGuard],
})
export class AuthModule {}
