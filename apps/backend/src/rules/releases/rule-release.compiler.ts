import { createHash } from 'crypto';
import { buildTraitShape, traitSatisfiesCollection, type TraitShapeNode } from '@world-building/common';
import { compileCreatureCapabilities } from '../metamodel/creature-capability.compiler';
import { compileResolutionDefinitions } from '../resolution/resolution.compiler';
import { validateTemplateDefinition } from '../templates/template.compiler';
import { compileTraitCompositions } from '../traits/trait-composition.compiler';
import type {
  RuleDefinitionResource,
  RuleModuleResource,
  RuleSetResource,
} from '../catalog/rule-catalog.types';

export const RULE_RELEASE_FORMAT_VERSION = 'rule-release/1' as const;
export const RULE_RELEASE_COMPILER_VERSION = 'rule-release-compiler/1' as const;

export interface RuleReleaseDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
}

export interface CompiledRuleRelease {
  contentHash: string;
  dependencyLock: unknown[];
  engineCompatibility: Record<string, unknown>;
  manifest: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  diagnostics: RuleReleaseDiagnostic[];
}

export type RuleReleaseCompilationResult =
  | { valid: true; diagnostics: RuleReleaseDiagnostic[]; release: CompiledRuleRelease }
  | { valid: false; diagnostics: RuleReleaseDiagnostic[] };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function prefixDiagnostics(
  prefix: string,
  values: Array<{ code: string; message: string; path: string; severity: 'error' | 'warning' }>,
): RuleReleaseDiagnostic[] {
  return values.map((diagnostic) => ({
    ...diagnostic,
    path: `${prefix}${diagnostic.path ? `.${diagnostic.path}` : ''}`,
  }));
}

function validateResolutionDieTraits(
  traitResult: ReturnType<typeof compileTraitCompositions> | undefined,
  traitSources: Array<{ externalId: string; name: string; body: Record<string, unknown> }>,
  resolutionSources: Record<string, unknown>[],
  operationSubjectContracts: Record<string, {
    effectiveTraitIds: string[];
    effectiveTraitSelections?: Record<string, string[]>;
  }> | undefined,
  diagnostics: RuleReleaseDiagnostic[],
): void {
  type CollectionNode = Extract<TraitShapeNode, { kind: 'collection' }>;
  const traitIds = new Set(traitSources.map((trait) => trait.externalId));
  const concreteDice = new Map(
    (traitResult?.artifact?.traits ?? []).flatMap((trait) => {
      const sides = trait.modifiers.find((modifier) =>
        modifier.operation === 'sets'
        && modifier.path.join('.') === 'sides'
        && typeof modifier.amount === 'number');
      return sides && traitSatisfiesCollection(trait.traitId, ['trait:die'], 'any', traitSources)
        ? [[trait.traitId, sides.amount as number] as const]
        : [];
    }),
  );
  const rollContracts = new Map(
    (traitResult?.artifact?.traits ?? []).flatMap((trait) => {
      const collections = trait.nodes.filter((node): node is CollectionNode =>
        node.kind === 'collection'
        && node.acceptedTraitIds.includes('trait:die')
        && node.entries.length > 0);
      return collections.length === 1
        ? [[trait.traitId, collections[0].entries] as const]
        : [];
    }),
  );
  const checkSelection = (
    selection: unknown,
    path: string,
  ): void => {
    if (!record(selection) || typeof selection.dieTraitId !== 'string') return;
    const compiledSides = concreteDice.get(selection.dieTraitId);
    if (compiledSides === undefined) {
      diagnostics.push({
        code: 'RULE_RELEASE_DIE_TRAIT_INVALID',
        path: `${path}.dieTraitId`,
        message: `Die '${selection.dieTraitId}' must be a published trait that derives from Die and sets self.sides.`,
        severity: 'error',
      });
    } else if (selection.sides !== compiledSides) {
      diagnostics.push({
        code: 'RULE_RELEASE_DIE_SIDES_MISMATCH',
        path: `${path}.sides`,
        message: `Die '${selection.dieTraitId}' compiles to ${compiledSides} sides, not ${String(selection.sides)}.`,
        severity: 'error',
      });
    }
  };
  resolutionSources.forEach((definition, definitionIndex) => {
    const path = `artifacts.resolution.definitions[${definitionIndex}]`;
    const directSubjectTraitIds = Array.isArray(definition.subjectTraitIds)
      ? definition.subjectTraitIds
      : [];
    directSubjectTraitIds.forEach((traitId, subjectIndex) => {
      if (typeof traitId === 'string' && !traitIds.has(traitId)) {
        diagnostics.push({
          code: 'RULE_RELEASE_SUBJECT_TRAIT_INVALID',
          path: `${path}.subjectTraitIds[${subjectIndex}]`,
          message: `Subject trait '${traitId}' is not a published trait in this release.`,
          severity: 'error',
        });
      }
    });
    const directSubjectTraitSelections = record(definition.subjectTraitSelections)
      ? definition.subjectTraitSelections as Record<string, unknown>
      : {};
    const effectiveSubjectTraitIds = definition.definitionType === 'operation'
      && typeof definition.definitionId === 'string'
      ? operationSubjectContracts?.[definition.definitionId]?.effectiveTraitIds ?? directSubjectTraitIds
      : directSubjectTraitIds;
    const effectiveSubjectTraitSelections = definition.definitionType === 'operation'
      && typeof definition.definitionId === 'string'
      ? operationSubjectContracts?.[definition.definitionId]?.effectiveTraitSelections ?? directSubjectTraitSelections
      : directSubjectTraitSelections;
    const reachableSubjectTraitIds = new Set<string>();
    const visitSubjectTrait = (traitId: string): void => {
      if (reachableSubjectTraitIds.has(traitId)) return;
      reachableSubjectTraitIds.add(traitId);
      const trait = traitSources.find((candidate) => candidate.externalId === traitId);
      const prerequisites = record(trait?.body.prerequisites) && Array.isArray(trait.body.prerequisites.ids)
        ? trait.body.prerequisites.ids
        : Array.isArray(trait?.body.prerequisites)
          ? trait.body.prerequisites
          : [];
      prerequisites.filter((item): item is string => typeof item === 'string').forEach(visitSubjectTrait);
    };
    effectiveSubjectTraitIds.filter((traitId): traitId is string => typeof traitId === 'string').forEach(visitSubjectTrait);
    for (const [ownerTraitId, selection] of Object.entries(effectiveSubjectTraitSelections)) {
      const owner = traitSources.find((trait) => trait.externalId === ownerTraitId);
      const prerequisites = record(owner?.body.prerequisites) && Array.isArray(owner.body.prerequisites.ids)
        ? owner.body.prerequisites.ids.filter((item): item is string => typeof item === 'string')
        : [];
      if (!owner || !reachableSubjectTraitIds.has(ownerTraitId)
        || owner.body.prerequisites && record(owner.body.prerequisites) && owner.body.prerequisites.mode === 'all'
        || !Array.isArray(selection) || !selection.length
        || selection.some((traitId) => typeof traitId !== 'string' || !prerequisites.includes(traitId))) {
        diagnostics.push({
          code: 'RULE_RELEASE_SUBJECT_TRAIT_SELECTION_INVALID',
          path: `${path}.subjectTraitSelections.${ownerTraitId}`,
          message: `Subject selection for '${ownerTraitId}' must choose its published any-prerequisite alternatives.`,
          severity: 'error',
        });
      }
    }
    if (effectiveSubjectTraitIds.length) {
      const subjectShape = buildTraitShape({
        definitions: traitSources,
        prerequisiteIds: effectiveSubjectTraitIds.filter((traitId): traitId is string => typeof traitId === 'string'),
        prerequisiteMode: 'all',
        prerequisiteSelections: effectiveSubjectTraitSelections as Record<string, string[]>,
      });
      const availablePaths = new Set(
        subjectShape.nodes.flatMap((node) => {
          if (node.kind === 'terminal') return [`self.${node.path.join('.')}`];
          if (node.kind !== 'collection') return [];
          const elementShape = buildTraitShape({
            definitions: traitSources,
            prerequisiteIds: node.acceptedTraitIds,
            prerequisiteMode: node.acceptsMode,
          });
          return elementShape.nodes.flatMap((terminal) =>
            terminal.kind === 'terminal' && terminal.path.length === 1
              ? [`self.${node.path.join('.')}[].${terminal.path[0]}`]
              : []);
        }),
      );
      const visitExpressions = (value: unknown, valuePath: string): void => {
        if (Array.isArray(value)) {
          value.forEach((item, index) => visitExpressions(item, `${valuePath}[${index}]`));
          return;
        }
        if (!record(value)) return;
        if (value.op === 'trait-path-field' && typeof value.path === 'string' && !availablePaths.has(value.path)) {
          diagnostics.push({
            code: 'RULE_RELEASE_TRAIT_PATH_OUTSIDE_SUBJECT',
            path: `${valuePath}.path`,
            message: `Trait path '${value.path}' is not guaranteed by this rule's subject traits.`,
            severity: 'error',
          });
        }
        Object.entries(value).forEach(([key, item]) => visitExpressions(item, `${valuePath}.${key}`));
      };
      visitExpressions(definition, path);
    }
    if (definition.definitionType === 'check' && record(definition.roll)) {
      if (Array.isArray(definition.roll.dice)) {
        definition.roll.dice.forEach((die, dieIndex) => checkSelection(die, `${path}.roll.dice[${dieIndex}]`));
        if (typeof definition.roll.rollTraitId === 'string') {
          const entries = rollContracts.get(definition.roll.rollTraitId);
          if (!entries) {
            diagnostics.push({
              code: 'RULE_RELEASE_ROLL_TRAIT_INVALID',
              path: `${path}.roll.rollTraitId`,
              message: `Roll trait '${definition.roll.rollTraitId}' must expose exactly one non-empty collection accepting Die.`,
              severity: 'error',
            });
          } else {
            const aggregate = (values: unknown[]): string => JSON.stringify(
              [...values.reduce<Map<string, number>>((counts, value) => {
                if (!record(value)) return counts;
                const traitId = typeof value.traitId === 'string'
                  ? value.traitId
                  : typeof value.dieTraitId === 'string'
                    ? value.dieTraitId
                    : undefined;
                if (traitId && Number.isInteger(value.count)) {
                  counts.set(traitId, (counts.get(traitId) ?? 0) + Number(value.count));
                }
                return counts;
              }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)),
            );
            if (aggregate(entries) !== aggregate(definition.roll.dice)) {
              diagnostics.push({
                code: 'RULE_RELEASE_ROLL_TRAIT_POOL_MISMATCH',
                path: `${path}.roll.dice`,
                message: `Normalized dice do not match the compiled collection contributed by '${definition.roll.rollTraitId}'.`,
                severity: 'error',
              });
            }
          }
        }
      } else {
        checkSelection(definition.roll, `${path}.roll`);
      }
    }
    if (definition.definitionType === 'modifier' && definition.modifierKind === 'roll-result' && record(definition.rollOperation)) {
      if (definition.rollOperation.kind === 'add-dice') checkSelection(definition.rollOperation.dice, `${path}.rollOperation.dice`);
      if (definition.rollOperation.kind === 'replace-result') checkSelection(definition.rollOperation.die, `${path}.rollOperation.die`);
    }
    if (definition.definitionType === 'modifier' && record(definition.appliesTo) && Array.isArray(definition.appliesTo.rollTraitIds)) {
      definition.appliesTo.rollTraitIds.forEach((rollTraitId, targetIndex) => {
        if (typeof rollTraitId === 'string' && !rollContracts.has(rollTraitId)) {
          diagnostics.push({
            code: 'RULE_RELEASE_ROLL_TRAIT_TARGET_INVALID',
            path: `${path}.appliesTo.rollTraitIds[${targetIndex}]`,
            message: `Modifier target '${rollTraitId}' must be a published trait with exactly one non-empty collection accepting Die.`,
            severity: 'error',
          });
        }
      });
    }
    if (definition.definitionType === 'modifier' && Array.isArray(definition.activatedByTraitIds)) {
      definition.activatedByTraitIds.forEach((traitId, activationIndex) => {
        if (typeof traitId === 'string' && !traitIds.has(traitId)) {
          diagnostics.push({
            code: 'RULE_RELEASE_ACTIVATING_TRAIT_INVALID',
            path: `${path}.activatedByTraitIds[${activationIndex}]`,
            message: `Modifier activation trait '${traitId}' is not a published trait in this release.`,
            severity: 'error',
          });
        }
      });
    }
  });
}

export function compileRuleRelease(
  ruleSet: RuleSetResource,
  modules: RuleModuleResource[],
  definitions: RuleDefinitionResource[],
): RuleReleaseCompilationResult {
  const diagnostics: RuleReleaseDiagnostic[] = [];
  const sortedModules = [...modules].sort((left, right) =>
    left.externalId.localeCompare(right.externalId));
  const sortedDefinitions = [...definitions].sort((left, right) =>
    left.externalId.localeCompare(right.externalId));
  if (modules.length === 0) {
    diagnostics.push({
      code: 'RULE_RELEASE_MODULES_REQUIRED',
      path: 'modules',
      message: 'A release requires at least one module.',
      severity: 'error',
    });
  }
  if (definitions.length === 0) {
    diagnostics.push({
      code: 'RULE_RELEASE_DEFINITIONS_REQUIRED',
      path: 'definitions',
      message: 'A release requires at least one definition.',
      severity: 'error',
    });
  }

  const moduleIds = new Set(sortedModules.map((module) => module.id));
  const definitionIds = new Set<string>();
  sortedDefinitions.forEach((definition, index) => {
    if (!moduleIds.has(definition.moduleId)) {
      diagnostics.push({
        code: 'RULE_RELEASE_MODULE_REFERENCE_MISSING',
        path: `definitions[${index}].moduleId`,
        message: `Definition '${definition.name}' references a module outside this rule set.`,
        severity: 'error',
      });
    }
    if (definitionIds.has(definition.externalId)) {
      diagnostics.push({
        code: 'RULE_RELEASE_DEFINITION_ID_DUPLICATE',
        path: `definitions[${index}].externalId`,
        message: `Definition ID '${definition.externalId}' is duplicated.`,
        severity: 'error',
      });
    }
    definitionIds.add(definition.externalId);
    if (typeof definition.body.definitionType === 'string'
      && definition.body.definitionType !== definition.definitionType) {
      diagnostics.push({
        code: 'RULE_RELEASE_DEFINITION_TYPE_MISMATCH',
        path: `definitions[${index}].body.definitionType`,
        message: `Catalog type '${definition.definitionType}' does not match body type '${definition.body.definitionType}'.`,
        severity: 'error',
      });
    }
    if (['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)) && definition.definitionType !== 'trait') {
      diagnostics.push({
        code: 'RULE_RELEASE_DEFINITION_TYPE_MISMATCH',
        path: `definitions[${index}].definitionType`,
        message: 'Bodies using a trait metamodelVersion must be cataloged as traits.',
        severity: 'error',
      });
    }
  });

  const traitSources = sortedDefinitions
    .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
    .map((definition) => ({
      externalId: definition.externalId,
      name: definition.name,
      body: definition.body,
    }));
  const creatureSources = sortedDefinitions
    .filter((definition) => definition.body.metamodelVersion === 'creature-capabilities/1')
    .map((definition) => definition.body);
  const resolutionSources = sortedDefinitions
    .filter((definition) => definition.body.metamodelVersion === 'resolution/1')
    .map((definition) => definition.body);
  const templateSources = sortedDefinitions
    .filter((definition) => definition.body.metamodelVersion === 'template/1');
  const recognized = new Set([
    'trait/1',
    'trait/2',
    'creature-capabilities/1',
    'resolution/1',
    'template/1',
  ]);
  sortedDefinitions.forEach((definition, index) => {
    if (!recognized.has(String(definition.body.metamodelVersion))) {
      diagnostics.push({
        code: 'RULE_RELEASE_METAMODEL_UNKNOWN',
        path: `definitions[${index}].body.metamodelVersion`,
        message: `Definition '${definition.name}' does not declare a publishable metamodelVersion.`,
        severity: 'error',
      });
    }
  });

  const traitResult = traitSources.length ? compileTraitCompositions(traitSources) : undefined;
  const creatureResult = creatureSources.length ? compileCreatureCapabilities(creatureSources) : undefined;
  const resolutionResult = resolutionSources.length ? compileResolutionDefinitions(resolutionSources) : undefined;
  diagnostics.push(
    ...prefixDiagnostics('artifacts.traitComposition', traitResult?.diagnostics ?? []),
    ...prefixDiagnostics('artifacts.creatureCapabilities', creatureResult?.diagnostics ?? []),
    ...prefixDiagnostics('artifacts.resolution', resolutionResult?.diagnostics ?? []),
  );
  if (resolutionSources.length) {
    validateResolutionDieTraits(
      traitResult,
      traitSources,
      resolutionSources,
      resolutionResult?.artifact?.operationSubjectContracts,
      diagnostics,
    );
  }
  templateSources.forEach((definition, index) => {
    diagnostics.push(...prefixDiagnostics(
      `artifacts.templates[${index}]`,
      validateTemplateDefinition(definition.body),
    ));
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { valid: false, diagnostics };
  }

  const sourceSnapshot: Record<string, unknown> = {
    formatVersion: RULE_RELEASE_FORMAT_VERSION,
    ruleSet: {
      externalId: ruleSet.externalId,
      name: ruleSet.name,
      slug: ruleSet.slug,
      summary: ruleSet.summary,
      description: ruleSet.description,
      engineFeatureLevel: ruleSet.engineFeatureLevel,
      tags: ruleSet.tags,
    },
    modules: sortedModules.map((module) => ({
      externalId: module.externalId,
      namespace: module.namespace,
      name: module.name,
      description: module.description,
      sortOrder: module.sortOrder,
      requiredEngineFeatureLevel: module.requiredEngineFeatureLevel,
      dependencies: module.dependencies,
      exports: module.exports,
    })),
    definitions: sortedDefinitions.map((definition) => ({
      externalId: definition.externalId,
      moduleExternalId: sortedModules.find((module) => module.id === definition.moduleId)?.externalId,
      definitionType: definition.definitionType,
      name: definition.name,
      description: definition.description,
      schemaVersion: definition.schemaVersion,
      visibility: definition.visibility,
      body: definition.body,
      presentation: definition.presentation,
      tags: definition.tags,
    })),
  };
  const dependencyLock = sortedModules.map((module) => ({
    moduleExternalId: module.externalId,
    namespace: module.namespace,
    dependencies: module.dependencies,
  }));
  const engineCompatibility = {
    ruleSetFeatureLevel: ruleSet.engineFeatureLevel,
    moduleFeatureLevels: sortedModules.map((module) => ({
      moduleExternalId: module.externalId,
      requiredEngineFeatureLevel: module.requiredEngineFeatureLevel,
    })),
  };
  const artifacts = {
    ...(traitResult?.artifact ? { traitComposition: traitResult.artifact } : {}),
    ...(creatureResult?.artifact ? { creatureCapabilities: creatureResult.artifact } : {}),
    ...(resolutionResult?.artifact ? { resolution: resolutionResult.artifact } : {}),
    ...(templateSources.length ? {
      templates: {
        metamodelVersion: 'template/1',
        sourceHash: hash(templateSources.map((definition) => definition.body)),
        definitions: templateSources.map((definition) => definition.body),
      },
    } : {}),
  };
  const manifest: Record<string, unknown> = {
    formatVersion: RULE_RELEASE_FORMAT_VERSION,
    compilerVersion: RULE_RELEASE_COMPILER_VERSION,
    ruleSetExternalId: ruleSet.externalId,
    artifacts,
    definitions: sortedDefinitions.map((definition) => ({
      externalId: definition.externalId,
      definitionType: definition.definitionType,
      sourceHash: hash(definition.body),
    })),
    validationSummary: {
      valid: true,
      errors: 0,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
      diagnostics,
    },
  };
  const contentHash = hash({
    dependencyLock,
    engineCompatibility,
    manifest,
    sourceSnapshot,
  });

  return {
    valid: true,
    diagnostics,
    release: {
      contentHash,
      dependencyLock,
      engineCompatibility,
      manifest,
      sourceSnapshot,
      diagnostics,
    },
  };
}
