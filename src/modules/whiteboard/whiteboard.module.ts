import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WhiteboardService } from '@/modules/whiteboard/whiteboard.service';
import { WhiteboardGateway } from '@/modules/whiteboard/whiteboard.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [WhiteboardService, WhiteboardGateway],
})
export class WhiteboardModule {}
