import { Injectable } from '@nestjs/common';
import { compileCreatureCapabilities } from '../metamodel/creature-capability.compiler';
import {
  creatureCapabilityMetamodelDescriptor,
  getCreatureDefinitionDescriptor,
} from '../metamodel/creature-capability.descriptors';
import { compileResolutionDefinitions } from '../resolution/resolution.compiler';
import { previewResolutionOperation } from '../resolution/resolution.evaluator';
import { resolutionDefinitionDescriptors, resolutionMetamodelDescriptor } from '../resolution/resolution.descriptors';
import type { ResolutionContext, ResolutionDefinition, ResolutionFixture } from '../resolution/resolution.types';
import { instantiateTemplate, validateTemplateDefinition } from '../templates/template.compiler';
import type { TemplateDefinition, TemplateParameterValues } from '../templates/template.types';
import type { AssistantMessage } from '../assistant/rule-assistant.service';
import { RuleAssistantService } from '../assistant/rule-assistant.service';
import type { RuleSentenceParseResult } from '../assistant/rule-sentence-parser.service';
import { compileTraitCompositions } from '../traits/trait-composition.compiler';
import {
  traitCompositionMetamodelDescriptor,
  type TraitCompositionSourceDefinition,
} from '../traits/trait-composition.types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function traitSource(value: unknown, index: number): TraitCompositionSourceDefinition | undefined {
  if (!record(value)) return undefined;
  if (record(value.body) && ['trait/1', 'trait/2'].includes(String(value.body.metamodelVersion))) {
    return {
      externalId: typeof value.externalId === 'string' && value.externalId
        ? value.externalId
        : `trait:draft-${index}`,
      name: typeof value.name === 'string' && value.name ? value.name : `Draft trait ${index + 1}`,
      body: value.body,
    };
  }
  if (!['trait/1', 'trait/2'].includes(String(value.metamodelVersion))) return undefined;
  return {
    externalId: typeof value.externalId === 'string' && value.externalId
      ? value.externalId
      : typeof value.definitionId === 'string' && value.definitionId
        ? value.definitionId
        : `trait:draft-${index}`,
    name: typeof value.name === 'string' && value.name ? value.name : `Draft trait ${index + 1}`,
    body: value,
  };
}

function resolutionSource(value: unknown): ResolutionDefinition | undefined {
  if (!record(value)) return undefined;
  const body = record(value.body) ? value.body : value;
  return body.metamodelVersion === 'resolution/1' ? body as unknown as ResolutionDefinition : undefined;
}

@Injectable()
export class RuleAuthoringService {
  constructor(private readonly assistant: RuleAssistantService) {}

  getMetamodel() {
    return {
      ...creatureCapabilityMetamodelDescriptor,
      extensions: [resolutionMetamodelDescriptor, traitCompositionMetamodelDescriptor],
    };
  }

  getDescriptor(type: string) {
    return getCreatureDefinitionDescriptor(type) ?? resolutionDefinitionDescriptors[type];
  }

  validate(definitions: unknown[]) {
    const creature = definitions.filter((definition) => (definition as any)?.metamodelVersion === 'creature-capabilities/1');
    const resolution = definitions.filter((definition) => (definition as any)?.metamodelVersion === 'resolution/1');
    const traits = definitions
      .map(traitSource)
      .filter((definition): definition is TraitCompositionSourceDefinition => definition !== undefined);
    const unknown = definitions.length - creature.length - resolution.length - traits.length;
    const creatureResult = creature.length ? compileCreatureCapabilities(creature) : undefined;
    const resolutionResult = resolution.length ? compileResolutionDefinitions(resolution) : undefined;
    const traitResult = traits.length ? compileTraitCompositions(traits) : undefined;
    const diagnostics = [
      ...(creatureResult?.diagnostics ?? []),
      ...(resolutionResult?.diagnostics ?? []),
      ...(traitResult?.diagnostics ?? []),
      ...(unknown ? [{ code: 'RULE_METAMODEL_UNKNOWN', path: 'definitions', message: `${unknown} definition(s) do not declare a supported metamodelVersion.`, severity: 'error' as const }] : []),
    ];
    const valid = !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    const artifacts = [creatureResult?.artifact, resolutionResult?.artifact, traitResult?.artifact]
      .filter(Boolean)
      .map((artifact) => ({
        artifactVersion: artifact.artifactVersion,
        metamodelVersion: artifact.metamodelVersion,
        sourceHash: artifact.sourceHash,
      }));
    return {
      valid,
      diagnostics,
      ...(artifacts.length === 1 ? { compiled: artifacts[0] } : {}),
      artifacts,
    };
  }

  preview(definitions: unknown[], operationId: string, context: ResolutionContext) {
    const resolutionDefinitions = definitions
      .map(resolutionSource)
      .filter((definition): definition is ResolutionDefinition => definition !== undefined);
    const traitDefinitions = definitions
      .map(traitSource)
      .filter((definition): definition is TraitCompositionSourceDefinition => definition !== undefined);
    const resolution = compileResolutionDefinitions(resolutionDefinitions);
    const traits = traitDefinitions.length ? compileTraitCompositions(traitDefinitions) : undefined;
    const diagnostics = [...resolution.diagnostics, ...(traits?.diagnostics ?? [])];
    if (!resolution.valid || !resolution.artifact || (traits && !traits.valid)) return { valid: false, diagnostics };
    return {
      valid: true,
      diagnostics,
      preview: previewResolutionOperation(resolution.artifact, operationId, context, traits?.artifact),
    };
  }

  instantiateTemplate(templateBody: unknown, values: TemplateParameterValues) {
    const validationDiagnostics = validateTemplateDefinition(templateBody);
    if (validationDiagnostics.some((d) => d.severity === 'error')) {
      return { valid: false, definitions: [], diagnostics: validationDiagnostics };
    }
    return instantiateTemplate(templateBody as TemplateDefinition, values);
  }

  async sendAssistantMessage(history: AssistantMessage[], userMessage: string, contextDefinitions: unknown[]) {
    return this.assistant.sendMessage(history, userMessage, contextDefinitions);
  }

  getAiToolSchemas() {
    return this.assistant.getAiToolSchemas();
  }

  parseRuleSentence(message: string): RuleSentenceParseResult {
    return this.assistant.parseSentence(message);
  }

  runFixtures(definitions: unknown[], fixtures: ResolutionFixture[]) {
    const resolutionDefinitions = definitions
      .map(resolutionSource)
      .filter((definition): definition is ResolutionDefinition => definition !== undefined);
    const traitDefinitions = definitions
      .map(traitSource)
      .filter((definition): definition is TraitCompositionSourceDefinition => definition !== undefined);
    const compilation = compileResolutionDefinitions(resolutionDefinitions);
    const traits = traitDefinitions.length ? compileTraitCompositions(traitDefinitions) : undefined;
    const diagnostics = [...compilation.diagnostics, ...(traits?.diagnostics ?? [])];
    if (!compilation.valid || !compilation.artifact || (traits && !traits.valid)) return { valid: false, diagnostics, results: [] };
    const results = fixtures.map((fixture) => {
      try {
        const preview = previewResolutionOperation(compilation.artifact!, fixture.operationId, fixture.context, traits?.artifact);
        const passed = fixture.expected.outcome === undefined || fixture.expected.outcome === preview.outcome;
        return { name: fixture.name, passed, preview, ...(passed ? {} : { message: `Expected ${fixture.expected.outcome}; received ${preview.outcome}.` }) };
      } catch (error) {
        return { name: fixture.name, passed: false, message: error instanceof Error ? error.message : 'Fixture failed.' };
      }
    });
    return { valid: results.every((result) => result.passed), diagnostics, results };
  }
}
