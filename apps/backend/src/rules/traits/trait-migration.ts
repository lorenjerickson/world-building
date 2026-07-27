import {
  buildTraitShape,
  selectTraitDefinitionScope,
  type TraitShapeNode,
} from '@wanderlust-vtt/common';
import {
  LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION,
  TRAIT_COMPOSITION_METAMODEL_VERSION,
  type TraitCompositionDiagnostic,
  type TraitCompositionSourceDefinition,
} from './trait-composition.types';
import { compileTraitCompositions } from './trait-composition.compiler';

export interface TraitSemanticPathChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

export interface TraitMigrationPreview {
  valid: boolean;
  sourceVersion: string;
  targetVersion: typeof TRAIT_COMPOSITION_METAMODEL_VERSION;
  migratedBody?: Record<string, unknown>;
  pathChanges: TraitSemanticPathChange[];
  diagnostics: TraitCompositionDiagnostic[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function explicitPath(value: string): string {
  const path = value.trim();
  return /^(self|this|owner|target)(?:\.|$)/.test(path) ? path : `this.${path}`;
}

function migrateGrant(
  value: unknown,
  index: number,
  diagnostics: TraitCompositionDiagnostic[],
): unknown {
  if (!record(value)) return structuredClone(value);
  const grant = structuredClone(value);
  if (grant.dataType !== 'trait') return grant;
  if (typeof grant.into === 'string') {
    grant.into = explicitPath(grant.into);
    delete grant.key;
    return grant;
  }
  if (typeof grant.at === 'string') {
    grant.at = explicitPath(grant.at);
    delete grant.key;
    return grant;
  }
  if (typeof grant.key !== 'string' || !grant.key.trim()) {
    diagnostics.push({
      code: 'RULE_TRAIT_MIGRATION_PLACEMENT_MISSING',
      path: `body.grants[${index}].key`,
      message: 'This legacy trait addition has no stable placement key. Add one before migrating; display names are not used as paths.',
      severity: 'error',
    });
    return grant;
  }
  grant.at = `this.${grant.key.trim()}`;
  delete grant.key;
  return grant;
}

export function migrateTraitBody(body: Record<string, unknown>): TraitMigrationPreview {
  const sourceVersion = String(body.metamodelVersion ?? '');
  const diagnostics: TraitCompositionDiagnostic[] = [];
  if (sourceVersion !== LEGACY_TRAIT_COMPOSITION_METAMODEL_VERSION
    && sourceVersion !== TRAIT_COMPOSITION_METAMODEL_VERSION) {
    return {
      valid: false,
      sourceVersion,
      targetVersion: TRAIT_COMPOSITION_METAMODEL_VERSION,
      pathChanges: [],
      diagnostics: [{
        code: 'RULE_TRAIT_MIGRATION_SOURCE_INVALID',
        path: 'body.metamodelVersion',
        message: "Only trait/1 and trait/2 definitions can use the trait migration workflow.",
        severity: 'error',
      }],
    };
  }
  const grants = Array.isArray(body.grants)
    ? body.grants.map((grant, index) => migrateGrant(grant, index, diagnostics))
    : structuredClone(body.grants);
  const prerequisites = Array.isArray(body.prerequisites)
    ? { mode: 'all', ids: [...body.prerequisites] }
    : record(body.prerequisites)
      ? {
          mode: body.prerequisites.mode === 'all' ? 'all' : 'any',
          ids: Array.isArray(body.prerequisites.ids) ? [...body.prerequisites.ids] : [],
        }
      : undefined;
  const migratedBody = {
    ...structuredClone(body),
    metamodelVersion: TRAIT_COMPOSITION_METAMODEL_VERSION,
    grants,
    ...(prerequisites ? { prerequisites } : {}),
  };
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    sourceVersion,
    targetVersion: TRAIT_COMPOSITION_METAMODEL_VERSION,
    ...(diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? {} : { migratedBody }),
    pathChanges: [],
    diagnostics,
  };
}

function nodeMeaning(node: TraitShapeNode): string {
  if (node.kind === 'branch') return `branch:${node.traitId}`;
  if (node.kind === 'terminal') {
    return `terminal:${node.dataType}:${JSON.stringify(node.allowedValues ?? [])}`;
  }
  return `collection:${node.acceptsMode}:${node.capacity ?? 'unbounded'}:${[...node.acceptedTraitIds].sort().join(',')}:${node.entries
    .map((entry) => `${entry.traitId}*${entry.count}`)
    .sort()
    .join(',')}`;
}

function semanticPaths(
  definition: TraitCompositionSourceDefinition,
  definitions: TraitCompositionSourceDefinition[],
): Map<string, string> {
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: [definition.externalId],
    prerequisiteMode: 'all',
  });
  return new Map(shape.nodes.map((node) => [`self.${node.path.join('.')}`, nodeMeaning(node)]));
}

function comparePaths(before: Map<string, string>, after: Map<string, string>): TraitSemanticPathChange[] {
  const changes: TraitSemanticPathChange[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(path);
    const next = after.get(path);
    if (previous === next) continue;
    if (previous === undefined) changes.push({ path, kind: 'added', after: next });
    else if (next === undefined) changes.push({ path, kind: 'removed', before: previous });
    else changes.push({ path, kind: 'changed', before: previous, after: next });
  }
  return changes;
}

export function previewTraitDefinitionMigration(
  definition: TraitCompositionSourceDefinition,
  catalogDefinitions: TraitCompositionSourceDefinition[],
): TraitMigrationPreview {
  const migration = migrateTraitBody(definition.body);
  const migrationDiagnostics = migration.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    definitionExternalId: definition.externalId,
    definitionName: definition.name,
  }));
  if (!migration.valid || !migration.migratedBody) {
    return { ...migration, diagnostics: migrationDiagnostics };
  }
  const sourceDefinitions = catalogDefinitions.map((candidate) => structuredClone(candidate));
  const migratedDefinitions = sourceDefinitions.map((candidate) =>
    candidate.externalId === definition.externalId
      ? { ...candidate, body: migration.migratedBody! }
      : candidate);
  const compilation = compileTraitCompositions(selectTraitDefinitionScope(
    migratedDefinitions,
    [definition.externalId],
  ));
  const pathChanges = comparePaths(
    semanticPaths(definition, sourceDefinitions),
    semanticPaths(
      { ...definition, body: migration.migratedBody },
      migratedDefinitions,
    ),
  );
  const diagnostics = [...migrationDiagnostics, ...compilation.diagnostics];
  if (pathChanges.length) {
    diagnostics.push({
      code: 'RULE_TRAIT_MIGRATION_SEMANTIC_CHANGE',
      path: 'body',
      message: `Migration changes ${pathChanges.length} effective path${pathChanges.length === 1 ? '' : 's'}; review the semantic diff before applying it.`,
      severity: 'warning',
    });
  }
  return {
    ...migration,
    valid: compilation.valid,
    pathChanges,
    diagnostics,
  };
}
