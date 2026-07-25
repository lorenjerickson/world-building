import { Module } from '@nestjs/common';
import { RealtimeAuthService } from './realtime-auth.service';
import { SessionGateway } from './session.gateway';

@Module({
  providers: [RealtimeAuthService, SessionGateway],
  exports: [SessionGateway],
})
export class RealtimeModule {}