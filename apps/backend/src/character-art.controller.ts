import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  CurrentRuleActor,
  RuleApiActor,
  RuleApiActorGuard,
} from './rules/api/rule-api-actor';
import { PayloadMediaAssetsRepository } from './media-assets/payload-media-assets.repository';

interface CharacterArtRequest {
  name: string;
  description?: string;
  worldName?: string;
  worldDescription?: string;
  kind: 'portrait' | 'token';
  referenceUrl?: string;
}

@Controller('api/generate')
@UseGuards(RuleApiActorGuard)
export class CharacterArtController {
  constructor(private readonly assets: PayloadMediaAssetsRepository) {}

  @Post('character-art')
  async generate(
    @CurrentRuleActor() actor: RuleApiActor,
    @Body() request: CharacterArtRequest,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured. Upload custom artwork instead.',
      );
    }
    const name = request.name?.trim();
    if (!name || name.length > 200 || !['portrait', 'token'].includes(request.kind)) {
      throw new BadRequestException('Provide a character name and a valid artwork kind.');
    }
    const isToken = request.kind === 'token';
    const model = isToken
      ? process.env.OPENAI_TOKEN_IMAGE_MODEL || 'gpt-image-1.5'
      : process.env.OPENAI_PORTRAIT_IMAGE_MODEL
        || process.env.OPENAI_IMAGE_MODEL
        || 'gpt-image-2';
    const prompt = isToken
      ? `Create a polished virtual tabletop character token for ${name}. Square composition, centered head-and-shoulders portrait, transparent background, strong readable silhouette at small size, no border, no text. Character: ${request.description || 'Use an evocative fantasy roleplaying interpretation.'} World context: ${request.worldName || ''}. ${request.worldDescription || ''}`
      : `Create a polished tabletop roleplaying character portrait for ${name}. Vertical character portrait, expressive face, costume and details grounded in the setting, painterly fantasy concept art, no frame, no text. Character: ${request.description || 'Use an evocative fantasy roleplaying interpretation.'} World context: ${request.worldName || ''}. ${request.worldDescription || ''}`;
    let response: Response;
    if (request.referenceUrl) {
      const reference = await this.assets.downloadUrl(actor, request.referenceUrl, 'image').catch(() => {
        throw new BadRequestException(
          'The counterpart artwork could not be loaded. Restore or replace it before regenerating this image.',
        );
      });
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', `${prompt} Use the supplied ${isToken ? 'portrait' : 'token'} as the authoritative visual reference. Preserve the same face, apparent age, ancestry, hair, costume, colors, and identifying features.`);
      form.append('size', isToken ? '1024x1024' : '1024x1536');
      form.append('quality', 'medium');
      form.append('output_format', 'png');
      form.append('background', isToken ? 'transparent' : 'opaque');
      form.append('input_fidelity', 'high');
      form.append(
        'image',
        new Blob([Uint8Array.from(reference.bytes)], { type: reference.mimeType }),
        reference.filename,
      );
      response = await fetch('https://api.openai.com/v1/images/edits', {
        body: form,
        headers: { Authorization: `Bearer ${apiKey}` },
        method: 'POST',
      });
    } else {
      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          size: isToken ? '1024x1024' : '1024x1536',
          quality: 'medium',
          output_format: 'png',
          background: isToken ? 'transparent' : 'opaque',
        }),
      });
    }
    const result = await response.json() as {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string };
    };
    const encoded = result.data?.[0]?.b64_json;
    if (!response.ok || !encoded) {
      throw new BadGatewayException(result.error?.message || 'OpenAI did not return an image.');
    }
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      || 'character';
    return this.assets.upload(actor, 'image', {
      buffer: Buffer.from(encoded, 'base64'),
      mimetype: 'image/png',
      originalname: `${safeName}-${request.kind}.png`,
    }, {
      altText: `${name} generated ${request.kind}`,
      generation: {
        correlationId: randomUUID(),
        model,
        promptHash: createHash('sha256').update(prompt).digest('hex'),
        provider: 'openai',
      },
      purpose: request.kind,
      tags: ['generated', `character-${request.kind}`],
    });
  }
}
