import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testEmail = `e2e-${Date.now()}@example.com`;

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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('internal attestation + auth guard enforcement', () => {
    it('rejects any request with no internal attestation headers, even on "public" routes', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send({
        email: testEmail,
        password: 'irrelevant',
      });
      expect(res.status).toBe(401);
    });

    it('rejects a protected route with valid attestation but no user JWT', async () => {
      const res = await internalRequest(app).get('/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('register -> login -> me', () => {
    let accessToken: string;
    let refreshToken: string;

    it('registers a new user and returns tokens + a sanitized user', async () => {
      const res = await internalRequest(app).post('/auth/register').send({
        email: testEmail,
        password: 'CorrectHorse1',
        firstName: 'E2E',
        lastName: 'Tester',
      });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();

      accessToken = res.body.tokens.accessToken;
      refreshToken = res.body.tokens.refreshToken;
    });

    it('rejects a duplicate registration', async () => {
      const res = await internalRequest(app).post('/auth/register').send({
        email: testEmail,
        password: 'CorrectHorse1',
        firstName: 'E2E',
        lastName: 'Tester',
      });
      expect(res.status).toBe(409);
    });

    it('rejects login with the wrong password', async () => {
      const res = await internalRequest(app).post('/auth/login').send({
        email: testEmail,
        password: 'WrongPassword1',
      });
      expect(res.status).toBe(401);
    });

    it('logs in with the correct password', async () => {
      const res = await internalRequest(app).post('/auth/login').send({
        email: testEmail,
        password: 'CorrectHorse1',
      });
      expect(res.status).toBe(200);
      expect(res.body.tokens.accessToken).toBeDefined();
    });

    it('fetches the current user with the access token', async () => {
      const res = await internalRequest(app)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testEmail.toLowerCase());
    });

    it('rejects a request with a garbage bearer token', async () => {
      const res = await internalRequest(app)
        .get('/users/me')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('rotates the refresh token and the old one can no longer be used', async () => {
      const rotateRes = await internalRequest(app).post('/auth/refresh').send({ refreshToken });
      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.accessToken).toBeDefined();
      const newRefreshToken = rotateRes.body.refreshToken;
      expect(newRefreshToken).not.toBe(refreshToken);

      // Reusing the rotated-out token is a reuse attempt.
      const reuseRes = await internalRequest(app).post('/auth/refresh').send({ refreshToken });
      expect(reuseRes.status).toBe(401);

      // Reuse detection revokes the whole family — even the freshly-issued child is now dead.
      const childRes = await internalRequest(app)
        .post('/auth/refresh')
        .send({ refreshToken: newRefreshToken });
      expect(childRes.status).toBe(401);
    });

    it('logout revokes the refresh token family', async () => {
      const loginRes = await internalRequest(app).post('/auth/login').send({
        email: testEmail,
        password: 'CorrectHorse1',
      });
      const freshRefreshToken = loginRes.body.tokens.refreshToken;

      const logoutRes = await internalRequest(app).post('/auth/logout').send({
        refreshToken: freshRefreshToken,
      });
      expect(logoutRes.status).toBe(204);

      const refreshAfterLogout = await internalRequest(app)
        .post('/auth/refresh')
        .send({ refreshToken: freshRefreshToken });
      expect(refreshAfterLogout.status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated auth requests past the configured limit', async () => {
      const attempts = Array.from({ length: 15 }, () =>
        internalRequest(app).post('/auth/login').send({ email: 'nope@example.com', password: 'x' }),
      );
      const results = await Promise.all(attempts);
      expect(results.some((r) => r.status === 429)).toBe(true);
    });
  });
});
