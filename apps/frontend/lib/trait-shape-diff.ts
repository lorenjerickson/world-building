import type { TraitShape, TraitShapeNode } from './trait-shape';

export type TraitShapeChangeKind = 'added' | 'changed' | 'removed';

export type TraitShapeChange = {
  kind: TraitShapeChangeKind;
  path: string[];
  label: string;
  nodeKind: TraitShapeNode['kind'];
  before?: TraitShapeNode;
  after?: TraitShapeNode;
  summary: string;
};

function pathKey(path: string[]): string {
  return path.join('.');
}

function sources(node: TraitShapeNode): string[] {
  return [...new Set([
    ...(node.sourceTraitIds ?? []),
    ...(node.sourceTraitId ? [node.sourceTraitId] : []),
  ])].sort();
}

function comparableNode(node: TraitShapeNode): Record<string, unknown> {
  const common = {
    kind: node.kind,
    label: node.label,
    sources: sources(node),
  };
  if (node.kind === 'branch') {
    return { ...common, traitId: node.traitId };
  }
  if (node.kind === 'collection') {
    return {
      ...common,
      acceptedTraitIds: [...node.acceptedTraitIds].sort(),
      acceptsMode: node.acceptsMode,
      entries: node.entries
        .map((entry) => ({ ...entry }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    };
  }
  return {
    ...common,
    dataType: node.dataType,
    required: node.required ?? false,
    min: node.min,
    max: node.max,
    unit: node.unit,
    default: node.default,
    allowedValues: node.allowedValues ?? [],
  };
}

function describeNode(node: TraitShapeNode): string {
  if (node.kind === 'branch') return `trait branch for ${node.traitId}`;
  if (node.kind === 'collection') {
    const entryCount = node.entries.reduce((total, entry) => total + entry.count, 0);
    return `trait collection with ${entryCount} mounted ${entryCount === 1 ? 'entry' : 'entries'}`;
  }
  const constraints = [
    node.required ? 'required' : 'optional',
    node.dataType,
    node.unit ? `measured in ${node.unit}` : '',
    node.min !== undefined ? `minimum ${node.min}` : '',
    node.max !== undefined ? `maximum ${node.max}` : '',
    node.default !== undefined ? `default ${String(node.default)}` : '',
    node.allowedValues?.length ? `choices ${node.allowedValues.join(', ')}` : '',
  ].filter(Boolean);
  return `${constraints.join(', ')} field`;
}

export function diffTraitShapes(before: TraitShape, after: TraitShape): TraitShapeChange[] {
  const beforeByPath = new Map(before.nodes.map((node) => [pathKey(node.path), node]));
  const afterByPath = new Map(after.nodes.map((node) => [pathKey(node.path), node]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort();

  return paths.flatMap((path): TraitShapeChange[] => {
    const previous = beforeByPath.get(path);
    const next = afterByPath.get(path);
    if (!previous && next) {
      return [{
        kind: 'added',
        path: next.path,
        label: next.label,
        nodeKind: next.kind,
        after: next,
        summary: `Adds ${describeNode(next)}.`,
      }];
    }
    if (previous && !next) {
      return [{
        kind: 'removed',
        path: previous.path,
        label: previous.label,
        nodeKind: previous.kind,
        before: previous,
        summary: `Removes ${describeNode(previous)}.`,
      }];
    }
    if (!previous || !next || JSON.stringify(comparableNode(previous)) === JSON.stringify(comparableNode(next))) {
      return [];
    }
    return [{
      kind: 'changed',
      path: next.path,
      label: next.label,
      nodeKind: next.kind,
      before: previous,
      after: next,
      summary: `Changes ${describeNode(previous)} to ${describeNode(next)}.`,
    }];
  });
}
