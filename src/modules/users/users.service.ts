import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Excludes soft-deleted accounts — a deleted user can't log in, be found by referral code, or act as anyone. */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  findByReferralCode(code: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { referralCode: code.toUpperCase(), deletedAt: null },
    });
  }

  async create(input: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    referredById?: string;
  }): Promise<User> {
    const referralCode = await this.generateUniqueReferralCode(input.firstName);
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          referralCode,
          referredById: input.referredById,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists.');
      }
      throw err;
    }
  }

  async promoteToRole(userId: string, role: Role): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { role } });
  }

  async updateProfile(userId: string, firstName: string, lastName: string): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { firstName, lastName } });
  }

  async updateEmail(userId: string, newEmail: string): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { email: newEmail.toLowerCase() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists.');
      }
      throw err;
    }
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async list(page: number, pageSize: number): Promise<{ users: User[]; total: number }> {
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { users, total };
  }

  /**
   * Soft delete: preserves the row (and every order/modification/referral
   * that references it) for audit/history, but the account can never log in
   * again and disappears from admin listings. Also revokes every session —
   * done here via a direct Prisma call rather than TokensService, to avoid
   * a circular module dependency (AuthModule already imports UsersModule).
   */
  async softDelete(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
  }

  async regenerateReferralCode(userId: string): Promise<User> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const referralCode = await this.generateUniqueReferralCode(user.firstName);
    return this.prisma.user.update({ where: { id: userId }, data: { referralCode } });
  }

  private async generateUniqueReferralCode(firstName: string): Promise<string> {
    const base =
      firstName
        .replace(/[^a-zA-Z]/g, '')
        .slice(0, 6)
        .toUpperCase() || 'UMER';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      const candidate = `${base}-${suffix}`;
      const existing = await this.prisma.user.findUnique({ where: { referralCode: candidate } });
      if (!existing) {
        return candidate;
      }
    }
    throw new Error('Failed to generate a unique referral code after 10 attempts.');
  }
}
