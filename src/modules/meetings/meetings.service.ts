import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Meeting, MeetingStatus } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { CreateMeetingDto } from '@/modules/meetings/dto/create-meeting.dto';
import { ConfirmMeetingDto } from '@/modules/meetings/dto/confirm-meeting.dto';
import { ListMeetingsQueryDto } from '@/modules/meetings/dto/list-meetings-query.dto';
import {
  DomainEvent,
  MeetingBookedPayload,
  MeetingCancelledPayload,
  MeetingConfirmedPayload,
} from '@/common/events/domain-events';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateMeetingDto): Promise<Meeting> {
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('Meeting time must be in the future.');
    }

    if (dto.modificationId) {
      const modification = await this.prisma.modification.findUnique({
        where: { id: dto.modificationId },
      });
      if (!modification || modification.userId !== userId) {
        throw new ForbiddenException('You can only book a meeting on your own request.');
      }
    }

    const meeting = await this.prisma.meeting.create({
      data: {
        userId,
        modificationId: dto.modificationId,
        scheduledAt,
        notes: dto.notes,
      },
    });

    const payload: MeetingBookedPayload = {
      meetingId: meeting.id,
      userId,
      scheduledAt: meeting.scheduledAt.toISOString(),
      modificationId: dto.modificationId,
    };
    this.events.emit(DomainEvent.MEETING_BOOKED, payload);

    return meeting;
  }

  listMine(userId: string): Promise<Meeting[]> {
    return this.prisma.meeting.findMany({
      where: { userId },
      include: { modification: { include: { design: true } } },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async listAdmin(query: ListMeetingsQueryDto): Promise<{ meetings: Meeting[]; total: number }> {
    const where = query.status ? { status: query.status } : {};
    const [meetings, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          modification: { include: { design: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.meeting.count({ where }),
    ]);
    return { meetings, total };
  }

  async confirm(id: string, dto: ConfirmMeetingDto): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting) {
      throw new NotFoundException('Meeting not found.');
    }

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: {
        status: MeetingStatus.CONFIRMED,
        link: dto.link,
        ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt) }),
      },
    });

    const payload: MeetingConfirmedPayload = {
      meetingId: id,
      userId: meeting.userId,
      scheduledAt: updated.scheduledAt.toISOString(),
      link: dto.link,
    };
    this.events.emit(DomainEvent.MEETING_CONFIRMED, payload);

    return updated;
  }

  async cancel(id: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting) {
      throw new NotFoundException('Meeting not found.');
    }

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { status: MeetingStatus.CANCELLED },
    });

    const payload: MeetingCancelledPayload = { meetingId: id, userId: meeting.userId };
    this.events.emit(DomainEvent.MEETING_CANCELLED, payload);

    return updated;
  }
}
