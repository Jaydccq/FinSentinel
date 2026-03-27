import { Module } from '@nestjs/common';
import { jwtConfig } from '../config/jwt.config';
import { JwtService } from './jwt.service';
import { JwtGuard } from './jwt.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [JwtService, JwtGuard, AuthService],
  exports: [JwtService, JwtGuard],
})
export class AuthModule {}
