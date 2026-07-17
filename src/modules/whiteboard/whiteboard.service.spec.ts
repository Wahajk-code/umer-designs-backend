import { WhiteboardService } from '@/modules/whiteboard/whiteboard.service';

describe('WhiteboardService', () => {
  let service: WhiteboardService;
  let prisma: {
    whiteboardSession: { findFirst: jest.Mock; create: jest.Mock };
    whiteboardSnapshot: { findFirst: jest.Mock; create: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      whiteboardSession: { findFirst: jest.fn(), create: jest.fn() },
      whiteboardSnapshot: { findFirst: jest.fn(), create: jest.fn() },
    };
    service = new WhiteboardService(prisma as any);
  });

  it('reuses an existing session for a modification instead of creating a duplicate', async () => {
    prisma.whiteboardSession.findFirst.mockResolvedValue({ id: 'session-1' });
    const session = await service.getOrCreateSession('mod-1');
    expect(session.id).toBe('session-1');
    expect(prisma.whiteboardSession.create).not.toHaveBeenCalled();
  });

  it('creates a session on first access', async () => {
    prisma.whiteboardSession.findFirst.mockResolvedValue(null);
    prisma.whiteboardSession.create.mockResolvedValue({ id: 'session-new' });
    const session = await service.getOrCreateSession('mod-1');
    expect(session.id).toBe('session-new');
  });

  it('returns null latest snapshot data when nothing has been saved yet', async () => {
    prisma.whiteboardSnapshot.findFirst.mockResolvedValue(null);
    const data = await service.getLatestSnapshotData('session-1');
    expect(data).toBeNull();
  });

  it('returns the most recent snapshot data', async () => {
    prisma.whiteboardSnapshot.findFirst.mockResolvedValue({ data: { strokes: [{ x: 1 }] } });
    const data = await service.getLatestSnapshotData('session-1');
    expect(data).toEqual({ strokes: [{ x: 1 }] });
    expect(prisma.whiteboardSnapshot.findFirst).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('saveSnapshot persists author + data against the session', async () => {
    prisma.whiteboardSnapshot.create.mockResolvedValue({});
    await service.saveSnapshot('session-1', 'user-1', { strokes: [] } as any);
    expect(prisma.whiteboardSnapshot.create).toHaveBeenCalledWith({
      data: { sessionId: 'session-1', authorId: 'user-1', data: { strokes: [] } },
    });
  });
});
