import { Injectable } from '@nestjs/common';

export type ParsedRuleParameter = {
  name: string;
  kind: 'number' | 'dice' | 'keyword';
  value: number | string | { count: number; sides: number; modifier: number };
  unit?: string;
  raw: string;
};

export type ParsedRuleSentence = {
  sentence: string;
  subject?: string;
  capability?: string;
  parameters: ParsedRuleParameter[];
  predicates: string[];
  confidence: number;
};

export type DraftDefinitionPatch = {
  definitionType: 'trait' | 'check' | 'operation' | 'modifier';
  name: string;
  patch: Record<string, unknown>;
  rationale: string;
};

export type RuleSentenceParseResult = {
  slots: ParsedRuleSentence[];
  draftDefinitionPatches: DraftDefinitionPatch[];
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'draft';
}

function title(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 80) || 'Draft Rule';
}

@Injectable()
export class RuleSentenceParserService {
  parse(message: string): RuleSentenceParseResult {
    const sentences = this.toSentences(message);
    const slots = sentences.map((sentence) => this.parseSentence(sentence));
    const draftDefinitionPatches = slots.flatMap((slot, index) => this.toDraftPatches(slot, index));
    return { slots, draftDefinitionPatches };
  }

  private toSentences(message: string): string[] {
    return message
      .split(/(?<=[.!?])\s+|\n+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .slice(0, 6);
  }

  private parseSentence(sentence: string): ParsedRuleSentence {
    const lowered = sentence.toLowerCase();
    const parameters = this.extractParameters(sentence);
    const predicates = this.extractPredicates(sentence);

    const subjectMatch = sentence.match(/^(?:when\s+|if\s+)?(.+?)\s+(?:can|may|must|should)\s+/i)
      || sentence.match(/^(.+?)\s+(?:gains?|gets?|receives?)\s+/i);
    const subject = subjectMatch?.[1]?.trim();

    const capabilityMatch = sentence.match(/\b(?:can|may|must|should|gains?|gets?|receives?)\s+(.+?)(?:\b(?:if|when|unless|while|provided)\b|[.;!?]|$)/i)
      || sentence.match(/^(?:if|when)\s+.+?,\s*(.+?)(?:[.;!?]|$)/i);
    const capability = capabilityMatch?.[1]?.trim();

    let confidence = 0.25;
    if (subject) confidence += 0.25;
    if (capability) confidence += 0.25;
    if (parameters.length > 0) confidence += 0.15;
    if (predicates.length > 0) confidence += 0.1;
    if (lowered.includes('roll') || lowered.includes('attack') || lowered.includes('damage')) confidence += 0.1;

    return {
      sentence,
      ...(subject ? { subject } : {}),
      ...(capability ? { capability } : {}),
      parameters,
      predicates,
      confidence: Math.min(1, Number(confidence.toFixed(2))),
    };
  }

  private extractPredicates(sentence: string): string[] {
    const matches = [...sentence.matchAll(/\b(if|when|unless|while|provided)\b\s+([^,.;!?]+)/gi)];
    return matches
      .map((match) => `${match[1].toLowerCase()} ${match[2].trim()}`)
      .filter((item) => item.length > 3)
      .slice(0, 6);
  }

  private extractParameters(sentence: string): ParsedRuleParameter[] {
    const parameters: ParsedRuleParameter[] = [];

    for (const match of sentence.matchAll(/([+-]?\d+)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?/gi)) {
      const count = Number(match[1]);
      const sides = Number(match[2]);
      const sign = match[3] === '-' ? -1 : 1;
      const extra = match[4] ? Number(match[4]) * sign : 0;
      parameters.push({
        name: 'dice',
        kind: 'dice',
        value: { count, sides, modifier: extra },
        raw: match[0],
      });
    }

    for (const match of sentence.matchAll(/\b([+-]?\d+(?:\.\d+)?)\s*(ft|feet|m|meters?|squares?|hp|damage|bonus|penalty|seconds?|rounds?|turns?|%)\b/gi)) {
      parameters.push({
        name: 'amount',
        kind: 'number',
        value: Number(match[1]),
        unit: match[2].toLowerCase(),
        raw: match[0],
      });
    }

    for (const keyword of ['advantage', 'disadvantage', 'critical hit', 'line of sight', 'cover', 'reaction']) {
      if (sentence.toLowerCase().includes(keyword)) {
        parameters.push({
          name: keyword.replace(/\s+/g, '-'),
          kind: 'keyword',
          value: keyword,
          raw: keyword,
        });
      }
    }

    return parameters.slice(0, 12);
  }

  private toDraftPatches(slot: ParsedRuleSentence, index: number): DraftDefinitionPatch[] {
    const source = slot.capability ?? slot.sentence;
    const lowered = source.toLowerCase();
    const baseName = title(source);
    const baseId = slug(source);
    const predicateText = slot.predicates.join('; ');
    const parameterSummary = slot.parameters.map((p) => p.raw).join(', ');

    if (/\b(roll|attack|check|save|initiative)\b/.test(lowered)) {
      return [{
        definitionType: 'check',
        name: baseName,
        patch: {
          metamodelVersion: 'resolution/1',
          definitionType: 'check',
          definitionId: `check:${baseId || `draft-${index + 1}`}`,
          name: baseName,
          narrativeIntent: slot.sentence,
          parsedSubject: slot.subject,
          parsedPredicates: slot.predicates,
          parsedParameters: slot.parameters,
        },
        rationale: `Classified as a check because the sentence references roll/check semantics${predicateText ? ` with conditions: ${predicateText}` : ''}.`,
      }];
    }

    if (/\b(damage|heal|heals|reduce|increase|bonus|penalty|modify|multipl)\b/.test(lowered)) {
      return [{
        definitionType: 'modifier',
        name: baseName,
        patch: {
          metamodelVersion: 'resolution/1',
          definitionType: 'modifier',
          definitionId: `modifier:${baseId || `draft-${index + 1}`}`,
          name: baseName,
          parsedEffect: slot.capability ?? slot.sentence,
          parsedPredicates: slot.predicates,
          parsedParameters: slot.parameters,
        },
        rationale: `Classified as a modifier because the sentence appears to adjust values${parameterSummary ? ` (${parameterSummary})` : ''}.`,
      }];
    }

    return [{
      definitionType: 'trait',
      name: baseName,
      patch: {
        metamodelVersion: 'trait/2',
        definitionType: 'trait',
        definitionId: `trait:${baseId || `draft-${index + 1}`}`,
        name: baseName,
        grants: [],
        parsedCapability: slot.capability ?? slot.sentence,
        parsedSubject: slot.subject,
        parsedPredicates: slot.predicates,
        parsedParameters: slot.parameters,
      },
      rationale: 'Classified as a trait because it describes a standing capability rather than a direct roll procedure.',
    }];
  }
}