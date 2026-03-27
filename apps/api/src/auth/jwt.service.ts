import { Injectable, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { jwtConfig } from '../config/jwt.config';

@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;

  constructor(
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {
    this.secret = new TextEncoder().encode(config.secret);
  }

  async generateToken(username: string, userId: string): Promise<string> {
    return new SignJWT({ uid: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(username)
      .setIssuedAt()
      .setExpirationTime(
        Math.floor(Date.now() / 1000) + this.config.expiration / 1000,
      )
      .sign(this.secret);
  }

  async validateToken(
    token: string,
  ): Promise<{ username: string; userId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      return { username: payload.sub!, userId: payload.uid as string };
    } catch {
      return null;
    }
  }
}
