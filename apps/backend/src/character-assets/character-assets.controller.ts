import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { extname } from 'node:path';
import {
  CurrentRuleActor,
  RuleApiActor,
  RuleApiActorGuard,
} from '../rules/api/rule-api-actor';
import { PayloadCharacterAssetsRepository } from './payload-character-assets.repository';
import {
  CHARACTER_MODEL_EXTENSIONS,
  CHARACTER_MODEL_MIME_TYPES,
  type UploadedCharacterModel,
} from './character-assets.types';

function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new BadRequestException({
      code: 'CHARACTER_MODEL_ID_INVALID',
      message: 'The character model identifier is invalid.',
      retryable: false,
    });
  }
  return id;
}

@Controller('api/character-assets/models')
@UseGuards(RuleApiActorGuard)
export class CharacterAssetsController {
  constructor(private readonly assets: PayloadCharacterAssetsRepository) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  }))
  upload(
    @CurrentRuleActor() actor: RuleApiActor,
    @UploadedFile() file: UploadedCharacterModel,
  ) {
    const extension = extname(file?.originalname || '').toLowerCase();
    const mimeType = file?.mimetype || 'application/octet-stream';
    if (
      !file
      || !CHARACTER_MODEL_EXTENSIONS.has(extension)
      || !CHARACTER_MODEL_MIME_TYPES.has(mimeType)
    ) {
      throw new BadRequestException({
        code: 'CHARACTER_MODEL_FILE_INVALID',
        message: 'Upload an OBJ, GLB, GLTF, PLY, or STL model file.',
        retryable: false,
      });
    }
    const modelName = file.originalname.slice(0, -extension.length) || 'Character';
    return this.assets.uploadModel(
      actor,
      { ...file, mimetype: mimeType },
      `${modelName} 3D character token`,
    );
  }

  @Get(':assetId/:filename')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async download(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('assetId') assetId: string,
    @Res() response: Response,
  ) {
    const model = await this.assets.downloadModel(actor, numericId(assetId));
    response.setHeader('content-type', model.mimeType);
    response.send(model.bytes);
  }

  @Delete(':assetId/:filename')
  async remove(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('assetId') assetId: string,
  ) {
    await this.assets.deleteModel(actor, numericId(assetId));
    return { deleted: true };
  }
}
