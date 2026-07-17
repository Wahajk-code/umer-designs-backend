import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ReplayCacheService } from '@/common/security/replay-cache.service';
import { verifyInternalAttestation } from '@/common/security/internal-signature.util';
import { AppConfig } from '@/config/configuration';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { WhiteboardService } from '@/modules/whiteboard/whiteboard.service';

/**
 * Fixed canonical method/path for the internal attestation signature on this
 * channel — unlike HTTP routes, a raw WS handshake has no clean per-route
 * path to bind to on both sides, so the BFF and this gateway simply agree on
 * one constant string rather than deriving it from the live request.
 */
const WS_ATTESTATION_METHOD = 'GET';
const WS_ATTESTATION_PATH = '/socket.io';

interface SocketData {
  user: AuthenticatedUser;
  modificationId: string;
  room: string;
}

function roomFor(modificationId: string): string {
  return `modification:${modificationId}`;
}

@WebSocketGateway({
  path: '/socket.io',
  cors: false,
})
export class WhiteboardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(WhiteboardGateway.name);
  private readonly sessionsBySocketId = new Map<string, SocketData>();

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly replayCache: ReplayCacheService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly whiteboardService: WhiteboardService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = this.authenticate(client);
      const modificationId = this.readModificationId(client);
      await this.authorizeModificationAccess(user, modificationId);

      const room = roomFor(modificationId);
      this.sessionsBySocketId.set(client.id, { user, modificationId, room });
      await client.join(room);

      const session = await this.whiteboardService.getOrCreateSession(modificationId);
      const data = await this.whiteboardService.getLatestSnapshotData(session.id);
      client.emit('whiteboard:sync', { data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection rejected.';
      this.logger.warn(`Rejecting whiteboard connection ${client.id}: ${message}`);
      client.emit('whiteboard:error', { message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.sessionsBySocketId.delete(client.id);
  }

  @SubscribeMessage('whiteboard:update')
  async handleUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { data: unknown },
  ): Promise<void> {
    const session = this.sessionsBySocketId.get(client.id);
    if (!session) return;

    client.to(session.room).emit('whiteboard:update', { data: body.data });

    const wbSession = await this.whiteboardService.getOrCreateSession(session.modificationId);
    await this.whiteboardService.saveSnapshot(wbSession.id, session.user.sub, body.data as never);
  }

  @SubscribeMessage('whiteboard:clear')
  async handleClear(@ConnectedSocket() client: Socket): Promise<void> {
    const session = this.sessionsBySocketId.get(client.id);
    if (!session) return;

    client.to(session.room).emit('whiteboard:update', { data: { strokes: [] } });

    const wbSession = await this.whiteboardService.getOrCreateSession(session.modificationId);
    await this.whiteboardService.saveSnapshot(wbSession.id, session.user.sub, { strokes: [] });
  }

  private authenticate(client: Socket): AuthenticatedUser {
    const headers = client.handshake.headers;
    const internalConfig = this.config.get('internal', { infer: true });

    const attestation = verifyInternalAttestation(
      {
        timestamp: headerValue(headers['x-internal-timestamp']),
        nonce: headerValue(headers['x-internal-nonce']),
        signature: headerValue(headers['x-internal-signature']),
        method: WS_ATTESTATION_METHOD,
        path: WS_ATTESTATION_PATH,
      },
      internalConfig.hmacSecret,
      internalConfig.windowMs,
      this.replayCache,
    );
    if (!attestation.ok) {
      throw new Error(attestation.reason);
    }

    const accessToken = headerValue(headers['x-access-token']);
    if (!accessToken) {
      throw new Error('Missing access token.');
    }

    const jwtConfig = this.config.get('jwt', { infer: true });
    try {
      return this.jwt.verify<AuthenticatedUser>(accessToken, { secret: jwtConfig.accessSecret });
    } catch {
      throw new Error('Invalid or expired access token.');
    }
  }

  private readModificationId(client: Socket): string {
    const raw = client.handshake.query.modificationId;
    const modificationId = Array.isArray(raw) ? raw[0] : raw;
    if (!modificationId) {
      throw new Error('Missing modificationId.');
    }
    return modificationId;
  }

  private async authorizeModificationAccess(
    user: AuthenticatedUser,
    modificationId: string,
  ): Promise<void> {
    const modification = await this.prisma.modification.findUnique({
      where: { id: modificationId },
    });
    if (!modification || (modification.userId !== user.sub && user.role !== 'ADMIN')) {
      throw new Error('You do not have access to this whiteboard.');
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
