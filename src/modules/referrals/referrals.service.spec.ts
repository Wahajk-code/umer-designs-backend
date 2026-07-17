import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReferralStatus } from '@prisma/client';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent } from '@/common/events/domain-events';

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock };
    referral: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
    };
    order: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let events: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let config: ConfigService<AppConfig, true>;

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      referral: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      order: { count: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    events = { emit: jest.fn() };
    config = { get: () => 3000 } as unknown as ConfigService<AppConfig, true>;
    service = new ReferralsService(prisma as any, config, events as any);
  });

  describe('tagSignup', () => {
    it('creates a PENDING referral row at the platform reward rate', async () => {
      prisma.referral.create.mockResolvedValue({});
      await service.tagSignup('referrer-1', 'referred-1');
      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: { referrerId: 'referrer-1', referredId: 'referred-1', rewardCents: 3000 },
      });
    });
  });

  describe('checkAndRewardFirstPurchase', () => {
    it('does nothing when the user has no referral record', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);
      await service.checkAndRewardFirstPurchase('u1');
      expect(prisma.referral.update).not.toHaveBeenCalled();
    });

    it('does nothing when the referral is already REWARDED (idempotent)', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        rewardStatus: ReferralStatus.REWARDED,
      });
      await service.checkAndRewardFirstPurchase('u1');
      expect(prisma.referral.update).not.toHaveBeenCalled();
    });

    it('does nothing if this is not genuinely the first paid order', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        rewardStatus: ReferralStatus.PENDING,
        referrerId: 'referrer-1',
        referred: { email: 'referred@example.com' },
      });
      prisma.order.count.mockResolvedValue(2); // this is their second paid order
      await service.checkAndRewardFirstPurchase('u1');
      expect(prisma.referral.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('rewards the referrer on the genuine first paid order and emits REFERRAL_REWARDED', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        rewardStatus: ReferralStatus.PENDING,
        referrerId: 'referrer-1',
        rewardCents: 3000,
        referred: { email: 'referred@example.com' },
      });
      prisma.order.count.mockResolvedValue(1);
      prisma.referral.update.mockResolvedValue({});

      await service.checkAndRewardFirstPurchase('u1');

      expect(prisma.referral.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ rewardStatus: ReferralStatus.REWARDED }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.REFERRAL_REWARDED,
        expect.objectContaining({ referralId: 'r1', referrerId: 'referrer-1', rewardCents: 3000 }),
      );
    });
  });

  describe('getMySummary', () => {
    it('sums only REWARDED referrals toward totalEarnedCents', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'SOFIA-ABC123' });
      prisma.referral.findMany.mockResolvedValue([
        {
          rewardStatus: ReferralStatus.REWARDED,
          rewardCents: 3000,
          referred: { email: 'a@example.com' },
          createdAt: new Date(),
        },
        {
          rewardStatus: ReferralStatus.PENDING,
          rewardCents: 3000,
          referred: { email: 'b@example.com' },
          createdAt: new Date(),
        },
      ]);

      const summary = await service.getMySummary('u1');

      expect(summary.totalEarnedCents).toBe(3000);
      expect(summary.totalReferred).toBe(2);
      expect(summary.referralCode).toBe('SOFIA-ABC123');
      expect(summary.referrals[0].referredEmail).not.toBe('a@example.com'); // masked
    });
  });
});
