import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import type { RuleApiActor } from '../rules/api/rule-api-actor';
import { normalizeAndValidateValues } from './world-entity-domain';
import type { ProposeWorldEntityDto } from './worlds.dto';
import { WorldsService } from './worlds.service';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class WorldEntityAiService {
  constructor(private readonly llm: LlmService, private readonly worlds: WorldsService) {}

  async propose(actor: RuleApiActor, worldId: string, dto: ProposeWorldEntityDto) {
    if (!this.llm.isConfigured) {
      throw new ServiceUnavailableException({
        code: 'WORLD_ENTITY_AI_NOT_CONFIGURED',
        message: 'AI assistance is not configured.',
        retryable: false,
      });
    }
    const schema = await this.worlds.schema(
      actor,
      worldId,
      dto.rootTraitIds,
      dto.prerequisiteSelections ?? {},
    );
    const terminals = schema.shape.nodes.filter((node) => node.kind === 'terminal').map((node) => ({
      path: node.path.join('.'),
      label: node.label,
      dataType: node.dataType,
      required: node.required ?? false,
      default: node.default,
      allowedValues: node.allowedValues,
      min: node.min,
      max: node.max,
      mediaType: node.mediaType,
    }));
    const completion = await this.llm.complete({
      responseFormat: 'json',
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            'You assist a game master by proposing values for one World Entity.',
            'Return JSON only, shaped as {"values":{"exact.path": value}}.',
            'Use only terminal paths supplied below. Do not invent references, media IDs, or collection children.',
            'Fill the complete form. The GM will review this proposal before anything is saved.',
            JSON.stringify({ terminals }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({ prompt: dto.prompt, currentValues: dto.currentValues ?? {} }),
        },
      ],
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.text);
    } catch {
      throw new BadGatewayException({
        code: 'WORLD_ENTITY_AI_RESPONSE_INVALID',
        message: 'AI assistance returned invalid JSON.',
        retryable: true,
      });
    }
    const proposed = record(parsed) && record(parsed.values) ? parsed.values : {};
    const combined = dto.preserveCurrentValues
      ? { ...proposed, ...(dto.currentValues ?? {}) }
      : proposed;
    const normalized = normalizeAndValidateValues(schema, combined);
    return {
      proposal: normalized.values,
      diagnostics: normalized.diagnostics,
      provider: completion.provider,
      model: completion.model,
      saved: false,
    };
  }
}
