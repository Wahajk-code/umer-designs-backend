import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, ReferralStatus } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent, ReferralRewardedPayload } from '@/common/events/domain-events';
import { maskEmail } from '@/modules/referrals/referral-email.util';

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: EventEmitter2,
  ) {}

  /** Called synchronously from registration — the tag is part of the signup transaction, not a side effect. */
  async tagSignup(referrerId: string, referredId: string): Promise<void> {
    await this.prisma.referral.create({
      data: {
        referrerId,
        referredId,
        rewardCents: this.config.get('referralRewardCents', { infer: true }),
      },
    });
  }

  async getMySummary(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalEarnedCents = referrals
      .filter((r) => r.rewardStatus === ReferralStatus.REWARDED)
      .reduce((sum, r) => sum + r.rewardCents, 0);

    return {
      referralCode: user.referralCode,
      totalReferred: referrals.length,
      totalEarnedCents,
      referrals: referrals.map((r) => ({
        referredEmail: maskEmail(r.referred.email),
        rewardStatus: r.rewardStatus,
        rewardCents: r.rewardCents,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Reacts to a user's order being paid (see ReferralsListener). Rewards the
   * referrer exactly once, only on the referred user's genuine first paid order.
   */
  async checkAndRewardFirstPurchase(referredUserId: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
      include: { referred: true },
    });
    if (!referral || referral.rewardStatus === ReferralStatus.REWARDED) {
      return;
    }

    const paidOrderCount = await this.prisma.order.count({
      where: { userId: referredUserId, status: OrderStatus.PAID },
    });
    if (paidOrderCount !== 1) {
      return;
    }

    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { rewardStatus: ReferralStatus.REWARDED, rewardedAt: new Date() },
    });

    const payload: ReferralRewardedPayload = {
      referralId: referral.id,
      referrerId: referral.referrerId,
      referredEmail: referral.referred.email,
      rewardCents: referral.rewardCents,
    };
    this.events.emit(DomainEvent.REFERRAL_REWARDED, payload);
  }

  async listAdmin(
    page: number,
    pageSize: number,
  ): Promise<{
    referrals: Array<{
      id: string;
      referrerEmail: string;
      referredEmail: string;
      rewardStatus: ReferralStatus;
      rewardCents: number;
      createdAt: Date;
    }>;
    total: number;
    totalRewardedCents: number;
  }> {
    const [rows, total, rewardedAgg] = await this.prisma.$transaction([
      this.prisma.referral.findMany({
        include: { referrer: { select: { email: true } }, referred: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.referral.count(),
      this.prisma.referral.aggregate({
        where: { rewardStatus: ReferralStatus.REWARDED },
        _sum: { rewardCents: true },
      }),
    ]);

    return {
      referrals: rows.map((r) => ({
        id: r.id,
        referrerEmail: r.referrer.email,
        referredEmail: r.referred.email,
        rewardStatus: r.rewardStatus,
        rewardCents: r.rewardCents,
        createdAt: r.createdAt,
      })),
      total,
      totalRewardedCents: rewardedAgg._sum.rewardCents ?? 0,
    };
  }

  getSettings(): { rewardCents: number; payout: string } {
    return {
      rewardCents: this.config.get('referralRewardCents', { infer: true }),
      payout: 'auto on 1st purchase',
    };
  }
}
