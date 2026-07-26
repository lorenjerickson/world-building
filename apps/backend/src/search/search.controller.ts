import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentRuleActor, RuleApiActor, RuleApiActorGuard } from '../rules/api/rule-api-actor';
import { SearchService } from './search.service';

@Controller('api/search')
@UseGuards(RuleApiActorGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@CurrentRuleActor() actor: RuleApiActor, @Query('q') query = '') {
    return this.searchService.search(actor.auth0Subject, query);
  }

  @Post('index')
  index(
    @CurrentRuleActor() actor: RuleApiActor,
    @Body() body: { documents?: unknown },
  ) {
    return this.searchService.replaceActorIndex(actor.auth0Subject, body?.documents);
  }
}
