import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DesignCategory, DesignStatus, ModificationStatus, OrderStatus, Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Modifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-mods-admin-${Date.now()}@example.com`;
  const ownerEmail = `e2e-mods-owner-${Date.now()}@example.com`;
  const strangerEmail = `e2e-mods-stranger-${Date.now()}@example.com`;
  let adminAccessToken: string;
  let ownerAccessToken: string;
  let strangerAccessToken: string;
  let ownerId: string;
  let designId: string;
  let addRoomOptionId: string;
  let resizeOptionId: string;

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
      await internalRequest(app).post('/auth/login').send({ email: adminEmail, password: 'CorrectHorse1' })
    ).body.tokens.accessToken;

    const ownerReg = await internalRequest(app).post('/auth/register').send({
      email: ownerEmail,
      password: 'CorrectHorse1',
      firstName: 'Owner',
      lastName: 'E2E',
    });
    ownerAccessToken = ownerReg.body.tokens.accessToken;
    ownerId = ownerReg.body.user.id;

    const strangerReg = await internalRequest(app).post('/auth/register').send({
      email: strangerEmail,
      password: 'CorrectHorse1',
      firstName: 'Stranger',
      lastName: 'E2E',
    });
    strangerAccessToken = strangerReg.body.tokens.accessToken;

    const design = await prisma.design.create({
      data: {
        title: 'E2E Modifications Design',
        slug: `e2e-mods-design-${Date.now()}`,
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

    await prisma.order.create({
      data: { userId: ownerId, designId, amountCents: 145000, status: OrderStatus.PAID },
    });

    const addRoom = await prisma.modificationOption.create({
      data: { label: 'Add a room', addedCostCents: 50000 },
    });
    addRoomOptionId = addRoom.id;
    const resize = await prisma.modificationOption.create({
      data: { label: 'Resize footprint', addedCostCents: 35000 },
    });
    resizeOptionId = resize.id;
  });

  afterAll(async () => {
    await prisma.modificationEvent.deleteMany({ where: { modification: { designId } } });
    await prisma.modificationSelectedOption.deleteMany({ where: { modification: { designId } } });
    await prisma.modification.deleteMany({ where: { designId } });
    await prisma.modificationOption.deleteMany({ where: { id: { in: [addRoomOptionId, resizeOptionId] } } });
    await prisma.order.deleteMany({ where: { designId } });
    await prisma.design.delete({ where: { id: designId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, ownerEmail, strangerEmail] } } });
    await app.close();
  });

  it('lists active modification options for a logged-in user', async () => {
    const res = await internalRequest(app)
      .get('/modifications/options')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((o: { id: string }) => o.id === addRoomOptionId)).toBe(true);
  });

  it("rejects a modification checkout for a design the user doesn't own", async () => {
    const res = await internalRequest(app)
      .post('/modifications/checkout')
      .set('Authorization', `Bearer ${strangerAccessToken}`)
      .send({ designId, selectedOptionIds: [addRoomOptionId] });
    expect(res.status).toBe(403);
  });

  it('rejects a checkout with an unknown option id', async () => {
    const res = await internalRequest(app)
      .post('/modifications/checkout')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ designId, selectedOptionIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(res.status).toBe(400);
  });

  it('returns 201/503 for a valid checkout attempt by the owner (Stripe may be unconfigured in this env)', async () => {
    const res = await internalRequest(app)
      .post('/modifications/checkout')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ designId, selectedOptionIds: [addRoomOptionId, resizeOptionId] });
    expect([201, 503]).toContain(res.status);
  });

  describe('once a modification has been paid for (simulated via the internal webhook route)', () => {
    let modificationId: string;

    beforeAll(async () => {
      await internalRequest(app)
        .post('/webhooks/stripe')
        .send({
          eventId: `evt_e2e_mod_${Date.now()}`,
          eventType: 'checkout.session.completed',
          paymentIntentId: 'pi_e2e_mod_1',
          metadata: {
            kind: 'modification',
            userId: ownerId,
            designId,
            basePriceCents: '145000',
            totalAmountCents: '230000',
            selections: JSON.stringify([
              { optionId: addRoomOptionId, priceAtSelectionCents: 50000 },
              { optionId: resizeOptionId, priceAtSelectionCents: 35000 },
            ]),
          },
        });

      const mine = await internalRequest(app)
        .get('/modifications/me')
        .set('Authorization', `Bearer ${ownerAccessToken}`);
      modificationId = mine.body[0].id;
    });

    it('computed the total as base + selected options and started in SUBMITTED', async () => {
      const res = await internalRequest(app)
        .get(`/modifications/${modificationId}`)
        .set('Authorization', `Bearer ${ownerAccessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.totalAmountCents).toBe(230000);
      expect(res.body.status).toBe(ModificationStatus.SUBMITTED);
      expect(res.body.selectedOptions).toHaveLength(2);
    });

    it('rejects a stranger viewing the request', async () => {
      const res = await internalRequest(app)
        .get(`/modifications/${modificationId}`)
        .set('Authorization', `Bearer ${strangerAccessToken}`);
      expect(res.status).toBe(404);
    });

    it('rejects a non-admin trying to change status', async () => {
      const res = await internalRequest(app)
        .patch(`/admin/modifications/${modificationId}/status`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ status: ModificationStatus.IN_REVIEW });
      expect(res.status).toBe(403);
    });

    it('rejects an illegal status jump (SUBMITTED -> DELIVERED)', async () => {
      const res = await internalRequest(app)
        .patch(`/admin/modifications/${modificationId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: ModificationStatus.DELIVERED });
      expect(res.status).toBe(400);
    });

    it('lets the admin walk the request through the pipeline', async () => {
      for (const status of [
        ModificationStatus.IN_REVIEW,
        ModificationStatus.IN_PROGRESS,
        ModificationStatus.DELIVERED,
      ]) {
        const res = await internalRequest(app)
          .patch(`/admin/modifications/${modificationId}/status`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({ status });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
      }
    });

    it('lets the owner and the admin both comment, and a stranger neither', async () => {
      const ownerComment = await internalRequest(app)
        .post(`/modifications/${modificationId}/comments`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ comment: 'Looks great, thank you!' });
      expect(ownerComment.status).toBe(201);

      const adminComment = await internalRequest(app)
        .post(`/modifications/${modificationId}/comments`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ comment: 'Glad you like it.' });
      expect(adminComment.status).toBe(201);

      const strangerComment = await internalRequest(app)
        .post(`/modifications/${modificationId}/comments`)
        .set('Authorization', `Bearer ${strangerAccessToken}`)
        .send({ comment: 'Can I see this too?' });
      expect(strangerComment.status).toBe(404);
    });

    it('records the full event timeline (status changes + comments) in order', async () => {
      const res = await internalRequest(app)
        .get(`/modifications/${modificationId}`)
        .set('Authorization', `Bearer ${ownerAccessToken}`);
      const kinds = res.body.events.map((e: { kind: string }) => e.kind);
      expect(kinds).toEqual([
        'STATUS_CHANGE',
        'STATUS_CHANGE',
        'STATUS_CHANGE',
        'STATUS_CHANGE',
        'COMMENT',
        'COMMENT',
      ]);
    });
  });
});
