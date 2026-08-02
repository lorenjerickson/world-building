import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RuleApiActor } from '../rules/api/rule-api-actor';
import type {
  CharacterModelAsset,
  CharacterModelDownload,
  UploadedCharacterModel,
} from './character-assets.types';

type JsonRecord = Record<string, unknown>;

type PayloadMedia = JsonRecord & {
  id: number;
  filename: string;
  mimeType?: string;
  purpose?: string;
  tags?: Array<{ value?: string }>;
};

@Injectable()
export class PayloadCharacterAssetsRepository {
  private readonly baseUrl = (process.env.CMS_BASE_URL || 'http://cms:3000').replace(/\/$/, '');
  private readonly internalToken = process.env.CMS_INTERNAL_TOKEN || '';

  async uploadModel(
    actor: RuleApiActor,
    file: UploadedCharacterModel,
    altText: string,
  ): Promise<CharacterModelAsset> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    form.append('_payload', JSON.stringify({
      altText,
      purpose: 'token',
      tags: [{ value: 'token-3d' }],
    }));

    const response = await fetch(`${this.baseUrl}/api/media`, {
      body: form,
      headers: this.actorHeaders(actor),
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    const body = await this.readJson(response, 'CHARACTER_MODEL_UPLOAD_FAILED');
    const media = this.asMedia((body.doc ?? body) as JsonRecord);
    return {
      assetId: media.id,
      filename: media.filename,
      mimeType: media.mimeType || file.mimetype,
      url: `/api/character-assets/models/${media.id}/${encodeURIComponent(media.filename)}`,
    };
  }

  async downloadModel(actor: RuleApiActor, assetId: number): Promise<CharacterModelDownload> {
    const media = await this.requireModel(actor, assetId);
    const response = await fetch(
      `${this.baseUrl}/api/media/file/${encodeURIComponent(media.filename)}`,
      {
        headers: this.actorHeaders(actor),
        signal: AbortSignal.timeout(30_000),
      },
    ).catch((error) => {
      throw this.unavailable(error);
    });
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'CHARACTER_MODEL_DOWNLOAD_FAILED',
        message: `CMS returned HTTP ${response.status} while reading the model.`,
        retryable: response.status >= 500,
      });
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      filename: media.filename,
      mimeType: media.mimeType || response.headers.get('content-type') || 'application/octet-stream',
    };
  }

  async deleteModel(actor: RuleApiActor, assetId: number): Promise<void> {
    await this.requireModel(actor, assetId);
    const response = await fetch(`${this.baseUrl}/api/media/${assetId}`, {
      headers: this.actorHeaders(actor),
      method: 'DELETE',
      signal: AbortSignal.timeout(20_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    if (!response.ok) {
      await this.readJson(response, 'CHARACTER_MODEL_DELETE_FAILED');
    }
  }

  private async requireModel(actor: RuleApiActor, assetId: number): Promise<PayloadMedia> {
    const response = await fetch(`${this.baseUrl}/api/media/${assetId}?depth=0`, {
      headers: this.actorHeaders(actor),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    if (response.status === 404) {
      throw new NotFoundException({
        code: 'CHARACTER_MODEL_NOT_FOUND',
        message: 'The character model was not found.',
        retryable: false,
      });
    }
    const media = this.asMedia(await this.readJson(response, 'CHARACTER_MODEL_READ_FAILED'));
    const isCharacterModel = media.purpose === 'token'
      && media.tags?.some((tag) => tag.value === 'token-3d');
    if (!isCharacterModel) {
      throw new NotFoundException({
        code: 'CHARACTER_MODEL_NOT_FOUND',
        message: 'The requested media item is not a character model.',
        retryable: false,
      });
    }
    return media;
  }

  private asMedia(value: JsonRecord): PayloadMedia {
    if (
      !Number.isSafeInteger(value.id)
      || typeof value.filename !== 'string'
      || !value.filename
    ) {
      throw new BadGatewayException({
        code: 'CHARACTER_MODEL_CMS_CONTRACT_INVALID',
        message: 'CMS returned an invalid model asset.',
        retryable: false,
      });
    }
    return value as PayloadMedia;
  }

  private actorHeaders(actor: RuleApiActor): Record<string, string> {
    return {
      ...(actor.email ? { 'x-auth0-email': actor.email } : {}),
      'x-auth0-sub': actor.auth0Subject,
      'x-cms-internal-token': this.internalToken,
    };
  }

  private async readJson(response: Response, code: string): Promise<JsonRecord> {
    const body = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      throw new BadGatewayException({
        code,
        details: body,
        message: `CMS returned HTTP ${response.status}.`,
        retryable: response.status >= 500,
      });
    }
    return body;
  }

  private unavailable(cause: unknown) {
    return new ServiceUnavailableException({
      code: 'CHARACTER_MODEL_CMS_UNAVAILABLE',
      message: 'Character model storage is unavailable.',
      retryable: true,
    }, { cause });
  }
}
