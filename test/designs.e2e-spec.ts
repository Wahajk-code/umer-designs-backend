import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DesignCategory, DesignStatus, Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Designs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-designs-admin-${Date.now()}@example.com`;
  const userEmail = `e2e-designs-user-${Date.now()}@example.com`;
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
  });

  afterAll(async () => {
    await prisma.design.deleteMany({ where: { title: { startsWith: 'E2E ' } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  const draftDesign = {
    title: 'E2E Draft House',
    category: DesignCategory.RESIDENTIAL,
    basePriceCents: 200000,
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1500,
    estimatedBuildCents: 30000000,
    summary: 'summary',
    description: 'description',
    coverImageUrl: 'https://example.com/cover.jpg',
  };

  it('rejects a non-admin creating a design', async () => {
    const res = await internalRequest(app)
      .post('/admin/designs')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send(draftDesign);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request to the admin designs list', async () => {
    const res = await internalRequest(app).get('/admin/designs');
    expect(res.status).toBe(401);
  });

  let createdId: string;
  let createdSlug: string;

  it('lets an admin create a design as a DRAFT', async () => {
    const res = await internalRequest(app)
      .post('/admin/designs')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send(draftDesign);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(DesignStatus.DRAFT);
    expect(res.body.slug).toBe('e2e-draft-house');
    createdId = res.body.id;
    createdSlug = res.body.slug;
  });

  it('does not expose a DRAFT design on the public list', async () => {
    const res = await internalRequest(app).get('/designs').query({ search: 'E2E Draft' });
    expect(res.status).toBe(200);
    expect(res.body.designs.find((d: { id: string }) => d.id === createdId)).toBeUndefined();
  });

  it('404s the public detail route for a DRAFT design', async () => {
    const res = await internalRequest(app).get(`/designs/${createdSlug}`);
    expect(res.status).toBe(404);
  });

  it('lets an admin publish the design', async () => {
    const res = await internalRequest(app)
      .patch(`/admin/designs/${createdId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: DesignStatus.PUBLISHED });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(DesignStatus.PUBLISHED);
  });

  it('now exposes it on the public list and detail routes', async () => {
    const listRes = await internalRequest(app).get('/designs').query({ search: 'E2E Draft' });
    expect(listRes.body.designs.some((d: { id: string }) => d.id === createdId)).toBe(true);

    const detailRes = await internalRequest(app).get(`/designs/${createdSlug}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.title).toBe('E2E Draft House');
  });

  it('rejects unknown fields on create (whitelist enforcement)', async () => {
    const res = await internalRequest(app)
      .post('/admin/designs')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ ...draftDesign, title: 'E2E Whitelist Test', hackerField: 'nope' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-admin requesting an upload signature', async () => {
    const res = await internalRequest(app)
      .post(`/admin/designs/${createdId}/upload-signature`)
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 503 (not a crash) for an upload signature when Cloudinary is unconfigured', async () => {
    const res = await internalRequest(app)
      .post(`/admin/designs/${createdId}/upload-signature`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect([200, 503]).toContain(res.status);
  });
});
