import { BadGatewayException, BadRequestException, Body, Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { storeImage } from './upload-storage';
import { uploadDirectory } from './upload-storage';
import { basename, extname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

interface CharacterArtRequest {
  name: string;
  description?: string;
  worldName?: string;
  worldDescription?: string;
  kind: 'portrait' | 'token';
  referenceUrl?: string;
}

@Controller('api/generate')
export class CharacterArtController {
  @Post('character-art')
  async generate(@Body() request: CharacterArtRequest) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured. Upload custom artwork instead.');
    const isToken = request.kind === 'token';
    const model = isToken
      ? process.env.OPENAI_TOKEN_IMAGE_MODEL || 'gpt-image-1.5'
      : process.env.OPENAI_PORTRAIT_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
    const prompt = isToken
      ? `Create a polished virtual tabletop character token for ${request.name}. Square composition, centered head-and-shoulders portrait, transparent background, strong readable silhouette at small size, no border, no text. Character: ${request.description || 'Use an evocative fantasy roleplaying interpretation.'} World context: ${request.worldName || ''}. ${request.worldDescription || ''}`
      : `Create a polished tabletop roleplaying character portrait for ${request.name}. Vertical character portrait, expressive face, costume and details grounded in the setting, painterly fantasy concept art, no frame, no text. Character: ${request.description || 'Use an evocative fantasy roleplaying interpretation.'} World context: ${request.worldName || ''}. ${request.worldDescription || ''}`;
    const referenceFilename = request.referenceUrl ? basename(request.referenceUrl) : undefined;
    const referencePath = referenceFilename ? join(uploadDirectory, referenceFilename) : undefined;
    const hasReference = Boolean(referencePath && existsSync(referencePath));
    if (request.referenceUrl && !hasReference) {
      throw new BadRequestException('The counterpart artwork could not be loaded. Restore or replace it before regenerating this image.');
    }
    let response: Response;
    if (hasReference && referencePath) {
      const extension = extname(referencePath).toLowerCase();
      const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/png';
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', `${prompt} Use the supplied ${isToken ? 'portrait' : 'token'} as the authoritative visual reference. Preserve the same face, apparent age, ancestry, hair, costume, colors, and identifying features.`);
      form.append('size', isToken ? '1024x1024' : '1024x1536');
      form.append('quality', 'medium');
      form.append('output_format', 'png');
      form.append('background', isToken ? 'transparent' : 'opaque');
      form.append('input_fidelity', 'high');
      form.append('image', new Blob([readFileSync(referencePath)], { type: mimeType }), referenceFilename);
      response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    } else {
      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size: isToken ? '1024x1024' : '1024x1536', quality: 'medium', output_format: 'png', background: isToken ? 'transparent' : 'opaque' }),
      });
    }
    const result = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    const encoded = result.data?.[0]?.b64_json;
    if (!response.ok || !encoded) throw new BadGatewayException(result.error?.message || 'OpenAI did not return an image.');
    return storeImage(Buffer.from(encoded, 'base64'), '.png');
  }
}
