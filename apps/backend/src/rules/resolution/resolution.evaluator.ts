import {
  CheckDefinition,
  CompiledResolutionArtifact,
  ModifierDefinition,
  ResolutionDiePool,
  ResolutionDieResult,
  OperationDefinition,
  RollModifierDefinition,
  ResolutionCondition,
  ResolutionContext,
  ResolutionExpression,
  ResolutionPreview,
  ResolutionPrimitive,
  ResolutionRollResult,
  ResolutionTraitPathSelector,
  TotalModifierDefinition,
} from './resolution.types';
import type { CompiledTraitCompositionArtifact } from '../traits/trait-composition.types';

type EvaluationContext = ResolutionContext & {
  resolvedTraitInstances?: ResolutionPreview['activeTraitInstances'];
  resolvedTraitChoices?: ResolutionPreview['traitChoices'];
  resolvedTraitTags?: Record<string, string[]>;
};

function repeatedPathPrefixes(segments: string[]): string[][] {
  return segments.flatMap((segment, index) =>
    segment.endsWith('[]')
      ? [segments.slice(0, index + 1).map((item) => item.replace(/\[\]$/, ''))]
      : []);
}

function selectorMatchesInstance(
  selector: ResolutionTraitPathSelector | { mode: 'all' },
  instance: ResolutionPreview['activeTraitInstances'][number],
  traitTags: Record<string, string[]>,
): boolean {
  if (selector.mode === 'all') return true;
  if (selector.mode === 'ordinal') return instance.ordinal === selector.ordinal;
  if (selector.mode === 'trait') return instance.traitId === selector.traitId;
  return (traitTags[instance.traitId] ?? []).includes(selector.tag);
}

function matchesRepeatedSelectors(
  candidate: ResolutionPreview['activeTraitInstances'][number],
  prefixes: string[][],
  selectors: Array<ResolutionTraitPathSelector | { mode: 'all' }>,
  instances: ResolutionPreview['activeTraitInstances'],
  traitTags: Record<string, string[]>,
): boolean {
  if (prefixes.length !== selectors.length) return false;
  return prefixes.every((prefix, index) => {
    const selectedMount = [...candidate.instanceChain]
      .reverse()
      .map((instanceId) => instances.find((instance) => instance.instanceId === instanceId))
      .find((instance) =>
        instance?.relation === 'adds'
        && instance.mountPath.join('\0') === prefix.join('\0'));
    if (!selectedMount || !selectorMatchesInstance(selectors[index], selectedMount, traitTags)) return false;
    const isInnermostPrefix = index === prefixes.length - 1;
    const candidateOccupiesSelectedMount = candidate.mountPath.join('\0') === prefix.join('\0');
    return !isInnermostPrefix
      || !candidateOccupiesSelectedMount
      || candidate.instanceId === selectedMount.instanceId;
  });
}

function number(value: ResolutionPrimitive, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function assertSubjectContract(
  definition: { definitionId: string; subjectTraitIds?: string[]; subjectTraitSelections?: Record<string, string[]> },
  context: EvaluationContext,
  requiredTraitIds: string[] = definition.subjectTraitIds ?? [],
  requiredTraitSelections: Record<string, string[]> = definition.subjectTraitSelections ?? {},
): void {
  const activeTraitIds = new Set((context.resolvedTraitInstances ?? []).map((instance) => instance.traitId));
  const missing = requiredTraitIds.filter((traitId) => !activeTraitIds.has(traitId));
  if (missing.length) {
    throw new Error(`Rule '${definition.definitionId}' requires self to have: ${missing.join(', ')}.`);
  }
  const choices = new Map(
    (context.resolvedTraitChoices ?? []).map((choice) => [choice.traitId, choice.selectedTraitIds]),
  );
  for (const [ownerTraitId, selectedTraitIds] of Object.entries(requiredTraitSelections)) {
    const actual = choices.get(ownerTraitId) ?? [];
    const missingSelections = selectedTraitIds.filter((traitId) => !actual.includes(traitId));
    if (missingSelections.length) {
      throw new Error(`Rule '${definition.definitionId}' requires '${ownerTraitId}' to select: ${missingSelections.join(', ')}.`);
    }
  }
}

function traitValues(value: unknown, label: string): Record<string, ResolutionPrimitive> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object of scalar values.`);
  }
  const entries = Object.entries(value);
  for (const [key, fieldValue] of entries) {
    if (!key.trim() || !['string', 'number', 'boolean'].includes(typeof fieldValue)
      || (typeof fieldValue === 'number' && !Number.isFinite(fieldValue))) {
      throw new Error(`${label}.${key || '(blank)'} must be a finite number, string, or boolean.`);
    }
  }
  return Object.fromEntries(entries) as Record<string, ResolutionPrimitive>;
}

function expression(
  node: ResolutionExpression,
  context: EvaluationContext,
  results: Record<string, Record<string, ResolutionPrimitive>>,
): ResolutionPrimitive {
  if (node.op === 'literal') return node.value;
  if (node.op === 'actor-field') {
    if (!(node.key in context.actor.fields)) throw new Error(`Actor field '${node.key}' is unavailable.`);
    return context.actor.fields[node.key];
  }
  if (node.op === 'target-field') {
    if (!(node.key in context.target.fields)) throw new Error(`Target field '${node.key}' is unavailable.`);
    return context.target.fields[node.key];
  }
  if (node.op === 'trait-instance-field') {
    const instance = context.resolvedTraitInstances?.find((candidate) => candidate.instanceId === node.instanceId);
    if (!instance) throw new Error(`Trait instance '${node.instanceId}' is unavailable.`);
    if (!(node.key in (instance.values ?? {}))) {
      throw new Error(`Trait instance field '${node.instanceId}.${node.key}' is unavailable.`);
    }
    return instance.values![node.key];
  }
  if (node.op === 'trait-path-field') {
    const segments = node.path.split('.').map((segment) => segment.trim());
    const key = segments.at(-1)!;
    const mountPath = segments.slice(1, -1).map((segment) => segment.replace(/\[\]$/, ''));
    let candidates = (context.resolvedTraitInstances ?? []).filter((instance) =>
      instance.mountPath.join('\0') === mountPath.join('\0')
      && key in instance.values);
    const prefixes = repeatedPathPrefixes(segments.slice(1, -1));
    const selectors = node.mountSelectors
      ?? (node.mountSelector ? [node.mountSelector] : []);
    if (prefixes.length) {
      candidates = candidates.filter((instance) => matchesRepeatedSelectors(
        instance,
        prefixes,
        selectors,
        context.resolvedTraitInstances ?? [],
        context.resolvedTraitTags ?? {},
      ));
    }
    if (!candidates.length) throw new Error(`Trait path field '${node.path}' is unavailable.`);
    if (candidates.length > 1) {
      throw new Error(`Trait path field '${node.path}' is ambiguous across instances: ${candidates.map((instance) => instance.instanceId).join(', ')}.`);
    }
    return candidates[0].values[key];
  }
  if (node.op === 'input') {
    if (!(node.key in (context.input ?? {}))) throw new Error(`Operation input '${node.key}' is unavailable.`);
    return context.input![node.key];
  }
  if (node.op === 'result') {
    const value = results[node.key]?.[node.property];
    if (value === undefined) throw new Error(`Result '${node.key}.${node.property}' is unavailable.`);
    return value;
  }
  const left = number(expression(node.left, context, results), `${node.op}.left`);
  const right = number(expression(node.right, context, results), `${node.op}.right`);
  if (node.op === 'add') return left + right;
  if (node.op === 'subtract') return left - right;
  if (node.op === 'multiply') return left * right;
  if (right === 0) throw new Error('Division by zero is not allowed.');
  return left / right;
}

function condition(node: ResolutionCondition, context: EvaluationContext, results: Record<string, Record<string, ResolutionPrimitive>>): boolean {
  if (node.op === 'all') return node.conditions.every((item) => condition(item, context, results));
  if (node.op === 'any') return node.conditions.some((item) => condition(item, context, results));
  if (node.op === 'not') return !condition(node.condition, context, results);
  const left = expression(node.left, context, results);
  const right = expression(node.right, context, results);
  if (node.op === 'equals') return left === right;
  return node.op === 'gte' ? number(left, 'condition.left') >= number(right, 'condition.right') : number(left, 'condition.left') <= number(right, 'condition.right');
}

function modifierTargetsCheck(modifier: ModifierDefinition, check: CheckDefinition): boolean {
  if (modifier.targetCheckId) return modifier.targetCheckId === check.definitionId;
  const target = modifier.appliesTo;
  if (!target) return false;
  if (target.allRolls) return true;
  if (target.checkIds?.length && !target.checkIds.includes(check.definitionId)) return false;
  const rollKind = check.roll.rollKind ?? 'other';
  if (target.rollKinds?.length && !target.rollKinds.includes(rollKind)) return false;
  const rollTraitId = 'rollTraitId' in check.roll ? check.roll.rollTraitId : undefined;
  if (target.rollTraitIds?.length && (!rollTraitId || !target.rollTraitIds.includes(rollTraitId))) return false;
  return !!(target.checkIds?.length || target.rollKinds?.length || target.rollTraitIds?.length);
}

function expandActiveTraits(
  rootTraitIds: string[],
  prerequisiteSelections: Record<string, string[]> = {},
  suppliedRootInstances: NonNullable<ResolutionContext['activeTraitInstances']> = [],
  instancePrerequisiteSelections: Record<string, string[]> = {},
  instanceValues: Record<string, Record<string, ResolutionPrimitive>> = {},
  artifact?: CompiledTraitCompositionArtifact,
): Pick<ResolutionPreview, 'activeTraits' | 'activeTraitInstances' | 'traitChoices' | 'structuralChanges'> {
  const roots = [...new Set(rootTraitIds)].sort();
  if (!artifact) {
    if (Object.keys(prerequisiteSelections).length || Object.keys(instancePrerequisiteSelections).length) {
      throw new Error('Trait prerequisite selections require a compiled trait artifact.');
    }
    const explicitTraitIds = new Set(suppliedRootInstances.map((instance) => instance.traitId));
    const rootInstances: NonNullable<ResolutionContext['activeTraitInstances']> = [
      ...suppliedRootInstances,
      ...roots.filter((traitId) => !explicitTraitIds.has(traitId)).map((traitId) => ({
        instanceId: `root:${encodeURIComponent(traitId)}`,
        traitId,
      })),
    ];
    const rootInstanceIds = new Set<string>();
    for (const instance of rootInstances) {
      if (!instance.instanceId?.trim() || !instance.traitId?.trim()) {
        throw new Error('Active trait instances require non-empty instance and trait IDs.');
      }
      if (rootInstanceIds.has(instance.instanceId)) throw new Error(`Active trait instance ID '${instance.instanceId}' is duplicated.`);
      rootInstanceIds.add(instance.instanceId);
    }
    const unusedValues = Object.keys(instanceValues).find((instanceId) => !rootInstanceIds.has(instanceId));
    if (unusedValues) throw new Error(`Trait instance values '${unusedValues}' do not belong to an active trait instance.`);
    return {
      activeTraits: [...new Set(rootInstances.map((instance) => instance.traitId))].sort().map((traitId) => ({
        traitId,
        roots: [{ rootTraitId: traitId, traitChain: [traitId] }],
      })),
      activeTraitInstances: rootInstances.map((instance) => ({
        instanceId: instance.instanceId,
        traitId: instance.traitId,
        rootInstanceId: instance.instanceId,
        rootTraitId: instance.traitId,
        mountPath: [],
        traitChain: [instance.traitId],
        instanceChain: [instance.instanceId],
        values: {
          ...traitValues(instanceValues[instance.instanceId], `Trait instance values '${instance.instanceId}'`),
          ...traitValues(instance.values, `Active trait instance '${instance.instanceId}' values`),
        },
        valueModifiers: [],
      })).sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
      traitChoices: [],
      structuralChanges: [],
    };
  }
  const knownTraits = new Set(artifact.traits.map((trait) => trait.traitId));
  const contractsByTrait = new Map(artifact.traits.map((trait) => [trait.traitId, trait]));
  const materializeValues = (
    traitId: string,
    instanceId: string,
    supplied: unknown,
  ): Record<string, ResolutionPrimitive> => {
    const values = traitValues(supplied, `Trait instance values '${instanceId}'`);
    const contract = contractsByTrait.get(traitId)!;
    const terminals = new Map(contract.nodes.flatMap((node) =>
      node.kind === 'terminal' && node.path.length === 1 ? [[node.path[0], node] as const] : []));
    for (const [key, value] of Object.entries(values)) {
      const terminal = terminals.get(key);
      if (!terminal) {
        throw new Error(`Trait instance field '${instanceId}.${key}' is not declared directly by '${traitId}'.`);
      }
      const valid = terminal.dataType === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : terminal.dataType === 'boolean'
          ? typeof value === 'boolean'
          : typeof value === 'string';
      if (!valid) {
        throw new Error(`Trait instance field '${instanceId}.${key}' must be ${terminal.dataType}.`);
      }
      if (terminal.dataType === 'enum' && terminal.allowedValues?.length
        && !terminal.allowedValues.includes(String(value))) {
        throw new Error(`Trait instance field '${instanceId}.${key}' must be one of: ${terminal.allowedValues.join(', ')}.`);
      }
    }
    return values;
  };
  const activationMountPath = (
    parent: ResolutionPreview['activeTraitInstances'][number],
    edge: CompiledTraitCompositionArtifact['activationEdges'][number],
  ): string[] => {
    if (edge.kind === 'requires' || !edge.path) return parent.mountPath;
    const segments = edge.path.split('.').map((segment) => segment.trim()).filter(Boolean);
    const root = segments[0];
    const relative = (root === 'self' || root === 'this' ? segments.slice(1) : segments)
      .map((segment) => segment.replace(/\[\]$/, ''));
    return root === 'self' ? relative : [...parent.mountPath, ...relative];
  };
  const explicitTraitIds = new Set(suppliedRootInstances.map((instance) => instance.traitId));
  const rootInstances: NonNullable<ResolutionContext['activeTraitInstances']> = [
    ...suppliedRootInstances,
    ...roots.filter((traitId) => !explicitTraitIds.has(traitId)).map((traitId) => ({
      instanceId: `root:${encodeURIComponent(traitId)}`,
      traitId,
    })),
  ];
  const rootInstanceIds = new Set<string>();
  for (const instance of rootInstances) {
    if (!instance.instanceId?.trim()) throw new Error('Active trait instances require a non-empty instance ID.');
    if (rootInstanceIds.has(instance.instanceId)) throw new Error(`Active trait instance ID '${instance.instanceId}' is duplicated.`);
    rootInstanceIds.add(instance.instanceId);
    if (!knownTraits.has(instance.traitId)) throw new Error(`Active root trait '${instance.traitId}' is not in the compiled trait artifact.`);
  }
  const edgesBySource = new Map<string, typeof artifact.activationEdges>();
  for (const edge of artifact.activationEdges ?? []) {
    const edges = edgesBySource.get(edge.fromTraitId) ?? [];
    edges.push(edge);
    edgesBySource.set(edge.fromTraitId, edges);
  }
  const choicesByTrait = new Map((artifact.activationChoices ?? []).map((choice) => [choice.traitId, choice.optionTraitIds]));
  const rootSet = new Set(rootInstances.map((instance) => instance.traitId));
  const resolvedChoices: ResolutionPreview['traitChoices'] = [];
  const encounteredChoiceTraits = new Map<string, string[]>();
  const encounteredChoiceInstances = new Set<string>();
  const activeTraitInstances: ResolutionPreview['activeTraitInstances'] = [];
  const queue: ResolutionPreview['activeTraitInstances'] = rootInstances.map((instance) => ({
    instanceId: instance.instanceId,
    traitId: instance.traitId,
    rootInstanceId: instance.instanceId,
    rootTraitId: instance.traitId,
    mountPath: [],
    traitChain: [instance.traitId],
    instanceChain: [instance.instanceId],
    values: materializeValues(instance.traitId, instance.instanceId, {
      ...traitValues(instanceValues[instance.instanceId], `Trait instance values '${instance.instanceId}'`),
      ...traitValues(instance.values, `Active trait instance '${instance.instanceId}' values`),
    }),
    valueModifiers: [],
  }));
  const visitedInstances = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visitedInstances.has(current.instanceId)) {
      throw new Error(`Trait instance ID '${current.instanceId}' resolves more than once.`);
    }
    visitedInstances.add(current.instanceId);
    activeTraitInstances.push(current);
    for (const edge of edgesBySource.get(current.traitId) ?? []) {
      if (current.traitChain.includes(edge.toTraitId)) continue;
      const count = edge.count ?? 1;
      for (let ordinal = 1; ordinal <= count; ordinal += 1) {
        const segment = `${edge.kind}:${encodeURIComponent(edge.path ?? edge.toTraitId)}:${encodeURIComponent(edge.toTraitId)}${count > 1 ? `#${ordinal}` : ''}`;
        const childInstanceId = `${current.instanceId}/${segment}`;
        queue.push({
          instanceId: childInstanceId,
          traitId: edge.toTraitId,
          rootInstanceId: current.rootInstanceId,
          rootTraitId: current.rootTraitId,
          parentInstanceId: current.instanceId,
          relation: edge.kind,
          ...(edge.path ? { path: edge.path } : {}),
          ...(edge.kind === 'adds' && edge.path?.includes('[]') ? { ordinal } : {}),
          mountPath: activationMountPath(current, edge),
          traitChain: [...current.traitChain, edge.toTraitId],
          instanceChain: [...current.instanceChain, childInstanceId],
          values: materializeValues(edge.toTraitId, childInstanceId, instanceValues[childInstanceId]),
          valueModifiers: [],
        });
      }
    }
    const options = choicesByTrait.get(current.traitId);
    if (!options) continue;
    encounteredChoiceInstances.add(current.instanceId);
    const traitInstances = encounteredChoiceTraits.get(current.traitId) ?? [];
    traitInstances.push(current.instanceId);
    encounteredChoiceTraits.set(current.traitId, traitInstances);
    const instanceSupplied = instancePrerequisiteSelections[current.instanceId];
    const traitSupplied = prerequisiteSelections[current.traitId];
    const supplied = instanceSupplied ?? traitSupplied;
    if (supplied !== undefined && (!Array.isArray(supplied) || !supplied.length || supplied.some((traitId) => typeof traitId !== 'string'))) {
      throw new Error(`Trait instance '${current.instanceId}' requires one or more selected prerequisite trait IDs.`);
    }
    const selectedTraitIds = [...new Set(supplied ?? options.filter((traitId) => rootSet.has(traitId)))].sort();
    if (!selectedTraitIds.length) {
      throw new Error(`Trait instance '${current.instanceId}' requires a prerequisite selection from: ${options.join(', ')}.`);
    }
    const invalid = selectedTraitIds.find((traitId) => !options.includes(traitId));
    if (invalid) throw new Error(`Trait '${invalid}' is not an allowed prerequisite selection for '${current.instanceId}'.`);
    resolvedChoices.push({
      traitId: current.traitId,
      ...(suppliedRootInstances.length || instanceSupplied ? { traitInstanceId: current.instanceId } : {}),
      selectedTraitIds,
      source: supplied ? 'context' : 'active-roots',
    });
    for (const traitId of selectedTraitIds) {
      if (current.traitChain.includes(traitId)) continue;
      const childInstanceId = `${current.instanceId}/choice:${encodeURIComponent(traitId)}`;
      queue.push({
        instanceId: childInstanceId,
        traitId,
        rootInstanceId: current.rootInstanceId,
        rootTraitId: current.rootTraitId,
        parentInstanceId: current.instanceId,
        relation: 'choice',
        mountPath: current.mountPath,
        traitChain: [...current.traitChain, traitId],
        instanceChain: [...current.instanceChain, childInstanceId],
        values: materializeValues(traitId, childInstanceId, instanceValues[childInstanceId]),
        valueModifiers: [],
      });
    }
  }
  for (const [traitId, instanceIds] of encounteredChoiceTraits) {
    if (prerequisiteSelections[traitId] && instanceIds.length > 1) {
      throw new Error(`Trait prerequisite selection '${traitId}' is ambiguous across instances: ${instanceIds.join(', ')}. Select prerequisites by instance ID.`);
    }
  }
  const structuralChanges: ResolutionPreview['structuralChanges'] = [];
  const inactiveInstanceIds = new Set<string>();
  const materializeReplacementTree = (
    seed: ResolutionPreview['activeTraitInstances'][number],
  ): void => {
    const replacementQueue = [seed];
    while (replacementQueue.length) {
      const current = replacementQueue.shift()!;
      if (activeTraitInstances.some((instance) => instance.instanceId === current.instanceId)) {
        throw new Error(`Replacement trait instance ID '${current.instanceId}' resolves more than once.`);
      }
      activeTraitInstances.push(current);
      const options = choicesByTrait.get(current.traitId);
      if (options) {
        encounteredChoiceInstances.add(current.instanceId);
        const traitInstances = encounteredChoiceTraits.get(current.traitId) ?? [];
        traitInstances.push(current.instanceId);
        encounteredChoiceTraits.set(current.traitId, traitInstances);
        const instanceSupplied = instancePrerequisiteSelections[current.instanceId];
        const traitSupplied = prerequisiteSelections[current.traitId];
        const supplied = instanceSupplied ?? traitSupplied;
        const selectedTraitIds = [...new Set(
          supplied ?? options.filter((traitId) => rootSet.has(traitId)),
        )].sort();
        if (!selectedTraitIds.length) {
          throw new Error(`Trait instance '${current.instanceId}' requires a prerequisite selection from: ${options.join(', ')}.`);
        }
        const invalid = selectedTraitIds.find((traitId) => !options.includes(traitId));
        if (invalid) {
          throw new Error(`Trait '${invalid}' is not an allowed prerequisite selection for '${current.instanceId}'.`);
        }
        resolvedChoices.push({
          traitId: current.traitId,
          traitInstanceId: current.instanceId,
          selectedTraitIds,
          source: supplied ? 'context' : 'active-roots',
        });
        for (const traitId of selectedTraitIds) {
          if (current.traitChain.includes(traitId)) continue;
          const childInstanceId = `${current.instanceId}/choice:${encodeURIComponent(traitId)}`;
          replacementQueue.push({
            instanceId: childInstanceId,
            traitId,
            rootInstanceId: current.rootInstanceId,
            rootTraitId: current.rootTraitId,
            parentInstanceId: current.instanceId,
            relation: 'choice',
            mountPath: current.mountPath,
            traitChain: [...current.traitChain, traitId],
            instanceChain: [...current.instanceChain, childInstanceId],
            values: materializeValues(traitId, childInstanceId, instanceValues[childInstanceId]),
            valueModifiers: [],
          });
        }
      }
      for (const edge of edgesBySource.get(current.traitId) ?? []) {
        if (current.traitChain.includes(edge.toTraitId)) continue;
        const count = edge.count ?? 1;
        for (let ordinal = 1; ordinal <= count; ordinal += 1) {
          const segment = `${edge.kind}:${encodeURIComponent(edge.path ?? edge.toTraitId)}:${encodeURIComponent(edge.toTraitId)}${count > 1 ? `#${ordinal}` : ''}`;
          const childInstanceId = `${current.instanceId}/${segment}`;
          replacementQueue.push({
            instanceId: childInstanceId,
            traitId: edge.toTraitId,
            rootInstanceId: current.rootInstanceId,
            rootTraitId: current.rootTraitId,
            parentInstanceId: current.instanceId,
            relation: edge.kind,
            ...(edge.path ? { path: edge.path } : {}),
            ...(edge.kind === 'adds' && edge.path?.includes('[]') ? { ordinal } : {}),
            mountPath: activationMountPath(current, edge),
            traitChain: [...current.traitChain, edge.toTraitId],
            instanceChain: [...current.instanceChain, childInstanceId],
            values: materializeValues(edge.toTraitId, childInstanceId, instanceValues[childInstanceId]),
            valueModifiers: [],
          });
        }
      }
    }
  };
  type StructuralApplication = {
    source: ResolutionPreview['activeTraitInstances'][number];
    directive: CompiledTraitCompositionArtifact['structuralDirectives'][number];
    directiveIndex: number;
    target: ResolutionPreview['activeTraitInstances'][number];
  };
  const processedStructuralApplications = new Set<string>();
  const maximumStructuralChanges = Math.max(1, activeTraitInstances.length + artifact.structuralDirectives.length) * 8;
  while (structuralChanges.length <= maximumStructuralChanges) {
    const applicationsByTarget = new Map<string, StructuralApplication[]>();
    for (const source of activeTraitInstances) {
      if (inactiveInstanceIds.has(source.instanceId)) continue;
      for (const [directiveIndex, directive] of (artifact.structuralDirectives ?? []).entries()) {
        if (directive.sourceTraitId !== source.traitId) continue;
        const root = activeTraitInstances.find((instance) => instance.instanceId === source.rootInstanceId)!;
        const basePath = directive.anchor === 'this' ? source.mountPath : root.mountPath;
        const targetMountPath = [
          ...basePath,
          ...directive.path.map((segment) => segment.replace(/\[\]$/, '')),
        ];
        let candidates = activeTraitInstances.filter((instance) =>
          !inactiveInstanceIds.has(instance.instanceId)
          && instance.rootInstanceId === source.rootInstanceId
          && instance.relation === 'adds'
          && instance.mountPath.join('\0') === targetMountPath.join('\0'));
        const directiveSelectors = directive.mountSelectors
          ?? (directive.mountSelector ? [directive.mountSelector] : []);
        const directivePrefixes = repeatedPathPrefixes(directive.path);
        if (directivePrefixes.length) {
          const traitTags = Object.fromEntries(
            artifact.traits.map((trait) => [trait.traitId, trait.tags ?? []]),
          );
          candidates = candidates.filter((instance) => matchesRepeatedSelectors(
            instance,
            directivePrefixes,
            directiveSelectors,
            activeTraitInstances,
            traitTags,
          ));
        }
        if (!directiveSelectors.some((selector) => selector.mode === 'all')
          && candidates.length > 1) {
          throw new Error(
            `Structural directive '${source.instanceId}' resolves '${directive.anchor}.${directive.path.join('.')}' `
            + `ambiguously to ${candidates.map((candidate) => candidate.instanceId).join(', ')}.`,
          );
        }
        for (const target of candidates) {
          const applicationKey = `${source.instanceId}\0${directiveIndex}\0${target.rootInstanceId}\0${target.mountPath.join('\0')}`;
          if (processedStructuralApplications.has(applicationKey)) continue;
          const grouped = applicationsByTarget.get(target.instanceId) ?? [];
          grouped.push({ source, directive, directiveIndex, target });
          applicationsByTarget.set(target.instanceId, grouped);
        }
      }
    }
    const next = [...applicationsByTarget.values()]
      .sort((left, right) =>
        left[0].target.mountPath.length - right[0].target.mountPath.length
        || left[0].target.instanceId.localeCompare(right[0].target.instanceId))
      .find((applications) =>
        !inactiveInstanceIds.has(applications[0].target.instanceId)
        && applications.some((application) => !inactiveInstanceIds.has(application.source.instanceId)));
    if (!next) break;
    const applications = next.filter((application) =>
      !inactiveInstanceIds.has(application.source.instanceId));
    applications.forEach((application) => {
      processedStructuralApplications.add(
        `${application.source.instanceId}\0${application.directiveIndex}\0${application.target.rootInstanceId}\0${application.target.mountPath.join('\0')}`,
      );
    });
    const priority = Math.max(...applications.map((application) => application.directive.priority));
    const winners = applications.filter((application) => application.directive.priority === priority);
    const winnerKinds = new Set(winners.map((application) => application.directive.kind));
    const replacementTraitIds = new Set(winners.map((application) => application.directive.replacementTraitId ?? ''));
    if (winnerKinds.size !== 1
      || (winners[0].directive.kind === 'replacement' && replacementTraitIds.size !== 1)) {
      throw new Error(
        `Structural directives conflict at '${winners[0].directive.anchor}.${winners[0].directive.path.join('.')}' `
        + `with priority ${priority}: ${winners.map((winner) =>
          `${winner.source.traitId}:${winner.directive.kind}${winner.directive.replacementTraitId ? `→${winner.directive.replacementTraitId}` : ''}`).join(', ')}.`,
      );
    }
    const target = winners[0].target;
    const inactive = activeTraitInstances
      .filter((instance) => instance.instanceChain.includes(target.instanceId))
      .map((instance) => instance.instanceId)
      .sort();
    inactive.forEach((instanceId) => inactiveInstanceIds.add(instanceId));
    const directive = winners[0].directive;
    let replacementInstanceId: string | undefined;
    if (directive.kind === 'replacement') {
      const replacementTraitId = directive.replacementTraitId!;
      if (target.traitChain.includes(replacementTraitId)) {
        throw new Error(
          `Structural replacement cycle detected: ${[...target.traitChain, replacementTraitId].join(' → ')}.`,
        );
      }
      replacementInstanceId = `${target.instanceId}/replacement:${encodeURIComponent(replacementTraitId)}`;
      const parent = target.parentInstanceId
        ? activeTraitInstances.find((instance) => instance.instanceId === target.parentInstanceId)
        : undefined;
      materializeReplacementTree({
        instanceId: replacementInstanceId,
        traitId: replacementTraitId,
        rootInstanceId: target.rootInstanceId,
        rootTraitId: target.rootTraitId,
        ...(parent ? { parentInstanceId: parent.instanceId } : {}),
        relation: 'adds',
        ...(target.path ? { path: target.path } : {}),
        ...(target.ordinal !== undefined ? { ordinal: target.ordinal } : {}),
        mountPath: target.mountPath,
        traitChain: [...(parent?.traitChain ?? [target.rootTraitId]), replacementTraitId],
        instanceChain: [...(parent?.instanceChain ?? [target.rootInstanceId]), replacementInstanceId],
        values: materializeValues(replacementTraitId, replacementInstanceId, instanceValues[replacementInstanceId]),
        valueModifiers: [],
      });
    }
    structuralChanges.push({
      sourceInstanceIds: [...new Set(winners.map((winner) => winner.source.instanceId))].sort(),
      sourceTraitIds: [...new Set(winners.map((winner) => winner.source.traitId))].sort(),
      kind: directive.kind,
      anchor: directive.anchor,
      path: directive.path,
      priority,
      ...(directive.mountSelector ? { mountSelector: directive.mountSelector } : {}),
      ...(directive.mountSelectors ? { mountSelectors: directive.mountSelectors } : {}),
      targetInstanceId: target.instanceId,
      targetTraitId: target.traitId,
      inactiveInstanceIds: inactive,
      ...(replacementInstanceId ? {
        replacementInstanceId,
        replacementTraitId: directive.replacementTraitId,
      } : {}),
    });
  }
  if (structuralChanges.length > maximumStructuralChanges) {
    throw new Error(`Structural composition exceeded the ${maximumStructuralChanges}-change safety budget.`);
  }
  const unusedSelection = Object.keys(prerequisiteSelections).find((traitId) => !encounteredChoiceTraits.has(traitId));
  if (unusedSelection) {
    throw new Error(`Trait prerequisite selection '${unusedSelection}' does not belong to an active trait with multiple alternatives.`);
  }
  const unusedInstanceSelection = Object.keys(instancePrerequisiteSelections).find((instanceId) => !encounteredChoiceInstances.has(instanceId));
  if (unusedInstanceSelection) {
    throw new Error(`Trait instance prerequisite selection '${unusedInstanceSelection}' does not belong to an active trait instance with multiple alternatives.`);
  }
  const effectiveTraitInstances = activeTraitInstances
    .filter((instance) => !inactiveInstanceIds.has(instance.instanceId));
  const effectiveInstanceIds = new Set(effectiveTraitInstances.map((instance) => instance.instanceId));
  const unusedValues = Object.keys(instanceValues).find((instanceId) => !effectiveInstanceIds.has(instanceId));
  if (unusedValues) throw new Error(`Trait instance values '${unusedValues}' do not belong to an active trait instance.`);
  const mountKey = (path: string[]): string => path.join('\0');
  const directTerminal = (instance: ResolutionPreview['activeTraitInstances'][number], key: string) => {
    const contract = contractsByTrait.get(instance.traitId)!;
    return contract.nodes.find((node) =>
      node.kind === 'terminal' && node.path.length === 1 && node.path[0] === key);
  };
  const baseValuesByInstance = new Map(
    effectiveTraitInstances.map((instance) => [instance.instanceId, { ...instance.values }]),
  );
  const modifierStage: Record<
    CompiledTraitCompositionArtifact['traits'][number]['modifiers'][number]['operation'],
    number
  > = {
    sets: 0,
    increases: 1,
    decreases: 1,
    multiplies: 2,
    divides: 2,
    'at-least': 3,
    'at-most': 4,
  };
  const modifierApplications = effectiveTraitInstances.flatMap((source) =>
    contractsByTrait.get(source.traitId)!.modifiers.map((modifier, sourceGrantIndex) => ({
      source,
      modifier,
      sourceGrantIndex,
    })))
    .sort((left, right) => {
      const leftLocal = left.modifier.path.length === 1
        && !left.modifier.mountSelector
        && !left.modifier.mountSelectors ? 0 : 1;
      const rightLocal = right.modifier.path.length === 1
        && !right.modifier.mountSelector
        && !right.modifier.mountSelectors ? 0 : 1;
      return leftLocal - rightLocal
        || modifierStage[left.modifier.operation] - modifierStage[right.modifier.operation]
        || (left.modifier.priority ?? 0) - (right.modifier.priority ?? 0)
        || left.source.instanceId.localeCompare(right.source.instanceId)
        || left.modifier.path.join('.').localeCompare(right.modifier.path.join('.'))
        || left.sourceGrantIndex - right.sourceGrantIndex;
    });
  const resolveModifierTargets = (
    source: ResolutionPreview['activeTraitInstances'][number],
    modifier: CompiledTraitCompositionArtifact['traits'][number]['modifiers'][number],
  ): ResolutionPreview['activeTraitInstances'] => {
    const key = modifier.path.at(-1)!;
    const basePath = modifier.anchor === 'this'
      ? source.mountPath
      : effectiveTraitInstances.find((instance) => instance.instanceId === source.rootInstanceId)!.mountPath;
    const targetMountPath = [
      ...basePath,
      ...modifier.path.slice(0, -1).map((segment) => segment.replace(/\[\]$/, '')),
    ];
    let candidates = effectiveTraitInstances.filter((instance) =>
      instance.rootInstanceId === source.rootInstanceId
      && mountKey(instance.mountPath) === mountKey(targetMountPath)
      && directTerminal(instance, key));
    if (modifier.path.length === 1 && directTerminal(source, key)) candidates = [source];
    const mountSelectors = modifier.mountSelectors
      ?? (modifier.mountSelector ? [modifier.mountSelector] : []);
    const repeatedPrefixes = repeatedPathPrefixes(modifier.path.slice(0, -1));
    if (repeatedPrefixes.length) {
      const traitTags = Object.fromEntries(
        artifact.traits.map((trait) => [trait.traitId, trait.tags ?? []]),
      );
      candidates = candidates.filter((instance) => matchesRepeatedSelectors(
        instance,
        repeatedPrefixes,
        mountSelectors,
        effectiveTraitInstances,
        traitTags,
      ));
    }
    if (candidates.length > 1) {
      const owned = candidates.filter((instance) => directTerminal(instance, key)?.sourceTraitId === instance.traitId);
      if (owned.length === 1) candidates = owned;
    }
    if (!candidates.length) {
      throw new Error(`Trait modifier '${source.instanceId}' cannot resolve '${modifier.anchor}.${modifier.path.join('.')}' to an active instance field.`);
    }
    if (candidates.length > 1 && !mountSelectors.some((selector) => selector.mode === 'all')) {
      throw new Error(`Trait modifier '${source.instanceId}' resolves '${modifier.anchor}.${modifier.path.join('.')}' ambiguously to: ${candidates.map((instance) => instance.instanceId).join(', ')}.`);
    }
    return candidates.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  };
  const modifierConditionMatches = (
    target: ResolutionPreview['activeTraitInstances'][number],
    modifier: CompiledTraitCompositionArtifact['traits'][number]['modifiers'][number],
  ): boolean => {
    if (!modifier.condition) return true;
    const key = modifier.path.at(-1)!;
    const baseValue = baseValuesByInstance.get(target.instanceId)?.[key];
    if (baseValue === undefined) {
      throw new Error(`Trait modifier condition requires a base value at '${target.instanceId}.${key}'.`);
    }
    return modifier.condition.operator === 'equals'
      ? baseValue === modifier.condition.value
      : modifier.condition.operator === 'gte'
        ? number(baseValue, 'trait modifier condition base') >= number(modifier.condition.value, 'trait modifier condition value')
        : number(baseValue, 'trait modifier condition base') <= number(modifier.condition.value, 'trait modifier condition value');
  };
  const activeModifiersByTarget = new Map<
    string,
    Array<(typeof modifierApplications)[number]>
  >();
  for (const application of modifierApplications) {
    for (const target of resolveModifierTargets(application.source, application.modifier)) {
      if (!modifierConditionMatches(target, application.modifier)) continue;
      const key = `${target.instanceId}\0${application.modifier.path.at(-1)!}`;
      const grouped = activeModifiersByTarget.get(key) ?? [];
      grouped.push(application);
      activeModifiersByTarget.set(key, grouped);
    }
  }
  for (const [target, applications] of activeModifiersByTarget) {
    const setsByPriority = new Map<number, typeof applications>();
    for (const application of applications.filter(({ modifier }) => modifier.operation === 'sets')) {
      const priority = application.modifier.priority ?? 0;
      const grouped = setsByPriority.get(priority) ?? [];
      grouped.push(application);
      setsByPriority.set(priority, grouped);
    }
    for (const [priority, sets] of setsByPriority) {
      if (new Set(sets.map(({ modifier }) => JSON.stringify(modifier.amount))).size > 1) {
        throw new Error(
          `Trait modifiers conflict at '${target.replace('\0', '.')}' with priority ${priority}: `
          + `${sets.map(({ source, modifier }) => `${source.traitId}:sets→${String(modifier.amount)}`).join(', ')}.`,
        );
      }
    }
    const lowerBounds = applications
      .filter(({ modifier }) => modifier.operation === 'at-least')
      .map(({ modifier }) => number(modifier.amount, 'trait minimum bound'));
    const upperBounds = applications
      .filter(({ modifier }) => modifier.operation === 'at-most')
      .map(({ modifier }) => number(modifier.amount, 'trait maximum bound'));
    if (lowerBounds.length && upperBounds.length
      && Math.max(...lowerBounds) > Math.min(...upperBounds)) {
      throw new Error(
        `Trait modifier bounds conflict at '${target.replace('\0', '.')}': `
        + `minimum ${Math.max(...lowerBounds)} exceeds maximum ${Math.min(...upperBounds)}.`,
      );
    }
  }
  for (const { source, modifier } of modifierApplications) {
      const key = modifier.path.at(-1)!;
      const mountSelector = modifier.mountSelector;
      const mountSelectors = modifier.mountSelectors;
      for (const target of resolveModifierTargets(source, modifier)) {
        const before = target.values[key];
        const condition = modifier.condition;
        const conditionMatched = modifierConditionMatches(target, modifier);
        if (!conditionMatched) {
          target.valueModifiers.push({
            sourceInstanceId: source.instanceId,
            sourceTraitId: source.traitId,
            anchor: modifier.anchor,
            operation: modifier.operation,
            path: modifier.path,
            amount: modifier.amount,
            ...(modifier.priority ? { priority: modifier.priority } : {}),
            condition,
            applied: false,
            conditionMatched: false,
            ...(modifier.authoredAmount ? { authoredAmount: modifier.authoredAmount } : {}),
            ...(modifier.normalizedAmount ? { normalizedAmount: modifier.normalizedAmount } : {}),
            ...(modifier.targetUnit ? { targetUnit: modifier.targetUnit } : {}),
            ...(mountSelector ? { mountSelector } : {}),
            ...(mountSelectors ? { mountSelectors } : {}),
            ...(before !== undefined ? { before } : {}),
            after: before,
          });
          continue;
        }
        let after: ResolutionPrimitive;
        if (modifier.operation === 'sets') {
          after = modifier.amount;
        } else {
          if (typeof before !== 'number' || typeof modifier.amount !== 'number') {
            throw new Error(`Trait modifier '${source.instanceId}' requires a numeric base value at '${target.instanceId}.${key}'.`);
          }
          if (modifier.operation === 'increases') after = before + modifier.amount;
          else if (modifier.operation === 'decreases') after = before - modifier.amount;
          else if (modifier.operation === 'multiplies') after = before * modifier.amount;
          else if (modifier.operation === 'divides') {
            if (modifier.amount === 0) throw new Error(`Trait modifier '${source.instanceId}' cannot divide by zero.`);
            after = before / modifier.amount;
          } else if (modifier.operation === 'at-least') after = Math.max(before, modifier.amount);
          else after = Math.min(before, modifier.amount);
          if (!Number.isFinite(after)) throw new Error(`Trait modifier '${source.instanceId}' produced a non-finite number.`);
        }
        target.values[key] = after;
        target.valueModifiers.push({
          sourceInstanceId: source.instanceId,
          sourceTraitId: source.traitId,
          anchor: modifier.anchor,
          operation: modifier.operation,
          path: modifier.path,
          amount: modifier.amount,
          ...(modifier.priority ? { priority: modifier.priority } : {}),
          ...(condition ? { condition, applied: true, conditionMatched: true } : {}),
          ...(modifier.authoredAmount ? { authoredAmount: modifier.authoredAmount } : {}),
          ...(modifier.normalizedAmount ? { normalizedAmount: modifier.normalizedAmount } : {}),
          ...(modifier.targetUnit ? { targetUnit: modifier.targetUnit } : {}),
          ...(mountSelector ? { mountSelector } : {}),
          ...(mountSelectors ? { mountSelectors } : {}),
          ...(before !== undefined ? { before } : {}),
          after,
        });
      }
  }
  return {
    activeTraits: [...new Set(effectiveTraitInstances.map((instance) => instance.traitId))].map((traitId) => ({
      traitId,
      roots: effectiveTraitInstances
        .filter((instance) => instance.traitId === traitId)
        .map((instance) => ({
          rootTraitId: instance.rootTraitId,
          traitChain: instance.traitChain,
        }))
        .filter((path, index, paths) =>
          paths.findIndex((candidate) =>
            candidate.rootTraitId === path.rootTraitId
            && candidate.traitChain.join('\0') === path.traitChain.join('\0')) === index)
        .sort((left, right) =>
          left.rootTraitId.localeCompare(right.rootTraitId)
          || left.traitChain.join('\0').localeCompare(right.traitChain.join('\0'))),
    })).sort((left, right) => left.traitId.localeCompare(right.traitId)),
    activeTraitInstances: effectiveTraitInstances.sort((left, right) =>
      left.instanceId.localeCompare(right.instanceId)),
    traitChoices: resolvedChoices.sort((left, right) =>
      left.traitId.localeCompare(right.traitId)
      || (left.traitInstanceId ?? '').localeCompare(right.traitInstanceId ?? '')),
    structuralChanges: structuralChanges.sort((left, right) =>
      left.targetInstanceId.localeCompare(right.targetInstanceId)),
  };
}

function performCheck(
  check: CheckDefinition,
  modifiers: ModifierDefinition[],
  context: EvaluationContext,
  results: Record<string, Record<string, ResolutionPrimitive>>,
  entropy: number[],
): { values: Record<string, ResolutionPrimitive>; dice: ResolutionDieResult[]; totals: ResolutionRollResult['totals']; appliedModifierIds: string[] } {
  assertSubjectContract(check, context);
  const pools: ResolutionDiePool[] = 'dice' in check.roll
    ? check.roll.dice
    : [{
        dieTraitId: check.roll.dieTraitId ?? `die:d${check.roll.sides}`,
        count: check.roll.count,
        sides: check.roll.sides,
        rollKind: check.roll.rollKind,
      }];
  const dice: ResolutionDieResult[] = [];
  const rollDie = (
    pool: Omit<ResolutionDiePool, 'count'>,
    origin: ResolutionDieResult['origin'],
    sourceDefinitionId: string,
    appliedModifierIds: string[] = [],
    replacesResultId?: string,
  ): ResolutionDieResult => {
    const roll = context.entropy[entropy.length];
    if (!Number.isInteger(roll) || roll < 1 || roll > pool.sides) {
      throw new Error(`Recorded entropy for '${pool.dieTraitId}' must be an integer from 1 to ${pool.sides}.`);
    }
    entropy.push(roll);
    return {
      resultId: `${check.definitionId}:die:${dice.length}`,
      dieTraitId: pool.dieTraitId,
      sides: pool.sides,
      rollKind: pool.rollKind ?? check.roll.rollKind ?? 'other',
      rawResult: roll,
      effectiveResult: roll,
      origin,
      sourceDefinitionId,
      ...(origin === 'original' && 'rollTraitId' in check.roll && check.roll.rollTraitId
        ? { sourceRollTraitId: check.roll.rollTraitId }
        : {}),
      active: true,
      ...(replacesResultId ? { replacesResultId } : {}),
      appliedModifierIds,
    };
  };
  for (const pool of pools) {
    for (let index = 0; index < pool.count; index += 1) {
      dice.push(rollDie(pool, 'original', check.definitionId));
    }
  }

  const totalModifiers: TotalModifierDefinition[] = [];
  const appliedModifierIds: string[] = [];
  const rollModifiers = modifiers
    .filter((modifier): modifier is RollModifierDefinition => modifier.modifierKind === 'roll-result')
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.definitionId.localeCompare(right.definitionId));
  for (const modifier of modifiers) {
    if (modifier.modifierKind !== 'roll-result') totalModifiers.push(modifier);
  }
  const matches = (die: ResolutionDieResult, modifier: RollModifierDefinition): boolean => {
    const selector = modifier.selector;
    return die.active
      && (!selector?.dieTraitIds?.length || selector.dieTraitIds.includes(die.dieTraitId))
      && (!selector?.rollKinds?.length || selector.rollKinds.includes(die.rollKind))
      && (!selector?.rawResults?.length || selector.rawResults.includes(die.rawResult))
      && (!selector?.origins?.length || selector.origins.includes(die.origin));
  };
  for (const modifier of rollModifiers) {
    assertSubjectContract(modifier, context);
    if (modifier.when && !condition(modifier.when, context, results)) continue;
    if (modifier.rollOperation.kind === 'add-dice') {
      for (let index = 0; index < modifier.rollOperation.dice.count; index += 1) {
        dice.push(rollDie(modifier.rollOperation.dice, 'added', modifier.definitionId, [modifier.definitionId]));
      }
      appliedModifierIds.push(modifier.definitionId);
      continue;
    }
    if (modifier.rollOperation.kind === 'replace-result') {
      const candidates = dice.filter((die) => matches(die, modifier));
      const limit = modifier.rollOperation.maximumApplications ?? candidates.length;
      const selected = candidates.slice(0, limit);
      for (const die of selected) {
        die.active = false;
        die.appliedModifierIds.push(modifier.definitionId);
        const replacement = rollDie(
          {
            ...modifier.rollOperation.die,
            rollKind: modifier.rollOperation.die.rollKind ?? die.rollKind,
          },
          'replacement',
          modifier.definitionId,
          [modifier.definitionId],
          die.resultId,
        );
        die.replacedByResultId = replacement.resultId;
        dice.push(replacement);
      }
      if (selected.length) appliedModifierIds.push(modifier.definitionId);
      continue;
    }
    const value = number(expression(modifier.rollOperation.value, context, results), modifier.definitionId);
    const selected = dice.filter((candidate) => matches(candidate, modifier));
    for (const die of selected) {
      die.effectiveResult += value;
      die.appliedModifierIds.push(modifier.definitionId);
    }
    if (selected.length) appliedModifierIds.push(modifier.definitionId);
  }

  const totals = dice.filter((die) => die.active).reduce<ResolutionRollResult['totals']>((byKind, die) => {
    byKind[die.rollKind] = (byKind[die.rollKind] ?? 0) + die.effectiveResult;
    return byKind;
  }, {});
  const primaryRollKind = check.roll.rollKind ?? 'other';
  const baseBonus = number(expression(check.bonus, context, results), `${check.definitionId}.bonus`);
  const roll = totals[primaryRollKind] ?? 0;
  let total = roll + baseBonus;
  for (const modifier of totalModifiers) {
    assertSubjectContract(modifier, context);
    if (modifier.when && !condition(modifier.when, context, results)) continue;
    const value = number(expression(modifier.value, context, results), modifier.definitionId);
    total = modifier.operation === 'add' ? total + value : total * value;
    appliedModifierIds.push(modifier.definitionId);
  }
  const target = number(expression(check.target, context, results), `${check.definitionId}.target`);
  return {
    values: { ...totals, roll, bonus: total - roll, total, target, success: total >= target },
    dice,
    totals,
    appliedModifierIds,
  };
}

export function previewResolutionOperation(
  artifact: CompiledResolutionArtifact,
  operationId: string,
  sourceContext: ResolutionContext,
  traitArtifact?: CompiledTraitCompositionArtifact,
): ResolutionPreview {
  const definitions = new Map(artifact.definitions.map((definition) => [definition.definitionId, definition]));
  const operation = definitions.get(operationId);
  if (!operation || operation.definitionType !== 'operation') throw new Error(`Operation '${operationId}' is not compiled.`);
  const steps = new Map(operation.steps.map((step) => [step.stepId, step]));
  const context: EvaluationContext = {
    ...sourceContext,
    actor: { ...sourceContext.actor, fields: { ...sourceContext.actor.fields }, resources: { ...sourceContext.actor.resources } },
    target: { ...sourceContext.target, fields: { ...sourceContext.target.fields } },
  };
  const results: Record<string, Record<string, ResolutionPrimitive>> = {};
  const trace: ResolutionPreview['trace'] = [];
  const resourceChanges: ResolutionPreview['resourceChanges'] = [];
  const effects: ResolutionPreview['effects'] = [];
  const events: ResolutionPreview['events'] = [];
  const rolls: ResolutionPreview['rolls'] = [];
  const traitExpansion = expandActiveTraits(
    context.activeTraitIds ?? [],
    context.traitPrerequisiteSelections ?? {},
    context.activeTraitInstances ?? [],
    context.traitInstancePrerequisiteSelections ?? {},
    context.traitInstanceValues ?? {},
    traitArtifact,
  );
  const { activeTraits, activeTraitInstances, traitChoices, structuralChanges } = traitExpansion;
  context.resolvedTraitInstances = activeTraitInstances;
  context.resolvedTraitChoices = traitChoices;
  context.resolvedTraitTags = Object.fromEntries(
    (traitArtifact?.traits ?? []).map((trait) => [trait.traitId, trait.tags ?? []]),
  );
  const modifierSources = new Map<string, ResolutionRollResult['modifierActivations'][number]['sources']>();
  const activateModifier = (
    modifierId: string,
    source: ResolutionRollResult['modifierActivations'][number]['sources'][number],
  ): void => {
    const definition = definitions.get(modifierId);
    if (!definition || definition.definitionType !== 'modifier') {
      throw new Error(`Modifier '${modifierId}' activated by ${source.kind} '${source.id}' is unavailable.`);
    }
    const sources = modifierSources.get(modifierId) ?? [];
    if (!sources.some((candidate) =>
      candidate.kind === source.kind
      && candidate.id === source.id
      && candidate.rootTraitId === source.rootTraitId
      && candidate.instanceId === source.instanceId
      && candidate.rootInstanceId === source.rootInstanceId
      && JSON.stringify(candidate.traitChain ?? []) === JSON.stringify(source.traitChain ?? []))) {
      sources.push(source);
    }
    modifierSources.set(modifierId, sources);
  };
  const activateEffect = (effectId: string): void => {
    const effect = definitions.get(effectId);
    if (!effect || effect.definitionType !== 'effect') throw new Error(`Active effect '${effectId}' is unavailable.`);
    for (const modifierId of effect.modifierIds ?? []) {
      activateModifier(modifierId, { kind: 'effect', id: effectId });
    }
  };
  for (const modifierId of context.activeModifierIds ?? []) {
    activateModifier(modifierId, { kind: 'explicit', id: modifierId });
  }
  const activeTraitsById = new Map(activeTraits.map((trait) => [trait.traitId, trait]));
  assertSubjectContract(
    operation,
    context,
    artifact.operationSubjectContracts?.[operation.definitionId]?.effectiveTraitIds,
    artifact.operationSubjectContracts?.[operation.definitionId]?.effectiveTraitSelections,
  );
  const explicitTraitInstances = !!sourceContext.activeTraitInstances?.length;
  for (const definition of artifact.definitions) {
    if (definition.definitionType !== 'modifier') continue;
    for (const traitId of definition.activatedByTraitIds ?? []) {
      const activeTrait = activeTraitsById.get(traitId);
      const instances = activeTraitInstances.filter((instance) => instance.traitId === traitId);
      if (explicitTraitInstances) {
        for (const instance of instances) {
          activateModifier(definition.definitionId, {
            kind: 'trait',
            id: traitId,
            rootTraitId: instance.rootTraitId,
            traitChain: instance.traitChain,
            instanceId: instance.instanceId,
            rootInstanceId: instance.rootInstanceId,
            instanceChain: instance.instanceChain,
          });
        }
      } else {
        for (const root of activeTrait?.roots ?? []) {
          activateModifier(definition.definitionId, {
            kind: 'trait',
            id: traitId,
            rootTraitId: root.rootTraitId,
            traitChain: root.traitChain,
          });
        }
      }
    }
  }
  for (const effectId of context.activeEffectIds ?? []) activateEffect(effectId);
  const entropyConsumed: number[] = [];
  let stepId = operation.startStepId;
  let executed = 0;

  while (true) {
    executed += 1;
    if (executed > operation.budget.maximumSteps) throw new Error(`Operation exceeded its ${operation.budget.maximumSteps}-step budget.`);
    const step = steps.get(stepId);
    if (!step) throw new Error(`Operation step '${stepId}' is unavailable.`);
    if (step.kind === 'validate') {
      const allowed = condition(step.condition, context, results);
      trace.push({ stepId, kind: step.kind, message: allowed ? 'Availability condition passed.' : step.failureMessage, values: { allowed } });
      if (!allowed) return { outcome: 'failure', data: { reason: step.failureMessage }, resourceChanges, effects, events, activeTraits, activeTraitInstances, traitChoices, structuralChanges, rolls, entropyConsumed, trace };
      stepId = step.next;
    } else if (step.kind === 'consume-resource') {
      const amount = number(expression(step.amount, context, results), `${stepId}.amount`);
      const before = context.actor.resources[step.resourceId] ?? 0;
      if (amount < 0 || before < amount) throw new Error(`Resource '${step.resourceId}' does not have ${amount} available.`);
      const after = before - amount;
      context.actor.resources[step.resourceId] = after;
      resourceChanges.push({ resourceId: step.resourceId, before, after });
      trace.push({ stepId, kind: step.kind, message: `Reserved ${amount} ${step.resourceId}.`, values: { before, after } });
      stepId = step.next;
    } else if (step.kind === 'perform-check') {
      const check = definitions.get(step.checkId);
      if (!check || check.definitionType !== 'check') throw new Error(`Check '${step.checkId}' is unavailable.`);
      const modifiers = artifact.definitions.filter((definition): definition is ModifierDefinition =>
        definition.definitionType === 'modifier'
        && modifierSources.has(definition.definitionId)
        && modifierTargetsCheck(definition, check));
      const result = performCheck(check, modifiers, context, results, entropyConsumed);
      results[step.resultKey] = result.values;
      rolls.push({
        resultKey: step.resultKey,
        checkId: check.definitionId,
        ...('rollTraitId' in check.roll && check.roll.rollTraitId
          ? { rollTraitId: check.roll.rollTraitId }
          : {}),
        dice: result.dice,
        appliedModifierIds: result.appliedModifierIds,
        modifierActivations: result.appliedModifierIds.map((modifierId) => ({
          modifierId,
          sources: modifierSources.get(modifierId) ?? [],
        })),
        totals: result.totals,
        roll: number(result.values.roll, `${step.resultKey}.roll`),
        bonus: number(result.values.bonus, `${step.resultKey}.bonus`),
        total: number(result.values.total, `${step.resultKey}.total`),
        target: number(result.values.target, `${step.resultKey}.target`),
        success: result.values.success === true,
      });
      trace.push({ stepId, kind: step.kind, message: result.values.success ? `${check.name} succeeded.` : `${check.name} failed.`, values: result.values });
      stepId = result.values.success ? step.onSuccess : step.onFailure;
    } else if (step.kind === 'apply-effect') {
      const effect = definitions.get(step.effectId);
      if (!effect || effect.definitionType !== 'effect') throw new Error(`Effect '${step.effectId}' is unavailable.`);
      const targetId = step.target === 'actor' ? context.actor.id : context.target.id;
      effects.push({ effectId: step.effectId, targetId });
      if (step.target === 'actor') activateEffect(step.effectId);
      trace.push({ stepId, kind: step.kind, message: `Applied ${effect.name} to ${targetId}.` });
      stepId = step.next;
    } else if (step.kind === 'emit-event') {
      const event = definitions.get(step.eventId);
      if (!event || event.definitionType !== 'event') throw new Error(`Event '${step.eventId}' is unavailable.`);
      const payload = Object.fromEntries(Object.entries(step.payload).map(([key, value]) => [key, expression(value, context, results)]));
      events.push({ eventId: step.eventId, visibility: event.visibility, payload });
      trace.push({ stepId, kind: step.kind, message: `Emitted ${event.name}.` });
      stepId = step.next;
    } else {
      const data = Object.fromEntries(Object.entries(step.data ?? {}).map(([key, value]) => [key, expression(value, context, results)]));
      trace.push({ stepId, kind: step.kind, message: `Returned ${step.outcome}.`, values: data });
      return { outcome: step.outcome, data, resourceChanges, effects, events, activeTraits, activeTraitInstances, traitChoices, structuralChanges, rolls, entropyConsumed, trace };
    }
  }
}
