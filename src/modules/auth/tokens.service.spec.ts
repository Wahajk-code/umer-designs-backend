import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokensService } from '@/modules/auth/tokens.service';
import { Role } from '@prisma/client';
import { AppConfig } from '@/config/configuration';

describe('TokensService', () => {
  let service: TokensService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwt: JwtService;
  let config: ConfigService<AppConfig, true>;

  beforeEach(() => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    config = {
      get: (key: string) => {
        if (key === 'jwt') {
          return {
            accessSecret: 'access-secret',
            accessExpiresIn: '15m',
            refreshSecret: 'refresh-secret',
            refreshExpiresInDays: 7,
          };
        }
        throw new Error(`unexpected key ${key}`);
      },
    } as unknown as ConfigService<AppConfig, true>;

    service = new TokensService(jwt, config, prisma as any);
  });

  it('issues an access + refresh token pair for a new session', async () => {
    const result = await service.issueNewSession('user-1', 'a@example.com', Role.USER);
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toHaveLength(96); // 48 bytes hex
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('rotates a valid, non-revoked refresh token and revokes the old one', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue({
      id: 'rt-1',
      familyId: 'family-1',
      userId: 'user-1',
      revoked: false,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      user: { email: 'a@example.com', role: Role.USER },
    });

    const result = await service.rotate('some-raw-refresh-token');

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { revoked: true },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ familyId: 'family-1' }) }),
    );
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('throws on an unknown refresh token', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await expect(service.rotate('unknown-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws on an expired refresh token', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue({
      id: 'rt-1',
      familyId: 'family-1',
      userId: 'user-1',
      revoked: false,
      expiresAt: new Date(Date.now() - 1000),
      user: { email: 'a@example.com', role: Role.USER },
    });
    await expect(service.rotate('expired-token')).rejects.toThrow(UnauthorizedException);
  });

  it('detects reuse of an already-rotated token and revokes the whole family', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue({
      id: 'rt-1',
      familyId: 'family-1',
      userId: 'user-1',
      revoked: true,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      user: { email: 'a@example.com', role: Role.USER },
    });

    await expect(service.rotate('reused-token')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revoked: false },
      data: { revoked: true },
    });
  });

  it('revokeFamilyByToken revokes all non-revoked tokens in the family', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'rt-1', familyId: 'family-9' });
    await service.revokeFamilyByToken('some-token');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-9', revoked: false },
      data: { revoked: true },
    });
  });
});
