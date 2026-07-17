import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { ModificationStatus, NotificationType } from '@prisma/client';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { MailService } from '@/modules/mail/mail.service';
import { renderEmail } from '@/modules/mail/email-template';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AppConfig } from '@/config/configuration';
import {
  DomainEvent,
  MeetingBookedPayload,
  MeetingCancelledPayload,
  MeetingConfirmedPayload,
  ModificationPaidPayload,
  ModificationStatusChangedPayload,
  OrderPaidPayload,
  PaymentLinkPaidPayload,
  ReferralRewardedPayload,
} from '@/common/events/domain-events';

/**
 * Translates domain events (emitted by Orders/Modifications/Meetings) into
 * in-app notifications + email. Kept separate from those modules so they
 * never depend on NotificationsService directly — no cross-module
 * reach-arounds, just events.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get origin(): string {
    return this.config.get('corsAllowedOrigin', { infer: true });
  }

  @OnEvent(DomainEvent.ORDER_PAID)
  async onOrderPaid(payload: OrderPaidPayload): Promise<void> {
    await this.notifications.notify(
      payload.userId,
      NotificationType.ORDER_CONFIRMED,
      {
        orderId: payload.orderId,
        designTitle: payload.designTitle,
        amountCents: payload.amountCents,
      },
      {
        subject: `Order confirmed — ${payload.designTitle}`,
        heading: 'Your order is confirmed',
        body: `Thanks for buying ${payload.designTitle}. Your files are ready in your account, yours to re-download any time.`,
        ctaLabel: 'View your designs',
        ctaUrl: `${this.origin}/dashboard`,
      },
    );
  }

  @OnEvent(DomainEvent.MODIFICATION_PAID)
  async onModificationPaid(payload: ModificationPaidPayload): Promise<void> {
    await this.notifications.notify(
      payload.userId,
      NotificationType.PAYMENT_RECEIVED,
      {
        modificationId: payload.modificationId,
        designTitle: payload.designTitle,
        totalAmountCents: payload.totalAmountCents,
      },
      {
        subject: `Payment received — ${payload.designTitle} modification`,
        heading: 'Payment received — work is starting',
        body: `We've received your payment for changes to ${payload.designTitle}. Track progress and message the architect from your request page.`,
        ctaLabel: 'View tracking',
        ctaUrl: `${this.origin}/modifications/${payload.modificationId}`,
      },
    );

    if (this.config.get('adminNotifyEmail', { infer: true })) {
      const { html, text } = renderEmail({
        heading: 'New paid modification request',
        body: `A client just paid for changes to ${payload.designTitle}. Open the admin queue to review it.`,
        ctaLabel: 'Open admin queue',
        ctaUrl: `${this.origin}/admin/modifications/${payload.modificationId}`,
      });
      await this.mail.send({
        to: this.config.get('adminNotifyEmail', { infer: true }),
        subject: `New modification request — ${payload.designTitle}`,
        html,
        text,
      });
    }
  }

  @OnEvent(DomainEvent.MODIFICATION_STATUS_CHANGED)
  async onModificationStatusChanged(payload: ModificationStatusChangedPayload): Promise<void> {
    const modification = await this.prisma.modification.findUnique({
      where: { id: payload.modificationId },
      include: { design: true },
    });
    if (!modification) {
      this.logger.warn(`Status-changed event for unknown modification ${payload.modificationId}`);
      return;
    }

    const isDelivered = payload.toStatus === ModificationStatus.DELIVERED;
    const type = isDelivered ? NotificationType.DELIVERY_COMPLETE : NotificationType.STATUS_CHANGE;
    const stageLabel = payload.toStatus.replace('_', ' ').toLowerCase();

    await this.notifications.notify(
      payload.userId,
      type,
      { modificationId: payload.modificationId, toStatus: payload.toStatus },
      {
        subject: isDelivered
          ? `Delivered — ${modification.design.title}`
          : `Update on your request — ${modification.design.title}`,
        heading: isDelivered ? 'Your files are ready' : `Now: ${stageLabel}`,
        body: isDelivered
          ? `Your modified plans for ${modification.design.title} are ready to download from your request page.`
          : `Your request for ${modification.design.title} has moved to "${stageLabel}".${payload.comment ? ` Note from the architect: ${payload.comment}` : ''}`,
        ctaLabel: 'View tracking',
        ctaUrl: `${this.origin}/modifications/${payload.modificationId}`,
      },
    );
  }

  @OnEvent(DomainEvent.MEETING_BOOKED)
  async onMeetingBooked(payload: MeetingBookedPayload): Promise<void> {
    await this.notifications.notify(
      payload.userId,
      NotificationType.MEETING_BOOKED,
      { meetingId: payload.meetingId, status: 'REQUESTED', scheduledAt: payload.scheduledAt },
      {
        subject: 'Meeting request received',
        heading: 'Request sent',
        body: `We've got your request for ${new Date(payload.scheduledAt).toLocaleString()}. We confirm by email once the architect accepts a time.`,
      },
    );

    const adminEmail = this.config.get('adminNotifyEmail', { infer: true });
    if (adminEmail) {
      const { html, text } = renderEmail({
        heading: 'New meeting request',
        body: `A client requested a meeting for ${new Date(payload.scheduledAt).toLocaleString()}.`,
        ctaLabel: 'Open admin meetings',
        ctaUrl: `${this.origin}/admin/meetings`,
      });
      await this.mail.send({ to: adminEmail, subject: 'New meeting request', html, text });
    }
  }

  @OnEvent(DomainEvent.MEETING_CONFIRMED)
  async onMeetingConfirmed(payload: MeetingConfirmedPayload): Promise<void> {
    await this.notifications.notify(
      payload.userId,
      NotificationType.MEETING_BOOKED,
      {
        meetingId: payload.meetingId,
        status: 'CONFIRMED',
        scheduledAt: payload.scheduledAt,
        link: payload.link,
      },
      {
        subject: 'Meeting confirmed',
        heading: 'You’re confirmed',
        body: `Your meeting for ${new Date(payload.scheduledAt).toLocaleString()} is confirmed. Both of us have the invite.`,
        ctaLabel: 'Join link',
        ctaUrl: payload.link,
      },
    );
  }

  @OnEvent(DomainEvent.MEETING_CANCELLED)
  async onMeetingCancelled(payload: MeetingCancelledPayload): Promise<void> {
    await this.notifications.notify(
      payload.userId,
      NotificationType.MEETING_BOOKED,
      { meetingId: payload.meetingId, status: 'CANCELLED' },
      {
        subject: 'Meeting cancelled',
        heading: 'Meeting cancelled',
        body: 'Your meeting request has been cancelled. Book a new time whenever works for you.',
        ctaLabel: 'Schedule a meeting',
        ctaUrl: `${this.origin}/schedule-a-meeting`,
      },
    );
  }

  @OnEvent(DomainEvent.PAYMENT_LINK_PAID)
  async onPaymentLinkPaid(payload: PaymentLinkPaidPayload): Promise<void> {
    if (payload.clientId) {
      await this.notifications.notify(
        payload.clientId,
        NotificationType.PAYMENT_RECEIVED,
        {
          paymentLinkId: payload.paymentLinkId,
          description: payload.description,
          amountCents: payload.amountCents,
        },
        {
          subject: `Payment received — ${payload.description}`,
          heading: 'Payment received',
          body: `Thanks — your payment for "${payload.description}" is confirmed.`,
        },
      );
    } else {
      // No account on file: send the receipt directly rather than through the in-app notification system.
      const { html, text } = renderEmail({
        heading: 'Payment received',
        body: `Thanks — your payment for "${payload.description}" is confirmed.`,
      });
      await this.mail.send({
        to: payload.clientEmail,
        subject: `Payment received — ${payload.description}`,
        html,
        text,
      });
    }

    const adminEmail = this.config.get('adminNotifyEmail', { infer: true });
    if (adminEmail) {
      const { html, text } = renderEmail({
        heading: 'Payment link paid',
        body: `${payload.clientEmail} just paid ${(payload.amountCents / 100).toFixed(2)} USD for "${payload.description}".`,
        ctaLabel: 'Open admin payment links',
        ctaUrl: `${this.origin}/admin/payment-links`,
      });
      await this.mail.send({ to: adminEmail, subject: 'Payment link paid', html, text });
    }
  }

  @OnEvent(DomainEvent.REFERRAL_REWARDED)
  async onReferralRewarded(payload: ReferralRewardedPayload): Promise<void> {
    const amount = (payload.rewardCents / 100).toFixed(0);
    await this.notifications.notify(
      payload.referrerId,
      NotificationType.REFERRAL_REWARDED,
      { referralId: payload.referralId, rewardCents: payload.rewardCents },
      {
        subject: `You earned $${amount} in referral credit`,
        heading: `$${amount} earned`,
        body: `Someone you referred just made their first purchase — $${amount} credit is now yours.`,
        ctaLabel: 'View referrals',
        ctaUrl: `${this.origin}/dashboard`,
      },
    );
  }
}
