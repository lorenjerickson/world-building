import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RuleApiActor } from '../rules/api/rule-api-actor';
import { PayloadMediaAssetsRepository } from '../media-assets/payload-media-assets.repository';
import { PayloadCharacterAssetsRepository } from './payload-character-assets.repository';
import type {
  CharacterModelGeneration,
  ShapEJob,
  UploadedSourceImage,
} from './character-model-generation.types';

type GenerationRecord = CharacterModelGeneration & {
  actor: RuleApiActor;
  characterName: string;
};

const IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

@Injectable()
export class CharacterModelGenerationService {
  private readonly baseUrl = (process.env.SHAP_E_BASE_URL || 'http://shap-e:8000').replace(/\/$/, '');
  private readonly pollInterval = Number(process.env.SHAP_E_POLL_INTERVAL_MS || 750);
  private readonly generations = new Map<string, GenerationRecord>();

  constructor(
    private readonly assets: PayloadCharacterAssetsRepository,
    private readonly mediaAssets: PayloadMediaAssetsRepository,
  ) {}

  async createFromText(
    actor: RuleApiActor,
    request: { characterName?: string; prompt?: string },
  ): Promise<CharacterModelGeneration> {
    const characterName = this.requireText(request.characterName, 'Character name', 200);
    const prompt = this.requireText(request.prompt, 'Prompt', 1000);
    const job = await this.shapRequest('/v1/jobs/text', {
      body: JSON.stringify({ prompt }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return this.track(actor, characterName, job);
  }

  async createFromImage(
    actor: RuleApiActor,
    request: {
      characterName?: string;
      file?: UploadedSourceImage;
      sourceImageUrl?: string;
    },
  ): Promise<CharacterModelGeneration> {
    const characterName = this.requireText(request.characterName, 'Character name', 200);
    if (Boolean(request.file) === Boolean(request.sourceImageUrl?.trim())) {
      throw new BadRequestException({
        code: 'CHARACTER_MODEL_IMAGE_SOURCE_INVALID',
        message: 'Provide either one uploaded image or one existing character image.',
        retryable: false,
      });
    }

    const file = request.file ?? await this.readExistingImage(actor, request.sourceImageUrl || '');
    if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: 'CHARACTER_MODEL_IMAGE_INVALID',
        message: 'Upload a PNG, JPEG, GIF, or WebP source image.',
        retryable: false,
      });
    }
    const form = new FormData();
    form.append(
      'image',
      new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    const job = await this.shapRequest('/v1/jobs/image', {
      body: form,
      method: 'POST',
    });
    return this.track(actor, characterName, job);
  }

  get(actor: RuleApiActor, id: string): CharacterModelGeneration {
    return this.publicRecord(this.requireOwned(actor, id));
  }

  async cancel(actor: RuleApiActor, id: string): Promise<CharacterModelGeneration> {
    const record = this.requireOwned(actor, id);
    if (!TERMINAL_STATUSES.has(record.status)) {
      await this.shapRequest(`/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      record.status = 'cancelled';
      record.stage = 'Cancelled';
    }
    return this.publicRecord(record);
  }

  private track(
    actor: RuleApiActor,
    characterName: string,
    job: ShapEJob,
  ): CharacterModelGeneration {
    const record: GenerationRecord = {
      actor: { ...actor },
      characterName,
      id: job.id,
      inputType: job.inputType,
      progress: job.progress,
      seed: job.seed,
      stage: job.stage,
      status: job.status,
    };
    this.generations.set(record.id, record);
    void this.monitor(record);
    return this.publicRecord(record);
  }

  private async monitor(record: GenerationRecord): Promise<void> {
    try {
      while (!TERMINAL_STATUSES.has(record.status)) {
        await this.delay(this.pollInterval);
        if (record.status === 'cancelled') return;
        const job = await this.shapRequest(`/v1/jobs/${encodeURIComponent(record.id)}`);
        record.seed = job.seed;
        record.stage = job.stage;
        record.progress = Math.min(90, Math.round(job.progress * 0.9));
        record.status = job.status;
        if (job.status === 'failed') {
          record.error = job.error || 'Shap-E could not generate this model.';
          return;
        }
        if (job.status === 'cancelled') return;
        if (job.status !== 'succeeded') continue;

        record.status = 'persisting';
        record.stage = 'Saving model to character media';
        record.progress = 94;
        const artifact = await this.fetchArtifact(record.id);
        const uploaded = await this.assets.uploadModel(
          record.actor,
          {
            buffer: artifact,
            mimetype: 'model/gltf-binary',
            originalname: `${this.safeFilename(record.characterName)}-token.glb`,
            size: artifact.byteLength,
          },
          `${record.characterName} generated 3D character token`,
        );
        record.url = uploaded.url;
        record.progress = 100;
        record.stage = '3D token ready';
        record.status = 'succeeded';
      }
    } catch (error) {
      record.error = error instanceof Error ? error.message : '3D token generation failed.';
      record.stage = 'Generation failed';
      record.status = 'failed';
    }
  }

  private async fetchArtifact(id: string): Promise<Buffer> {
    const response = await fetch(
      `${this.baseUrl}/v1/jobs/${encodeURIComponent(id)}/artifact`,
      { signal: AbortSignal.timeout(60_000) },
    ).catch((error) => {
      throw this.unavailable(error);
    });
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'SHAP_E_ARTIFACT_FAILED',
        message: `Shap-E returned HTTP ${response.status} while reading the generated model.`,
        retryable: response.status >= 500,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async readExistingImage(
    actor: RuleApiActor,
    sourceUrl: string,
  ): Promise<UploadedSourceImage> {
    try {
      const media = await this.mediaAssets.downloadUrl(actor, sourceUrl, 'image');
      return {
        buffer: media.bytes,
        mimetype: media.mimeType,
        originalname: media.filename,
        size: media.bytes.byteLength,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw this.invalidSourceUrl();
      throw new NotFoundException({
        code: 'CHARACTER_MODEL_SOURCE_NOT_FOUND',
        message: 'The selected portrait or 2D token could not be loaded.',
        retryable: false,
      });
    }
  }

  private invalidSourceUrl() {
    return new BadRequestException({
      code: 'CHARACTER_MODEL_SOURCE_URL_INVALID',
      message: 'The source must be an existing portrait or 2D token image.',
      retryable: false,
    });
  }

  private requireOwned(actor: RuleApiActor, id: string): GenerationRecord {
    const record = this.generations.get(id);
    if (!record || record.actor.auth0Subject !== actor.auth0Subject) {
      throw new NotFoundException({
        code: 'CHARACTER_MODEL_GENERATION_NOT_FOUND',
        message: 'The 3D token generation job was not found.',
        retryable: false,
      });
    }
    return record;
  }

  private requireText(value: string | undefined, label: string, max: number): string {
    const text = value?.trim() || '';
    if (!text || text.length > max) {
      throw new BadRequestException({
        code: 'CHARACTER_MODEL_GENERATION_INPUT_INVALID',
        message: `${label} must contain between 1 and ${max} characters.`,
        retryable: false,
      });
    }
    return text;
  }

  private async shapRequest(path: string, init: RequestInit = {}): Promise<ShapEJob> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => {
      throw this.unavailable(error);
    });
    const body = await response.json().catch(() => ({})) as Partial<ShapEJob> & { detail?: string };
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'SHAP_E_REQUEST_FAILED',
        message: body.detail || `Shap-E returned HTTP ${response.status}.`,
        retryable: response.status >= 500,
      });
    }
    if (
      typeof body.id !== 'string'
      || (body.inputType !== 'image' && body.inputType !== 'text')
      || typeof body.progress !== 'number'
      || typeof body.seed !== 'number'
      || typeof body.stage !== 'string'
      || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(body.status || '')
    ) {
      throw new BadGatewayException({
        code: 'SHAP_E_CONTRACT_INVALID',
        message: 'Shap-E returned an invalid generation response.',
        retryable: false,
      });
    }
    return body as ShapEJob;
  }

  private unavailable(cause: unknown) {
    return new ServiceUnavailableException({
      code: 'SHAP_E_UNAVAILABLE',
      message: 'The local 3D generation service is unavailable.',
      retryable: true,
    }, { cause });
  }

  private publicRecord(record: GenerationRecord): CharacterModelGeneration {
    return {
      ...(record.error ? { error: record.error } : {}),
      id: record.id,
      inputType: record.inputType,
      progress: record.progress,
      seed: record.seed,
      stage: record.stage,
      status: record.status,
      ...(record.url ? { url: record.url } : {}),
    };
  }

  private safeFilename(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
