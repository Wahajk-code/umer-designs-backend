import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MeetingStatus, Role } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { internalRequest } from './utils/internal-request';

describe('Meetings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `e2e-meetings-admin-${Date.now()}@example.com`;
  const userEmail = `e2e-meetings-user-${Date.now()}@example.com`;
  let adminAccessToken: string;
  let userAccessToken: string;
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
    await prisma.meeting.deleteMany({ where: { user: { email: userEmail } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('rejects an unauthenticated meeting request', async () => {
    const res = await internalRequest(app).post('/meetings').send({ scheduledAt: future });
    expect(res.status).toBe(401);
  });

  it('rejects a meeting time in the past', async () => {
    const res = await internalRequest(app)
      .post('/meetings')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ scheduledAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(res.status).toBe(400);
  });

  let meetingId: string;

  it('lets a logged-in user book a meeting', async () => {
    const res = await internalRequest(app)
      .post('/meetings')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ scheduledAt: future, notes: 'Discuss the layout' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(MeetingStatus.REQUESTED);
    meetingId = res.body.id;
  });

  it('shows the meeting in the user’s own list', async () => {
    const res = await internalRequest(app)
      .get('/meetings/me')
      .set('Authorization', `Bearer ${userAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((m: { id: string }) => m.id === meetingId)).toBe(true);
  });

  it('rejects a non-admin confirming a meeting', async () => {
    const res = await internalRequest(app)
      .patch(`/admin/meetings/${meetingId}/confirm`)
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ link: 'https://meet.example/room' });
    expect(res.status).toBe(403);
  });

  it('lets an admin confirm the meeting with a link', async () => {
    const res = await internalRequest(app)
      .patch(`/admin/meetings/${meetingId}/confirm`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ link: 'https://meet.example/room' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(MeetingStatus.CONFIRMED);
    expect(res.body.link).toBe('https://meet.example/room');
  });

  it('lets an admin list all meetings', async () => {
    const res = await internalRequest(app)
      .get('/admin/meetings')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meetings.some((m: { id: string }) => m.id === meetingId)).toBe(true);
  });

  it('lets an admin cancel a meeting', async () => {
    const res = await internalRequest(app)
      .patch(`/admin/meetings/${meetingId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(MeetingStatus.CANCELLED);
  });
});
