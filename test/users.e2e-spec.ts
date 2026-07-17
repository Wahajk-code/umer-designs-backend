import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-admin-${Date.now()}@example.com`;
  const userEmail = `e2e-user-${Date.now()}@example.com`;
  let adminAccessToken: string;
  let userAccessToken: string;
  let plainUserId: string;

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

    const adminRes = await internalRequest(app).post('/auth/register').send({
      email: adminEmail,
      password: 'CorrectHorse1',
      firstName: 'Admin',
      lastName: 'E2E',
    });
    adminAccessToken = adminRes.body.tokens.accessToken;
    // Promote directly via Prisma — there is no bootstrap admin endpoint by design (see dev CLI script in Phase 12).
    await prisma.user.update({ where: { email: adminEmail }, data: { role: Role.ADMIN } });
    const refreshed = await internalRequest(app).post('/auth/login').send({
      email: adminEmail,
      password: 'CorrectHorse1',
    });
    adminAccessToken = refreshed.body.tokens.accessToken;

    const userRes = await internalRequest(app).post('/auth/register').send({
      email: userEmail,
      password: 'CorrectHorse1',
      firstName: 'Plain',
      lastName: 'E2E',
    });
    userAccessToken = userRes.body.tokens.accessToken;
    plainUserId = userRes.body.user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('rejects a non-admin user listing all users', async () => {
    const res = await internalRequest(app)
      .get('/users')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects a non-admin user promoting anyone (including themselves)', async () => {
    const res = await internalRequest(app)
      .patch(`/users/${plainUserId}/role`)
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ role: Role.ADMIN });
    expect(res.status).toBe(403);
  });

  it('allows an admin to list users', async () => {
    const res = await internalRequest(app)
      .get('/users')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users[0]).not.toHaveProperty('passwordHash');
  });

  it('allows an admin to promote a user', async () => {
    const res = await internalRequest(app)
      .patch(`/users/${plainUserId}/role`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: Role.ADMIN });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe(Role.ADMIN);
  });

  it('rejects an unknown role value at the DTO layer', async () => {
    const res = await internalRequest(app)
      .patch(`/users/${plainUserId}/role`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: 'SUPERUSER' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields on the role update DTO (whitelist enforcement)', async () => {
    const res = await internalRequest(app)
      .patch(`/users/${plainUserId}/role`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: Role.USER, isSuperAdmin: true });
    expect(res.status).toBe(400);
  });
});
