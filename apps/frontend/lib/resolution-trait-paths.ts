import {
  buildTraitShape,
  type TraitShapeDefinition,
  type TraitShapeNode,
} from './trait-shape';

export type GuidedTraitPathProvenance = {
  rootTraitId: string;
  rootLabel: string;
  traitChain: string[];
  traitChainLabels: string[];
  contractKind: 'direct' | 'inherited' | 'catalog';
  checkIds: string[];
};

export type GuidedTraitPathOption = {
  path: string;
  label: string;
  dataType: string;
  explanation: string;
  provenance: GuidedTraitPathProvenance[];
};

export type GuidedTraitPathResult = {
  options: GuidedTraitPathOption[];
  repairs: GuidedTraitPathRepair[];
  diagnostics: string[];
  scoped: boolean;
};

export type GuidedTraitPathRepair = {
  path: string;
  reason: 'outside-subject' | 'optional-prerequisite' | 'composition-conflict';
  message: string;
  candidates: Array<{
    traitId: string;
    traitLabel: string;
    explanation: string;
    selectionOwnerTraitId?: string;
    selectionOwnerLabel?: string;
  }>;
};

export type GuidedOperationSubjectContract = {
  directTraitIds: string[];
  inheritedTraitIds: string[];
  effectiveTraitIds: string[];
  effectiveTraitSelections?: Record<string, string[]>;
  checkSources: Array<{ checkId: string; traitIds: string[]; traitSelections?: Record<string, string[]> }>;
};

export function guidedOperationSubjectContract(
  directTraitIds: string[],
  steps: Array<{ stepId: string; kind: string; checkId?: string; next?: string; onSuccess?: string; onFailure?: string }>,
  resolutionDefinitions: Array<{ body: Record<string, unknown> }>,
  directTraitSelections: Record<string, string[]> = {},
): GuidedOperationSubjectContract {
  const checks = new Map(
    resolutionDefinitions.flatMap((definition) =>
      definition.body.metamodelVersion === 'resolution/1'
      && definition.body.definitionType === 'check'
      && typeof definition.body.definitionId === 'string'
        ? [[definition.body.definitionId, definition.body] as const]
        : []),
  );
  const normalizedDirect = [...new Set(directTraitIds)].sort();
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));
  const reachableCheckIds = new Set<string>();
  const pendingStepIds = steps[0]?.stepId ? [steps[0].stepId] : [];
  const visitedStepIds = new Set<string>();
  while (pendingStepIds.length) {
    const stepId = pendingStepIds.shift()!;
    if (visitedStepIds.has(stepId)) continue;
    visitedStepIds.add(stepId);
    const step = stepsById.get(stepId);
    if (!step) continue;
    if (step.kind === 'perform-check') {
      if (step.checkId) reachableCheckIds.add(step.checkId);
      if (step.onSuccess) pendingStepIds.push(step.onSuccess);
      if (step.onFailure) pendingStepIds.push(step.onFailure);
    } else if (step.kind !== 'return' && step.next) {
      pendingStepIds.push(step.next);
    }
  }
  const checkSources = [...new Set(
    reachableCheckIds,
  )].flatMap((checkId) => {
    const check = checks.get(checkId);
    const traitIds = Array.isArray(check?.subjectTraitIds)
      ? [...new Set(check.subjectTraitIds.filter((traitId): traitId is string => typeof traitId === 'string'))].sort()
      : [];
    const traitSelections = check?.subjectTraitSelections
      && typeof check.subjectTraitSelections === 'object'
      && !Array.isArray(check.subjectTraitSelections)
      ? check.subjectTraitSelections as Record<string, string[]>
      : {};
    return traitIds.length || Object.keys(traitSelections).length
      ? [{ checkId, traitIds, ...(Object.keys(traitSelections).length ? { traitSelections } : {}) }]
      : [];
  }).sort((left, right) => left.checkId.localeCompare(right.checkId));
  const inheritedTraitIds = [...new Set(checkSources.flatMap((source) => source.traitIds))]
    .filter((traitId) => !normalizedDirect.includes(traitId))
    .sort();
  const effectiveTraitSelections = Object.fromEntries(
    [...new Set([
      ...Object.keys(directTraitSelections),
      ...checkSources.flatMap((source) => Object.keys(source.traitSelections ?? {})),
    ])].sort().map((ownerTraitId) => [
      ownerTraitId,
      [...new Set([
        ...(directTraitSelections[ownerTraitId] ?? []),
        ...checkSources.flatMap((source) => source.traitSelections?.[ownerTraitId] ?? []),
      ])].sort(),
    ]),
  );
  return {
    directTraitIds: normalizedDirect,
    inheritedTraitIds,
    effectiveTraitIds: [...new Set([...normalizedDirect, ...inheritedTraitIds])].sort(),
    ...(Object.keys(effectiveTraitSelections).length ? { effectiveTraitSelections } : {}),
    checkSources,
  };
}

function optionsFromNodes(
  nodes: TraitShapeNode[],
  definitions: TraitShapeDefinition[],
  options: Map<string, GuidedTraitPathOption>,
  rootTraitIds: string[],
  contract?: Pick<GuidedOperationSubjectContract, 'directTraitIds' | 'checkSources'>,
  prerequisiteSelections: Record<string, string[]> = {},
): void {
  const definitionsById = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const rootShapes = new Map(rootTraitIds.map((rootTraitId) => [
    rootTraitId,
    buildTraitShape({
      definitions,
      prerequisiteIds: [rootTraitId],
      prerequisiteMode: 'all',
      prerequisiteSelections,
    }),
  ]));
  const nodeAt = (shapeNodes: TraitShapeNode[], path: string[], kind: TraitShapeNode['kind']) =>
    shapeNodes.find((candidate) =>
      candidate.kind === kind
      && candidate.path.length === path.length
      && candidate.path.every((segment, index) => segment === path[index]));
  const provenanceFor = (
    node: TraitShapeNode,
    additionalContributorTraitId?: string,
  ): GuidedTraitPathProvenance[] => rootTraitIds.flatMap((rootTraitId) => {
    const rootShape = rootShapes.get(rootTraitId);
    if (!rootShape || !nodeAt(rootShape.nodes, node.path, node.kind)) return [];
    const traitChain = [
      rootTraitId,
      ...rootShape.nodes
        .filter((candidate): candidate is Extract<TraitShapeNode, { kind: 'branch' }> =>
          candidate.kind === 'branch'
          && candidate.path.length <= node.path.length
          && candidate.path.every((segment, index) => segment === node.path[index]))
        .sort((left, right) => left.path.length - right.path.length)
        .map((candidate) => candidate.traitId),
      node.sourceTraitId,
      additionalContributorTraitId,
    ].filter((traitId): traitId is string => !!traitId)
      .filter((traitId, index, values) => values.indexOf(traitId) === index);
    const checkIds = contract?.checkSources
      .filter((source) => source.traitIds.includes(rootTraitId))
      .map((source) => source.checkId)
      .sort() ?? [];
    const contractKind = !contract
      ? 'catalog'
      : contract.directTraitIds.includes(rootTraitId)
        ? 'direct'
        : checkIds.length
          ? 'inherited'
          : 'direct';
    return [{
      rootTraitId,
      rootLabel: definitionsById.get(rootTraitId)?.name ?? rootTraitId,
      traitChain,
      traitChainLabels: traitChain.map((traitId) => definitionsById.get(traitId)?.name ?? traitId),
      contractKind,
      checkIds,
    }];
  });
  const addOption = (
    path: string,
    dataType: string,
    provenance: GuidedTraitPathProvenance[],
  ) => {
    const existing = options.get(path);
    const merged = [...(existing?.provenance ?? []), ...provenance].filter((item, index, values) =>
      values.findIndex((candidate) =>
        candidate.rootTraitId === item.rootTraitId
        && candidate.contractKind === item.contractKind
        && candidate.checkIds.join('\0') === item.checkIds.join('\0')
        && candidate.traitChain.join('\0') === item.traitChain.join('\0')) === index);
    const explanations = merged.map((item) => {
      const origin = item.contractKind === 'inherited'
        ? `inherited from ${item.checkIds.join(', ')}`
        : item.contractKind === 'direct'
          ? 'direct self contract'
          : 'catalog fallback';
      return `${origin}: ${item.traitChainLabels.join(' → ')}`;
    });
    options.set(path, {
      path,
      dataType,
      label: `${path} — ${dataType}${explanations[0] ? ` — ${explanations[0]}` : ''}`,
      explanation: explanations.join('; '),
      provenance: merged,
    });
  };
  for (const node of nodes) {
    if (node.kind === 'terminal') {
      const path = `self.${node.path.join('.')}`;
      addOption(path, node.dataType, provenanceFor(node));
    }
    if (node.kind === 'collection' && node.acceptedTraitIds.length) {
      const elementShape = buildTraitShape({
        definitions,
        prerequisiteIds: node.acceptedTraitIds,
        prerequisiteMode: node.acceptsMode,
      });
      for (const terminal of elementShape.nodes) {
        if (terminal.kind !== 'terminal' || terminal.path.length !== 1) continue;
        const path = `self.${node.path.join('.')}[].${terminal.path[0]}`;
        addOption(path, terminal.dataType, provenanceFor(node, terminal.sourceTraitId));
      }
    }
  }
}

export function guidedTraitPathOptions(
  definitions: TraitShapeDefinition[],
  subjectTraitIds: string[] = [],
  contract?: Pick<GuidedOperationSubjectContract, 'directTraitIds' | 'checkSources'>,
  repairPaths: string[] = [],
  prerequisiteSelections: Record<string, string[]> = {},
): GuidedTraitPathResult {
  const options = new Map<string, GuidedTraitPathOption>();
  const catalogOptions = new Map<string, GuidedTraitPathOption>();
  const diagnostics: string[] = [];
  for (const definition of definitions) {
    const shape = buildTraitShape({
      definitions,
      prerequisiteIds: [definition.externalId],
      prerequisiteMode: 'all',
    });
    if (shape.diagnostics.length) continue;
    optionsFromNodes(shape.nodes, definitions, catalogOptions, [definition.externalId]);
  }
  if (subjectTraitIds.length) {
    const shape = buildTraitShape({
      definitions,
      prerequisiteIds: subjectTraitIds,
      prerequisiteMode: 'all',
      prerequisiteSelections,
    });
    diagnostics.push(...shape.diagnostics.map((diagnostic) => diagnostic.message));
    optionsFromNodes(shape.nodes, definitions, options, subjectTraitIds, contract ?? {
      directTraitIds: subjectTraitIds,
      checkSources: [],
    }, prerequisiteSelections);
  } else {
    catalogOptions.forEach((option, path) => options.set(path, option));
  }
  const repairs = subjectTraitIds.length
    ? [...catalogOptions.values()]
      .filter((catalogOption) =>
        repairPaths.includes(catalogOption.path)
        && !options.has(catalogOption.path))
      .map((catalogOption): GuidedTraitPathRepair => {
        const definitionsById = new Map(definitions.map((definition) => [definition.externalId, definition]));
        const reachable = new Set<string>();
        const visit = (traitId: string) => {
          if (reachable.has(traitId)) return;
          reachable.add(traitId);
          const body = definitionsById.get(traitId)?.body;
          const prerequisites = body && typeof body.prerequisites === 'object' && body.prerequisites !== null
            ? (body.prerequisites as { ids?: unknown }).ids
            : undefined;
          if (Array.isArray(prerequisites)) {
            prerequisites.filter((item): item is string => typeof item === 'string').forEach(visit);
          }
        };
        subjectTraitIds.forEach(visit);
        const optionalCandidates = [...reachable].flatMap((ownerTraitId) => {
          const owner = definitionsById.get(ownerTraitId);
          const prerequisites = owner?.body.prerequisites;
          if (!prerequisites || typeof prerequisites !== 'object' || Array.isArray(prerequisites)
            || (prerequisites as { mode?: unknown }).mode === 'all'
            || !Array.isArray((prerequisites as { ids?: unknown }).ids)) return [];
          return ((prerequisites as { ids: unknown[] }).ids)
            .filter((item): item is string => typeof item === 'string')
            .flatMap((traitId) => {
              const candidateShape = buildTraitShape({
                definitions,
                prerequisiteIds: subjectTraitIds,
                prerequisiteMode: 'all',
                prerequisiteSelections: {
                  ...prerequisiteSelections,
                  [ownerTraitId]: [traitId],
                },
              });
              if (candidateShape.diagnostics.length) return [];
              const candidateOptions = new Map<string, GuidedTraitPathOption>();
              optionsFromNodes(
                candidateShape.nodes,
                definitions,
                candidateOptions,
                subjectTraitIds,
                contract,
                { ...prerequisiteSelections, [ownerTraitId]: [traitId] },
              );
              if (!candidateOptions.has(catalogOption.path)) return [];
              return [{
                traitId,
                traitLabel: definitionsById.get(traitId)?.name ?? traitId,
                explanation: `${owner?.name ?? ownerTraitId} selects ${definitionsById.get(traitId)?.name ?? traitId}`,
                selectionOwnerTraitId: ownerTraitId,
                selectionOwnerLabel: owner?.name ?? ownerTraitId,
              }];
            });
        }).filter((candidate, index, values) =>
          values.findIndex((item) =>
            item.selectionOwnerTraitId === candidate.selectionOwnerTraitId
            && item.traitId === candidate.traitId) === index);
        if (optionalCandidates.length) {
          return {
            path: catalogOption.path,
            reason: 'optional-prerequisite',
            message: 'This path is available only for a specific prerequisite branch, so the rule must require that choice.',
            candidates: optionalCandidates,
          };
        }
        const candidates = catalogOption.provenance
          .filter((provenance) => !subjectTraitIds.includes(provenance.rootTraitId))
          .filter((provenance) => {
            const candidateRoots = [...new Set([...subjectTraitIds, provenance.rootTraitId])];
            const candidateShape = buildTraitShape({
              definitions,
              prerequisiteIds: candidateRoots,
              prerequisiteMode: 'all',
              prerequisiteSelections,
            });
            if (candidateShape.diagnostics.length) return false;
            const candidateOptions = new Map<string, GuidedTraitPathOption>();
            optionsFromNodes(candidateShape.nodes, definitions, candidateOptions, candidateRoots, undefined, prerequisiteSelections);
            return candidateOptions.has(catalogOption.path);
          })
          .map((provenance) => ({
            traitId: provenance.rootTraitId,
            traitLabel: provenance.rootLabel,
            explanation: provenance.traitChainLabels.join(' → '),
          }))
          .filter((candidate, index, values) =>
            values.findIndex((item) => item.traitId === candidate.traitId) === index);
        return candidates.length
          ? {
              path: catalogOption.path,
              reason: 'outside-subject',
              message: 'This path exists, but the current self contract does not guarantee it.',
              candidates,
            }
          : {
              path: catalogOption.path,
              reason: 'composition-conflict',
              message: 'Catalog traits define this path, but none can be safely composed with the current self contract.',
              candidates: [],
            };
      })
      .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  return {
    options: [...options.values()].sort((left, right) => left.path.localeCompare(right.path)),
    repairs,
    diagnostics: [...new Set(diagnostics)],
    scoped: subjectTraitIds.length > 0,
  };
}
