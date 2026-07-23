import { Module } from '@nestjs/common';
import { RuleApiActorGuard } from '../rules/api/rule-api-actor';
import { EncounterMapsController } from './encounter-maps.controller';
import { PayloadEncounterMapRepository } from './payload-encounter-map.repository';

@Module({
  controllers: [EncounterMapsController],
  providers: [RuleApiActorGuard, PayloadEncounterMapRepository],
})
export class EncountersModule {}
