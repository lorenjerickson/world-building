import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RulesModule } from '../rules/rules.module';
import { WorldEntityAiService } from './world-entity-ai.service';
import { WorldsController } from './worlds.controller';
import { WorldsService } from './worlds.service';

@Module({
  imports: [RulesModule, LlmModule],
  controllers: [WorldsController],
  providers: [WorldsService, WorldEntityAiService],
})
export class WorldsModule {}
