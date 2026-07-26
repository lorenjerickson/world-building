import {
  traitShapeTerminalPaths,
  type TraitShape,
  type TraitShapeDefinition,
  type TraitShapeNode,
} from './trait-shape';

export type TraitModifierOperation =
  | 'increases'
  | 'decreases'
  | 'multiplies'
  | 'divides'
  | 'sets'
  | 'at-least'
  | 'at-most';

export type TraitModifierPathOption = {
  segments: string[];
  path: string;
  label: string;
  dataType: string;
  sourceTraitIds: string[];
  repeatedCollectionPaths: string[][];
  searchText: string;
};

function operationSupports(
  operation: TraitModifierOperation,
  dataType: Extract<TraitShapeNode, { kind: 'terminal' }>['dataType'],
): boolean {
  return operation === 'sets' || dataType === 'number';
}

function sourcesFrom(node: TraitShapeNode): string[] {
  return [...new Set([
    ...(node.sourceTraitIds ?? []),
    ...(node.sourceTraitId ? [node.sourceTraitId] : []),
    ...(node.kind === 'branch' ? [node.traitId] : []),
  ])].sort();
}

function option(
  root: 'self' | 'this',
  structuralSegments: string[],
  labels: string[],
  dataType: string,
  sourceTraitIds: string[],
  repeatedCollectionPaths: string[][],
  definitionsById: Map<string, TraitShapeDefinition>,
): TraitModifierPathOption {
  const segments = [root, ...structuralSegments];
  const path = segments.join('.');
  const sourceLabels = sourceTraitIds.map((traitId) => definitionsById.get(traitId)?.name ?? traitId);
  const breadcrumb = [root === 'self' ? 'Self' : 'This trait', ...labels].join(' › ');
  return {
    segments,
    path,
    label: `${breadcrumb} — ${dataType}`,
    dataType,
    sourceTraitIds,
    repeatedCollectionPaths,
    searchText: [
      path,
      breadcrumb,
      dataType,
      ...structuralSegments,
      ...labels,
      ...sourceTraitIds,
      ...sourceLabels,
    ].join(' ').toLowerCase(),
  };
}

export function traitModifierPathOptions(
  shape: TraitShape,
  definitions: TraitShapeDefinition[],
  operation: TraitModifierOperation,
): TraitModifierPathOption[] {
  const definitionsById = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const structuralOptions: Array<{
    segments: string[];
    labels: string[];
    dataType: string;
    sourceTraitIds: string[];
    repeatedCollectionPaths: string[][];
  }> = [];

  for (const terminalPath of traitShapeTerminalPaths(shape, definitions)) {
    if (!operationSupports(operation, terminalPath.terminal.dataType)) continue;
    structuralOptions.push({
      segments: terminalPath.path,
      labels: terminalPath.path.map((segment, index) =>
        index === terminalPath.path.length - 1
          ? terminalPath.terminal.label
          : segment.replace(/\[\]$/, '')),
      dataType: terminalPath.terminal.dataType,
      sourceTraitIds: sourcesFrom(terminalPath.terminal),
      repeatedCollectionPaths: terminalPath.repeatedCollectionPaths,
    });
  }

  return structuralOptions
    .flatMap((candidate) => (['self', 'this'] as const).map((root) =>
      option(
        root,
        candidate.segments,
        candidate.labels,
        candidate.dataType,
        candidate.sourceTraitIds,
        candidate.repeatedCollectionPaths,
        definitionsById,
      )))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function searchTraitModifierPaths(
  options: TraitModifierPathOption[],
  query: string,
): TraitModifierPathOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter((candidate) => terms.every((term) => candidate.searchText.includes(term)));
}
