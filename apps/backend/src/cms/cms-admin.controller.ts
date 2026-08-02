import { Controller, Post, UseGuards } from '@nestjs/common';

import {
  CurrentRuleActor,
  RuleApiActor,
  RuleApiActorGuard,
} from '../rules/api/rule-api-actor';
import { CmsAdminSessionService } from './cms-admin-session.service';

@Controller('api/cms/admin-session')
@UseGuards(RuleApiActorGuard)
export class CmsAdminController {
  constructor(private readonly sessions: CmsAdminSessionService) {}

  @Post()
  create(@CurrentRuleActor() actor: RuleApiActor): { ticket: string } {
    return { ticket: this.sessions.createTicket(actor) };
  }
}
