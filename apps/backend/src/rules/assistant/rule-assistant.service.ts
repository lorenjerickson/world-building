import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import { compileCreatureCapabilities } from '../metamodel/creature-capability.compiler';
import { creatureCapabilityMetamodelDescriptor } from '../metamodel/creature-capability.descriptors';
import { creatureCapabilityExamples } from '../metamodel/creature-capability.examples';
import { compileResolutionDefinitions } from '../resolution/resolution.compiler';
import { resolutionMetamodelDescriptor } from '../resolution/resolution.descriptors';
import { meleeResolutionExamples } from '../resolution/resolution.examples';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantProposedDefinition {
  body: Record<string, unknown>;
  valid: boolean;
  diagnostics: Array<{ code: string; path: string; message: string; severity: 'error' | 'warning' }>;
}

export interface AssistantResponse {
  questions: string[];
  explanation: string;
  assumptions: string[];
  definitions: AssistantProposedDefinition[];
  raw?: string;
  llmAvailable: boolean;
}

@Injectable()
export class RuleAssistantService {
  private readonly logger = new Logger(RuleAssistantService.name);

  constructor(private readonly llm: LlmService) {}

  get isAvailable(): boolean {
    return this.llm.isConfigured;
  }

  // ── System prompt ───────────────────────────────────────────────────────────

  private buildSystemPrompt(contextDefinitions: unknown[]): string {
    const creatureTypes = creatureCapabilityMetamodelDescriptor.definitionTypes.join(', ');
    const resolutionTypes = resolutionMetamodelDescriptor.definitionTypes.join(', ');
    const creatureExampleJson = JSON.stringify(creatureCapabilityExamples.slice(0, 2), null, 2);
    const resolutionExampleJson = JSON.stringify(meleeResolutionExamples.slice(0, 3), null, 2);
    const contextSummary = contextDefinitions.length
      ? `The rule set currently contains these definitions (for reference only — do not duplicate their IDs):\n${contextDefinitions.map((d: any) => `  - ${d.definitionId} (${d.definitionType}): ${d.name}`).join('\n')}`
      : 'The rule set is empty.';

    return `You are a rule-authoring assistant for a tabletop role-playing game platform.
Your job is to help Game Masters define gameplay mechanics as typed, declarative rule definitions.

## Metamodels

### creature-capabilities/1
Defines properties of creatures. Types: ${creatureTypes}.
Use formatVersion "1" and metamodelVersion "creature-capabilities/1".
IDs use pattern: type:kebab-name (e.g., field:strength-score, trait:vision).

Example definitions:
${creatureExampleJson}

### resolution/1
Defines checks, operations, and their parts. Types: ${resolutionTypes}.
Use formatVersion "1" and metamodelVersion "resolution/1".
IDs use pattern: type:kebab-name (e.g., check:melee-attack, operation:cast-spell).

Example definitions:
${resolutionExampleJson}

## Context
${contextSummary}

## Instructions
When the GM describes a mechanic:
1. Identify what definition types are needed.
2. Ask clarifying questions ONLY for genuinely consequential ambiguities (not every possible detail).
3. Propose complete, valid definition bodies that implement the described mechanic.
4. List any assumptions you made that the GM should review.
5. Write a plain-language explanation of what the definitions do.

Always respond with ONLY valid JSON in this exact format — no prose outside the JSON:
{
  "questions": ["string — ask only if truly needed before proposing"],
  "explanation": "plain-language description of what was understood and proposed",
  "assumptions": ["stated assumption the GM should confirm"],
  "definitions": [
    { <complete definition body including formatVersion, metamodelVersion, definitionId, definitionType, name, and all required fields> }
  ]
}

If you are proposing definitions, always include them even if you have questions — the GM can answer questions and refine later.
If you cannot propose anything yet, return an empty definitions array.
Never include prose, markdown, or any content outside the JSON object.`;
  }

  // ── Parsing ─────────────────────────────────────────────────────────────────

  private parseResponse(text: string): { questions: string[]; explanation: string; assumptions: string[]; rawDefinitions: unknown[] } {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    return {
      questions: Array.isArray(parsed.questions) ? parsed.questions.filter((q: unknown) => typeof q === 'string') : [],
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((a: unknown) => typeof a === 'string') : [],
      rawDefinitions: Array.isArray(parsed.definitions) ? parsed.definitions : [],
    };
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  private validateProposedDefinitions(rawDefinitions: unknown[]): AssistantProposedDefinition[] {
    return rawDefinitions.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { body: {}, valid: false, diagnostics: [{ code: 'ASSISTANT_DEF_INVALID', path: '', message: 'Proposed definition is not an object.', severity: 'error' as const }] };
      }
      const body = raw as Record<string, unknown>;
      const metamodel = String(body.metamodelVersion ?? '');

      let diagnostics: Array<{ code: string; path: string; message: string; severity: 'error' | 'warning' }> = [];
      if (metamodel === 'creature-capabilities/1') {
        const result = compileCreatureCapabilities([body]);
        diagnostics = result.diagnostics;
      } else if (metamodel === 'resolution/1') {
        const result = compileResolutionDefinitions([body]);
        diagnostics = result.diagnostics;
      } else {
        diagnostics = [{ code: 'ASSISTANT_METAMODEL_UNKNOWN', path: 'metamodelVersion', message: `Unknown metamodelVersion '${metamodel}'.`, severity: 'error' }];
      }

      return { body, valid: !diagnostics.some((d) => d.severity === 'error'), diagnostics };
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async sendMessage(
    history: AssistantMessage[],
    userMessage: string,
    contextDefinitions: unknown[] = [],
  ): Promise<AssistantResponse> {
    if (!this.llm.isConfigured) {
      return {
        questions: [],
        explanation: 'The AI assistant is not configured. Set OPENAI_API_KEY or LLAMA_MODEL_PATH to enable it.',
        assumptions: [],
        definitions: [],
        llmAvailable: false,
      };
    }

    const systemPrompt = this.buildSystemPrompt(contextDefinitions);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMessage },
    ];

    let raw: string;
    try {
      const completion = await this.llm.complete({ messages, responseFormat: 'json', maxTokens: 4096, temperature: 0.2 });
      raw = completion.text;
    } catch (error) {
      this.logger.error('LLM call failed', error);
      throw new Error('The AI assistant encountered an error. Please try again.');
    }

    let parsed: ReturnType<typeof this.parseResponse>;
    try {
      parsed = this.parseResponse(raw);
    } catch {
      this.logger.warn('Failed to parse assistant response as JSON', raw.slice(0, 200));
      return { questions: [], explanation: 'The assistant returned an unreadable response. Please try rephrasing your request.', assumptions: [], definitions: [], raw, llmAvailable: true };
    }

    const definitions = this.validateProposedDefinitions(parsed.rawDefinitions);
    return { questions: parsed.questions, explanation: parsed.explanation, assumptions: parsed.assumptions, definitions, raw, llmAvailable: true };
  }

  /** Generate AI tool schemas from metamodel descriptors — the "shared metamodel" piece. */
  getAiToolSchemas(): object[] {
    const creatureTools = Object.entries(
      require('../metamodel/creature-capability.descriptors').creatureDefinitionDescriptors,
    ).map(([type, descriptor]: [string, any]) => ({
      name: `propose_${type.replace(/-/g, '_')}_definition`,
      description: `${descriptor.label}: ${descriptor.help}`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          (descriptor.fields as any[]).map((field: any) => [
            field.fieldId,
            { type: field.valueType === 'number' ? 'number' : 'string', description: field.label },
          ]),
        ),
        required: (descriptor.fields as any[]).filter((f: any) => f.required).map((f: any) => f.fieldId),
      },
    }));

    const resolutionTools = Object.entries(
      require('../resolution/resolution.descriptors').resolutionDefinitionDescriptors,
    ).map(([type, descriptor]: [string, any]) => ({
      name: `propose_${type.replace(/-/g, '_')}_definition`,
      description: `${descriptor.label}: ${descriptor.help}`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          (descriptor.fields as any[]).map((field: any) => [
            field.fieldId,
            { type: 'string', description: field.label },
          ]),
        ),
        required: (descriptor.fields as any[]).filter((f: any) => f.required).map((f: any) => f.fieldId),
      },
    }));

    return [...creatureTools, ...resolutionTools];
  }
}
