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

@Injectable()
export class RuleAuthoringService {
  constructor(private readonly assistant: RuleAssistantService) {}

  getMetamodel() {
    return { ...creatureCapabilityMetamodelDescriptor, extensions: [resolutionMetamodelDescriptor] };
  }

  getDescriptor(type: string) {
    return getCreatureDefinitionDescriptor(type) ?? resolutionDefinitionDescriptors[type];
  }

  validate(definitions: unknown[]) {
    const creature = definitions.filter((definition) => (definition as any)?.metamodelVersion === 'creature-capabilities/1');
    const resolution = definitions.filter((definition) => (definition as any)?.metamodelVersion === 'resolution/1');
    const unknown = definitions.length - creature.length - resolution.length;
    const creatureResult = creature.length ? compileCreatureCapabilities(creature) : undefined;
    const resolutionResult = resolution.length ? compileResolutionDefinitions(resolution) : undefined;
    const diagnostics = [
      ...(creatureResult?.diagnostics ?? []),
      ...(resolutionResult?.diagnostics ?? []),
      ...(unknown ? [{ code: 'RULE_METAMODEL_UNKNOWN', path: 'definitions', message: `${unknown} definition(s) do not declare a supported metamodelVersion.`, severity: 'error' as const }] : []),
    ];
    const valid = !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    const artifacts = [creatureResult?.artifact, resolutionResult?.artifact].filter(Boolean).map((artifact) => ({ artifactVersion: artifact.artifactVersion, metamodelVersion: artifact.metamodelVersion, sourceHash: artifact.sourceHash }));
    return {
      valid,
      diagnostics,
      ...(artifacts.length === 1 ? { compiled: artifacts[0] } : {}),
      artifacts,
    };
  }

  preview(definitions: ResolutionDefinition[], operationId: string, context: ResolutionContext) {
    const compilation = compileResolutionDefinitions(definitions);
    if (!compilation.valid || !compilation.artifact) return { valid: false, diagnostics: compilation.diagnostics };
    return { valid: true, diagnostics: compilation.diagnostics, preview: previewResolutionOperation(compilation.artifact, operationId, context) };
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

  runFixtures(definitions: ResolutionDefinition[], fixtures: ResolutionFixture[]) {
    const compilation = compileResolutionDefinitions(definitions);
    if (!compilation.valid || !compilation.artifact) return { valid: false, diagnostics: compilation.diagnostics, results: [] };
    const results = fixtures.map((fixture) => {
      try {
        const preview = previewResolutionOperation(compilation.artifact!, fixture.operationId, fixture.context);
        const passed = fixture.expected.outcome === undefined || fixture.expected.outcome === preview.outcome;
        return { name: fixture.name, passed, preview, ...(passed ? {} : { message: `Expected ${fixture.expected.outcome}; received ${preview.outcome}.` }) };
      } catch (error) {
        return { name: fixture.name, passed: false, message: error instanceof Error ? error.message : 'Fixture failed.' };
      }
    });
    return { valid: results.every((result) => result.passed), diagnostics: compilation.diagnostics, results };
  }
}
