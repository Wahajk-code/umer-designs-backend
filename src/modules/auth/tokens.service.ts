import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AppConfig } from '@/config/configuration';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { Role } from '@prisma/client';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  signAccessToken(user: AuthenticatedUser): string {
    const jwtConfig = this.config.get('jwt', { infer: true });
    return this.jwt.sign(
      { sub: user.sub, email: user.email, role: user.role },
      { secret: jwtConfig.accessSecret, expiresIn: jwtConfig.accessExpiresIn },
    );
  }

  /** Starts a brand-new refresh-token family (login/register). */
  async issueNewSession(userId: string, email: string, role: Role): Promise<IssuedTokens> {
    const familyId = randomUUID();
    return this.issueTokenPairForFamily(userId, email, role, familyId);
  }

  /**
   * Rotates a refresh token. If the presented token has already been
   * rotated-out (revoked) this is a reuse attempt: the entire family is
   * revoked and the caller must log in again.
   */
  async rotate(rawRefreshToken: string): Promise<IssuedTokens> {
    const tokenHash = hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.revoked) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revoked: false },
        data: { revoked: true },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected. All sessions for this account have been revoked; please log in again.',
      );
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true },
    });

    return this.issueTokenPairForFamily(
      existing.userId,
      existing.user.email,
      existing.user.role,
      existing.familyId,
    );
  }

  async revokeFamilyByToken(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });
    if (!existing) {
      return;
    }
    await this.prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revoked: false },
      data: { revoked: true },
    });
  }

  private async issueTokenPairForFamily(
    userId: string,
    email: string,
    role: Role,
    familyId: string,
  ): Promise<IssuedTokens> {
    const jwtConfig = this.config.get('jwt', { infer: true });
    const rawRefreshToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + jwtConfig.refreshExpiresInDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawRefreshToken),
        familyId,
        expiresAt,
      },
    });

    const accessToken = this.signAccessToken({ sub: userId, email, role });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      accessTokenExpiresIn: jwtConfig.accessExpiresIn,
    };
  }
}
