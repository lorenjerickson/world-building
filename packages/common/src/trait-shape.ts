import type { CanonicalUnitId } from './units';

export type TraitGrantDataType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'trait'
  | 'extends'
  | 'trait-collection'
  | 'modifier'
  | 'suppression'
  | 'replacement'
  | 'slot'
  | 'slot-affinity';

export type TraitShapeGrant = {
  key?: string;
  label?: string;
  dataType: TraitGrantDataType;
  required?: boolean;
  min?: number;
  max?: number;
  unit?: CanonicalUnitId;
  default?: string | number | boolean;
  ref?: string;
  allowedValues?: string[];
  acceptedTraits?: string[];
  acceptsMode?: 'any' | 'all';
  count?: number;
  into?: string;
  at?: string;
  requiresTraitId?: string;
};

export type TraitShapeDefinition = {
  externalId: string;
  name: string;
  body: Record<string, unknown>;
};

export type TraitShapeNode =
  | {
    kind: 'branch';
    path: string[];
    label: string;
    traitId: string;
    sourceTraitId?: string;
    sourceTraitIds?: string[];
  }
  | {
    kind: 'terminal';
    path: string[];
    label: string;
    dataType: Exclude<TraitGrantDataType, 'trait' | 'extends' | 'trait-collection'>;
    required?: boolean;
    min?: number;
    max?: number;
    unit?: CanonicalUnitId;
    default?: string | number | boolean;
    allowedValues?: string[];
    sourceTraitId?: string;
    sourceTraitIds?: string[];
  }
  | {
    kind: 'collection';
    path: string[];
    label: string;
    acceptedTraitIds: string[];
    acceptsMode: 'any' | 'all';
    entries: Array<{
      traitId: string;
      count: number;
      sourceTraitId?: string;
    }>;
    sourceTraitId?: string;
    sourceTraitIds?: string[];
  };

export type TraitShapeDiagnostic = {
  code:
    | 'cycle'
    | 'missing-reference'
    | 'path-conflict'
    | 'depth-limit'
    | 'node-limit'
    | 'missing-collection'
    | 'collection-type-mismatch'
    | 'invalid-count';
  path: string[];
  message: string;
};

export type TraitShape = {
  nodes: TraitShapeNode[];
  diagnostics: TraitShapeDiagnostic[];
};

export type TraitShapeTerminalPath = {
  path: string[];
  terminal: Extract<TraitShapeNode, { kind: 'terminal' }>;
  repeatedCollectionPaths: string[][];
};

export type BuildTraitShapeInput = {
  definitions: TraitShapeDefinition[];
  prerequisiteIds: string[];
  prerequisiteMode?: 'any' | 'all';
  prerequisiteSelections?: Record<string, string[]>;
  draftGrants?: TraitShapeGrant[];
  maximumDepth?: number;
  maximumNodes?: number;
};

type MutableShape = {
  nodesByPath: Map<string, TraitShapeNode>;
  diagnostics: TraitShapeDiagnostic[];
};

const DEFAULT_MAXIMUM_DEPTH = 32;
const DEFAULT_MAXIMUM_NODES = 2_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function referencedTraitIds(definition: TraitShapeDefinition): string[] {
  const references: string[] = [];
  const prerequisites = definition.body.prerequisites;
  if (Array.isArray(prerequisites)) {
    references.push(...prerequisites.filter((value): value is string => typeof value === 'string'));
  } else if (record(prerequisites) && Array.isArray(prerequisites.ids)) {
    references.push(...prerequisites.ids.filter((value): value is string => typeof value === 'string'));
  }
  if (Array.isArray(definition.body.grants)) {
    for (const value of definition.body.grants) {
      if (!record(value)) continue;
      if (typeof value.ref === 'string'
        && ['trait', 'extends', 'replacement'].includes(String(value.dataType))) {
        references.push(value.ref);
      }
      if (typeof value.requiresTraitId === 'string') references.push(value.requiresTraitId);
      if (Array.isArray(value.acceptedTraits)) {
        references.push(...value.acceptedTraits.filter((traitId): traitId is string =>
          typeof traitId === 'string'));
      }
    }
  }
  return [...new Set(references.filter(Boolean))];
}

/**
 * Selects the smallest catalog slice needed to validate one or more traits.
 * With dependents enabled, consumers of the changed roots are included before
 * their own dependencies are expanded. Unrelated invalid drafts stay outside
 * incremental authoring while whole-catalog publication remains authoritative.
 */
export function selectTraitDefinitionScope<T extends TraitShapeDefinition>(
  definitions: T[],
  rootTraitIds: string[],
  includeDependents = false,
): T[] {
  const definitionsById = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const referencesById = new Map(definitions.map((definition) => [
    definition.externalId,
    referencedTraitIds(definition),
  ]));
  const affected = new Set(rootTraitIds.filter((traitId) => definitionsById.has(traitId)));
  if (includeDependents) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const definition of definitions) {
        if (affected.has(definition.externalId)) continue;
        if ((referencesById.get(definition.externalId) ?? []).some((traitId) => affected.has(traitId))) {
          affected.add(definition.externalId);
          changed = true;
        }
      }
    }
  }
  const required = new Set(affected);
  const queue = [...affected];
  while (queue.length) {
    const traitId = queue.shift()!;
    for (const reference of referencesById.get(traitId) ?? []) {
      if (!definitionsById.has(reference) || required.has(reference)) continue;
      required.add(reference);
      queue.push(reference);
    }
  }
  return definitions.filter((definition) => required.has(definition.externalId));
}

function grantsFromBody(body: Record<string, unknown>): TraitShapeGrant[] {
  if (!['trait/1', 'trait/2'].includes(String(body.metamodelVersion)) || !Array.isArray(body.grants)) return [];
  return body.grants.filter(record).flatMap((grant) => {
    if (typeof grant.dataType !== 'string') return [];
    const dataType = grant.dataType as TraitGrantDataType;
    if (!['text', 'number', 'boolean', 'enum', 'trait', 'extends', 'trait-collection', 'modifier', 'suppression', 'replacement', 'slot', 'slot-affinity'].includes(dataType)) return [];
    return [{
      dataType,
      ...(typeof grant.key === 'string' ? { key: grant.key } : {}),
      ...(typeof grant.label === 'string' ? { label: grant.label } : {}),
      ...(typeof grant.required === 'boolean' ? { required: grant.required } : {}),
      ...(typeof grant.min === 'number' ? { min: grant.min } : {}),
      ...(typeof grant.max === 'number' ? { max: grant.max } : {}),
      ...(typeof grant.unit === 'string' ? { unit: grant.unit as CanonicalUnitId } : {}),
      ...(['string', 'number', 'boolean'].includes(typeof grant.default)
        ? { default: grant.default as string | number | boolean }
        : {}),
      ...(typeof grant.ref === 'string' ? { ref: grant.ref } : {}),
      ...(typeof grant.into === 'string' ? { into: grant.into } : {}),
      ...(typeof grant.at === 'string' ? { at: grant.at } : {}),
      ...(typeof grant.requiresTraitId === 'string' ? { requiresTraitId: grant.requiresTraitId } : {}),
      ...(typeof grant.count === 'number' ? { count: grant.count } : {}),
      ...(Array.isArray(grant.acceptedTraits) && grant.acceptedTraits.every((item) => typeof item === 'string')
        ? { acceptedTraits: grant.acceptedTraits as string[] }
        : {}),
      ...(grant.acceptsMode === 'all' ? { acceptsMode: 'all' as const } : {}),
      ...(Array.isArray(grant.allowedValues) && grant.allowedValues.every((item) => typeof item === 'string')
        ? { allowedValues: grant.allowedValues as string[] }
        : {}),
    }];
  });
}

function pathKey(path: string[]): string {
  return path.join('.');
}

function sameNode(left: TraitShapeNode, right: TraitShapeNode): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'branch' && right.kind === 'branch') return left.traitId === right.traitId;
  if (left.kind === 'collection' && right.kind === 'collection') {
    return left.acceptsMode === right.acceptsMode
      && JSON.stringify([...left.acceptedTraitIds].sort()) === JSON.stringify([...right.acceptedTraitIds].sort());
  }
  return left.kind === 'terminal'
    && right.kind === 'terminal'
    && left.dataType === right.dataType
    && (left.required ?? false) === (right.required ?? false)
    && left.min === right.min
    && left.max === right.max
    && left.unit === right.unit
    && left.default === right.default
    && JSON.stringify(left.allowedValues ?? []) === JSON.stringify(right.allowedValues ?? []);
}

function sourceTraitIds(node: TraitShapeNode): string[] {
  return [...new Set([
    ...(node.sourceTraitIds ?? []),
    ...(node.sourceTraitId ? [node.sourceTraitId] : []),
  ])].sort();
}

function mergeNodeSources(target: TraitShapeNode, contribution: TraitShapeNode): void {
  const sources = [...new Set([
    ...sourceTraitIds(target),
    ...sourceTraitIds(contribution),
  ])].sort();
  if (!sources.length) return;
  target.sourceTraitId = sources[0];
  if (sources.length > 1) target.sourceTraitIds = sources;
  else delete target.sourceTraitIds;
}

function addNode(shape: MutableShape, node: TraitShapeNode, maximumNodes: number): boolean {
  const key = pathKey(node.path);
  const existing = shape.nodesByPath.get(key);
  if (existing) {
    if (existing.kind === 'collection' && node.kind === 'collection' && sameNode(existing, node)) {
      mergeNodeSources(existing, node);
      for (const entry of node.entries) {
        const matching = existing.entries.find((candidate) =>
          candidate.traitId === entry.traitId
          && candidate.sourceTraitId === entry.sourceTraitId);
        if (matching) matching.count += entry.count;
        else existing.entries.push({ ...entry });
      }
      return true;
    }
    if (sameNode(existing, node)) {
      mergeNodeSources(existing, node);
    } else {
      shape.diagnostics.push({
        code: 'path-conflict',
        path: node.path,
        message: `Multiple incompatible contributions resolve to '${key}'.`,
      });
    }
    return true;
  }
  if (shape.nodesByPath.size >= maximumNodes) {
    if (!shape.diagnostics.some((diagnostic) => diagnostic.code === 'node-limit')) {
      shape.diagnostics.push({
        code: 'node-limit',
        path: node.path,
        message: `Trait expansion exceeded the ${maximumNodes}-node limit.`,
      });
    }
    return false;
  }
  shape.nodesByPath.set(key, node);
  return true;
}

function prerequisiteIdsFromBody(body: Record<string, unknown>): string[] {
  const prerequisites = body.prerequisites;
  if (Array.isArray(prerequisites)) {
    return prerequisites.filter((item): item is string => typeof item === 'string');
  }
  if (record(prerequisites) && Array.isArray(prerequisites.ids)) {
    return prerequisites.ids.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function prerequisiteModeFromBody(body: Record<string, unknown>): 'any' | 'all' {
  return record(body.prerequisites) && body.prerequisites.mode === 'all' ? 'all' : 'any';
}

function traitClosure(
  traitId: string,
  definitionsById: Map<string, TraitShapeDefinition>,
  visited = new Set<string>(),
): Set<string> {
  if (visited.has(traitId)) return visited;
  visited.add(traitId);
  const definition = definitionsById.get(traitId);
  if (!definition) return visited;
  for (const prerequisiteId of prerequisiteIdsFromBody(definition.body)) {
    traitClosure(prerequisiteId, definitionsById, visited);
  }
  return visited;
}

export function traitSatisfiesCollection(
  traitId: string,
  acceptedTraitIds: string[],
  acceptsMode: 'any' | 'all',
  definitions: TraitShapeDefinition[],
): boolean {
  if (acceptedTraitIds.length === 0) return true;
  const closure = traitClosure(
    traitId,
    new Map(definitions.map((definition) => [definition.externalId, definition])),
  );
  return acceptsMode === 'all'
    ? acceptedTraitIds.every((acceptedId) => closure.has(acceptedId))
    : acceptedTraitIds.some((acceptedId) => closure.has(acceptedId));
}

/**
 * Enumerates every terminal reachable through a guaranteed shape, including
 * terminals nested through multiple accepted trait collections. Each
 * collection segment is marked with [] and reported as an ordered prefix so
 * authored selectors can map one-to-one to repeated mounts.
 */
export function traitShapeTerminalPaths(
  shape: TraitShape,
  definitions: TraitShapeDefinition[],
  maximumRepeatedDepth = 8,
): TraitShapeTerminalPath[] {
  const results: TraitShapeTerminalPath[] = shape.nodes
    .filter((node): node is Extract<TraitShapeNode, { kind: 'terminal' }> =>
      node.kind === 'terminal')
    .map((terminal) => ({
      path: [...terminal.path],
      terminal,
      repeatedCollectionPaths: [],
    }));
  const visitCollections = (
    currentShape: TraitShape,
    prefix: string[],
    repeatedPrefixes: string[][],
    depth: number,
  ): void => {
    if (depth >= maximumRepeatedDepth) return;
    for (const collection of currentShape.nodes) {
      if (collection.kind !== 'collection' || !collection.acceptedTraitIds.length) continue;
      const repeatedPath = [
        ...prefix,
        ...collection.path.slice(0, -1),
        `${collection.path.at(-1)!}[]`,
      ];
      const elementShape = buildTraitShape({
        definitions,
        prerequisiteIds: collection.acceptedTraitIds,
        prerequisiteMode: collection.acceptsMode,
      });
      const nextRepeatedPrefixes = [...repeatedPrefixes, repeatedPath];
      for (const terminal of elementShape.nodes) {
        if (terminal.kind !== 'terminal') continue;
        results.push({
          path: [...repeatedPath, ...terminal.path],
          terminal,
          repeatedCollectionPaths: nextRepeatedPrefixes.map((path) => [...path]),
        });
      }
      visitCollections(
        elementShape,
        repeatedPath,
        nextRepeatedPrefixes,
        depth + 1,
      );
    }
  };
  visitCollections(shape, [], [], 0);
  const unique = new Map<string, TraitShapeTerminalPath>();
  for (const result of results) {
    const key = result.path.join('.');
    if (!unique.has(key)) unique.set(key, result);
  }
  return [...unique.values()].sort((left, right) =>
    left.path.join('.').localeCompare(right.path.join('.')));
}

function normalizedCollectionPath(into: string, mountPath: string[]): string[] {
  const segments = into.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments[0] === 'self') return segments.slice(1);
  if (segments[0] === 'this') return [...mountPath, ...segments.slice(1)];
  return [...mountPath, ...segments];
}

function normalizedAdditionPath(at: string, mountPath: string[]): string[] {
  const segments = at.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments[0] === 'self') return segments.slice(1);
  if (segments[0] === 'this') return [...mountPath, ...segments.slice(1)];
  return [...mountPath, ...segments];
}

function addNestedTraitContributions(
  grants: TraitShapeGrant[],
  mountPath: string[],
  sourceTraitId: string | undefined,
  definitionsById: Map<string, TraitShapeDefinition>,
  ancestors: string[],
  shape: MutableShape,
  maximumDepth: number,
  maximumNodes: number,
  prerequisiteSelections: Record<string, string[]>,
): void {
  for (const grant of grants) {
    if ((grant.dataType !== 'trait' && grant.dataType !== 'extends') || !grant.at?.trim()) continue;
    const path = normalizedAdditionPath(grant.at, mountPath);
    const parentPath = path.slice(0, -1);
    const parent = shape.nodesByPath.get(pathKey(parentPath));
    if (parentPath.length > 0 && (!parent || parent.kind !== 'branch')) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path,
        message: `Nested trait addition requires an existing trait branch at '${pathKey(parentPath)}'.`,
      });
      continue;
    }
    const traitId = grant.ref?.trim();
    const definition = traitId ? definitionsById.get(traitId) : undefined;
    if (!traitId || !definition) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path,
        message: traitId
          ? `Trait '${traitId}' added at '${pathKey(path)}' was not found.`
          : `Nested trait addition at '${pathKey(path)}' has no referenced trait.`,
      });
      continue;
    }
    if (!addNode(shape, {
      kind: 'branch',
      path,
      label: grant.label?.trim() || definition.name || path.at(-1)!,
      traitId,
      sourceTraitId,
    }, maximumNodes)) continue;
    if (ancestors.includes(traitId)) {
      shape.diagnostics.push({
        code: 'cycle',
        path,
        message: `Recursive trait grant cycle detected: ${[...ancestors, traitId].join(' → ')}.`,
      });
      continue;
    }
    expandDefinitionAtMount(
      definition,
      path,
      definitionsById,
      [...ancestors, traitId],
      shape,
      maximumDepth,
      maximumNodes,
      prerequisiteSelections,
    );
  }
}

function addCollectionContributions(
  grants: TraitShapeGrant[],
  mountPath: string[],
  sourceTraitId: string | undefined,
  definitionsById: Map<string, TraitShapeDefinition>,
  shape: MutableShape,
): void {
  for (const grant of grants) {
    if (grant.dataType !== 'trait' || !grant.into?.trim()) continue;
    const path = normalizedCollectionPath(grant.into, mountPath);
    const collection = shape.nodesByPath.get(pathKey(path));
    if (!collection || collection.kind !== 'collection') {
      shape.diagnostics.push({
        code: 'missing-collection',
        path,
        message: `Counted trait contribution targets '${pathKey(path)}', which is not a trait collection.`,
      });
      continue;
    }
    const count = grant.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      shape.diagnostics.push({
        code: 'invalid-count',
        path,
        message: 'A counted trait contribution requires a positive whole-number count.',
      });
      continue;
    }
    const traitId = grant.ref?.trim();
    if (!traitId || !definitionsById.has(traitId)) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path,
        message: traitId
          ? `Trait '${traitId}' added to '${pathKey(path)}' was not found.`
          : `A trait contribution to '${pathKey(path)}' has no referenced trait.`,
      });
      continue;
    }
    const definitions = [...definitionsById.values()];
    if (!traitSatisfiesCollection(
      traitId,
      collection.acceptedTraitIds,
      collection.acceptsMode,
      definitions,
    )) {
      shape.diagnostics.push({
        code: 'collection-type-mismatch',
        path,
        message: `Trait '${traitId}' does not satisfy the accepted base traits for '${pathKey(path)}'.`,
      });
      continue;
    }
    const existing = collection.entries.find((entry) =>
      entry.traitId === traitId && entry.sourceTraitId === sourceTraitId);
    if (existing) existing.count += count;
    else collection.entries.push({ traitId, count, sourceTraitId });
  }
}

function expandGrants(
  grants: TraitShapeGrant[],
  mountPath: string[],
  sourceTraitId: string | undefined,
  definitionsById: Map<string, TraitShapeDefinition>,
  ancestors: string[],
  shape: MutableShape,
  maximumDepth: number,
  maximumNodes: number,
  prerequisiteSelections: Record<string, string[]>,
): void {
  for (const grant of grants) {
    if (grant.dataType === 'trait' && (grant.into?.trim() || grant.at?.trim())) continue;
    const segment = grant.key?.trim();
    if (!segment) continue;
    const path = [...mountPath, segment];
    if (path.length > maximumDepth) {
      shape.diagnostics.push({
        code: 'depth-limit',
        path,
        message: `Trait expansion exceeded the ${maximumDepth}-segment depth limit.`,
      });
      continue;
    }

    if (grant.dataType === 'trait-collection') {
      addNode(shape, {
        kind: 'collection',
        path,
        label: grant.label?.trim() || segment,
        acceptedTraitIds: grant.acceptedTraits?.filter(Boolean) ?? [],
        acceptsMode: grant.acceptsMode ?? 'any',
        entries: [],
        sourceTraitId,
      }, maximumNodes);
      continue;
    }

    if (grant.dataType !== 'trait') {
      if (grant.dataType === 'modifier'
        || grant.dataType === 'suppression'
        || grant.dataType === 'replacement'
        || grant.dataType === 'extends') continue;
      addNode(shape, {
        kind: 'terminal',
        path,
        label: grant.label?.trim() || segment,
        dataType: grant.dataType,
        ...(grant.required !== undefined ? { required: grant.required } : {}),
        ...(grant.min !== undefined ? { min: grant.min } : {}),
        ...(grant.max !== undefined ? { max: grant.max } : {}),
        ...(grant.unit !== undefined ? { unit: grant.unit } : {}),
        ...(grant.default !== undefined ? { default: grant.default } : {}),
        allowedValues: grant.allowedValues,
        sourceTraitId,
      }, maximumNodes);
      continue;
    }

    const traitId = grant.ref?.trim();
    if (!traitId) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path,
        message: `Trait grant '${segment}' has no referenced trait.`,
      });
      continue;
    }

    const definition = definitionsById.get(traitId);
    if (!definition) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path,
        message: `Trait '${traitId}' referenced at '${pathKey(path)}' was not found.`,
      });
      continue;
    }

    if (!addNode(shape, {
      kind: 'branch',
      path,
      label: grant.label?.trim() || definition.name || segment,
      traitId,
      sourceTraitId,
    }, maximumNodes)) return;

    if (ancestors.includes(traitId)) {
      const chain = [...ancestors, traitId].join(' → ');
      shape.diagnostics.push({
        code: 'cycle',
        path,
        message: `Recursive trait grant cycle detected: ${chain}.`,
      });
      continue;
    }

    expandDefinitionAtMount(
      definition,
      path,
      definitionsById,
      [...ancestors, traitId],
      shape,
      maximumDepth,
      maximumNodes,
      prerequisiteSelections,
    );
  }
  addCollectionContributions(grants, mountPath, sourceTraitId, definitionsById, shape);
  addNestedTraitContributions(
    grants,
    mountPath,
    sourceTraitId,
    definitionsById,
    ancestors,
    shape,
    maximumDepth,
    maximumNodes,
    prerequisiteSelections,
  );
}

function expandDefinitionAtMount(
  definition: TraitShapeDefinition,
  mountPath: string[],
  definitionsById: Map<string, TraitShapeDefinition>,
  ancestors: string[],
  shape: MutableShape,
  maximumDepth: number,
  maximumNodes: number,
  prerequisiteSelections: Record<string, string[]>,
): void {
  const prerequisiteShapes: MutableShape[] = [];
  const declaredPrerequisiteIds = prerequisiteIdsFromBody(definition.body);
  const selectedPrerequisiteIds = prerequisiteModeFromBody(definition.body) === 'any'
    && declaredPrerequisiteIds.length > 1
    && prerequisiteSelections[definition.externalId]?.length
      ? prerequisiteSelections[definition.externalId]
      : undefined;
  const prerequisiteIds = selectedPrerequisiteIds ?? declaredPrerequisiteIds;
  if (selectedPrerequisiteIds) {
    const invalid = selectedPrerequisiteIds.find((traitId) => !declaredPrerequisiteIds.includes(traitId));
    if (invalid) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path: mountPath,
        message: `Trait '${invalid}' is not an allowed prerequisite selection for '${definition.externalId}'.`,
      });
    }
  }
  for (const prerequisiteId of prerequisiteIds.filter((traitId) => declaredPrerequisiteIds.includes(traitId))) {
    const prerequisite = definitionsById.get(prerequisiteId);
    if (!prerequisite) {
      shape.diagnostics.push({
        code: 'missing-reference',
        path: mountPath,
        message: `Prerequisite trait '${prerequisiteId}' was not found.`,
      });
      continue;
    }
    if (ancestors.includes(prerequisiteId)) {
      shape.diagnostics.push({
        code: 'cycle',
        path: mountPath,
        message: `Recursive trait requirement cycle detected: ${[...ancestors, prerequisiteId].join(' → ')}.`,
      });
      continue;
    }
    const prerequisiteShape: MutableShape = { nodesByPath: new Map(), diagnostics: [] };
    expandDefinitionAtMount(
      prerequisite,
      mountPath,
      definitionsById,
      [...ancestors, prerequisiteId],
      prerequisiteShape,
      maximumDepth,
      maximumNodes,
      prerequisiteSelections,
    );
    prerequisiteShapes.push(prerequisiteShape);
  }

  const shouldIntersect = prerequisiteModeFromBody(definition.body) === 'any'
    && prerequisiteShapes.length > 1
    && !selectedPrerequisiteIds;
  const prerequisites = shouldIntersect
    ? intersectShapes(prerequisiteShapes)
    : { nodesByPath: new Map<string, TraitShapeNode>(), diagnostics: [] };
  if (!shouldIntersect) {
    for (const prerequisiteShape of prerequisiteShapes) {
      mergeShape(prerequisites, prerequisiteShape, maximumNodes);
    }
  }
  mergeShape(shape, prerequisites, maximumNodes);

  expandGrants(
    grantsFromBody(definition.body),
    mountPath,
    definition.externalId,
    definitionsById,
    ancestors,
    shape,
    maximumDepth,
    maximumNodes,
    prerequisiteSelections,
  );
}

function expandDefinitionAtRoot(
  definition: TraitShapeDefinition,
  definitionsById: Map<string, TraitShapeDefinition>,
  maximumDepth: number,
  maximumNodes: number,
  prerequisiteSelections: Record<string, string[]>,
): MutableShape {
  const shape: MutableShape = { nodesByPath: new Map(), diagnostics: [] };
  expandDefinitionAtMount(
    definition,
    [],
    definitionsById,
    [definition.externalId],
    shape,
    maximumDepth,
    maximumNodes,
    prerequisiteSelections,
  );
  return shape;
}

function mergeShape(target: MutableShape, source: MutableShape, maximumNodes: number): void {
  target.diagnostics.push(...source.diagnostics);
  for (const node of source.nodesByPath.values()) addNode(target, node, maximumNodes);
}

function intersectShapes(shapes: MutableShape[]): MutableShape {
  if (shapes.length === 0) return { nodesByPath: new Map(), diagnostics: [] };
  const result: MutableShape = {
    nodesByPath: new Map([...shapes[0].nodesByPath].map(([key, node]) => [
      key,
      node.kind === 'collection'
        ? {
          ...node,
          acceptedTraitIds: [...node.acceptedTraitIds],
          entries: node.entries.map((entry) => ({ ...entry })),
          ...(node.sourceTraitIds ? { sourceTraitIds: [...node.sourceTraitIds] } : {}),
        }
        : {
          ...node,
          path: [...node.path],
          ...(node.sourceTraitIds ? { sourceTraitIds: [...node.sourceTraitIds] } : {}),
        },
    ])),
    diagnostics: shapes.flatMap((shape) => shape.diagnostics),
  };
  for (const [key, node] of result.nodesByPath) {
    const candidates = shapes.slice(1).map((shape) => shape.nodesByPath.get(key));
    if (!candidates.every((candidate) => {
      return candidate !== undefined && sameNode(node, candidate);
    })) {
      result.nodesByPath.delete(key);
      continue;
    }
    for (const candidate of candidates) {
      if (candidate) mergeNodeSources(node, candidate);
    }
    if (node.kind === 'collection') {
      node.entries = node.entries.flatMap((entry) => {
        const matchingEntries = candidates.map((candidate) =>
          candidate?.kind === 'collection'
            ? candidate.entries.find((candidateEntry) => candidateEntry.traitId === entry.traitId)
            : undefined);
        if (matchingEntries.some((candidate) => candidate === undefined)) return [];
        const sources = [entry.sourceTraitId, ...matchingEntries.map((candidate) => candidate?.sourceTraitId)];
        return [{
          traitId: entry.traitId,
          count: Math.min(entry.count, ...matchingEntries.map((candidate) => candidate!.count)),
          ...(sources.every((source) => source === sources[0]) ? { sourceTraitId: sources[0] } : {}),
        }];
      });
    }
  }
  return result;
}

function compareNodes(left: TraitShapeNode, right: TraitShapeNode): number {
  return pathKey(left.path).localeCompare(pathKey(right.path));
}

export function buildTraitShape({
  definitions,
  prerequisiteIds,
  prerequisiteMode = 'any',
  prerequisiteSelections = {},
  draftGrants = [],
  maximumDepth = DEFAULT_MAXIMUM_DEPTH,
  maximumNodes = DEFAULT_MAXIMUM_NODES,
}: BuildTraitShapeInput): TraitShape {
  const definitionsById = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const prerequisiteShapes: MutableShape[] = [];
  const missingDiagnostics: TraitShapeDiagnostic[] = [];

  for (const prerequisiteId of prerequisiteIds.filter(Boolean)) {
    const definition = definitionsById.get(prerequisiteId);
    if (!definition) {
      missingDiagnostics.push({
        code: 'missing-reference',
        path: [],
        message: `Prerequisite trait '${prerequisiteId}' was not found.`,
      });
      continue;
    }
    prerequisiteShapes.push(expandDefinitionAtRoot(
      definition,
      definitionsById,
      maximumDepth,
      maximumNodes,
      prerequisiteSelections,
    ));
  }

  const composed = prerequisiteMode === 'any' && prerequisiteShapes.length > 1
    ? intersectShapes(prerequisiteShapes)
    : { nodesByPath: new Map<string, TraitShapeNode>(), diagnostics: [] };

  if (!(prerequisiteMode === 'any' && prerequisiteShapes.length > 1)) {
    for (const shape of prerequisiteShapes) mergeShape(composed, shape, maximumNodes);
  }

  composed.diagnostics.push(...missingDiagnostics);
  expandGrants(
    draftGrants,
    [],
    undefined,
    definitionsById,
    [],
    composed,
    maximumDepth,
    maximumNodes,
    prerequisiteSelections,
  );

  return {
    nodes: [...composed.nodesByPath.values()].sort(compareNodes),
    diagnostics: composed.diagnostics,
  };
}

export function traitShapeChildren(shape: TraitShape, parentPath: string[]): TraitShapeNode[] {
  return shape.nodes.filter((node) =>
    node.path.length === parentPath.length + 1
    && parentPath.every((segment, index) => node.path[index] === segment));
}

export function resolveTraitShapeTerminal(shape: TraitShape, path: string[]): Extract<TraitShapeNode, { kind: 'terminal' }> | null {
  return shape.nodes.find((node): node is Extract<TraitShapeNode, { kind: 'terminal' }> =>
    node.kind === 'terminal'
    && node.path.length === path.length
    && node.path.every((segment, index) => path[index] === segment)) ?? null;
}
