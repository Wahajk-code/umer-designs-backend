import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { MailService } from '@/modules/mail/mail.service';
import { renderEmail } from '@/modules/mail/email-template';

export interface EmailContent {
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Always creates the in-app notification. Email is best-effort on top —
   * a down/unconfigured SMTP provider never prevents the in-app record.
   */
  async notify(
    userId: string,
    type: NotificationType,
    payload: Prisma.InputJsonValue,
    email?: EmailContent,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: { userId, type, payload },
    });

    if (!email) {
      return notification;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return notification;
    }

    const { html, text } = renderEmail({
      heading: email.heading,
      body: email.body,
      ctaLabel: email.ctaLabel,
      ctaUrl: email.ctaUrl,
    });
    const sent = await this.mail.send({ to: user.email, subject: email.subject, html, text });

    if (sent) {
      return this.prisma.notification.update({
        where: { id: notification.id },
        data: { sentViaEmail: true },
      });
    }
    return notification;
  }

  async listMine(
    userId: string,
    unreadOnly: boolean,
    page: number,
    pageSize: number,
  ): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [notifications, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { notifications, total, unreadCount };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found.');
    }
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
