import { Injectable } from '@nestjs/common';
import { Prisma, WhiteboardSession } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class WhiteboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateSession(modificationId: string): Promise<WhiteboardSession> {
    const existing = await this.prisma.whiteboardSession.findFirst({ where: { modificationId } });
    if (existing) {
      return existing;
    }
    return this.prisma.whiteboardSession.create({ data: { modificationId } });
  }

  async getLatestSnapshotData(sessionId: string): Promise<Prisma.JsonValue | null> {
    const snapshot = await this.prisma.whiteboardSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    return snapshot?.data ?? null;
  }

  async saveSnapshot(
    sessionId: string,
    authorId: string | undefined,
    data: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.whiteboardSnapshot.create({
      data: { sessionId, authorId, data },
    });
  }
}
