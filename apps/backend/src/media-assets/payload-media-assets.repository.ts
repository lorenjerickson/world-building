import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RuleApiActor } from '../rules/api/rule-api-actor';
import type {
  MediaAssetCatalogPage,
  MediaAssetDownload,
  MediaAssetSummary,
  MediaAssetPurpose,
  MediaAssetType,
  MediaAssetUploadOptions,
  UploadedMediaAsset,
} from './media-assets.types';

type JsonRecord = Record<string, unknown>;

type PayloadMedia = JsonRecord & {
  id: number;
  altText: string;
  filename: string;
  filesize?: number | null;
  mimeType?: string;
  purpose?: MediaAssetPurpose;
  tags?: Array<{ value?: string }>;
};

@Injectable()
export class PayloadMediaAssetsRepository {
  private readonly baseUrl = (process.env.CMS_BASE_URL || 'http://cms:3000').replace(/\/$/, '');
  private readonly internalToken = process.env.CMS_INTERNAL_TOKEN || '';

  async list(
    actor: RuleApiActor,
    mediaType: MediaAssetType,
    options: { mimeType?: string; page: number; search?: string },
  ): Promise<MediaAssetCatalogPage> {
    const query = new URLSearchParams({
      depth: '0',
      limit: '24',
      page: String(options.page),
      sort: '-updatedAt',
    });
    const mimeTypes = options.mimeType ? [options.mimeType] : this.mimeTypes(mediaType);
    query.set('where[and][0][mimeType][in]', mimeTypes.join(','));
    if (options.search) {
      query.set('where[and][1][or][0][altText][like]', options.search);
      query.set('where[and][1][or][1][filename][like]', options.search);
    }
    const response = await fetch(`${this.baseUrl}/api/media?${query}`, {
      headers: this.actorHeaders(actor),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    const body = await this.readJson(response, 'MEDIA_ASSET_LIST_FAILED');
    const docs = Array.isArray(body.docs) ? body.docs : [];
    const items = docs
      .map((value) => this.asMedia(value as JsonRecord))
      .filter((media) => this.mediaType(media) === mediaType)
      .map((media) => this.summary(media, mediaType));
    return {
      items,
      page: Number(body.page) || options.page,
      totalItems: Number(body.totalDocs) || 0,
      totalPages: Number(body.totalPages) || 0,
    };
  }

  async upload(
    actor: RuleApiActor,
    mediaType: MediaAssetType,
    file: UploadedMediaAsset,
    options: MediaAssetUploadOptions = {},
  ): Promise<MediaAssetSummary> {
    const purpose = options.purpose ?? 'reference';
    const duplicate = await this.findDuplicate(actor, mediaType, file, purpose);
    if (duplicate) return { ...this.summary(duplicate, mediaType), reusedExisting: true };

    const form = new FormData();
    form.append(
      'file',
      new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    form.append('_payload', JSON.stringify({
      altText: options.altText?.trim() || file.originalname,
      ...(options.generation ? { generation: options.generation } : {}),
      purpose,
      tags: (options.tags ?? (purpose === 'reference' ? [`trait-${mediaType}`] : []))
        .map((value) => ({ value })),
    }));
    const response = await fetch(`${this.baseUrl}/api/media`, {
      body: form,
      headers: this.actorHeaders(actor),
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    const body = await this.readJson(response, 'MEDIA_ASSET_UPLOAD_FAILED');
    return this.summary(this.asMedia((body.doc ?? body) as JsonRecord), mediaType);
  }

  async download(actor: RuleApiActor, assetId: number): Promise<MediaAssetDownload> {
    const metadataResponse = await fetch(`${this.baseUrl}/api/media/${assetId}?depth=0`, {
      headers: this.actorHeaders(actor),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    if (metadataResponse.status === 404) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'The media asset was not found.',
        retryable: false,
      });
    }
    const media = this.asMedia(await this.readJson(metadataResponse, 'MEDIA_ASSET_READ_FAILED'));
    if (!this.mediaType(media)) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'The requested item is not a supported trait media asset.',
        retryable: false,
      });
    }
    const fileResponse = await fetch(
      `${this.baseUrl}/api/media/file/${encodeURIComponent(media.filename)}`,
      {
        headers: this.actorHeaders(actor),
        signal: AbortSignal.timeout(30_000),
      },
    ).catch((error) => {
      throw this.unavailable(error);
    });
    if (!fileResponse.ok) {
      throw new BadGatewayException({
        code: 'MEDIA_ASSET_DOWNLOAD_FAILED',
        message: `CMS returned HTTP ${fileResponse.status} while reading the media asset.`,
        retryable: fileResponse.status >= 500,
      });
    }
    return {
      bytes: Buffer.from(await fileResponse.arrayBuffer()),
      filename: media.filename,
      mimeType: media.mimeType || fileResponse.headers.get('content-type') || 'application/octet-stream',
    };
  }

  async downloadUrl(
    actor: RuleApiActor,
    url: string,
    requiredType: MediaAssetType,
  ): Promise<MediaAssetDownload> {
    const assetId = this.assetIdFromUrl(url);
    const download = await this.download(actor, assetId);
    if (!this.mimeTypeMatches(requiredType, download.mimeType)) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: `The requested item is not ${requiredType} media.`,
        retryable: false,
      });
    }
    return download;
  }

  async deleteArtwork(actor: RuleApiActor, assetId: number): Promise<void> {
    const media = await this.requireMedia(actor, assetId);
    if (!this.mediaType(media) || media.purpose === 'reference') {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'The requested item is not application artwork.',
        retryable: false,
      });
    }
    const response = await fetch(`${this.baseUrl}/api/media/${assetId}`, {
      headers: this.actorHeaders(actor),
      method: 'DELETE',
      signal: AbortSignal.timeout(20_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    if (!response.ok) await this.readJson(response, 'MEDIA_ASSET_DELETE_FAILED');
  }

  private summary(media: PayloadMedia, mediaType: MediaAssetType): MediaAssetSummary {
    return {
      id: String(media.id),
      filename: media.filename,
      label: media.altText || media.filename,
      mediaType,
      mimeType: media.mimeType || 'application/octet-stream',
      size: Number(media.filesize) || 0,
      url: `/api/media-assets/${media.id}/${encodeURIComponent(media.filename)}`,
    };
  }

  private async findDuplicate(
    actor: RuleApiActor,
    mediaType: MediaAssetType,
    file: UploadedMediaAsset,
    purpose: MediaAssetPurpose,
  ): Promise<PayloadMedia | undefined> {
    const query = new URLSearchParams({ depth: '0', limit: '50' });
    query.set('where[and][0][filesize][equals]', String(file.buffer.length));
    query.set('where[and][1][filename][like]', file.originalname);
    query.set('where[and][2][purpose][equals]', purpose);
    const response = await fetch(`${this.baseUrl}/api/media?${query}`, {
      headers: this.actorHeaders(actor),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    const body = await this.readJson(response, 'MEDIA_ASSET_DUPLICATE_CHECK_FAILED');
    const normalizedName = this.normalizedFilename(file.originalname);
    const docs = Array.isArray(body.docs) ? body.docs : [];
    return docs
      .map((value) => this.asMedia(value as JsonRecord))
      .find((media) =>
        this.normalizedFilename(media.filename) === normalizedName
        && Number(media.filesize) === file.buffer.length
        && media.purpose === purpose
        && this.mediaType(media) === mediaType);
  }

  private assetIdFromUrl(url: string): number {
    let path: string;
    try {
      path = new URL(url, 'https://local.web.wanderlust-vtt.com').pathname;
    } catch {
      throw this.invalidAssetUrl();
    }
    const match = /^\/api\/media-assets\/(\d+)\/[^/]+$/.exec(path);
    const assetId = Number(match?.[1]);
    if (!Number.isSafeInteger(assetId) || assetId < 1) throw this.invalidAssetUrl();
    return assetId;
  }

  private invalidAssetUrl(): BadRequestException {
    return new BadRequestException({
      code: 'MEDIA_ASSET_URL_INVALID',
      message: 'The source must be an existing media asset.',
      retryable: false,
    });
  }

  private async requireMedia(actor: RuleApiActor, assetId: number): Promise<PayloadMedia> {
    const response = await fetch(`${this.baseUrl}/api/media/${assetId}?depth=0`, {
      headers: this.actorHeaders(actor),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    if (response.status === 404) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'The media asset was not found.',
        retryable: false,
      });
    }
    return this.asMedia(await this.readJson(response, 'MEDIA_ASSET_READ_FAILED'));
  }

  private normalizedFilename(filename: string): string {
    return filename.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }

  private asMedia(value: JsonRecord): PayloadMedia {
    if (
      !Number.isSafeInteger(value.id)
      || typeof value.filename !== 'string'
      || typeof value.altText !== 'string'
    ) {
      throw new BadGatewayException({
        code: 'MEDIA_ASSET_CMS_CONTRACT_INVALID',
        message: 'CMS returned an invalid media asset.',
        retryable: false,
      });
    }
    return value as PayloadMedia;
  }

  private mediaType(media: PayloadMedia): MediaAssetType | undefined {
    const mimeType = media.mimeType || '';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (['application/json', 'text/markdown', 'text/plain'].includes(mimeType)) return 'text';
    return undefined;
  }

  private mimeTypeMatches(mediaType: MediaAssetType, mimeType: string): boolean {
    if (mediaType === 'text') {
      return ['application/json', 'text/markdown', 'text/plain'].includes(mimeType);
    }
    return mimeType.startsWith(`${mediaType}/`);
  }

  private mimeTypes(mediaType: MediaAssetType): string[] {
    if (mediaType === 'audio') return ['audio/flac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'];
    if (mediaType === 'image') return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'];
    if (mediaType === 'video') return ['video/mp4', 'video/ogg', 'video/quicktime', 'video/webm'];
    return ['application/json', 'text/markdown', 'text/plain'];
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
      code: 'MEDIA_ASSET_CMS_UNAVAILABLE',
      message: 'Media storage is unavailable.',
      retryable: true,
    }, { cause });
  }
}
