import { ConfigService } from '@nestjs/config';
import { ModificationStatus, NotificationType } from '@prisma/client';
import { NotificationsListener } from '@/modules/notifications/notifications.listener';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { MailService } from '@/modules/mail/mail.service';
import { AppConfig } from '@/config/configuration';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let notifications: jest.Mocked<Pick<NotificationsService, 'notify'>>;
  let mail: jest.Mocked<Pick<MailService, 'send'>>;
  let prisma: { modification: { findUnique: jest.Mock }; user: { findMany: jest.Mock; findUnique: jest.Mock } };
  let config: ConfigService<AppConfig, true>;
  let adminEmail = '';

  beforeEach(() => {
    notifications = { notify: jest.fn().mockResolvedValue({}) };
    mail = { send: jest.fn().mockResolvedValue(true) };
    prisma = {
      modification: { findUnique: jest.fn() },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]),
        findUnique: jest.fn().mockResolvedValue({ firstName: 'Sara', lastName: 'Khan', email: 'sara@example.com' }),
      },
    };
    adminEmail = '';
    config = {
      get: (key: string) => {
        if (key === 'corsAllowedOrigin') return 'https://umerdesigns.example';
        if (key === 'adminNotifyEmail') return adminEmail;
        throw new Error(`unexpected key ${key}`);
      },
    } as unknown as ConfigService<AppConfig, true>;

    listener = new NotificationsListener(notifications as any, mail as any, prisma as any, config);
  });

  describe('who gets what', () => {
    const mod = { id: 'm1', userId: 'client-1', design: { title: 'The Meridian' } };

    it('an architect reply notifies the CLIENT (bell + email), not the admins', async () => {
      prisma.modification.findUnique.mockResolvedValue(mod);
      await listener.onModificationCommentAdded({
        modificationId: 'm1',
        userId: 'client-1',
        authorId: 'admin-1',
        isAdminAuthor: true,
        comment: 'Updated the kitchen layout',
      });
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        'client-1',
        NotificationType.STATUS_CHANGE,
        expect.objectContaining({ kind: 'message', modificationId: 'm1' }),
        expect.objectContaining({ ctaUrl: 'https://umerdesigns.example/dashboard/requests/m1' }),
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('a client message notifies every ADMIN in-app and emails ADMIN_NOTIFY_EMAIL — never the client', async () => {
      adminEmail = 'studio@example.com';
      prisma.modification.findUnique.mockResolvedValue(mod);
      await listener.onModificationCommentAdded({
        modificationId: 'm1',
        userId: 'client-1',
        authorId: 'client-1',
        isAdminAuthor: false,
        comment: 'Can we add a skylight?',
      });
      const recipients = notifications.notify.mock.calls.map((c) => c[0]);
      expect(recipients).toEqual(['admin-1', 'admin-2']);
      expect(notifications.notify.mock.calls[0][2]).toEqual(
        expect.objectContaining({ audience: 'admin', clientName: 'Sara Khan', authorName: 'Sara Khan', designTitle: 'The Meridian' }),
      );
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'studio@example.com', subject: 'New message from Sara Khan — The Meridian' }),
      );
    });

    it('a new order also tells the admins', async () => {
      await listener.onOrderPaid({ orderId: 'o1', userId: 'u1', designId: 'd1', designTitle: 'X', amountCents: 100 });
      const recipients = notifications.notify.mock.calls.map((c) => c[0]);
      expect(recipients).toEqual(['u1', 'admin-1', 'admin-2']);
    });
  });

  it('notifies the buyer on ORDER_PAID with type ORDER_CONFIRMED', async () => {
    await listener.onOrderPaid({
      orderId: 'o1',
      userId: 'u1',
      designId: 'd1',
      designTitle: 'The Meridian',
      amountCents: 145000,
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.ORDER_CONFIRMED,
      expect.objectContaining({ orderId: 'o1' }),
      expect.objectContaining({ subject: expect.stringContaining('The Meridian') }),
    );
  });

  it('notifies the user with PAYMENT_RECEIVED on MODIFICATION_PAID and does not email admin when unconfigured', async () => {
    await listener.onModificationPaid({
      modificationId: 'm1',
      userId: 'u1',
      designId: 'd1',
      designTitle: 'The Meridian',
      totalAmountCents: 230000,
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.PAYMENT_RECEIVED,
      expect.anything(),
      expect.anything(),
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('emails admin on MODIFICATION_PAID when ADMIN_NOTIFY_EMAIL is configured', async () => {
    adminEmail = 'admin@umerdesigns.example';
    await listener.onModificationPaid({
      modificationId: 'm1',
      userId: 'u1',
      designId: 'd1',
      designTitle: 'The Meridian',
      totalAmountCents: 230000,
    });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@umerdesigns.example' }),
    );
  });

  it('uses DELIVERY_COMPLETE (not STATUS_CHANGE) when the new status is DELIVERED', async () => {
    prisma.modification.findUnique.mockResolvedValue({
      id: 'm1',
      design: { title: 'The Meridian' },
    });

    await listener.onModificationStatusChanged({
      modificationId: 'm1',
      userId: 'u1',
      fromStatus: 'IN_PROGRESS',
      toStatus: ModificationStatus.DELIVERED,
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.DELIVERY_COMPLETE,
      expect.anything(),
      expect.anything(),
    );
  });

  it('uses STATUS_CHANGE for any non-terminal transition', async () => {
    prisma.modification.findUnique.mockResolvedValue({
      id: 'm1',
      design: { title: 'The Meridian' },
    });

    await listener.onModificationStatusChanged({
      modificationId: 'm1',
      userId: 'u1',
      fromStatus: 'SUBMITTED',
      toStatus: ModificationStatus.IN_REVIEW,
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.STATUS_CHANGE,
      expect.anything(),
      expect.anything(),
    );
  });

  it('does nothing (does not throw) for a status change on an unknown modification', async () => {
    prisma.modification.findUnique.mockResolvedValue(null);
    await listener.onModificationStatusChanged({
      modificationId: 'missing',
      userId: 'u1',
      fromStatus: 'SUBMITTED',
      toStatus: ModificationStatus.IN_REVIEW,
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('notifies the user on MEETING_BOOKED and only emails admin when configured', async () => {
    await listener.onMeetingBooked({
      meetingId: 'meet1',
      userId: 'u1',
      scheduledAt: new Date().toISOString(),
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.MEETING_BOOKED,
      expect.objectContaining({ status: 'REQUESTED' }),
      expect.anything(),
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('notifies the user on MEETING_CONFIRMED with the link as the CTA', async () => {
    await listener.onMeetingConfirmed({
      meetingId: 'meet1',
      userId: 'u1',
      scheduledAt: new Date().toISOString(),
      link: 'https://meet.example/room',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.MEETING_BOOKED,
      expect.objectContaining({ status: 'CONFIRMED', link: 'https://meet.example/room' }),
      expect.objectContaining({ ctaUrl: 'https://meet.example/room' }),
    );
  });

  it('notifies the user on MEETING_CANCELLED', async () => {
    await listener.onMeetingCancelled({ meetingId: 'meet1', userId: 'u1' });
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.MEETING_BOOKED,
      expect.objectContaining({ status: 'CANCELLED' }),
      expect.anything(),
    );
  });
});
