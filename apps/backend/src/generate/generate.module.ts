import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';
import { GraphModule } from '../graph/graph.module';
import { LlmModule } from '../llm/llm.module';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [
    GraphModule,
    LlmModule,
    RulesModule,
  ],
  controllers: [GenerateController],
  providers: [GenerateService],
})
export class GenerateModule {}
