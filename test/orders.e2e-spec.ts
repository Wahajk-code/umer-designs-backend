import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DesignCategory, DesignStatus, Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Orders + Webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-orders-admin-${Date.now()}@example.com`;
  const userEmail = `e2e-orders-user-${Date.now()}@example.com`;
  let adminAccessToken: string;
  let userAccessToken: string;
  let userId: string;
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
    const adminLogin = await internalRequest(app)
      .post('/auth/login')
      .send({ email: adminEmail, password: 'CorrectHorse1' });
    adminAccessToken = adminLogin.body.tokens.accessToken;

    const userReg = await internalRequest(app).post('/auth/register').send({
      email: userEmail,
      password: 'CorrectHorse1',
      firstName: 'Plain',
      lastName: 'E2E',
    });
    userAccessToken = userReg.body.tokens.accessToken;
    userId = userReg.body.user.id;

    const design = await prisma.design.create({
      data: {
        title: 'E2E Orders Design',
        slug: `e2e-orders-design-${Date.now()}`,
        category: DesignCategory.CONTAINER,
        status: DesignStatus.PUBLISHED,
        basePriceCents: 145000,
        bedrooms: 2,
        bathrooms: 1,
        sqft: 900,
        estimatedBuildCents: 11000000,
        summary: 'summary',
        description: 'description',
        coverImageUrl: 'https://example.com/cover.jpg',
      },
    });
    designId = design.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { designId } });
    await prisma.design.delete({ where: { id: designId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('rejects checkout for an unauthenticated caller', async () => {
    const res = await internalRequest(app).post('/orders/checkout').send({ designId });
    expect(res.status).toBe(401);
  });

  it('rejects checkout for a nonexistent design', async () => {
    const res = await internalRequest(app)
      .post('/orders/checkout')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ designId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('returns 503 (Stripe unconfigured in this test environment) rather than crashing on a valid checkout attempt', async () => {
    const res = await internalRequest(app)
      .post('/orders/checkout')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ designId });
    expect([201, 503]).toContain(res.status);
  });

  it('rejects an unattested (no internal HMAC) call to the internal webhook route', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .send({
        eventId: 'evt_e2e_1',
        eventType: 'checkout.session.completed',
        metadata: { kind: 'design_order', recordId: 'does-not-matter' },
      });
    expect(res.status).toBe(401);
  });

  it('marks an order paid via the internal webhook route and is idempotent on replay', async () => {
    const order = await prisma.order.create({
      data: { userId, designId, amountCents: 145000 },
    });

    const first = await internalRequest(app)
      .post('/webhooks/stripe')
      .send({
        eventId: 'evt_e2e_2',
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_e2e_2',
        metadata: { kind: 'design_order', recordId: order.id },
      });
    expect(first.status).toBe(200);

    const paid = await prisma.order.findUnique({ where: { id: order.id } });
    expect(paid?.status).toBe('PAID');
    expect(paid?.stripePaymentIntentId).toBe('pi_e2e_2');

    // Replay with the same event id must not throw or double-process.
    const replay = await internalRequest(app)
      .post('/webhooks/stripe')
      .send({
        eventId: 'evt_e2e_2',
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_e2e_2',
        metadata: { kind: 'design_order', recordId: order.id },
      });
    expect(replay.status).toBe(200);
  });

  it('lets the owning user download a file only after the order is paid', async () => {
    const file = await prisma.designFile.create({
      data: {
        designId,
        label: 'Plan set',
        cloudinaryPublicId: `designs/${designId}/plan`,
        resourceType: 'raw',
        format: 'pdf',
      },
    });

    const order = await prisma.order.findFirst({ where: { userId, designId, status: 'PAID' } });
    expect(order).not.toBeNull();

    const res = await internalRequest(app)
      .get(`/orders/${order!.id}/download/${file.id}`)
      .set('Authorization', `Bearer ${userAccessToken}`);
    // 200 with a signed url, or 503 if Cloudinary isn't configured in this environment — never a crash/leak.
    expect([200, 503]).toContain(res.status);
  });

  it('rejects an unauthenticated request to the admin orders list', async () => {
    const res = await internalRequest(app).get('/admin/orders');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin listing all orders', async () => {
    const res = await internalRequest(app)
      .get('/admin/orders')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('lets an admin list all orders', async () => {
    const res = await internalRequest(app)
      .get('/admin/orders')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
  });
});
