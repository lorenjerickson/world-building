import type {
  CheckDefinition,
  OperationDefinition,
  ResolutionDefinition,
} from './resolution.types';

export interface ResolutionOperationSubjectContract {
  directTraitIds: string[];
  inheritedTraitIds: string[];
  effectiveTraitIds: string[];
  effectiveTraitSelections?: Record<string, string[]>;
  checkSources: Array<{ checkId: string; traitIds: string[]; traitSelections?: Record<string, string[]> }>;
}

export function deriveOperationSubjectContract(
  operation: OperationDefinition,
  definitions: Iterable<ResolutionDefinition>,
): ResolutionOperationSubjectContract {
  const byId = new Map([...definitions].map((definition) => [definition.definitionId, definition]));
  const directTraitIds = [...new Set(operation.subjectTraitIds ?? [])].sort();
  const stepsById = new Map(operation.steps.map((step) => [step.stepId, step]));
  const reachableCheckIds = new Set<string>();
  const pendingStepIds = [operation.startStepId];
  const visitedStepIds = new Set<string>();
  while (pendingStepIds.length) {
    const stepId = pendingStepIds.shift()!;
    if (visitedStepIds.has(stepId)) continue;
    visitedStepIds.add(stepId);
    const step = stepsById.get(stepId);
    if (!step) continue;
    if (step.kind === 'perform-check') {
      reachableCheckIds.add(step.checkId);
      pendingStepIds.push(step.onSuccess, step.onFailure);
    } else if (step.kind !== 'return') {
      pendingStepIds.push(step.next);
    }
  }
  const checkSources = [...new Set(
    reachableCheckIds,
  )].flatMap((checkId) => {
    const definition = byId.get(checkId);
    if (!definition || definition.definitionType !== 'check') return [];
    const traitIds = [...new Set((definition as CheckDefinition).subjectTraitIds ?? [])].sort();
    const traitSelections = definition.subjectTraitSelections ?? {};
    return traitIds.length || Object.keys(traitSelections).length
      ? [{ checkId, traitIds, ...(Object.keys(traitSelections).length ? { traitSelections } : {}) }]
      : [];
  }).sort((left, right) => left.checkId.localeCompare(right.checkId));
  const inheritedTraitIds = [...new Set(checkSources.flatMap((source) => source.traitIds))]
    .filter((traitId) => !directTraitIds.includes(traitId))
    .sort();
  const effectiveTraitSelections = Object.fromEntries(
    [...new Set([
      ...Object.keys(operation.subjectTraitSelections ?? {}),
      ...checkSources.flatMap((source) => Object.keys(source.traitSelections ?? {})),
    ])].sort().map((ownerTraitId) => [
      ownerTraitId,
      [...new Set([
        ...(operation.subjectTraitSelections?.[ownerTraitId] ?? []),
        ...checkSources.flatMap((source) => source.traitSelections?.[ownerTraitId] ?? []),
      ])].sort(),
    ]),
  );
  return {
    directTraitIds,
    inheritedTraitIds,
    effectiveTraitIds: [...new Set([...directTraitIds, ...inheritedTraitIds])].sort(),
    ...(Object.keys(effectiveTraitSelections).length ? { effectiveTraitSelections } : {}),
    checkSources,
  };
}
