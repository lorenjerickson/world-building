import { Module } from '@nestjs/common';
import { RuleApiActorGuard } from './api/rule-api-actor';
import { RuleSetsController } from './api/rule-sets.controller';
import { RuleAuthoringController } from './api/rule-authoring.controller';
import { RuleAuthoringService } from './api/rule-authoring.service';
import { RuleApiIdPipe } from './api/rule-api-validation';
import { PayloadRuleCatalogRepository } from './catalog/payload-rule-catalog.repository';
import { RuleCatalogRepository } from './catalog/rule-catalog.repository';
import { RuleSetCatalogService } from './catalog/rule-set-catalog.service';

@Module({
  controllers: [RuleSetsController, RuleAuthoringController],
  exports: [RuleApiActorGuard],
  providers: [
    RuleApiActorGuard,
    RuleApiIdPipe,
    RuleAuthoringService,
    RuleSetCatalogService,
    PayloadRuleCatalogRepository,
    {
      provide: RuleCatalogRepository,
      useExisting: PayloadRuleCatalogRepository,
    },
  ],
})
export class RulesModule {}
