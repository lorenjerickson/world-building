import { BadRequestException, Body, Controller, Get, Header, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentRuleActor, RuleApiActor, RuleApiActorGuard } from '../rules/api/rule-api-actor';
import type { CreateEncounterMapInput, FinalizeEncounterDraftInput, SaveEncounterDraftInput } from './encounter-map.types';
import { PayloadEncounterMapRepository } from './payload-encounter-map.repository';

function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new BadRequestException({ code: 'ENCOUNTER_ID_INVALID', message: `Invalid numeric identifier '${value}'.`, retryable: false });
  }
  return id;
}

@Controller('api/encounters/:encId/maps')
@UseGuards(RuleApiActorGuard)
export class EncounterMapsController {
  constructor(private readonly maps: PayloadEncounterMapRepository) {}

  @Post()
  create(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Body() body: CreateEncounterMapInput) {
    return this.maps.createMap(actor, encId, body);
  }

  @Get(':mapId/drafts/:draftId')
  @Header('Cache-Control', 'no-store')
  getDraft(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Param('mapId') mapId: string, @Param('draftId') draftId: string) {
    return this.maps.getDraft(actor, encId, numericId(mapId), numericId(draftId));
  }

  @Put(':mapId/drafts/:draftId')
  saveDraft(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Param('mapId') mapId: string, @Param('draftId') draftId: string, @Body() body: SaveEncounterDraftInput) {
    return this.maps.saveDraft(actor, encId, numericId(mapId), numericId(draftId), body);
  }

  @Post(':mapId/drafts/:draftId/validate')
  validateDraft(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Param('mapId') mapId: string, @Param('draftId') draftId: string) {
    return this.maps.validateDraft(actor, encId, numericId(mapId), numericId(draftId));
  }

  @Post(':mapId/drafts/:draftId/finalize')
  finalizeDraft(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Param('mapId') mapId: string, @Param('draftId') draftId: string, @Body() body: FinalizeEncounterDraftInput) {
    return this.maps.finalizeDraft(actor, encId, numericId(mapId), numericId(draftId), body);
  }

  @Get(':mapId/revisions/:revisionId/manifest')
  @Header('Cache-Control', 'private, max-age=60')
  getManifest(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Param('mapId') mapId: string, @Param('revisionId') revisionId: string) {
    return this.maps.getRevisionManifest(actor, encId, numericId(mapId), numericId(revisionId));
  }

  @Get(':mapId/revisions/:revisionId/artifacts/:artifactKind/:profile')
  async getArtifact(@CurrentRuleActor() actor: RuleApiActor, @Param('encId') encId: string, @Param('mapId') mapId: string, @Param('revisionId') revisionId: string, @Param('artifactKind') artifactKind: string, @Res() response: Response) {
    const bytes = await this.maps.downloadRevisionArtifact(actor, encId, numericId(mapId), numericId(revisionId), artifactKind);
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'private, max-age=31536000, immutable');
    response.send(bytes);
  }
}
