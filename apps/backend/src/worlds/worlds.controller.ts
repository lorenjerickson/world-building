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
import { CurrentRuleActor, RuleApiActor, RuleApiActorGuard } from '../rules/api/rule-api-actor';
import { ruleApiValidationPipe } from '../rules/api/rule-api-validation';
import { WorldEntityAiService } from './world-entity-ai.service';
import {
  AddWorldEntityReferenceDto,
  CreateWorldDto,
  CreateWorldEntityDto,
  CreateCollectionWorldEntityDto,
  ProposeWorldEntityDto,
  UpdateWorldEntityDto,
} from './worlds.dto';
import { WorldsService } from './worlds.service';

@Controller('api/worlds')
@UseGuards(RuleApiActorGuard)
@UsePipes(ruleApiValidationPipe)
export class WorldsController {
  constructor(private readonly worlds: WorldsService, private readonly ai: WorldEntityAiService) {}

  @Get('available-rule-sets')
  availableRuleSets(@CurrentRuleActor() actor: RuleApiActor) {
    return this.worlds.listAvailableRuleSets(actor);
  }

  @Get()
  list(@CurrentRuleActor() actor: RuleApiActor) {
    return this.worlds.listWorlds(actor);
  }

  @Post()
  create(@CurrentRuleActor() actor: RuleApiActor, @Body() dto: CreateWorldDto) {
    return this.worlds.createWorld(actor, dto);
  }

  @Get(':worldId')
  get(@CurrentRuleActor() actor: RuleApiActor, @Param('worldId') worldId: string) {
    return this.worlds.getWorld(actor, worldId);
  }

  @Post(':worldId/upgrade')
  upgrade(@CurrentRuleActor() actor: RuleApiActor, @Param('worldId') worldId: string) {
    return this.worlds.upgrade(actor, worldId);
  }

  @Get(':worldId/createable-traits')
  createableTraits(@CurrentRuleActor() actor: RuleApiActor, @Param('worldId') worldId: string) {
    return this.worlds.listCreateableTraits(actor, worldId);
  }

  @Post(':worldId/entity-schema')
  entitySchema(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Body() dto: Pick<CreateWorldEntityDto, 'rootTraitIds' | 'prerequisiteSelections'>,
  ) {
    return this.worlds.schema(actor, worldId, dto.rootTraitIds, dto.prerequisiteSelections ?? {});
  }

  @Get(':worldId/entities')
  entities(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Query('search') search?: string,
    @Query('traitId') traitId?: string,
  ) {
    return this.worlds.listEntities(actor, worldId, { search, traitId });
  }

  @Post(':worldId/entities')
  createEntity(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Body() dto: CreateWorldEntityDto,
  ) {
    return this.worlds.createEntity(actor, worldId, dto);
  }

  @Post(':worldId/entities/proposals')
  proposeEntity(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Body() dto: ProposeWorldEntityDto,
  ) {
    return this.ai.propose(actor, worldId, dto);
  }

  @Get(':worldId/entities/:entityId')
  entity(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.worlds.getEntity(actor, worldId, entityId);
  }

  @Patch(':worldId/entities/:entityId')
  updateEntity(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
    @Body() dto: UpdateWorldEntityDto,
  ) {
    return this.worlds.updateEntity(actor, worldId, entityId, dto);
  }

  @Delete(':worldId/entities/:entityId')
  @HttpCode(HttpStatus.OK)
  deleteEntity(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.worlds.deleteEntity(actor, worldId, entityId);
  }

  @Post(':worldId/entities/:entityId/collections/:collectionPath/references')
  addReference(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
    @Param('collectionPath') collectionPath: string,
    @Body() dto: AddWorldEntityReferenceDto,
  ) {
    return this.worlds.addReference(actor, worldId, entityId, collectionPath, dto);
  }

  @Get(':worldId/entities/:entityId/collections/:collectionPath/options')
  collectionOptions(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
    @Param('collectionPath') collectionPath: string,
  ) {
    return this.worlds.collectionOptions(actor, worldId, entityId, collectionPath);
  }

  @Post(':worldId/entities/:entityId/collections/:collectionPath/entities')
  createCollectionEntity(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
    @Param('collectionPath') collectionPath: string,
    @Body() dto: CreateCollectionWorldEntityDto,
  ) {
    return this.worlds.createCollectionEntity(actor, worldId, entityId, collectionPath, dto);
  }

  @Delete(':worldId/entities/:entityId/references/:referenceId')
  @HttpCode(HttpStatus.OK)
  removeReference(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('worldId') worldId: string,
    @Param('entityId') entityId: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.worlds.removeReference(actor, worldId, entityId, referenceId);
  }
}
