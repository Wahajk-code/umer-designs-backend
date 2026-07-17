import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DesignCategory, DesignStatus, ReferralStatus, Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Referrals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-ref-admin-${Date.now()}@example.com`;
  const referrerEmail = `e2e-ref-referrer-${Date.now()}@example.com`;
  const referredEmail = `e2e-ref-referred-${Date.now()}@example.com`;
  let adminAccessToken: string;
  let referrerAccessToken: string;
  let referredId: string;
  let designId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await internalRequest(app).post('/auth/register').send({
      email: adminEmail,
      password: 'CorrectHorse1',
      firstName: 'Admin',
      lastName: 'E2E',
    });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: Role.ADMIN } });
    adminAccessToken = (
      await internalRequest(app)
        .post('/auth/login')
        .send({ email: adminEmail, password: 'CorrectHorse1' })
    ).body.tokens.accessToken;

    const referrerReg = await internalRequest(app).post('/auth/register').send({
      email: referrerEmail,
      password: 'CorrectHorse1',
      firstName: 'Referrer',
      lastName: 'E2E',
    });
    referrerAccessToken = referrerReg.body.tokens.accessToken;
    const referrerCode = referrerReg.body.user.referralCode;

    const referredReg = await internalRequest(app).post('/auth/register').send({
      email: referredEmail,
      password: 'CorrectHorse1',
      firstName: 'Referred',
      lastName: 'E2E',
      referralCode: referrerCode,
    });
    referredId = referredReg.body.user.id;

    const design = await prisma.design.create({
      data: {
        title: 'E2E Referral Design',
        slug: `e2e-referral-design-${Date.now()}`,
        category: DesignCategory.CONTAINER,
        status: DesignStatus.PUBLISHED,
        basePriceCents: 100000,
        bedrooms: 1,
        bathrooms: 1,
        sqft: 500,
        estimatedBuildCents: 6000000,
        summary: 'summary',
        description: 'description',
        coverImageUrl: 'https://example.com/cover.jpg',
      },
    });
    designId = design.id;
  });

  afterAll(async () => {
    await prisma.referral.deleteMany({ where: { referredId } });
    await prisma.order.deleteMany({ where: { designId } });
    await prisma.design.delete({ where: { id: designId } });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, referrerEmail, referredEmail] } },
    });
    await app.close();
  });

  it('creates a PENDING referral row at signup when a valid referral code is used', async () => {
    const referral = await prisma.referral.findUnique({ where: { referredId } });
    expect(referral).not.toBeNull();
    expect(referral?.rewardStatus).toBe(ReferralStatus.PENDING);
  });

  it('rejects an unauthenticated summary request', async () => {
    const res = await internalRequest(app).get('/referrals/me');
    expect(res.status).toBe(401);
  });

  it("shows the referrer's summary with one pending referral and zero earned so far", async () => {
    const res = await internalRequest(app)
      .get('/referrals/me')
      .set('Authorization', `Bearer ${referrerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalReferred).toBe(1);
    expect(res.body.totalEarnedCents).toBe(0);
  });

  it("rewards the referrer when the referred user's first order is paid", async () => {
    const order = await prisma.order.create({
      data: { userId: referredId, designId, amountCents: 100000 },
    });

    const webhookRes = await internalRequest(app)
      .post('/webhooks/stripe')
      .send({
        eventId: `evt_e2e_ref_${Date.now()}`,
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_e2e_ref',
        metadata: { kind: 'design_order', recordId: order.id },
      });
    expect(webhookRes.status).toBe(200);

    const referral = await prisma.referral.findUnique({ where: { referredId } });
    expect(referral?.rewardStatus).toBe(ReferralStatus.REWARDED);

    const summaryRes = await internalRequest(app)
      .get('/referrals/me')
      .set('Authorization', `Bearer ${referrerAccessToken}`);
    expect(summaryRes.body.totalEarnedCents).toBeGreaterThan(0);
  });

  it('rejects a non-admin listing all referrals', async () => {
    const res = await internalRequest(app)
      .get('/admin/referrals')
      .set('Authorization', `Bearer ${referrerAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('lets an admin list all referrals with a platform-wide rewarded total', async () => {
    const res = await internalRequest(app)
      .get('/admin/referrals')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRewardedCents).toBeGreaterThan(0);
  });

  it('exposes the current flat reward settings to admins', async () => {
    const res = await internalRequest(app)
      .get('/admin/referrals/settings')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rewardCents).toBeGreaterThan(0);
  });
});
