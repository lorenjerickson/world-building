import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentRuleActor,
  RuleApiActor,
  RuleApiActorGuard,
} from '../rules/api/rule-api-actor';
import { CharacterModelGenerationService } from './character-model-generation.service';
import type { UploadedSourceImage } from './character-model-generation.types';

@Controller('api/character-assets/generations')
@UseGuards(RuleApiActorGuard)
export class CharacterModelGenerationController {
  constructor(private readonly generations: CharacterModelGenerationService) {}

  @Post('text')
  createFromText(
    @CurrentRuleActor() actor: RuleApiActor,
    @Body() body: { characterName?: string; prompt?: string },
  ) {
    return this.generations.createFromText(actor, body);
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('image', {
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  }))
  createFromImage(
    @CurrentRuleActor() actor: RuleApiActor,
    @Body() body: { characterName?: string; sourceImageUrl?: string },
    @UploadedFile() file?: UploadedSourceImage,
  ) {
    return this.generations.createFromImage(actor, {
      characterName: body.characterName,
      file,
      sourceImageUrl: body.sourceImageUrl,
    });
  }

  @Get(':generationId')
  get(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('generationId') generationId: string,
  ) {
    return this.generations.get(actor, generationId);
  }

  @Delete(':generationId')
  cancel(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('generationId') generationId: string,
  ) {
    return this.generations.cancel(actor, generationId);
  }
}
