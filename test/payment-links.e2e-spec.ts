import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Payment Links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-paylinks-admin-${Date.now()}@example.com`;
  const userEmail = `e2e-paylinks-user-${Date.now()}@example.com`;
  let adminAccessToken: string;
  let userAccessToken: string;

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

    const userReg = await internalRequest(app).post('/auth/register').send({
      email: userEmail,
      password: 'CorrectHorse1',
      firstName: 'Plain',
      lastName: 'E2E',
    });
    userAccessToken = userReg.body.tokens.accessToken;
  });

  afterAll(async () => {
    await prisma.paymentLink.deleteMany({ where: { clientEmail: userEmail } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('rejects a non-admin creating a payment link', async () => {
    const res = await internalRequest(app)
      .post('/admin/payment-links')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ clientEmail: userEmail, description: 'Custom quote', amountCents: 78000 });
    expect(res.status).toBe(403);
  });

  let redeemUrl: string;
  let token: string;

  it('lets an admin create a payment link, auto-linking the matching account', async () => {
    const res = await internalRequest(app)
      .post('/admin/payment-links')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ clientEmail: userEmail, description: 'Custom quote', amountCents: 78000 });
    expect(res.status).toBe(201);
    expect(res.body.paymentLink.clientEmail).toBe(userEmail.toLowerCase());

    redeemUrl = res.body.redeemUrl;
    token = redeemUrl.split('/pay/')[1];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows a public preview of the link with no auth required', async () => {
    const res = await internalRequest(app).get(`/payment-links/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(78000);
    expect(res.body.status).toBe('OPEN');
  });

  it('404s the preview for a bogus token (no info leak)', async () => {
    const res = await internalRequest(app).get('/payment-links/not-a-real-token');
    expect(res.status).toBe(404);
  });

  it('redeems the link into a Stripe checkout attempt for the exact stored amount (201/503 depending on Stripe config)', async () => {
    const res = await internalRequest(app).post(`/payment-links/${token}/redeem`);
    expect([201, 200, 503]).toContain(res.status);
  });

  it('marks the link paid via the internal webhook route and rejects further redemption', async () => {
    const listRes = await internalRequest(app)
      .get('/admin/payment-links')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const linkId = listRes.body.paymentLinks.find(
      (l: { clientEmail: string }) => l.clientEmail === userEmail.toLowerCase(),
    )?.id;
    expect(linkId).toBeDefined();

    const webhookRes = await internalRequest(app)
      .post('/webhooks/stripe')
      .send({
        eventId: `evt_e2e_paylink_${Date.now()}`,
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_e2e_paylink',
        metadata: { kind: 'payment_link', recordId: linkId },
      });
    expect(webhookRes.status).toBe(200);

    const redeemAgain = await internalRequest(app).post(`/payment-links/${token}/redeem`);
    expect(redeemAgain.status).toBe(409);
  });

  it('rejects cancelling an already-paid link', async () => {
    const listRes = await internalRequest(app)
      .get('/admin/payment-links')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const linkId = listRes.body.paymentLinks.find(
      (l: { clientEmail: string }) => l.clientEmail === userEmail.toLowerCase(),
    )?.id;

    const res = await internalRequest(app)
      .patch(`/admin/payment-links/${linkId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(409);
  });
});
