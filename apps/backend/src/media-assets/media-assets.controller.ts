import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  CurrentRuleActor,
  RuleApiActor,
  RuleApiActorGuard,
} from '../rules/api/rule-api-actor';
import {
  MEDIA_ASSET_TYPES,
  MEDIA_ASSET_PURPOSES,
  MEDIA_ASSET_MIME_TYPES,
  mediaTypeAcceptsMimeType,
  type MediaAssetType,
  type MediaAssetPurpose,
  type UploadedMediaAsset,
} from './media-assets.types';
import { PayloadMediaAssetsRepository } from './payload-media-assets.repository';

function requiredMediaType(value: string): MediaAssetType {
  if (!MEDIA_ASSET_TYPES.includes(value as MediaAssetType)) {
    throw new BadRequestException({
      code: 'MEDIA_ASSET_TYPE_INVALID',
      message: "Media type must be 'text', 'audio', 'video', or 'image'.",
      retryable: false,
    });
  }
  return value as MediaAssetType;
}

function pageNumber(value: string | undefined): number {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new BadRequestException({
      code: 'MEDIA_ASSET_ID_INVALID',
      message: 'The media asset identifier is invalid.',
      retryable: false,
    });
  }
  return id;
}

function optionalPurpose(value: string | undefined): MediaAssetPurpose | undefined {
  const purpose = value?.trim();
  if (!purpose) return undefined;
  if (!MEDIA_ASSET_PURPOSES.includes(purpose as MediaAssetPurpose)) {
    throw new BadRequestException({
      code: 'MEDIA_ASSET_PURPOSE_INVALID',
      message: 'The media purpose is invalid.',
      retryable: false,
    });
  }
  return purpose as MediaAssetPurpose;
}

@Controller('api/media-assets')
@UseGuards(RuleApiActorGuard)
export class MediaAssetsController {
  constructor(private readonly assets: PayloadMediaAssetsRepository) {}

  @Get()
  list(
    @CurrentRuleActor() actor: RuleApiActor,
    @Query('type') type: string,
    @Query('mimeType') mimeType?: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    const mediaType = requiredMediaType(type);
    const normalizedMimeType = mimeType?.trim();
    if (normalizedMimeType
      && !MEDIA_ASSET_MIME_TYPES[mediaType].some((candidate) => candidate === normalizedMimeType)) {
      throw new BadRequestException({
        code: 'MEDIA_ASSET_MIME_FILTER_INVALID',
        message: `The MIME filter is not valid for ${mediaType} media.`,
        retryable: false,
      });
    }
    return this.assets.list(actor, mediaType, {
      ...(normalizedMimeType ? { mimeType: normalizedMimeType } : {}),
      page: pageNumber(page),
      ...(search?.trim() ? { search: search.trim().slice(0, 120) } : {}),
    });
  }

  @Get(':assetId/:filename')
  @Header('Cache-Control', 'private, max-age=300')
  async download(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('assetId') assetId: string,
    @Res() response: Response,
  ) {
    const media = await this.assets.download(actor, numericId(assetId));
    response.setHeader('content-disposition', `inline; filename="${media.filename.replace(/["\\]/g, '_')}"`);
    response.setHeader('content-type', media.mimeType);
    response.send(media.bytes);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  }))
  upload(
    @CurrentRuleActor() actor: RuleApiActor,
    @Query('type') type: string,
    @Query('purpose') purpose: string | undefined,
    @Query('altText') altText: string | undefined,
    @UploadedFile() file: UploadedMediaAsset,
  ) {
    const mediaType = requiredMediaType(type);
    const mediaPurpose = optionalPurpose(purpose);
    if (!file || !mediaTypeAcceptsMimeType(mediaType, file.mimetype)) {
      throw new BadRequestException({
        code: 'MEDIA_ASSET_FILE_INVALID',
        message: `Upload a valid ${mediaType} file.`,
        retryable: false,
      });
    }
    return this.assets.upload(actor, mediaType, file, {
      ...(altText?.trim() ? { altText: altText.trim().slice(0, 300) } : {}),
      ...(mediaPurpose ? { purpose: mediaPurpose } : {}),
    });
  }

  @Delete(':assetId/:filename')
  async remove(
    @CurrentRuleActor() actor: RuleApiActor,
    @Param('assetId') assetId: string,
  ) {
    await this.assets.deleteArtwork(actor, numericId(assetId));
    return { deleted: true };
  }
}
