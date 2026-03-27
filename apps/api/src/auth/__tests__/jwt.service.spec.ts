import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '../jwt.service';
import { jwtConfig } from '../../config/jwt.config';
import { decodeJwt } from 'jose';

const TEST_SECRET = 'a'.repeat(32); // minimum 32 chars
const TEST_EXPIRATION = 86400000; // 24h in ms

describe('JwtService', () => {
  let jwtService: JwtService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: jwtConfig.KEY,
          useValue: { secret: TEST_SECRET, expiration: TEST_EXPIRATION },
        },
      ],
    }).compile();

    jwtService = module.get(JwtService);
  });

  it('generates token with correct claims (sub, uid, iat, exp)', async () => {
    const token = await jwtService.generateToken('alice', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    const payload = decodeJwt(token);

    expect(payload.sub).toBe('alice');
    expect(payload.uid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');

    // exp should be ~24h after iat
    const diff = payload.exp! - payload.iat!;
    expect(diff).toBe(TEST_EXPIRATION / 1000);
  });

  it('validates a freshly generated token and returns username + userId', async () => {
    const token = await jwtService.generateToken('bob', 'deadbeef-1234-5678-9abc-def012345678');
    const result = await jwtService.validateToken(token);

    expect(result).not.toBeNull();
    expect(result!.username).toBe('bob');
    expect(result!.userId).toBe('deadbeef-1234-5678-9abc-def012345678');
  });

  it('rejects an expired token and returns null', async () => {
    // Create service with 0ms expiration (token expires immediately)
    const module = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: jwtConfig.KEY,
          useValue: { secret: TEST_SECRET, expiration: 0 },
        },
      ],
    }).compile();

    const expiredJwtService = module.get(JwtService);
    const token = await expiredJwtService.generateToken('charlie', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

    // Wait a tick to ensure the token is expired
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await jwtService.validateToken(token);
    expect(result).toBeNull();
  });

  it('rejects a tampered token and returns null', async () => {
    const token = await jwtService.generateToken('dave', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    // Tamper with the payload portion (second segment)
    const parts = token.split('.');
    parts[1] = parts[1] + 'tampered';
    const tampered = parts.join('.');

    const result = await jwtService.validateToken(tampered);
    expect(result).toBeNull();
  });

  it('rejects garbage string and returns null', async () => {
    const result = await jwtService.validateToken('this-is-not-a-jwt');
    expect(result).toBeNull();
  });
});
