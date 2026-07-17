/**
 * Central catalogue of domain events emitted via EventEmitter2. The
 * Notifications module (Phase 8) subscribes to these rather than each
 * feature module reaching into NotificationsService directly — keeps module
 * boundaries clean (no cross-module reach-arounds).
 */
export enum DomainEvent {
  ORDER_PAID = 'order.paid',
  MODIFICATION_PAID = 'modification.paid',
  MODIFICATION_STATUS_CHANGED = 'modification.status_changed',
  MODIFICATION_COMMENT_ADDED = 'modification.comment_added',
  MEETING_BOOKED = 'meeting.booked',
  MEETING_CONFIRMED = 'meeting.confirmed',
  MEETING_CANCELLED = 'meeting.cancelled',
  PAYMENT_LINK_PAID = 'payment_link.paid',
  REFERRAL_REWARDED = 'referral.rewarded',
}

export interface OrderPaidPayload {
  orderId: string;
  userId: string;
  designId: string;
  designTitle: string;
  amountCents: number;
}

export interface ModificationPaidPayload {
  modificationId: string;
  userId: string;
  designId: string;
  designTitle: string;
  totalAmountCents: number;
}

export interface ModificationStatusChangedPayload {
  modificationId: string;
  userId: string;
  fromStatus: string;
  toStatus: string;
  comment?: string;
}

export interface ModificationCommentAddedPayload {
  modificationId: string;
  userId: string;
  authorId: string;
  isAdminAuthor: boolean;
  comment: string;
}

export interface MeetingBookedPayload {
  meetingId: string;
  userId: string;
  scheduledAt: string;
  modificationId?: string;
}

export interface MeetingConfirmedPayload {
  meetingId: string;
  userId: string;
  scheduledAt: string;
  link: string;
}

export interface MeetingCancelledPayload {
  meetingId: string;
  userId: string;
}

export interface PaymentLinkPaidPayload {
  paymentLinkId: string;
  clientId?: string;
  clientEmail: string;
  description: string;
  amountCents: number;
}

export interface ReferralRewardedPayload {
  referralId: string;
  referrerId: string;
  referredEmail: string;
  rewardCents: number;
}
