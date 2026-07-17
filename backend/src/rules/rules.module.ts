import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RuleApiActorGuard } from './api/rule-api-actor';
import { RuleSetsController } from './api/rule-sets.controller';
import { RuleAuthoringController } from './api/rule-authoring.controller';
import { RuleAuthoringService } from './api/rule-authoring.service';
import { RuleApiIdPipe } from './api/rule-api-validation';
import { RuleAssistantService } from './assistant/rule-assistant.service';
import { PayloadRuleCatalogRepository } from './catalog/payload-rule-catalog.repository';
import { RuleCatalogRepository } from './catalog/rule-catalog.repository';
import { RuleDefinitionSnapshotService } from './catalog/rule-definition-snapshot.service';
import { RuleSetCatalogService } from './catalog/rule-set-catalog.service';

@Module({
  imports: [LlmModule],
  controllers: [RuleSetsController, RuleAuthoringController],
  exports: [RuleApiActorGuard],
  providers: [
    RuleApiActorGuard,
    RuleApiIdPipe,
    RuleAssistantService,
    RuleAuthoringService,
    RuleDefinitionSnapshotService,
    RuleSetCatalogService,
    PayloadRuleCatalogRepository,
    {
      provide: RuleCatalogRepository,
      useExisting: PayloadRuleCatalogRepository,
    },
  ],
})
export class RulesModule {}
