import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '../jwt.service';
import { jwtConfig } from '../../config/jwt.config';
import { decodeJwt, SignJWT } from 'jose';

const TEST_SECRET = 'a'.repeat(32); // minimum 32 chars
const TEST_EXPIRATION = 86400000; // 24h in ms
const TEST_ISSUER = 'finsentinel-api-test';
const TEST_AUDIENCE = 'finsentinel-web-test';

const TEST_CONFIG = {
  secret: TEST_SECRET,
  expiration: TEST_EXPIRATION,
  issuer: TEST_ISSUER,
  audience: TEST_AUDIENCE,
};

describe('JwtService', () => {
  let jwtService: JwtService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: jwtConfig.KEY,
          useValue: TEST_CONFIG,
        },
      ],
    }).compile();

    jwtService = module.get(JwtService);
  });

  it('generates token with correct claims (sub, uid, iat, exp)', async () => {
    const token = await jwtService.generateToken('alice', 'a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    const payload = decodeJwt(token);

    expect(payload.sub).toBe('alice');
    expect(payload.uid).toBe('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');

    // exp should be ~24h after iat
    const diff = payload.exp! - payload.iat!;
    expect(diff).toBe(TEST_EXPIRATION / 1000);
  });

  it('generates token with iss, aud, jti claims', async () => {
    const token = await jwtService.generateToken('alice', 'a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    const payload = decodeJwt(token);

    expect(payload.iss).toBe(TEST_ISSUER);
    expect(payload.aud).toBe(TEST_AUDIENCE);
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe('string');
    // jti must be a uuid
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('validates a freshly generated token and returns username + userId + jti', async () => {
    const token = await jwtService.generateToken('bob', 'deadbeef-1234-4678-9abc-def012345678');
    const result = await jwtService.validateToken(token);

    expect(result).not.toBeNull();
    expect(result!.username).toBe('bob');
    expect(result!.userId).toBe('deadbeef-1234-4678-9abc-def012345678');
    expect(result!.jti).toBeDefined();
    expect(typeof result!.jti).toBe('string');
  });

  it('rejects an expired token and returns null', async () => {
    // Create service with 0ms expiration (token expires immediately)
    const module = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: jwtConfig.KEY,
          useValue: { ...TEST_CONFIG, expiration: 0 },
        },
      ],
    }).compile();

    const expiredJwtService = module.get(JwtService);
    const token = await expiredJwtService.generateToken(
      'charlie',
      'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    );

    // Wait a tick to ensure the token is expired
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await jwtService.validateToken(token);
    expect(result).toBeNull();
  });

  it('rejects a tampered token and returns null', async () => {
    const token = await jwtService.generateToken('dave', 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee');
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

  it('rejects a token signed with a different issuer', async () => {
    // Build a JwtService with a different issuer and use it to sign a token.
    const module = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: jwtConfig.KEY,
          useValue: { ...TEST_CONFIG, issuer: 'attacker-api' },
        },
      ],
    }).compile();
    const otherIssuerService = module.get(JwtService);
    const token = await otherIssuerService.generateToken(
      'eve',
      'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    );

    // The default jwtService (TEST_ISSUER) should reject it.
    const result = await jwtService.validateToken(token);
    expect(result).toBeNull();
  });

  it('rejects a token signed with a different audience', async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: jwtConfig.KEY,
          useValue: { ...TEST_CONFIG, audience: 'attacker-web' },
        },
      ],
    }).compile();
    const otherAudService = module.get(JwtService);
    const token = await otherAudService.generateToken(
      'eve',
      'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    );

    const result = await jwtService.validateToken(token);
    expect(result).toBeNull();
  });

  it('rejects a token whose payload is missing uid', async () => {
    // Hand-roll a token with no `uid` claim, but otherwise correctly signed.
    const secret = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('mallory')
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setJti('11111111-1111-4111-8111-111111111111')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);

    const result = await jwtService.validateToken(token);
    expect(result).toBeNull();
  });

  it('rejects a token whose uid is not a uuid', async () => {
    const secret = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({ uid: 'not-a-uuid' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('mallory')
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setJti('22222222-2222-4222-8222-222222222222')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);

    const result = await jwtService.validateToken(token);
    expect(result).toBeNull();
  });
});
