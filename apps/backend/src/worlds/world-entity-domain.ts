import {
  buildTraitShape,
  type TraitShape,
  type TraitShapeDefinition,
  type TraitShapeNode,
} from '@wanderlust-vtt/common';
import type { RuleReleaseResource } from '../rules/catalog/rule-catalog.types';

export type WorldEntityValues = Record<string, string | number | boolean | null>;

export type ReleasedTraitDefinition = TraitShapeDefinition & {
  description?: string;
  visibility: 'exported' | 'private';
  tags: string[];
};

export type WorldEntityDiagnostic = {
  code: string;
  path?: string;
  message: string;
};

export type WorldEntitySchema = {
  rootTraitIds: string[];
  prerequisiteSelections: Record<string, string[]>;
  satisfiedTraitIds: string[];
  shape: TraitShape;
};

export type CreateableTrait = {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  inheritedTraitIds: string[];
  prerequisiteChoices: Array<{
    traitId: string;
    traitName: string;
    options: Array<{ id: string; name: string }>;
    optionTraitIds: string[];
  }>;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : [];
}

export function releaseTraitDefinitions(release: RuleReleaseResource): ReleasedTraitDefinition[] {
  const snapshot = record(release.sourceSnapshot) ? release.sourceSnapshot : {};
  return (Array.isArray(snapshot.definitions) ? snapshot.definitions : []).flatMap((item) => {
    if (!record(item) || item.definitionType !== 'trait' || typeof item.externalId !== 'string'
      || typeof item.name !== 'string' || !record(item.body)) return [];
    return [{
      externalId: item.externalId,
      name: item.name,
      body: item.body,
      visibility: item.visibility === 'private' ? 'private' as const : 'exported' as const,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      tags: strings(item.tags),
    }];
  });
}

export function prerequisites(definition: TraitShapeDefinition): {
  ids: string[];
  mode: 'any' | 'all';
} {
  const value = definition.body.prerequisites;
  if (Array.isArray(value)) return { ids: strings(value), mode: 'any' };
  if (record(value)) return {
    ids: strings(value.ids),
    mode: value.mode === 'all' ? 'all' : 'any',
  };
  return { ids: [], mode: 'any' };
}

function selectedPrerequisites(
  definition: TraitShapeDefinition,
  selections: Record<string, string[]>,
): string[] {
  const contract = prerequisites(definition);
  if (contract.mode === 'all' || contract.ids.length <= 1) return contract.ids;
  return selections[definition.externalId]?.filter((id) => contract.ids.includes(id)) ?? [];
}

export function traitClosure(
  rootTraitIds: string[],
  definitions: TraitShapeDefinition[],
  selections: Record<string, string[]> = {},
): string[] {
  const byId = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const visited = new Set<string>();
  const visit = (traitId: string): void => {
    if (visited.has(traitId)) return;
    visited.add(traitId);
    const definition = byId.get(traitId);
    if (!definition) return;
    selectedPrerequisites(definition, selections).forEach(visit);
  };
  rootTraitIds.forEach(visit);
  return [...visited].sort();
}

function prerequisiteChoices(
  rootTraitId: string,
  definitions: TraitShapeDefinition[],
): CreateableTrait['prerequisiteChoices'] {
  const byId = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const visited = new Set<string>();
  const result: CreateableTrait['prerequisiteChoices'] = [];
  const visit = (traitId: string): void => {
    if (visited.has(traitId)) return;
    visited.add(traitId);
    const definition = byId.get(traitId);
    if (!definition) return;
    const contract = prerequisites(definition);
    if (contract.mode === 'any' && contract.ids.length > 1) {
      result.push({
        traitId,
        traitName: definition.name,
        optionTraitIds: contract.ids,
        options: contract.ids.map((id) => ({ id, name: byId.get(id)?.name ?? id })),
      });
    }
    contract.ids.forEach(visit);
  };
  visit(rootTraitId);
  return result;
}

export function buildWorldEntitySchema(
  rootTraitIds: string[],
  definitions: TraitShapeDefinition[],
  prerequisiteSelections: Record<string, string[]> = {},
): WorldEntitySchema {
  const uniqueRoots = [...new Set(rootTraitIds)];
  return {
    rootTraitIds: uniqueRoots,
    prerequisiteSelections,
    satisfiedTraitIds: traitClosure(uniqueRoots, definitions, prerequisiteSelections),
    shape: buildTraitShape({
      definitions,
      prerequisiteIds: uniqueRoots,
      prerequisiteMode: 'all',
      prerequisiteSelections,
    }),
  };
}

/** Leaf exported traits with configurable shape and guaranteed name/description. */
export function listCreateableTraits(definitions: ReleasedTraitDefinition[]): CreateableTrait[] {
  const usedAsPrerequisite = new Set(
    definitions.flatMap((definition) => prerequisites(definition).ids),
  );
  return definitions.flatMap((definition) => {
    if (definition.visibility !== 'exported' || usedAsPrerequisite.has(definition.externalId)) return [];
    const shape = buildWorldEntitySchema([definition.externalId], definitions).shape;
    const terminalPaths = new Set(
      shape.nodes.filter((node) => node.kind === 'terminal').map((node) => node.path.join('.')),
    );
    const configurable = shape.nodes.some((node) => node.kind === 'terminal' || node.kind === 'collection');
    if (!configurable || !terminalPaths.has('name') || !terminalPaths.has('description')) return [];
    return [{
      id: definition.externalId,
      name: definition.name,
      description: definition.description,
      tags: definition.tags,
      inheritedTraitIds: traitClosure([definition.externalId], definitions),
      prerequisiteChoices: prerequisiteChoices(definition.externalId, definitions),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function terminalDiagnostic(
  terminal: Extract<TraitShapeNode, { kind: 'terminal' }>,
  value: unknown,
): WorldEntityDiagnostic | undefined {
  const path = terminal.path.join('.');
  if (value === undefined || value === null || value === '') {
    return terminal.required || path === 'name' || path === 'description'
      ? { code: 'FIELD_REQUIRED', path, message: `${terminal.label} is required.` }
      : undefined;
  }
  if (terminal.dataType === 'number' && typeof value !== 'number') {
    return { code: 'FIELD_TYPE_INVALID', path, message: `${terminal.label} must be a number.` };
  }
  if (terminal.dataType === 'boolean' && typeof value !== 'boolean') {
    return { code: 'FIELD_TYPE_INVALID', path, message: `${terminal.label} must be true or false.` };
  }
  if (['text', 'enum', 'media'].includes(terminal.dataType) && typeof value !== 'string') {
    return { code: 'FIELD_TYPE_INVALID', path, message: `${terminal.label} must be text.` };
  }
  if (typeof value === 'number' && terminal.min !== undefined && value < terminal.min) {
    return { code: 'FIELD_MINIMUM', path, message: `${terminal.label} must be at least ${terminal.min}.` };
  }
  if (typeof value === 'number' && terminal.max !== undefined && value > terminal.max) {
    return { code: 'FIELD_MAXIMUM', path, message: `${terminal.label} must be at most ${terminal.max}.` };
  }
  if (terminal.dataType === 'enum' && terminal.allowedValues?.length
    && !terminal.allowedValues.includes(String(value))) {
    return { code: 'FIELD_ENUM_INVALID', path, message: `${terminal.label} is not an allowed value.` };
  }
  return undefined;
}

export function normalizeAndValidateValues(
  schema: WorldEntitySchema,
  input: Record<string, unknown>,
): { values: WorldEntityValues; diagnostics: WorldEntityDiagnostic[]; retainedValues: Record<string, unknown> } {
  const terminals = schema.shape.nodes.filter((node): node is Extract<TraitShapeNode, { kind: 'terminal' }> =>
    node.kind === 'terminal');
  const knownPaths = new Set(terminals.map((terminal) => terminal.path.join('.')));
  const values: WorldEntityValues = {};
  const incompatibleValues: Record<string, unknown> = {};
  const diagnostics: WorldEntityDiagnostic[] = schema.shape.diagnostics.map((diagnostic) => ({
    code: `SHAPE_${diagnostic.code.toUpperCase().replaceAll('-', '_')}`,
    path: diagnostic.path.join('.'),
    message: diagnostic.message,
  }));
  for (const terminal of terminals) {
    const path = terminal.path.join('.');
    const value = input[path] ?? terminal.default;
    const diagnostic = terminalDiagnostic(terminal, value);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      if (value !== undefined && value !== null && value !== '') incompatibleValues[path] = value;
      continue;
    }
    if (value !== undefined && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
      values[path] = value as WorldEntityValues[string];
    }
  }
  const retainedValues = {
    ...Object.fromEntries(Object.entries(input).filter(([path]) => !knownPaths.has(path))),
    ...incompatibleValues,
  };
  return { values, diagnostics, retainedValues };
}

export function schemaCollections(schema: WorldEntitySchema) {
  return schema.shape.nodes.filter((node): node is Extract<TraitShapeNode, { kind: 'collection' }> =>
    node.kind === 'collection');
}
