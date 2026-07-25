import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '@/modules/users/users.service';
import { TokensService, IssuedTokens } from '@/modules/auth/tokens.service';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { RegisterDto } from '@/modules/auth/dto/register.dto';
import { LoginDto } from '@/modules/auth/dto/login.dto';
import { UpdateEmailDto } from '@/modules/auth/dto/update-email.dto';
import { UpdatePasswordDto } from '@/modules/auth/dto/update-password.dto';
import { AppConfig } from '@/config/configuration';
import { sanitizeUser, SafeUser } from '@/common/utils/sanitize-user.util';

export interface AuthResult {
  user: SafeUser;
  tokens: IssuedTokens;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly referralsService: ReferralsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    let referredById: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.usersService.findByReferralCode(dto.referralCode);
      referredById = referrer?.id;
    }

    const saltRounds = this.config.get('bcryptSaltRounds', { infer: true });
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      referredById,
    });

    if (referredById) {
      await this.referralsService.tagSignup(referredById, user.id);
    }

    const tokens = await this.tokensService.issueNewSession(user.id, user.email, user.role);
    return { user: sanitizeUser(user), tokens };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const tokens = await this.tokensService.issueNewSession(user.id, user.email, user.role);
    return { user: sanitizeUser(user), tokens };
  }

  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    return this.tokensService.rotate(rawRefreshToken);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokensService.revokeFamilyByToken(rawRefreshToken);
  }

  async changeEmail(userId: string, dto: UpdateEmailDto): Promise<SafeUser> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const passwordMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const updated = await this.usersService.updateEmail(userId, dto.newEmail);
    return sanitizeUser(updated);
  }

  /** Revokes every session on every device — the new password is only trustworthy once nothing old can still act as the user. */
  async changePassword(userId: string, dto: UpdatePasswordDto): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const passwordMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const saltRounds = this.config.get('bcryptSaltRounds', { infer: true });
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);
    await this.usersService.updatePasswordHash(userId, passwordHash);
    await this.tokensService.revokeAllForUser(userId);
  }
}
