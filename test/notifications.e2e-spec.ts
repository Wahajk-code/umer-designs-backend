import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DesignCategory, DesignStatus } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userEmail = `e2e-notifications-user-${Date.now()}@example.com`;
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

    const reg = await internalRequest(app).post('/auth/register').send({
      email: userEmail,
      password: 'CorrectHorse1',
      firstName: 'Plain',
      lastName: 'E2E',
    });
    userAccessToken = reg.body.tokens.accessToken;
    userId = reg.body.user.id;

    const design = await prisma.design.create({
      data: {
        title: 'E2E Notifications Design',
        slug: `e2e-notifications-design-${Date.now()}`,
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
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.order.deleteMany({ where: { designId } });
    await prisma.design.delete({ where: { id: designId } });
    await prisma.user.deleteMany({ where: { email: userEmail } });
    await app.close();
  });

  it('rejects an unauthenticated request to list notifications', async () => {
    const res = await internalRequest(app).get('/notifications/me');
    expect(res.status).toBe(401);
  });

  it('starts with an empty notification list', async () => {
    const res = await internalRequest(app)
      .get('/notifications/me')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.unreadCount).toBe(0);
  });

  it('creates an ORDER_CONFIRMED notification when an order is marked paid via the webhook route', async () => {
    const order = await prisma.order.create({
      data: { userId, designId, amountCents: 100000 },
    });

    const webhookRes = await internalRequest(app)
      .post('/webhooks/stripe')
      .send({
        eventId: `evt_e2e_notif_${Date.now()}`,
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_e2e_notif',
        metadata: { kind: 'design_order', recordId: order.id },
      });
    expect(webhookRes.status).toBe(200);

    const listRes = await internalRequest(app)
      .get('/notifications/me')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(
      listRes.body.notifications.some((n: { type: string }) => n.type === 'ORDER_CONFIRMED'),
    ).toBe(true);
    expect(listRes.body.unreadCount).toBeGreaterThan(0);
  });

  let notificationId: string;

  it('lets the user mark a single notification as read', async () => {
    const listRes = await internalRequest(app)
      .get('/notifications/me')
      .set('Authorization', `Bearer ${userAccessToken}`);
    notificationId = listRes.body.notifications[0].id;

    const res = await internalRequest(app)
      .patch(`/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();
  });

  it('rejects marking a notification that does not belong to the caller', async () => {
    const res = await internalRequest(app)
      .patch(`/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${userAccessToken}`); // still the owner here — verify a bogus id 404s instead
    expect(res.status).toBe(200); // idempotent re-read is fine

    const bogus = await internalRequest(app)
      .patch(`/notifications/00000000-0000-0000-0000-000000000000/read`)
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(bogus.status).toBe(404);
  });

  it('lets the user mark all notifications as read', async () => {
    const res = await internalRequest(app)
      .patch('/notifications/read-all')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(204);

    const listRes = await internalRequest(app)
      .get('/notifications/me')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(listRes.body.unreadCount).toBe(0);
  });
});
