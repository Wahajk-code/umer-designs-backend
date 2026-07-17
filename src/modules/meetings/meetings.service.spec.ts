import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MeetingStatus } from '@prisma/client';
import { MeetingsService } from '@/modules/meetings/meetings.service';
import { DomainEvent } from '@/common/events/domain-events';

describe('MeetingsService', () => {
  let service: MeetingsService;
  let prisma: {
    meeting: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    modification: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let events: jest.Mocked<Pick<EventEmitter2, 'emit'>>;

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    prisma = {
      meeting: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      modification: { findUnique: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    events = { emit: jest.fn() };
    service = new MeetingsService(prisma as any, events as any);
  });

  describe('create', () => {
    it('rejects a meeting time in the past', async () => {
      await expect(service.create('u1', { scheduledAt: past })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects booking a meeting against a modification the user does not own', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'someone-else' });
      await expect(
        service.create('u1', { scheduledAt: future, modificationId: 'mod-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a meeting and emits MEETING_BOOKED', async () => {
      prisma.meeting.create.mockResolvedValue({
        id: 'meeting-1',
        scheduledAt: new Date(future),
      });

      await service.create('u1', { scheduledAt: future, notes: 'Discuss layout' });

      expect(prisma.meeting.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          modificationId: undefined,
          scheduledAt: new Date(future),
          notes: 'Discuss layout',
        },
      });
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.MEETING_BOOKED,
        expect.objectContaining({ meetingId: 'meeting-1', userId: 'u1' }),
      );
    });

    it('allows booking against a modification the user owns', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'u1' });
      prisma.meeting.create.mockResolvedValue({ id: 'meeting-1', scheduledAt: new Date(future) });

      await service.create('u1', { scheduledAt: future, modificationId: 'mod-1' });

      expect(prisma.meeting.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ modificationId: 'mod-1' }) }),
      );
    });
  });

  describe('confirm', () => {
    it('throws 404 for an unknown meeting', async () => {
      prisma.meeting.findUnique.mockResolvedValue(null);
      await expect(service.confirm('missing', { link: 'https://meet.example/x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets status CONFIRMED and stores the link, emitting MEETING_CONFIRMED', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ id: 'meeting-1', userId: 'u1' });
      prisma.meeting.update.mockResolvedValue({
        id: 'meeting-1',
        status: MeetingStatus.CONFIRMED,
        scheduledAt: new Date(future),
      });

      await service.confirm('meeting-1', { link: 'https://meet.example/x' });

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { status: MeetingStatus.CONFIRMED, link: 'https://meet.example/x' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.MEETING_CONFIRMED,
        expect.objectContaining({ meetingId: 'meeting-1', link: 'https://meet.example/x' }),
      );
    });
  });

  describe('cancel', () => {
    it('sets status CANCELLED and emits MEETING_CANCELLED', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ id: 'meeting-1', userId: 'u1' });
      prisma.meeting.update.mockResolvedValue({ id: 'meeting-1', status: MeetingStatus.CANCELLED });

      await service.cancel('meeting-1');

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { status: MeetingStatus.CANCELLED },
      });
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.MEETING_CANCELLED,
        expect.objectContaining({ meetingId: 'meeting-1' }),
      );
    });
  });
});
