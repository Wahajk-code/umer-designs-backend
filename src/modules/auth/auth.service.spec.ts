import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '@/modules/auth/auth.service';
import { UsersService } from '@/modules/users/users.service';
import { TokensService } from '@/modules/auth/tokens.service';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { Role } from '@prisma/client';
import { AppConfig } from '@/config/configuration';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findByReferralCode' | 'create'>
  >;
  let tokensService: jest.Mocked<
    Pick<TokensService, 'issueNewSession' | 'rotate' | 'revokeFamilyByToken'>
  >;
  let referralsService: jest.Mocked<Pick<ReferralsService, 'tagSignup'>>;
  let config: ConfigService<AppConfig, true>;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findByReferralCode: jest.fn(),
      create: jest.fn(),
    };
    tokensService = {
      issueNewSession: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresIn: '15m',
      }),
      rotate: jest.fn(),
      revokeFamilyByToken: jest.fn(),
    };
    referralsService = { tagSignup: jest.fn().mockResolvedValue(undefined) };
    config = { get: () => 4 } as unknown as ConfigService<AppConfig, true>; // low salt rounds for fast tests

    service = new AuthService(
      usersService as unknown as UsersService,
      tokensService as unknown as TokensService,
      config,
      referralsService as unknown as ReferralsService,
    );
  });

  describe('register', () => {
    it('rejects a duplicate email', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 'u1' } as any);
      await expect(
        service.register({
          email: 'a@example.com',
          password: 'Password1',
          firstName: 'A',
          lastName: 'B',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('hashes the password before persisting and never returns it', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(async (input) => ({
        id: 'u1',
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: Role.USER,
        referralCode: 'ABC-123',
        referredById: input.referredById ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.register({
        email: 'a@example.com',
        password: 'Password1',
        firstName: 'A',
        lastName: 'B',
      });

      const createArg = usersService.create.mock.calls[0][0];
      expect(createArg.passwordHash).not.toBe('Password1');
      expect(await bcrypt.compare('Password1', createArg.passwordHash)).toBe(true);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(tokensService.issueNewSession).toHaveBeenCalledWith('u1', 'a@example.com', Role.USER);
    });

    it('tags referredById when a valid referral code is supplied', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByReferralCode.mockResolvedValue({ id: 'referrer-1' } as any);
      usersService.create.mockImplementation(async (input) => ({
        id: 'u2',
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: Role.USER,
        referralCode: 'XYZ-999',
        referredById: input.referredById ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.register({
        email: 'b@example.com',
        password: 'Password1',
        firstName: 'B',
        lastName: 'C',
        referralCode: 'REFERRER1',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ referredById: 'referrer-1' }),
      );
      expect(referralsService.tagSignup).toHaveBeenCalledWith('referrer-1', 'u2');
    });

    it('does not tag a referral when no referral code is supplied', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(async (input) => ({
        id: 'u3',
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: Role.USER,
        referralCode: 'NOP-000',
        referredById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.register({
        email: 'c@example.com',
        password: 'Password1',
        firstName: 'C',
        lastName: 'D',
      });

      expect(referralsService.tagSignup).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects an unknown email without revealing whether the account exists', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nope@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword1', 4);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        passwordHash,
        role: Role.USER,
      } as any);

      await expect(
        service.login({ email: 'a@example.com', password: 'WrongPassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues tokens on a correct password', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword1', 4);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        passwordHash,
        role: Role.USER,
      } as any);

      const result = await service.login({ email: 'a@example.com', password: 'CorrectPassword1' });
      expect(result.tokens.accessToken).toBe('access');
      expect(tokensService.issueNewSession).toHaveBeenCalledWith('u1', 'a@example.com', Role.USER);
    });
  });
});
