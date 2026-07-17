import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { MailService } from '@/modules/mail/mail.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let mail: jest.Mocked<Pick<MailService, 'send'>>;

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    mail = { send: jest.fn().mockResolvedValue(true) };
    service = new NotificationsService(prisma as any, mail as any);
  });

  describe('notify', () => {
    it('always creates the in-app notification, even with no email content', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      const result = await service.notify('u1', NotificationType.ORDER_CONFIRMED, {
        orderId: 'o1',
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { userId: 'u1', type: NotificationType.ORDER_CONFIRMED, payload: { orderId: 'o1' } },
      });
      expect(mail.send).not.toHaveBeenCalled();
      expect(result.id).toBe('n1');
    });

    it('sends an email and marks sentViaEmail when email content is provided and the user exists', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.com' });
      prisma.notification.update.mockResolvedValue({ id: 'n1', sentViaEmail: true });

      const result = await service.notify(
        'u1',
        NotificationType.ORDER_CONFIRMED,
        { orderId: 'o1' },
        { subject: 'Hi', heading: 'Hi', body: 'Body' },
      );

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'a@example.com', subject: 'Hi' }),
      );
      expect(result.sentViaEmail).toBe(true);
    });

    it('does not mark sentViaEmail when the send fails', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'n1', sentViaEmail: false });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.com' });
      mail.send.mockResolvedValue(false);

      const result = await service.notify(
        'u1',
        NotificationType.ORDER_CONFIRMED,
        {},
        { subject: 'Hi', heading: 'Hi', body: 'Body' },
      );

      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result.sentViaEmail).toBe(false);
    });
  });

  describe('markRead', () => {
    it('rejects marking another user’s notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'someone-else' });
      await expect(service.markRead('u1', 'n1')).rejects.toThrow(NotFoundException);
    });

    it('marks the owning user’s notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'u1' });
      prisma.notification.update.mockResolvedValue({ id: 'n1', readAt: new Date() });
      const result = await service.markRead('u1', 'n1');
      expect(result.readAt).toBeDefined();
    });
  });

  describe('listMine', () => {
    it('returns notifications, total, and unread count together', async () => {
      prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
      prisma.notification.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

      const result = await service.listMine('u1', false, 1, 20);

      expect(result.total).toBe(5);
      expect(result.unreadCount).toBe(2);
      expect(result.notifications).toHaveLength(1);
    });
  });
});
