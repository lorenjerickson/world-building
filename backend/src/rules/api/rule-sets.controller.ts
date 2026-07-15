import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { RuleSetCatalogService } from '../catalog/rule-set-catalog.service';
import { CurrentRuleActor, RuleApiActor, RuleApiActorGuard } from './rule-api-actor';
import { RuleApiIdPipe, ruleApiValidationPipe } from './rule-api-validation';
import {
  CloneRuleDefinitionDto,
  CreateRuleDefinitionDto,
  CreateRuleModuleDto,
  CreateRuleSetDto,
  ListRuleDefinitionsQueryDto,
  ListRuleSetsQueryDto,
  UpdateRuleDefinitionDto,
  UpdateRuleModuleDto,
  UpdateRuleSetDto,
} from './rule-set.dto';

@Controller('api/rule-sets')
@UseGuards(RuleApiActorGuard)
@UsePipes(ruleApiValidationPipe)
export class RuleSetsController {
  constructor(private readonly catalog: RuleSetCatalogService) {}

  @Get()
  list(@CurrentRuleActor() actor: RuleApiActor, @Query() query: ListRuleSetsQueryDto) {
    return this.catalog.list(actor, query);
  }

  @Post()
  create(@CurrentRuleActor() actor: RuleApiActor, @Body() dto: CreateRuleSetDto) {
    return this.catalog.create(actor, dto);
  }

  @Get(':ruleSetId')
  get(@CurrentRuleActor() actor: RuleApiActor, @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number) {
    return this.catalog.get(actor, ruleSetId);
  }

  @Patch(':ruleSetId')
  update(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Body() dto: UpdateRuleSetDto,
  ) {
    return this.catalog.update(actor, ruleSetId, dto);
  }

  @Delete(':ruleSetId')
  delete(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Query('expectedUpdatedAt') expectedUpdatedAt: string,
  ) {
    return this.catalog.delete(actor, ruleSetId, expectedUpdatedAt);
  }

  @Get(':ruleSetId/modules')
  listModules(@CurrentRuleActor() actor: RuleApiActor, @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number) {
    return this.catalog.listModules(actor, ruleSetId);
  }

  @Post(':ruleSetId/modules')
  createModule(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Body() dto: CreateRuleModuleDto,
  ) {
    return this.catalog.createModule(actor, ruleSetId, dto);
  }

  @Patch(':ruleSetId/modules/:moduleId')
  updateModule(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Param('moduleId', RuleApiIdPipe) moduleId: number,
    @Body() dto: UpdateRuleModuleDto,
  ) {
    return this.catalog.updateModule(actor, ruleSetId, moduleId, dto);
  }

  @Delete(':ruleSetId/modules/:moduleId')
  deleteModule(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Param('moduleId', RuleApiIdPipe) moduleId: number,
    @Query('expectedUpdatedAt') expectedUpdatedAt: string,
  ) {
    return this.catalog.deleteModule(actor, ruleSetId, moduleId, expectedUpdatedAt);
  }

  @Get(':ruleSetId/definitions')
  listDefinitions(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Query() query: ListRuleDefinitionsQueryDto,
  ) {
    return this.catalog.listDefinitions(actor, ruleSetId, query);
  }

  @Post(':ruleSetId/definitions')
  createDefinition(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Body() dto: CreateRuleDefinitionDto,
  ) {
    return this.catalog.createDefinition(actor, ruleSetId, dto);
  }

  @Patch(':ruleSetId/definitions/:definitionId')
  updateDefinition(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Param('definitionId', RuleApiIdPipe) definitionId: number,
    @Body() dto: UpdateRuleDefinitionDto,
  ) {
    return this.catalog.updateDefinition(actor, ruleSetId, definitionId, dto);
  }

  @Delete(':ruleSetId/definitions/:definitionId')
  deleteDefinition(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Param('definitionId', RuleApiIdPipe) definitionId: number,
    @Query('expectedUpdatedAt') expectedUpdatedAt: string,
  ) {
    return this.catalog.deleteDefinition(actor, ruleSetId, definitionId, expectedUpdatedAt);
  }

  @Post(':ruleSetId/definitions/:definitionId/clone')
  @HttpCode(HttpStatus.CREATED)
  cloneDefinition(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Param('definitionId', RuleApiIdPipe) definitionId: number,
    @Body() dto: CloneRuleDefinitionDto,
  ) {
    return this.catalog.cloneDefinition(actor, ruleSetId, definitionId, dto);
  }

  @Get(':ruleSetId/releases')
  listReleases(@CurrentRuleActor() actor: RuleApiActor, @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number) {
    return this.catalog.listReleases(actor, ruleSetId);
  }

  @Get(':ruleSetId/releases/:releaseId')
  getRelease(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('ruleSetId', RuleApiIdPipe) ruleSetId: number,
    @Param('releaseId', RuleApiIdPipe) releaseId: number,
  ) {
    return this.catalog.getRelease(actor, ruleSetId, releaseId);
  }
}
