import { Module } from '@nestjs/common';
import { RuleApiActorGuard } from '../rules/api/rule-api-actor';
import { CmsAdminController } from './cms-admin.controller';
import { CmsAdminSessionService } from './cms-admin-session.service';
import { ContentRepository } from './content.repository';
import { PayloadContentRepository } from './payload-content.repository';

@Module({
  controllers: [CmsAdminController],
  exports: [ContentRepository],
  providers: [
    CmsAdminSessionService,
    RuleApiActorGuard,
    PayloadContentRepository,
    {
      provide: ContentRepository,
      useExisting: PayloadContentRepository,
    },
  ],
})
export class CmsModule {}
