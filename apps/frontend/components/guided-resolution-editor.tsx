'use client';

import { useEffect, useMemo, useState } from 'react';
import { AuthoringDiagnostic, getRuleDefinitionDescriptor, previewRuleOperation, runRuleFixtures } from '@/lib/rule-authoring';
import {
  buildGuidedScalarExpression,
  defaultGuidedScalarExpression,
  parseGuidedScalarExpression,
  type GuidedExpressionSource,
  type GuidedScalarExpressionDraft,
} from '@/lib/resolution-expression';
import {
  guidedOperationSubjectContract,
  guidedTraitPathOptions,
  type GuidedTraitPathOption,
  type GuidedTraitPathRepair,
} from '@/lib/resolution-trait-paths';
import { buildTraitShape, traitSatisfiesCollection, type TraitShapeNode } from '@/lib/trait-shape';

// ── Step draft types ──────────────────────────────────────────────────────────

export type OperationStepKind =
  | 'validate'
  | 'consume-resource'
  | 'perform-check'
  | 'apply-effect'
  | 'emit-event'
  | 'return';

export type OperationStepDraft = {
  stepId: string;
  kind: OperationStepKind;
  // validate
  conditionField?: 'actor-field' | 'target-field' | 'trait-instance-field' | 'trait-path-field';
  conditionInstanceId?: string;
  conditionTraitPath?: string;
  conditionMountOrdinal?: number;
  conditionKey?: string;
  conditionLeftExpression?: GuidedScalarExpressionDraft;
  conditionRightExpression?: GuidedScalarExpressionDraft;
  conditionOp?: 'gte' | 'lte' | 'equals';
  conditionValue?: number;
  failureMessage?: string;
  // consume-resource
  resourceId?: string;
  resourceCost?: number;
  resourceAmountExpression?: GuidedScalarExpressionDraft;
  // perform-check
  checkId?: string;
  resultKey?: string;
  onSuccess?: string;
  onFailure?: string;
  // apply-effect
  effectId?: string;
  effectTarget?: 'actor' | 'target';
  // emit-event
  eventId?: string;
  payloadFromResult?: string;
  payloadValueKey?: string;
  eventPayloadExpression?: GuidedScalarExpressionDraft;
  // return
  outcome?: 'success' | 'failure';
  dataResultKey?: string;
  returnDataKey?: string;
  returnDataExpression?: GuidedScalarExpressionDraft;
  // routing (non-branching steps)
  next?: string;
};

// ── Draft union ───────────────────────────────────────────────────────────────

export type ResolutionAuthoringDraft =
  | {
    kind: 'modifier';
    stableId: string;
    targetMode: 'check' | 'roll-kind' | 'roll-trait' | 'all-rolls';
    targetCheckId: string;
    targetRollKind: 'saving' | 'hit' | 'damage' | 'other';
    targetRollTraitId: string;
    subjectTraitIds: string[];
    subjectTraitSelections: Record<string, string[]>;
    activatingTraitIds: string[];
    modifierMode: 'total' | 'add-dice' | 'replace-result' | 'increase-result';
    operation: 'add' | 'multiply';
    value: number;
    valueExpression?: GuidedScalarExpressionDraft;
    dieTraitId: string;
    dieSides: number;
    diceCount: number;
    rollKind: 'saving' | 'hit' | 'damage' | 'other';
    matchDieTraitId: string;
    matchRawResult: string;
    maximumApplications: number;
  }
  | { kind: 'resource'; stableId: string; capacity: number; minimum: number; refresh: 'manual' | 'encounter' | 'turn' }
  | { kind: 'effect'; stableId: string; durationKind: 'instant' | 'turns' | 'persistent'; durationTurns: number; modifierIds: string }
  | { kind: 'event'; stableId: string; visibility: 'public' | 'gm'; payloadFields: string }
  | {
    kind: 'check';
    stableId: string;
    rollSource: 'single-die' | 'roll-trait';
    rollTraitId: string;
    dicePools: Array<{ dieTraitId: string; count: number; sides: number }>;
    diceCount: number;
    dieTraitId: string;
    dieSides: number;
    rollKind: 'saving' | 'hit' | 'damage' | 'other';
    actorBonusField: string;
    targetField: string;
    subjectTraitIds: string[];
    subjectTraitSelections: Record<string, string[]>;
    bonusExpression?: GuidedScalarExpressionDraft;
    targetExpression?: GuidedScalarExpressionDraft;
  }
  | { kind: 'operation'; stableId: string; subjectTraitIds: string[]; subjectTraitSelections: Record<string, string[]>; steps: OperationStepDraft[]; maximumSteps: number };

// ── Defaults ──────────────────────────────────────────────────────────────────

function defaultMeleeSteps(): OperationStepDraft[] {
  return [
    { stepId: 'consume-resource', kind: 'consume-resource', resourceId: 'resource:action-points', resourceCost: 1, next: 'perform-check' },
    { stepId: 'perform-check', kind: 'perform-check', checkId: 'check:melee-attack', resultKey: 'check', onSuccess: 'apply-effect', onFailure: 'emit-miss' },
    { stepId: 'apply-effect', kind: 'apply-effect', effectId: 'effect:wounded', effectTarget: 'target', next: 'emit-hit' },
    { stepId: 'emit-hit', kind: 'emit-event', eventId: 'event:melee-attack-hit', payloadFromResult: 'check', next: 'success' },
    { stepId: 'emit-miss', kind: 'emit-event', eventId: 'event:melee-attack-missed', payloadFromResult: 'check', next: 'failure' },
    { stepId: 'success', kind: 'return', outcome: 'success', dataResultKey: 'check' },
    { stepId: 'failure', kind: 'return', outcome: 'failure', dataResultKey: 'check' },
  ];
}

function defaultStep(kind: OperationStepKind, stepIndex: number): OperationStepDraft {
  const stepId = `step-${stepIndex + 1}`;
  switch (kind) {
    case 'validate': return { stepId, kind, conditionField: 'actor-field', conditionKey: 'id', conditionOp: 'gte', conditionValue: 0, failureMessage: 'Not available.', next: '' };
    case 'consume-resource': return { stepId, kind, resourceId: '', resourceCost: 1, next: '' };
    case 'perform-check': return { stepId, kind, checkId: '', resultKey: 'check', onSuccess: '', onFailure: '' };
    case 'apply-effect': return { stepId, kind, effectId: '', effectTarget: 'target', next: '' };
    case 'emit-event': return { stepId, kind, eventId: '', payloadFromResult: '', next: '' };
    case 'return': return { stepId, kind, outcome: 'success', dataResultKey: '' };
  }
}

export function defaultResolutionDraft(kind: ResolutionAuthoringDraft['kind']): ResolutionAuthoringDraft {
  switch (kind) {
    case 'modifier': return { kind, stableId: 'modifier:new-modifier', targetMode: 'check', targetCheckId: 'check:melee-attack', targetRollKind: 'hit', targetRollTraitId: '', subjectTraitIds: [], subjectTraitSelections: {}, activatingTraitIds: [], modifierMode: 'total', operation: 'add', value: 1, dieTraitId: 'trait:d20', dieSides: 20, diceCount: 1, rollKind: 'damage', matchDieTraitId: '', matchRawResult: '', maximumApplications: 1 };
    case 'resource': return { kind, stableId: 'resource:new-resource', capacity: 3, minimum: 0, refresh: 'turn' };
    case 'effect': return { kind, stableId: 'effect:new-effect', durationKind: 'persistent', durationTurns: 2, modifierIds: '' };
    case 'event': return { kind, stableId: 'event:new-event', visibility: 'public', payloadFields: 'attackerId:string, targetId:string' };
    case 'check': return { kind, stableId: 'check:new-check', rollSource: 'single-die', rollTraitId: '', dicePools: [], diceCount: 1, dieTraitId: 'trait:d20', dieSides: 20, rollKind: 'hit', actorBonusField: 'strength-modifier', targetField: 'defense', subjectTraitIds: [], subjectTraitSelections: {} };
    case 'operation': return { kind, stableId: 'operation:new-operation', subjectTraitIds: [], subjectTraitSelections: {}, steps: defaultMeleeSteps(), maximumSteps: 8 };
  }
}

// ── Body builders ─────────────────────────────────────────────────────────────

function legacyConditionLeft(step: OperationStepDraft): GuidedScalarExpressionDraft {
  if (step.conditionLeftExpression) return step.conditionLeftExpression;
  if (step.conditionField === 'trait-path-field') {
    return defaultGuidedScalarExpression('trait-path-field', {
      traitPath: step.conditionTraitPath ?? '',
      mountOrdinal: step.conditionMountOrdinal ?? 1,
    });
  }
  if (step.conditionField === 'trait-instance-field') {
    return defaultGuidedScalarExpression('trait-instance-field', {
      instanceId: step.conditionInstanceId ?? '',
      key: step.conditionKey ?? '',
    });
  }
  return defaultGuidedScalarExpression(step.conditionField ?? 'actor-field', { key: step.conditionKey ?? 'id' });
}

function legacyResultExpression(resultKey: string | undefined): GuidedScalarExpressionDraft | undefined {
  return resultKey
    ? defaultGuidedScalarExpression('result', { key: resultKey, resultProperty: 'total' })
    : undefined;
}

function buildStep(step: OperationStepDraft): Record<string, unknown> {
  const base = { stepId: step.stepId, kind: step.kind };
  switch (step.kind) {
    case 'validate':
      return {
        ...base,
        condition: {
          op: step.conditionOp ?? 'gte',
          left: buildGuidedScalarExpression(legacyConditionLeft(step)),
          right: buildGuidedScalarExpression(step.conditionRightExpression
            ?? defaultGuidedScalarExpression('literal', { literalValue: step.conditionValue ?? 0 })),
        },
        failureMessage: step.failureMessage ?? 'Not available.',
        next: step.next ?? '',
      };
    case 'consume-resource':
      return {
        ...base,
        resourceId: step.resourceId ?? '',
        amount: buildGuidedScalarExpression(step.resourceAmountExpression
          ?? defaultGuidedScalarExpression('literal', { literalValue: step.resourceCost ?? 1 })),
        next: step.next ?? '',
      };
    case 'perform-check':
      return { ...base, checkId: step.checkId ?? '', resultKey: step.resultKey ?? 'check', onSuccess: step.onSuccess ?? '', onFailure: step.onFailure ?? '' };
    case 'apply-effect':
      return { ...base, effectId: step.effectId ?? '', target: step.effectTarget ?? 'target', next: step.next ?? '' };
    case 'emit-event': {
      const payload: Record<string, unknown> = { attackerId: { op: 'actor-field', key: 'id' }, targetId: { op: 'target-field', key: 'id' } };
      const payloadExpression = step.eventPayloadExpression ?? legacyResultExpression(step.payloadFromResult);
      if (payloadExpression) payload[step.payloadValueKey ?? 'total'] = buildGuidedScalarExpression(payloadExpression);
      return { ...base, eventId: step.eventId ?? '', payload, next: step.next ?? '' };
    }
    case 'return': {
      const data: Record<string, unknown> = {};
      const returnExpression = step.returnDataExpression ?? legacyResultExpression(step.dataResultKey);
      if (returnExpression) data[step.returnDataKey ?? 'checkTotal'] = buildGuidedScalarExpression(returnExpression);
      return { ...base, outcome: step.outcome ?? 'success', ...(Object.keys(data).length ? { data } : {}) };
    }
  }
}

export function buildResolutionBody(name: string, description: string, draft: ResolutionAuthoringDraft): Record<string, unknown> {
  const subjectTraitIds = 'subjectTraitIds' in draft ? draft.subjectTraitIds : [];
  const subjectTraitSelections = 'subjectTraitSelections' in draft ? draft.subjectTraitSelections : {};
  const common = {
    formatVersion: '1',
    metamodelVersion: 'resolution/1',
    definitionId: draft.stableId,
    definitionType: draft.kind,
    name: name.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(subjectTraitIds.length ? { subjectTraitIds } : {}),
    ...(Object.keys(subjectTraitSelections).length ? { subjectTraitSelections } : {}),
  };
  switch (draft.kind) {
    case 'modifier': {
      const target = draft.targetMode === 'check'
        ? { targetCheckId: draft.targetCheckId }
        : {
            appliesTo: draft.targetMode === 'all-rolls'
              ? { allRolls: true }
              : draft.targetMode === 'roll-kind'
                ? { rollKinds: [draft.targetRollKind] }
                : { rollTraitIds: [draft.targetRollTraitId] },
          };
      const activation = draft.activatingTraitIds.length ? { activatedByTraitIds: draft.activatingTraitIds } : {};
      const value = buildGuidedScalarExpression(draft.valueExpression
        ?? defaultGuidedScalarExpression('literal', { literalValue: draft.value }));
      if (draft.modifierMode === 'total') return { ...common, ...target, ...activation, operation: draft.operation, value };
      return {
        ...common,
        ...target,
        ...activation,
        modifierKind: 'roll-result',
        ...((draft.modifierMode === 'add-dice')
          ? { rollOperation: { kind: 'add-dice', dice: { dieTraitId: draft.dieTraitId, count: draft.diceCount, sides: draft.dieSides, rollKind: draft.rollKind } } }
          : (draft.modifierMode === 'replace-result')
            ? {
                selector: {
                  ...(draft.matchDieTraitId ? { dieTraitIds: [draft.matchDieTraitId] } : {}),
                  ...(draft.matchRawResult ? { rawResults: [Number(draft.matchRawResult)] } : {}),
                  origins: ['original'],
                },
                rollOperation: { kind: 'replace-result', die: { dieTraitId: draft.dieTraitId, sides: draft.dieSides, rollKind: draft.rollKind }, maximumApplications: draft.maximumApplications },
              }
            : {
                ...(draft.matchDieTraitId ? { selector: { dieTraitIds: [draft.matchDieTraitId] } } : {}),
                rollOperation: { kind: 'increase-result', value },
              }),
      };
    }
    case 'resource':
      return { ...common, capacity: draft.capacity, minimum: draft.minimum, refresh: draft.refresh };
    case 'effect': {
      const duration = draft.durationKind === 'turns' ? { kind: 'turns', turns: draft.durationTurns } : { kind: draft.durationKind };
      const ids = draft.modifierIds.split(',').map((s) => s.trim()).filter(Boolean);
      return { ...common, duration, ...(ids.length ? { modifierIds: ids } : {}) };
    }
    case 'event': {
      const payload: Record<string, string> = {};
      draft.payloadFields.split(',').map((s) => s.trim()).filter(Boolean).forEach((field) => {
        const [key, type] = field.split(':').map((s) => s.trim());
        if (key && type) payload[key] = type;
      });
      return { ...common, visibility: draft.visibility, payload };
    }
    case 'check':
      return {
        ...common,
        checkKind: 'target-number',
        roll: draft.rollSource === 'roll-trait'
          ? { rollTraitId: draft.rollTraitId, dice: draft.dicePools, rollKind: draft.rollKind }
          : { dice: [{ dieTraitId: draft.dieTraitId, count: draft.diceCount, sides: draft.dieSides }], rollKind: draft.rollKind },
        bonus: buildGuidedScalarExpression(draft.bonusExpression
          ?? defaultGuidedScalarExpression('actor-field', { key: draft.actorBonusField })),
        target: buildGuidedScalarExpression(draft.targetExpression
          ?? defaultGuidedScalarExpression('target-field', { key: draft.targetField })),
        comparison: 'gte',
      };
    case 'operation': {
      const startStepId = draft.steps[0]?.stepId ?? 'step-1';
      return { ...common, startStepId, steps: draft.steps.map(buildStep), budget: { maximumSteps: draft.maximumSteps } };
    }
  }
}

// ── Body parsers ──────────────────────────────────────────────────────────────

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function traitSelectionMap(value: unknown): Record<string, string[]> {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([traitId, selections]) =>
    Array.isArray(selections) && selections.every((item) => typeof item === 'string')
      ? [[traitId, selections as string[]]]
      : []));
}

function draftedTraitPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!record(item)) return;
    if (typeof item.traitPath === 'string' && item.traitPath) paths.add(item.traitPath);
    if (typeof item.conditionTraitPath === 'string' && item.conditionTraitPath) paths.add(item.conditionTraitPath);
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...paths].sort();
}

function parseStepDraft(step: Record<string, unknown>): OperationStepDraft {
  const kind = String(step.kind) as OperationStepKind;
  const base = { stepId: String(step.stepId), kind };
  switch (kind) {
    case 'validate': {
      const cond = record(step.condition) ? step.condition : {};
      const left = record(cond.left) ? cond.left : {};
      const right = record(cond.right) ? cond.right : {};
      const conditionField = left.op === 'target-field'
        ? 'target-field'
        : left.op === 'trait-instance-field'
          ? 'trait-instance-field'
          : left.op === 'trait-path-field'
            ? 'trait-path-field'
          : 'actor-field';
      const mountSelector = record(left.mountSelector) ? left.mountSelector : {};
      return {
        ...base,
        conditionField,
        conditionLeftExpression: parseGuidedScalarExpression(left, defaultGuidedScalarExpression('actor-field', { key: 'id' })),
        conditionRightExpression: parseGuidedScalarExpression(right),
        conditionInstanceId: conditionField === 'trait-instance-field' ? String(left.instanceId ?? '') : undefined,
        conditionTraitPath: conditionField === 'trait-path-field' ? String(left.path ?? '') : undefined,
        conditionMountOrdinal: conditionField === 'trait-path-field' && mountSelector.mode === 'ordinal' ? Number(mountSelector.ordinal ?? 1) : undefined,
        conditionKey: String(left.key ?? 'id'),
        conditionOp: (['gte', 'lte', 'equals'].includes(String(cond.op)) ? String(cond.op) : 'gte') as 'gte' | 'lte' | 'equals',
        conditionValue: Number(right.value ?? 0),
        failureMessage: String(step.failureMessage ?? ''),
        next: String(step.next ?? ''),
      };
    }
    case 'consume-resource': {
      const amount = record(step.amount) ? step.amount : {};
      return {
        ...base,
        resourceId: String(step.resourceId ?? ''),
        resourceCost: Number(amount.value ?? 1),
        resourceAmountExpression: parseGuidedScalarExpression(amount, defaultGuidedScalarExpression('literal', { literalValue: 1 })),
        next: String(step.next ?? ''),
      };
    }
    case 'perform-check':
      return { ...base, checkId: String(step.checkId ?? ''), resultKey: String(step.resultKey ?? 'check'), onSuccess: String(step.onSuccess ?? ''), onFailure: String(step.onFailure ?? '') };
    case 'apply-effect':
      return { ...base, effectId: String(step.effectId ?? ''), effectTarget: step.target === 'actor' ? 'actor' : 'target', next: String(step.next ?? '') };
    case 'emit-event': {
      const payload = record(step.payload) ? step.payload : {};
      const payloadEntry = Object.entries(payload).find(([key, value]) =>
        !['attackerId', 'targetId'].includes(key) && record(value));
      const payloadExpression = payloadEntry && record(payloadEntry[1])
        ? parseGuidedScalarExpression(payloadEntry[1])
        : undefined;
      return {
        ...base,
        eventId: String(step.eventId ?? ''),
        payloadFromResult: payloadExpression?.source === 'result' ? payloadExpression.key : '',
        payloadValueKey: payloadEntry?.[0] ?? 'total',
        eventPayloadExpression: payloadExpression,
        next: String(step.next ?? ''),
      };
    }
    case 'return': {
      const data = record(step.data) ? step.data : {};
      const dataEntry = Object.entries(data).find((entry): entry is [string, Record<string, unknown>] => record(entry[1]));
      const returnExpression = dataEntry ? parseGuidedScalarExpression(dataEntry[1]) : undefined;
      return {
        ...base,
        outcome: step.outcome === 'failure' ? 'failure' : 'success',
        dataResultKey: returnExpression?.source === 'result' ? returnExpression.key : '',
        returnDataKey: dataEntry?.[0] ?? 'checkTotal',
        returnDataExpression: returnExpression,
      };
    }
    default:
      return base;
  }
}

export function resolutionDraftFromBody(body: Record<string, unknown>): ResolutionAuthoringDraft | undefined {
  if (body.metamodelVersion !== 'resolution/1' || typeof body.definitionId !== 'string') return undefined;
  switch (body.definitionType) {
    case 'modifier': {
      const val = record(body.value) ? body.value : {};
      const rollOperation = record(body.rollOperation) ? body.rollOperation : {};
      const appliesTo = record(body.appliesTo) ? body.appliesTo : {};
      const selector = record(body.selector) ? body.selector : {};
      const selectedDie = record(rollOperation.dice) ? rollOperation.dice : record(rollOperation.die) ? rollOperation.die : {};
      const resultValue = record(rollOperation.value) ? rollOperation.value : {};
      const modifierMode = body.modifierKind !== 'roll-result'
        ? 'total'
        : (['add-dice', 'replace-result', 'increase-result'].includes(String(rollOperation.kind)) ? String(rollOperation.kind) : 'increase-result');
      const targetMode = typeof body.targetCheckId === 'string' || Array.isArray(appliesTo.checkIds)
        ? 'check'
        : appliesTo.allRolls === true
          ? 'all-rolls'
          : Array.isArray(appliesTo.rollKinds)
            ? 'roll-kind'
            : 'roll-trait';
      return {
        kind: 'modifier',
        stableId: body.definitionId,
        targetMode,
        targetCheckId: String(body.targetCheckId ?? (Array.isArray(appliesTo.checkIds) ? appliesTo.checkIds[0] : '') ?? ''),
        targetRollKind: (Array.isArray(appliesTo.rollKinds) && ['saving', 'hit', 'damage', 'other'].includes(String(appliesTo.rollKinds[0]))
          ? String(appliesTo.rollKinds[0])
          : 'hit') as 'saving' | 'hit' | 'damage' | 'other',
        targetRollTraitId: Array.isArray(appliesTo.rollTraitIds) ? String(appliesTo.rollTraitIds[0] ?? '') : '',
        subjectTraitIds: stringList(body.subjectTraitIds),
        subjectTraitSelections: traitSelectionMap(body.subjectTraitSelections),
        activatingTraitIds: Array.isArray(body.activatedByTraitIds)
          ? body.activatedByTraitIds.filter((traitId): traitId is string => typeof traitId === 'string')
          : [],
        modifierMode: modifierMode as 'total' | 'add-dice' | 'replace-result' | 'increase-result',
        operation: body.operation === 'multiply' ? 'multiply' : 'add',
        value: Number((modifierMode === 'increase-result' ? resultValue.value : val.value) ?? 0),
        valueExpression: parseGuidedScalarExpression(
          modifierMode === 'increase-result' ? resultValue : val,
        ),
        dieTraitId: String(selectedDie.dieTraitId ?? 'trait:d20'),
        dieSides: Number(selectedDie.sides ?? 20),
        diceCount: Number(selectedDie.count ?? 1),
        rollKind: (['saving', 'hit', 'damage', 'other'].includes(String(selectedDie.rollKind)) ? String(selectedDie.rollKind) : 'damage') as 'saving' | 'hit' | 'damage' | 'other',
        matchDieTraitId: Array.isArray(selector.dieTraitIds) ? String(selector.dieTraitIds[0] ?? '') : '',
        matchRawResult: Array.isArray(selector.rawResults) ? String(selector.rawResults[0] ?? '') : '',
        maximumApplications: Number(rollOperation.maximumApplications ?? 1),
      };
    }
    case 'resource':
      return { kind: 'resource', stableId: body.definitionId, capacity: Number(body.capacity ?? 3), minimum: Number(body.minimum ?? 0), refresh: (['manual', 'encounter', 'turn'].includes(String(body.refresh)) ? String(body.refresh) : 'turn') as 'manual' | 'encounter' | 'turn' };
    case 'effect': {
      const dur = record(body.duration) ? body.duration : { kind: 'persistent' };
      const ids = Array.isArray(body.modifierIds) ? body.modifierIds.join(', ') : '';
      return { kind: 'effect', stableId: body.definitionId, durationKind: (['instant', 'turns', 'persistent'].includes(String(dur.kind)) ? String(dur.kind) : 'persistent') as 'instant' | 'turns' | 'persistent', durationTurns: Number(dur.turns ?? 2), modifierIds: ids };
    }
    case 'event': {
      const payload = record(body.payload) ? body.payload : {};
      const payloadFields = Object.entries(payload).map(([k, t]) => `${k}:${t}`).join(', ');
      return { kind: 'event', stableId: body.definitionId, visibility: body.visibility === 'gm' ? 'gm' : 'public', payloadFields };
    }
    case 'check':
      if (record(body.roll) && record(body.bonus) && record(body.target)) {
        const firstDie = Array.isArray(body.roll.dice) && record(body.roll.dice[0]) ? body.roll.dice[0] : body.roll;
        return {
          kind: 'check',
          stableId: body.definitionId,
          rollSource: typeof body.roll.rollTraitId === 'string' ? 'roll-trait' : 'single-die',
          rollTraitId: String(body.roll.rollTraitId ?? ''),
          dicePools: Array.isArray(body.roll.dice)
            ? body.roll.dice.filter(record).map((die) => ({
                dieTraitId: String(die.dieTraitId ?? ''),
                count: Number(die.count),
                sides: Number(die.sides),
              }))
            : [],
          diceCount: Number(firstDie.count),
          dieTraitId: String(firstDie.dieTraitId ?? `trait:d${Number(firstDie.sides)}`),
          dieSides: Number(firstDie.sides),
          rollKind: (['saving', 'hit', 'damage', 'other'].includes(String(body.roll.rollKind)) ? String(body.roll.rollKind) : 'other') as 'saving' | 'hit' | 'damage' | 'other',
          actorBonusField: String(body.bonus.key ?? ''),
          targetField: String(body.target.key ?? ''),
          subjectTraitIds: stringList(body.subjectTraitIds),
          subjectTraitSelections: traitSelectionMap(body.subjectTraitSelections),
          bonusExpression: parseGuidedScalarExpression(
            body.bonus,
            defaultGuidedScalarExpression('actor-field'),
          ),
          targetExpression: parseGuidedScalarExpression(
            body.target,
            defaultGuidedScalarExpression('target-field'),
          ),
        };
      }
      return undefined;
    case 'operation':
      if (Array.isArray(body.steps)) {
        const steps: OperationStepDraft[] = body.steps.filter(record).map(parseStepDraft);
        return { kind: 'operation', stableId: body.definitionId, subjectTraitIds: stringList(body.subjectTraitIds), subjectTraitSelections: traitSelectionMap(body.subjectTraitSelections), steps, maximumSteps: record(body.budget) ? Number(body.budget.maximumSteps) : 8 };
      }
      return undefined;
  }
  return undefined;
}

// ── Step editor ───────────────────────────────────────────────────────────────

const STEP_KINDS: OperationStepKind[] = ['validate', 'consume-resource', 'perform-check', 'apply-effect', 'emit-event', 'return'];

const EXPRESSION_SOURCE_LABELS: Record<GuidedExpressionSource, string> = {
  literal: 'Fixed number',
  'actor-field': 'Actor field',
  'target-field': 'Target field',
  'trait-path-field': 'Composed trait path',
  'trait-instance-field': 'Named trait instance',
  input: 'Operation input',
  result: 'Previous result',
};

function SubjectTraitContextEditor({
  selectedTraitIds,
  traits,
  scoped,
  pathCount,
  diagnostics,
  inheritedSources = [],
  prerequisiteChoices = [],
  traitSelections,
  onChange,
  onSelectionChange,
}: {
  selectedTraitIds: string[];
  traits: Array<{ id: string; name: string }>;
  scoped: boolean;
  pathCount: number;
  diagnostics: string[];
  inheritedSources?: Array<{ checkId: string; traitIds: string[]; traitSelections?: Record<string, string[]> }>;
  prerequisiteChoices?: Array<{ ownerTraitId: string; ownerLabel: string; options: Array<{ traitId: string; label: string }> }>;
  traitSelections: Record<string, string[]>;
  onChange: (traitIds: string[]) => void;
  onSelectionChange: (selections: Record<string, string[]>) => void;
}) {
  return (
    <fieldset className="rule-set-field rule-set-field-wide">
      <legend>What is this rule acting as?</legend>
      {traits.length
        ? traits.map((trait) => <label className="guided-rule-checkbox" key={trait.id}><input type="checkbox" checked={selectedTraitIds.includes(trait.id)} onChange={(event) => onChange(event.target.checked ? [...selectedTraitIds, trait.id] : selectedTraitIds.filter((id) => id !== trait.id))} /><span>{trait.name}</span></label>)
        : <small>No traits are available yet.</small>}
      {inheritedSources.map((source) => <small key={source.checkId}>Inherited from {source.checkId}: {source.traitIds.join(', ')}</small>)}
      {prerequisiteChoices.map((choice) => <div key={choice.ownerTraitId}>
        <small>{choice.ownerLabel} requires a branch. Leave all unchecked to allow any branch:</small>
        {choice.options.map((option) => <label className="guided-rule-checkbox" key={option.traitId}><input type="checkbox" checked={(traitSelections[choice.ownerTraitId] ?? []).includes(option.traitId)} onChange={(event) => {
          const selected = traitSelections[choice.ownerTraitId] ?? [];
          const next = event.target.checked ? [...selected, option.traitId] : selected.filter((id) => id !== option.traitId);
          const result = { ...traitSelections };
          if (next.length) result[choice.ownerTraitId] = next;
          else delete result[choice.ownerTraitId];
          onSelectionChange(result);
        }} /><span>Require {option.label}</span></label>)}
      </div>)}
      <small>{scoped
        ? `Completions are limited to ${pathCount} field path${pathCount === 1 ? '' : 's'} guaranteed by the selected trait contract.`
        : 'No self contract is selected. Completions use the broader catalog for compatibility with older definitions.'}</small>
      {diagnostics.map((message) => <small key={message} className="rule-set-notice error">{message}</small>)}
    </fieldset>
  );
}

function ScalarExpressionEditor({
  legend,
  expression,
  traitPathOptions,
  traitPathRepairs = [],
  onAddSubjectTrait,
  onSelectSubjectBranch,
  onChange,
  sources = ['literal', 'actor-field', 'target-field', 'trait-path-field', 'trait-instance-field', 'input', 'result'],
  className = 'rule-set-field rule-set-field-wide',
}: {
  legend: string;
  expression: GuidedScalarExpressionDraft;
  traitPathOptions: GuidedTraitPathOption[];
  traitPathRepairs?: GuidedTraitPathRepair[];
  onAddSubjectTrait?: (traitId: string) => void;
  onSelectSubjectBranch?: (ownerTraitId: string, traitId: string) => void;
  onChange: (expression: GuidedScalarExpressionDraft) => void;
  sources?: GuidedExpressionSource[];
  className?: string;
}) {
  const set = <K extends keyof GuidedScalarExpressionDraft>(key: K, value: GuidedScalarExpressionDraft[K]) =>
    onChange({ ...expression, [key]: value });
  const selectedTraitPath = traitPathOptions.find((option) => option.path === expression.traitPath);
  const traitPathRepair = traitPathRepairs.find((repair) => repair.path === expression.traitPath);
  const unavailableTraitPath = expression.source === 'trait-path-field'
    && !!expression.traitPath
    && !selectedTraitPath;
  return (
    <fieldset className={className}>
      <legend>{legend}</legend>
      <label><span>Value source</span><select value={expression.source} onChange={(event) => set('source', event.target.value as GuidedExpressionSource)}>{sources.map((source) => <option key={source} value={source}>{EXPRESSION_SOURCE_LABELS[source]}</option>)}</select></label>
      {expression.source === 'literal' && <label><span>Number</span><input type="number" step="any" value={expression.literalValue} onChange={(event) => set('literalValue', Number(event.target.value))} /></label>}
      {['actor-field', 'target-field', 'input'].includes(expression.source) && <label><span>Field key</span><input value={expression.key} onChange={(event) => set('key', event.target.value)} placeholder={expression.source === 'input' ? 'amount' : 'strength-modifier'} /></label>}
      {expression.source === 'trait-path-field' && <>
        <label><span>Trait field path</span><select value={expression.traitPath} onChange={(event) => set('traitPath', event.target.value)}><option value="">Select an actual field…</option>{!traitPathOptions.some((option) => option.path === expression.traitPath) && expression.traitPath && <option value={expression.traitPath}>{expression.traitPath} (unavailable)</option>}{traitPathOptions.map((option) => <option key={option.path} value={option.path}>{option.label}</option>)}</select>{selectedTraitPath && <small>Why available: {selectedTraitPath.explanation}</small>}</label>
        {unavailableTraitPath && <div className="rule-set-notice error">
          <strong>Why unavailable</strong>
          <p>{traitPathRepair?.message ?? 'No trait in the current catalog guarantees this path.'}</p>
          {!!traitPathRepair?.candidates.length && traitPathRepair.reason !== 'optional-prerequisite' && onAddSubjectTrait && <div className="rule-set-form-actions">{traitPathRepair.candidates.map((candidate) => <button type="button" className="secondary-action" key={candidate.traitId} onClick={() => onAddSubjectTrait(candidate.traitId)}>Add {candidate.traitLabel} to self contract</button>)}</div>}
          {!!traitPathRepair?.candidates.length && traitPathRepair.reason === 'optional-prerequisite' && onSelectSubjectBranch && <div className="rule-set-form-actions">{traitPathRepair.candidates.map((candidate) => candidate.selectionOwnerTraitId && <button type="button" className="secondary-action" key={`${candidate.selectionOwnerTraitId}:${candidate.traitId}`} onClick={() => onSelectSubjectBranch(candidate.selectionOwnerTraitId!, candidate.traitId)}>Require {candidate.selectionOwnerLabel} → {candidate.traitLabel}</button>)}</div>}
        </div>}
        {expression.traitPath.includes('[]') && <label><span>Collection entry number</span><input type="number" min={1} value={expression.mountOrdinal} onChange={(event) => set('mountOrdinal', Number(event.target.value))} /></label>}
      </>}
      {expression.source === 'trait-instance-field' && <>
        <label><span>Trait instance ID</span><input value={expression.instanceId} onChange={(event) => set('instanceId', event.target.value)} placeholder="movement:left" /></label>
        <label><span>Field key</span><input value={expression.key} onChange={(event) => set('key', event.target.value)} placeholder="rate" /></label>
      </>}
      {expression.source === 'result' && <>
        <label><span>Result key</span><input value={expression.key} onChange={(event) => set('key', event.target.value)} placeholder="check" /></label>
        <label><span>Result property</span><input value={expression.resultProperty} onChange={(event) => set('resultProperty', event.target.value)} placeholder="total" /></label>
      </>}
    </fieldset>
  );
}

function StepEditor({ index, step, traitPathOptions, traitPathRepairs, onAddSubjectTrait, onSelectSubjectBranch, onChange, onRemove }: { index: number; step: OperationStepDraft; traitPathOptions: GuidedTraitPathOption[]; traitPathRepairs: GuidedTraitPathRepair[]; onAddSubjectTrait: (traitId: string) => void; onSelectSubjectBranch: (ownerTraitId: string, traitId: string) => void; onChange: (step: OperationStepDraft) => void; onRemove: () => void }) {
  const set = <K extends keyof OperationStepDraft>(key: K, value: OperationStepDraft[K]) => onChange({ ...step, [key]: value });
  return (
    <li className="pipeline-step-editor">
      <div className="pipeline-step-header">
        <span className="pipeline-step-index">{index + 1}</span>
        <label className="pipeline-step-id-field"><span className="sr-only">Step ID</span><input aria-label="Step ID" value={step.stepId} onChange={(e) => set('stepId', e.target.value)} placeholder="step-id" /></label>
        <select aria-label="Step kind" value={step.kind} onChange={(e) => onChange(defaultStep(e.target.value as OperationStepKind, index))}>{STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <button type="button" aria-label="Remove step" className="pipeline-step-remove" onClick={onRemove}>✕</button>
      </div>
      <div className="pipeline-step-fields">
        {step.kind === 'validate' && <>
          <ScalarExpressionEditor legend="Left value" expression={legacyConditionLeft(step)} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathRepairs} onAddSubjectTrait={onAddSubjectTrait} onSelectSubjectBranch={onSelectSubjectBranch} onChange={(expression) => set('conditionLeftExpression', expression)} />
          <label><span>Comparison</span><select value={step.conditionOp ?? 'gte'} onChange={(e) => set('conditionOp', e.target.value as 'gte' | 'lte' | 'equals')}><option value="gte">≥</option><option value="lte">≤</option><option value="equals">=</option></select></label>
          <ScalarExpressionEditor legend="Right value" expression={step.conditionRightExpression ?? defaultGuidedScalarExpression('literal', { literalValue: step.conditionValue ?? 0 })} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathRepairs} onAddSubjectTrait={onAddSubjectTrait} onSelectSubjectBranch={onSelectSubjectBranch} onChange={(expression) => set('conditionRightExpression', expression)} />
          <label className="pipeline-step-wide"><span>Failure message</span><input value={step.failureMessage ?? ''} onChange={(e) => set('failureMessage', e.target.value)} placeholder="Not available." /></label>
          <label className="pipeline-step-wide"><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'consume-resource' && <>
          <label className="pipeline-step-wide"><span>Resource ID</span><input value={step.resourceId ?? ''} onChange={(e) => set('resourceId', e.target.value)} placeholder="resource:action-points" /></label>
          <ScalarExpressionEditor legend="Amount" expression={step.resourceAmountExpression ?? defaultGuidedScalarExpression('literal', { literalValue: step.resourceCost ?? 1 })} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathRepairs} onAddSubjectTrait={onAddSubjectTrait} onSelectSubjectBranch={onSelectSubjectBranch} onChange={(expression) => set('resourceAmountExpression', expression)} />
          <label><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'perform-check' && <>
          <label className="pipeline-step-wide"><span>Check ID</span><input value={step.checkId ?? ''} onChange={(e) => set('checkId', e.target.value)} placeholder="check:melee-attack" /></label>
          <label><span>Result key</span><input value={step.resultKey ?? 'check'} onChange={(e) => set('resultKey', e.target.value)} placeholder="check" /></label>
          <label><span>On success</span><input value={step.onSuccess ?? ''} onChange={(e) => set('onSuccess', e.target.value)} placeholder="next-step-id" /></label>
          <label><span>On failure</span><input value={step.onFailure ?? ''} onChange={(e) => set('onFailure', e.target.value)} placeholder="next-step-id" /></label>
        </>}
        {step.kind === 'apply-effect' && <>
          <label className="pipeline-step-wide"><span>Effect ID</span><input value={step.effectId ?? ''} onChange={(e) => set('effectId', e.target.value)} placeholder="effect:wounded" /></label>
          <label><span>Apply to</span><select value={step.effectTarget ?? 'target'} onChange={(e) => set('effectTarget', e.target.value as 'actor' | 'target')}><option value="target">Target</option><option value="actor">Actor</option></select></label>
          <label><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'emit-event' && <>
          <label className="pipeline-step-wide"><span>Event ID</span><input value={step.eventId ?? ''} onChange={(e) => set('eventId', e.target.value)} placeholder="event:attack-hit" /></label>
          {(step.eventPayloadExpression || step.payloadFromResult)
            ? <>
                <label><span>Payload key</span><input value={step.payloadValueKey ?? 'total'} onChange={(event) => set('payloadValueKey', event.target.value)} /></label>
                <ScalarExpressionEditor legend="Payload value" expression={step.eventPayloadExpression ?? legacyResultExpression(step.payloadFromResult)!} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathRepairs} onAddSubjectTrait={onAddSubjectTrait} onSelectSubjectBranch={onSelectSubjectBranch} onChange={(expression) => set('eventPayloadExpression', expression)} />
                <button type="button" className="secondary-action" onClick={() => onChange({ ...step, payloadFromResult: '', eventPayloadExpression: undefined })}>Remove payload value</button>
              </>
            : <button type="button" className="secondary-action" onClick={() => set('eventPayloadExpression', defaultGuidedScalarExpression('result', { key: 'check' }))}>Add payload value</button>}
          <label><span>Next step</span><input value={step.next ?? ''} onChange={(e) => set('next', e.target.value)} placeholder="step-id" /></label>
        </>}
        {step.kind === 'return' && <>
          <label><span>Outcome</span><select value={step.outcome ?? 'success'} onChange={(e) => set('outcome', e.target.value as 'success' | 'failure')}><option value="success">Success</option><option value="failure">Failure</option></select></label>
          {(step.returnDataExpression || step.dataResultKey)
            ? <>
                <label><span>Returned data key</span><input value={step.returnDataKey ?? 'checkTotal'} onChange={(event) => set('returnDataKey', event.target.value)} /></label>
                <ScalarExpressionEditor legend="Returned value" expression={step.returnDataExpression ?? legacyResultExpression(step.dataResultKey)!} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathRepairs} onAddSubjectTrait={onAddSubjectTrait} onSelectSubjectBranch={onSelectSubjectBranch} onChange={(expression) => set('returnDataExpression', expression)} />
                <button type="button" className="secondary-action" onClick={() => onChange({ ...step, dataResultKey: '', returnDataExpression: undefined })}>Remove returned value</button>
              </>
            : <button type="button" className="secondary-action" onClick={() => set('returnDataExpression', defaultGuidedScalarExpression('result', { key: 'check' }))}>Add returned value</button>}
        </>}
      </div>
    </li>
  );
}

// ── Fixture runner ────────────────────────────────────────────────────────────

type KVPair = { key: string; value: string };

type ResolutionPreviewSummary = {
  outcome: string;
  activeTraits?: Array<{ traitId: string; roots: Array<{ rootTraitId: string; traitChain: string[] }> }>;
  activeTraitInstances?: Array<{
    instanceId: string;
    traitId: string;
    rootInstanceId: string;
    mountPath: string[];
    values: Record<string, string | number | boolean>;
    valueModifiers: Array<Record<string, unknown>>;
  }>;
  traitChoices?: Array<{ traitId: string; traitInstanceId?: string; selectedTraitIds: string[]; source: 'context' | 'active-roots' }>;
  rolls?: Array<{ modifierActivations?: Array<{ modifierId: string; sources: Array<Record<string, unknown>> }> }>;
  trace: Array<{ stepId: string; kind: string; message: string; values?: Record<string, unknown> }>;
};

type FixtureResult = {
  passed: boolean;
  message?: string;
  preview?: ResolutionPreviewSummary;
};

function KVList({ label, pairs, onChange }: { label: string; pairs: KVPair[]; onChange: (pairs: KVPair[]) => void }) {
  return (
    <fieldset className="fixture-kv-group">
      <legend>{label}</legend>
      {pairs.map((pair, i) => (
        <div key={i} className="fixture-kv-row">
          <input aria-label="Key" value={pair.key} onChange={(e) => { const next = [...pairs]; next[i] = { ...pair, key: e.target.value }; onChange(next); }} placeholder="key" />
          <span>:</span>
          <input aria-label="Value" value={pair.value} onChange={(e) => { const next = [...pairs]; next[i] = { ...pair, value: e.target.value }; onChange(next); }} placeholder="value" />
          <button type="button" aria-label="Remove" onClick={() => onChange(pairs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="fixture-add-field" onClick={() => onChange([...pairs, { key: '', value: '' }])}>+ Add field</button>
    </fieldset>
  );
}

function FixtureRunner({ operationId, relatedBodies, traitSources, body }: { operationId: string; relatedBodies: Record<string, unknown>[]; traitSources: RelatedDefinition[]; body: Record<string, unknown> }) {
  const [actorFields, setActorFields] = useState<KVPair[]>([{ key: 'id', value: 'preview:actor' }, { key: 'strength-modifier', value: '3' }]);
  const [targetFields, setTargetFields] = useState<KVPair[]>([{ key: 'id', value: 'preview:target' }, { key: 'defense', value: '16' }]);
  const [resources, setResources] = useState<KVPair[]>([{ key: 'resource:action-points', value: '2' }]);
  const [entropy, setEntropy] = useState('14');
  const [activeTraits, setActiveTraits] = useState('');
  const [activeTraitInstances, setActiveTraitInstances] = useState<KVPair[]>([]);
  const [instanceTraitChoices, setInstanceTraitChoices] = useState<KVPair[]>([]);
  const [traitInstanceValues, setTraitInstanceValues] = useState<KVPair[]>([]);
  const [traitChoices, setTraitChoices] = useState<Record<string, string[]>>({});
  const [activeEffects, setActiveEffects] = useState('');
  const [activeModifiers, setActiveModifiers] = useState('');
  const [expected, setExpected] = useState<'success' | 'failure' | ''>('success');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FixtureResult>();
  const [error, setError] = useState<string>();
  const availableTraitChoices = useMemo(() => traitSources.flatMap((definition) => {
    const prerequisites = record(definition.body.prerequisites) ? definition.body.prerequisites : {};
    const optionTraitIds = prerequisites.mode === 'any' && Array.isArray(prerequisites.ids)
      ? prerequisites.ids.filter((traitId): traitId is string => typeof traitId === 'string')
      : [];
    return optionTraitIds.length > 1 ? [{ traitId: definition.externalId, name: definition.name, optionTraitIds }] : [];
  }), [traitSources]);

  async function run() {
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    try {
      const kv = (pairs: KVPair[]) => Object.fromEntries(pairs.filter((p) => p.key).map((p) => [p.key, isNaN(Number(p.value)) ? p.value : Number(p.value)]));
      const entropyValues = entropy.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
      const allDefinitions = [...relatedBodies.filter((item) => item.metamodelVersion === 'resolution/1' && item.definitionId !== operationId), ...traitSources, body];
      const ids = (value: string) => value.split(',').map((id) => id.trim()).filter(Boolean);
      const prerequisiteSelections = Object.fromEntries(Object.entries(traitChoices).filter(([, selections]) => selections.length));
      const traitInstances = activeTraitInstances.filter((pair) => pair.key && pair.value).map((pair) => ({ instanceId: pair.key, traitId: pair.value }));
      const instancePrerequisiteSelections = Object.fromEntries(instanceTraitChoices.filter((pair) => pair.key && pair.value).map((pair) => [pair.key, ids(pair.value)]));
      const instanceValueEntries = traitInstanceValues.flatMap((pair) => {
        const separator = pair.key.lastIndexOf('.');
        const value = pair.value === 'true'
          ? true
          : pair.value === 'false'
            ? false
            : isNaN(Number(pair.value))
              ? pair.value
              : Number(pair.value);
        return separator > 0 && pair.value !== ''
          ? [[pair.key.slice(0, separator), pair.key.slice(separator + 1), value] as const]
          : [];
      });
      const valuesByInstance = instanceValueEntries.reduce<Record<string, Record<string, string | number | boolean>>>((values, [instanceId, field, value]) => {
        values[instanceId] = { ...(values[instanceId] ?? {}), [field]: value };
        return values;
      }, {});
      const fixture = { name: 'Builder fixture', operationId, context: { actor: { id: actorFields.find((p) => p.key === 'id')?.value ?? 'preview:actor', fields: kv(actorFields), resources: kv(resources) as Record<string, number> }, target: { id: targetFields.find((p) => p.key === 'id')?.value ?? 'preview:target', fields: kv(targetFields) }, activeTraitIds: ids(activeTraits), activeTraitInstances: traitInstances, traitPrerequisiteSelections: prerequisiteSelections, traitInstancePrerequisiteSelections: instancePrerequisiteSelections, traitInstanceValues: valuesByInstance, activeEffectIds: ids(activeEffects), activeModifierIds: ids(activeModifiers), entropy: entropyValues }, expected: expected ? { outcome: expected as 'success' | 'failure' } : {} };
      const response = await runRuleFixtures({ definitions: allDefinitions, fixtures: [fixture] });
      if (!response.valid || !response.results?.[0]) throw new Error(response.diagnostics?.map((d: { message: string }) => d.message).join(' ') || 'Fixture failed to compile.');
      setResult(response.results[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fixture could not run.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixture-runner">
      <div className="fixture-runner-inputs">
        <KVList label="Actor fields" pairs={actorFields} onChange={setActorFields} />
        <KVList label="Actor resources" pairs={resources} onChange={setResources} />
        <KVList label="Target fields" pairs={targetFields} onChange={setTargetFields} />
        <label className="fixture-entropy"><span>Entropy (comma-separated rolls)</span><input value={entropy} onChange={(e) => setEntropy(e.target.value)} placeholder="14, 7" /></label>
        <label className="fixture-entropy"><span>Active trait IDs</span><input value={activeTraits} onChange={(e) => setActiveTraits(e.target.value)} placeholder="trait:brutal" /></label>
        <KVList label="Named trait instances (instance ID : trait ID)" pairs={activeTraitInstances} onChange={setActiveTraitInstances} />
        <KVList label="Instance prerequisite choices (instance ID : trait IDs)" pairs={instanceTraitChoices} onChange={setInstanceTraitChoices} />
        <KVList label="Instance values (instance ID.field : value)" pairs={traitInstanceValues} onChange={setTraitInstanceValues} />
        {availableTraitChoices.map((choice) => <fieldset className="fixture-kv-group" key={choice.traitId}><legend>{choice.name} prerequisite choice</legend>{choice.optionTraitIds.map((traitId) => {
          const selected = traitChoices[choice.traitId] ?? [];
          const optionName = traitSources.find((trait) => trait.externalId === traitId)?.name ?? traitId;
          return <label className="guided-rule-checkbox" key={traitId}><input type="checkbox" checked={selected.includes(traitId)} onChange={(e) => setTraitChoices({ ...traitChoices, [choice.traitId]: e.target.checked ? [...selected, traitId] : selected.filter((id) => id !== traitId) })} /><span>{optionName}</span></label>;
        })}</fieldset>)}
        <label className="fixture-entropy"><span>Active effect IDs</span><input value={activeEffects} onChange={(e) => setActiveEffects(e.target.value)} placeholder="effect:blessing" /></label>
        <label className="fixture-entropy"><span>Explicit modifier IDs</span><input value={activeModifiers} onChange={(e) => setActiveModifiers(e.target.value)} placeholder="modifier:accurate" /></label>
        <label className="fixture-expected"><span>Expected outcome</span><select value={expected} onChange={(e) => setExpected(e.target.value as 'success' | 'failure' | '')}><option value="">Any</option><option value="success">Success</option><option value="failure">Failure</option></select></label>
      </div>
      <button type="button" className="secondary-action" onClick={run} disabled={running}>{running ? 'Running…' : 'Run fixture'}</button>
      {error && <p className="rule-set-notice error">{error}</p>}
      {result && (
        <div className="fixture-result">
          <strong className={result.passed ? 'fixture-pass' : 'fixture-fail'}>{result.passed ? '✓ Pass' : '✗ Fail'}{result.message ? ` — ${result.message}` : ''}</strong>
          {result.preview && <>
            <p className="fixture-outcome">Outcome: {result.preview.outcome}</p>
            {!!result.preview.activeTraits?.length && <p className="fixture-outcome">Expanded traits: {result.preview.activeTraits.map((trait) => trait.traitId).join(', ')}</p>}
            {!!result.preview.activeTraitInstances?.length && <p className="fixture-outcome">Trait instances: {result.preview.activeTraitInstances.map((instance) => `${instance.instanceId} → ${instance.traitId} @ ${instance.mountPath.length ? `self.${instance.mountPath.join('.')}` : 'self'}${Object.keys(instance.values).length ? ` ${JSON.stringify(instance.values)}` : ''}`).join('; ')}</p>}
            {!!result.preview.activeTraitInstances?.some((instance) => instance.valueModifiers.length) && <p className="fixture-outcome">Trait value modifiers: {JSON.stringify(result.preview.activeTraitInstances.flatMap((instance) => instance.valueModifiers.map((modifier) => ({ targetInstanceId: instance.instanceId, ...modifier }))))}</p>}
            {!!result.preview.traitChoices?.length && <p className="fixture-outcome">Prerequisite choices: {result.preview.traitChoices.map((choice) => `${choice.traitInstanceId ?? choice.traitId} → ${choice.selectedTraitIds.join(' + ')}`).join('; ')}</p>}
            {!!result.preview.rolls?.some((roll) => roll.modifierActivations?.length) && <p className="fixture-outcome">Modifier activation: {JSON.stringify(result.preview.rolls.flatMap((roll) => roll.modifierActivations ?? []))}</p>}
            <ol className="fixture-trace">{result.preview.trace.map((entry) => (
              <li key={entry.stepId}><span>{entry.stepId}</span>{entry.message}{entry.values && <small>{JSON.stringify(entry.values)}</small>}</li>
            ))}</ol>
          </>}
        </div>
      )}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

type ViewKind = 'builder' | 'preview' | 'fixture';

type RelatedDefinition = { externalId: string; name: string; body: Record<string, unknown> };

function subjectPrerequisiteChoices(
  definitions: RelatedDefinition[],
  rootTraitIds: string[],
): Array<{ ownerTraitId: string; ownerLabel: string; options: Array<{ traitId: string; label: string }> }> {
  const byId = new Map(definitions.map((definition) => [definition.externalId, definition]));
  const reachable = new Set<string>();
  const visit = (traitId: string) => {
    if (reachable.has(traitId)) return;
    reachable.add(traitId);
    const prerequisites = byId.get(traitId)?.body.prerequisites;
    if (record(prerequisites) && Array.isArray(prerequisites.ids)) {
      prerequisites.ids.filter((item): item is string => typeof item === 'string').forEach(visit);
    }
  };
  rootTraitIds.forEach(visit);
  return [...reachable].flatMap((ownerTraitId) => {
    const owner = byId.get(ownerTraitId);
    const prerequisites = owner?.body.prerequisites;
    if (!record(prerequisites) || prerequisites.mode === 'all' || !Array.isArray(prerequisites.ids) || prerequisites.ids.length < 2) return [];
    return [{
      ownerTraitId,
      ownerLabel: owner?.name ?? ownerTraitId,
      options: prerequisites.ids.filter((item): item is string => typeof item === 'string').map((traitId) => ({
        traitId,
        label: byId.get(traitId)?.name ?? traitId,
      })),
    }];
  }).sort((left, right) => left.ownerLabel.localeCompare(right.ownerLabel));
}

function dieTraitOptions(relatedDefinitions: RelatedDefinition[]): Array<{ id: string; name: string; sides: number }> {
  const traits = relatedDefinitions
    .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
    .map((definition) => ({ externalId: definition.externalId, name: definition.name, body: definition.body }));
  if (!traits.some((definition) => definition.externalId === 'trait:die')) return [];
  return traits.flatMap((definition) => {
    if (!traitSatisfiesCollection(definition.externalId, ['trait:die'], 'any', traits)) return [];
    const grants = Array.isArray(definition.body.grants) ? definition.body.grants.filter(record) : [];
    const sidesGrant = grants.find((grant) =>
      grant.dataType === 'modifier'
      && grant.operation === 'sets'
      && typeof grant.field === 'string'
      && grant.field.split('.').at(-1) === 'sides'
      && typeof grant.amount === 'number');
    return sidesGrant ? [{ id: definition.externalId, name: definition.name, sides: Number(sidesGrant.amount) }] : [];
  }).sort((left, right) => left.sides - right.sides || left.name.localeCompare(right.name));
}

function diceRollTraitOptions(
  relatedDefinitions: RelatedDefinition[],
  dice: Array<{ id: string; name: string; sides: number }>,
): Array<{ id: string; name: string; dice: Array<{ dieTraitId: string; count: number; sides: number }>; notation: string }> {
  type CollectionNode = Extract<TraitShapeNode, { kind: 'collection' }>;
  const traits = relatedDefinitions
    .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
    .map((definition) => ({ externalId: definition.externalId, name: definition.name, body: definition.body }));
  const diceById = new Map(dice.map((die) => [die.id, die]));
  return traits.flatMap((definition) => {
    const shape = buildTraitShape({
      definitions: traits,
      prerequisiteIds: [definition.externalId],
      prerequisiteMode: 'all',
    });
    const collections = shape.nodes.filter((node): node is CollectionNode =>
      node.kind === 'collection'
      && node.acceptedTraitIds.includes('trait:die')
      && node.entries.length > 0);
    if (shape.diagnostics.length || collections.length !== 1) return [];
    const counts = collections[0].entries.reduce((result, entry) => {
      result.set(entry.traitId, (result.get(entry.traitId) ?? 0) + entry.count);
      return result;
    }, new Map<string, number>());
    const pools = [...counts].flatMap(([dieTraitId, count]) => {
      const die = diceById.get(dieTraitId);
      return die ? [{ dieTraitId, count, sides: die.sides }] : [];
    });
    if (pools.length !== counts.size) return [];
    pools.sort((left, right) => right.sides - left.sides || left.dieTraitId.localeCompare(right.dieTraitId));
    return [{
      id: definition.externalId,
      name: definition.name,
      dice: pools,
      notation: pools.map((pool) => `${pool.count}d${pool.sides}`).join(' + '),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function GuidedResolutionEditor({ name, description, draft, onChange, diagnostics = [], relatedDefinitions = [] }: { name: string; description: string; draft: ResolutionAuthoringDraft; onChange: (draft: ResolutionAuthoringDraft) => void; diagnostics?: AuthoringDiagnostic[]; relatedDefinitions?: RelatedDefinition[] }) {
  const [view, setView] = useState<ViewKind>('builder');
  const [descriptorReady, setDescriptorReady] = useState(false);
  const [preview, setPreview] = useState<ResolutionPreviewSummary>();
  const [previewError, setPreviewError] = useState<string>();
  const [newStepKind, setNewStepKind] = useState<OperationStepKind>('return');

  const body = useMemo(() => buildResolutionBody(name, description, draft), [description, draft, name]);
  const relatedBodies = useMemo(() => relatedDefinitions.map((definition) => definition.body), [relatedDefinitions]);
  const traitSources = useMemo(() => relatedDefinitions.filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion))), [relatedDefinitions]);
  const dice = useMemo(() => dieTraitOptions(relatedDefinitions), [relatedDefinitions]);
  const diceRolls = useMemo(() => diceRollTraitOptions(relatedDefinitions, dice), [dice, relatedDefinitions]);
  const directSubjectTraitIds = useMemo(
    () => ('subjectTraitIds' in draft ? draft.subjectTraitIds : []),
    [draft],
  );
  const operationSubjectContract = useMemo(
    () => draft.kind === 'operation'
      ? guidedOperationSubjectContract(draft.subjectTraitIds, draft.steps, relatedDefinitions, draft.subjectTraitSelections)
      : undefined,
    [draft, relatedDefinitions],
  );
  const effectiveSubjectTraitIds = operationSubjectContract?.effectiveTraitIds ?? directSubjectTraitIds;
  const directSubjectTraitSelections = 'subjectTraitSelections' in draft ? draft.subjectTraitSelections : {};
  const effectiveSubjectTraitSelections = operationSubjectContract?.effectiveTraitSelections ?? directSubjectTraitSelections;
  const prerequisiteChoices = useMemo(
    () => subjectPrerequisiteChoices(traitSources, effectiveSubjectTraitIds),
    [effectiveSubjectTraitIds, traitSources],
  );
  const selectedTraitPaths = useMemo(() => draftedTraitPaths(draft), [draft]);
  const traitPathResult = useMemo(
    () => guidedTraitPathOptions(
      traitSources,
      effectiveSubjectTraitIds,
      operationSubjectContract,
      selectedTraitPaths,
      effectiveSubjectTraitSelections,
    ),
    [effectiveSubjectTraitIds, effectiveSubjectTraitSelections, operationSubjectContract, selectedTraitPaths, traitSources],
  );
  const traitPathOptions = traitPathResult.options;
  const checks = useMemo(() => relatedDefinitions.flatMap((definition) =>
    definition.body.metamodelVersion === 'resolution/1'
    && definition.body.definitionType === 'check'
    && typeof definition.body.definitionId === 'string'
      ? [{ id: definition.body.definitionId, name: definition.name }]
      : []), [relatedDefinitions]);
  const traits = useMemo(() => relatedDefinitions
    .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
    .map((definition) => ({ id: definition.externalId, name: definition.name }))
    .sort((left, right) => left.name.localeCompare(right.name)), [relatedDefinitions]);
  const modifiers = useMemo(() => relatedDefinitions.flatMap((definition) =>
    definition.body.metamodelVersion === 'resolution/1'
    && definition.body.definitionType === 'modifier'
    && typeof definition.body.definitionId === 'string'
      ? [{ id: definition.body.definitionId, name: definition.name }]
      : []).sort((left, right) => left.name.localeCompare(right.name)), [relatedDefinitions]);
  const selectDie = (dieTraitId: string): { dieTraitId: string; dieSides: number } => {
    const selected = dice.find((die) => die.id === dieTraitId);
    return { dieTraitId, dieSides: selected?.sides ?? 1 };
  };
  const selectDiceRoll = (rollTraitId: string): { rollTraitId: string; dicePools: Array<{ dieTraitId: string; count: number; sides: number }> } => {
    const selected = diceRolls.find((roll) => roll.id === rollTraitId);
    return { rollTraitId, dicePools: selected?.dice ?? [] };
  };

  useEffect(() => {
    const controller = new AbortController();
    getRuleDefinitionDescriptor(draft.kind, controller.signal).then(() => setDescriptorReady(true)).catch(() => setDescriptorReady(false));
    return () => controller.abort();
  }, [draft.kind]);

  async function runPreview() {
    if (draft.kind !== 'operation') return;
    setPreviewError(undefined);
    try {
      const allDefinitions = [...relatedBodies.filter((item) => item.metamodelVersion === 'resolution/1' && item.definitionId !== draft.stableId), ...traitSources, body];
      const result = await previewRuleOperation({ definitions: allDefinitions, operationId: draft.stableId, context: { actor: { id: 'preview:actor', fields: { id: 'preview:actor', 'strength-modifier': 3 }, resources: { [((draft as { steps: OperationStepDraft[] }).steps.find((s) => s.kind === 'consume-resource')?.resourceId ?? 'resource:action-points')]: 2 } }, target: { id: 'preview:target', fields: { id: 'preview:target', defense: 16 } }, activeTraitIds: operationSubjectContract?.effectiveTraitIds ?? draft.subjectTraitIds, traitPrerequisiteSelections: operationSubjectContract?.effectiveTraitSelections ?? draft.subjectTraitSelections, entropy: [14] } });
      if (!result.valid || !result.preview) throw new Error(result.diagnostics.map((d) => d.message).join(' '));
      setPreview(result.preview);
      setView('preview');
    } catch (cause) { setPreviewError(cause instanceof Error ? cause.message : 'Preview failed.'); }
  }

  function updateStep(index: number, step: OperationStepDraft) {
    if (draft.kind !== 'operation') return;
    const steps = [...draft.steps];
    steps[index] = step;
    onChange({ ...draft, steps });
  }

  function removeStep(index: number) {
    if (draft.kind !== 'operation') return;
    onChange({ ...draft, steps: draft.steps.filter((_, i) => i !== index) });
  }

  function addStep() {
    if (draft.kind !== 'operation') return;
    onChange({ ...draft, steps: [...draft.steps, defaultStep(newStepKind, draft.steps.length)] });
  }

  function addSubjectTrait(traitId: string) {
    if (!('subjectTraitIds' in draft) || draft.subjectTraitIds.includes(traitId)) return;
    onChange({ ...draft, subjectTraitIds: [...draft.subjectTraitIds, traitId] });
  }

  function changeSubjectTraits(subjectTraitIds: string[]) {
    if (!('subjectTraitSelections' in draft)) return;
    const effectiveTraitIds = draft.kind === 'operation'
      ? guidedOperationSubjectContract(
          subjectTraitIds,
          draft.steps,
          relatedDefinitions,
          draft.subjectTraitSelections,
        ).effectiveTraitIds
      : subjectTraitIds;
    const reachableOwners = new Set(
      subjectPrerequisiteChoices(traitSources, effectiveTraitIds).map((choice) => choice.ownerTraitId),
    );
    const subjectTraitSelections = Object.fromEntries(
      Object.entries(draft.subjectTraitSelections).filter(([ownerTraitId]) => reachableOwners.has(ownerTraitId)),
    );
    onChange({ ...draft, subjectTraitIds, subjectTraitSelections });
  }

  function selectSubjectBranch(ownerTraitId: string, traitId: string) {
    if (!('subjectTraitSelections' in draft)) return;
    onChange({
      ...draft,
      subjectTraitSelections: {
        ...draft.subjectTraitSelections,
        [ownerTraitId]: [...new Set([...(draft.subjectTraitSelections[ownerTraitId] ?? []), traitId])],
      },
    });
  }

  const typeLabel: Record<ResolutionAuthoringDraft['kind'], string> = { modifier: 'Modifier', resource: 'Resource', effect: 'Effect', event: 'Event', check: 'Target-number check', operation: 'Bounded operation pipeline' };

  return (
    <section className="guided-rule-editor rule-set-field-wide">
      <div className="guided-rule-editor-heading">
        <div><span className="eyebrow">Phase 2 guided authoring</span><h5>{typeLabel[draft.kind]}</h5></div>
        <span className="badge">{descriptorReady ? 'resolution/1' : 'loading descriptor…'}</span>
      </div>

      {/* Stable ID */}
      <label className="rule-set-field rule-set-field-wide guided-rule-identity">
        <span>Stable definition ID</span>
        <input required pattern={`${draft.kind}:[a-z0-9]+(?:-[a-z0-9]+)*`} value={draft.stableId} onChange={(e) => onChange({ ...draft, stableId: e.target.value.toLowerCase() })} />
        <small>Names can change; this ID keeps references stable.</small>
      </label>

      {/* Tab bar — only check and operation have meaningful extra views */}
      {(draft.kind === 'check' || draft.kind === 'operation') && (
        <div className="guided-rule-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'builder'} onClick={() => setView('builder')}>Builder</button>
          {draft.kind === 'check' && <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Example table</button>}
          {draft.kind === 'operation' && <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview trace</button>}
          {draft.kind === 'operation' && <button type="button" role="tab" aria-selected={view === 'fixture'} onClick={() => setView('fixture')}>Run fixture</button>}
        </div>
      )}

      {/* Modifier form */}
      {draft.kind === 'modifier' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <SubjectTraitContextEditor selectedTraitIds={draft.subjectTraitIds} traitSelections={draft.subjectTraitSelections} prerequisiteChoices={prerequisiteChoices} traits={traits} scoped={traitPathResult.scoped} pathCount={traitPathOptions.length} diagnostics={traitPathResult.diagnostics} onChange={changeSubjectTraits} onSelectionChange={(subjectTraitSelections) => onChange({ ...draft, subjectTraitSelections })} />
          <label className="rule-set-field rule-set-field-wide"><span>Which rolls are affected?</span><select value={draft.targetMode} onChange={(e) => onChange({ ...draft, targetMode: e.target.value as typeof draft.targetMode })}><option value="check">One specific check</option><option value="roll-kind">Every roll with a purpose</option><option value="roll-trait">One reusable Dice Roll trait</option><option value="all-rolls">All rolls</option></select></label>
          {draft.targetMode === 'check' && <label className="rule-set-field rule-set-field-wide"><span>Target check</span><select value={draft.targetCheckId} onChange={(e) => onChange({ ...draft, targetCheckId: e.target.value })}>{!checks.some((check) => check.id === draft.targetCheckId) && draft.targetCheckId && <option value={draft.targetCheckId}>{draft.targetCheckId} (unavailable)</option>}{checks.map((check) => <option key={check.id} value={check.id}>{check.name}</option>)}</select><small>Only checks in the current rule set are offered.</small></label>}
          {draft.targetMode === 'roll-kind' && <label className="rule-set-field rule-set-field-wide"><span>Roll purpose</span><select value={draft.targetRollKind} onChange={(e) => onChange({ ...draft, targetRollKind: e.target.value as typeof draft.targetRollKind })}><option value="hit">Hit rolls</option><option value="damage">Damage rolls</option><option value="saving">Saving rolls</option><option value="other">Other rolls</option></select></label>}
          {draft.targetMode === 'roll-trait' && <label className="rule-set-field rule-set-field-wide"><span>Dice Roll trait</span><select value={draft.targetRollTraitId} onChange={(e) => onChange({ ...draft, targetRollTraitId: e.target.value })}><option value="">Select a complete roll…</option>{!diceRolls.some((roll) => roll.id === draft.targetRollTraitId) && draft.targetRollTraitId && <option value={draft.targetRollTraitId}>{draft.targetRollTraitId} (unavailable)</option>}{diceRolls.map((roll) => <option key={roll.id} value={roll.id}>{roll.name} — {roll.notation}</option>)}</select><small>The modifier follows this reusable roll wherever a check uses it.</small></label>}
          {draft.targetMode === 'all-rolls' && <p className="rule-set-field rule-set-field-wide"><small>This modifier is considered for every roll. Use the matching-die controls below to keep its result scope precise.</small></p>}
          <fieldset className="rule-set-field rule-set-field-wide"><legend>Activated by traits</legend>{traits.length ? traits.map((trait) => <label className="guided-rule-checkbox" key={trait.id}><input type="checkbox" checked={draft.activatingTraitIds.includes(trait.id)} onChange={(e) => onChange({ ...draft, activatingTraitIds: e.target.checked ? [...draft.activatingTraitIds, trait.id] : draft.activatingTraitIds.filter((id) => id !== trait.id) })} /><span>{trait.name}</span></label>) : <small>No traits are available yet. Explicit runtime activation remains supported.</small>}<small>A modifier becomes active while any selected trait is active.</small></fieldset>
          <label className="rule-set-field rule-set-field-wide"><span>What changes?</span><select value={draft.modifierMode} onChange={(e) => onChange({ ...draft, modifierMode: e.target.value as typeof draft.modifierMode })}><option value="total">The final check total</option><option value="add-dice">Add reusable dice to the roll</option><option value="replace-result">Replace matching die results</option><option value="increase-result">Increase matching die results</option></select></label>
          {draft.modifierMode === 'total' && <>
            <label className="rule-set-field"><span>Adjustment</span><select value={draft.operation} onChange={(e) => onChange({ ...draft, operation: e.target.value as 'add' | 'multiply' })}><option value="add">Add (+)</option><option value="multiply">Multiply (×)</option></select></label>
            <ScalarExpressionEditor legend="Value" expression={draft.valueExpression ?? defaultGuidedScalarExpression('literal', { literalValue: draft.value })} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathResult.repairs} onAddSubjectTrait={addSubjectTrait} onSelectSubjectBranch={selectSubjectBranch} sources={['literal', 'actor-field', 'target-field', 'trait-path-field', 'trait-instance-field', 'input']} onChange={(valueExpression) => onChange({ ...draft, valueExpression })} />
          </>}
          {draft.modifierMode !== 'total' && <>
            {draft.modifierMode !== 'add-dice' && <label className="rule-set-field"><span>Match die</span><select value={draft.matchDieTraitId} onChange={(e) => onChange({ ...draft, matchDieTraitId: e.target.value })}><option value="">Every die</option>{dice.map((die) => <option key={die.id} value={die.id}>{die.name} (d{die.sides})</option>)}</select><small>Only dice currently available through the Die trait are offered.</small></label>}
            {draft.modifierMode === 'replace-result' && <label className="rule-set-field"><span>When the original result is</span><input type="number" min={1} value={draft.matchRawResult} onChange={(e) => onChange({ ...draft, matchRawResult: e.target.value })} placeholder="1" /></label>}
            {draft.modifierMode === 'increase-result'
              ? <ScalarExpressionEditor legend="Increase each match by" expression={draft.valueExpression ?? defaultGuidedScalarExpression('literal', { literalValue: draft.value })} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathResult.repairs} onAddSubjectTrait={addSubjectTrait} onSelectSubjectBranch={selectSubjectBranch} sources={['literal', 'actor-field', 'target-field', 'trait-path-field', 'trait-instance-field', 'input']} onChange={(valueExpression) => onChange({ ...draft, valueExpression })} />
              : <label className="rule-set-field"><span>{draft.modifierMode === 'add-dice' ? 'Die to add' : 'Replacement die'}</span><select value={draft.dieTraitId} onChange={(e) => onChange({ ...draft, ...selectDie(e.target.value) })}>{!dice.some((die) => die.id === draft.dieTraitId) && <option value={draft.dieTraitId}>{draft.dieTraitId} (unavailable)</option>}{dice.map((die) => <option key={die.id} value={die.id}>{die.name} (d{die.sides})</option>)}</select></label>}
            {draft.modifierMode === 'add-dice' && <label className="rule-set-field"><span>Number to add</span><input type="number" min={1} value={draft.diceCount} onChange={(e) => onChange({ ...draft, diceCount: Number(e.target.value) })} /></label>}
            {draft.modifierMode !== 'increase-result' && <label className="rule-set-field"><span>Purpose</span><select value={draft.rollKind} onChange={(e) => onChange({ ...draft, rollKind: e.target.value as typeof draft.rollKind })}><option value="hit">Hit</option><option value="damage">Damage</option><option value="saving">Saving throw</option><option value="other">Other</option></select></label>}
            {draft.modifierMode === 'replace-result' && <label className="rule-set-field"><span>Maximum replacements</span><input type="number" min={1} value={draft.maximumApplications} onChange={(e) => onChange({ ...draft, maximumApplications: Number(e.target.value) })} /></label>}
          </>}
        </div>
      )}

      {/* Resource form */}
      {draft.kind === 'resource' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field"><span>Capacity</span><input type="number" min={0} value={draft.capacity} onChange={(e) => onChange({ ...draft, capacity: Number(e.target.value) })} /></label>
          <label className="rule-set-field"><span>Minimum</span><input type="number" min={0} value={draft.minimum} onChange={(e) => onChange({ ...draft, minimum: Number(e.target.value) })} /></label>
          <label className="rule-set-field"><span>Refreshes on</span><select value={draft.refresh} onChange={(e) => onChange({ ...draft, refresh: e.target.value as 'manual' | 'encounter' | 'turn' })}><option value="turn">Turn</option><option value="encounter">Encounter</option><option value="manual">Manual</option></select></label>
        </div>
      )}

      {/* Effect form */}
      {draft.kind === 'effect' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field"><span>Duration</span><select value={draft.durationKind} onChange={(e) => onChange({ ...draft, durationKind: e.target.value as 'instant' | 'turns' | 'persistent' })}><option value="instant">Instant</option><option value="turns">Fixed turns</option><option value="persistent">Persistent</option></select></label>
          {draft.durationKind === 'turns' && <label className="rule-set-field"><span>Number of turns</span><input type="number" min={1} value={draft.durationTurns} onChange={(e) => onChange({ ...draft, durationTurns: Number(e.target.value) })} /></label>}
          <fieldset className="rule-set-field rule-set-field-wide"><legend>Contributed modifiers</legend>{modifiers.length ? modifiers.map((modifier) => {
            const selected = draft.modifierIds.split(',').map((id) => id.trim()).filter(Boolean);
            return <label className="guided-rule-checkbox" key={modifier.id}><input type="checkbox" checked={selected.includes(modifier.id)} onChange={(e) => onChange({ ...draft, modifierIds: (e.target.checked ? [...selected, modifier.id] : selected.filter((id) => id !== modifier.id)).join(', ') })} /><span>{modifier.name}</span></label>;
          }) : <small>No modifiers are available yet.</small>}<small>These modifiers become active while this effect is active.</small></fieldset>
        </div>
      )}

      {/* Event form */}
      {draft.kind === 'event' && (
        <div className="rule-set-form-grid guided-rule-full-form">
          <label className="rule-set-field"><span>Visibility</span><select value={draft.visibility} onChange={(e) => onChange({ ...draft, visibility: e.target.value as 'public' | 'gm' })}><option value="public">Public</option><option value="gm">GM only</option></select></label>
          <label className="rule-set-field rule-set-field-wide"><span>Payload fields (key:type, …)</span><input value={draft.payloadFields} onChange={(e) => onChange({ ...draft, payloadFields: e.target.value })} placeholder="attackerId:string, targetId:string, total:number" /><small>Comma-separated pairs of field name and type (string | number | boolean).</small></label>
        </div>
      )}

      {/* Check builder */}
      {draft.kind === 'check' && view === 'builder' && (
        <div className="rule-set-form-grid guided-rule-full-form" role="tabpanel">
          <SubjectTraitContextEditor selectedTraitIds={draft.subjectTraitIds} traitSelections={draft.subjectTraitSelections} prerequisiteChoices={prerequisiteChoices} traits={traits} scoped={traitPathResult.scoped} pathCount={traitPathOptions.length} diagnostics={traitPathResult.diagnostics} onChange={changeSubjectTraits} onSelectionChange={(subjectTraitSelections) => onChange({ ...draft, subjectTraitSelections })} />
          <label className="rule-set-field rule-set-field-wide"><span>Roll structure</span><select value={draft.rollSource} onChange={(e) => onChange({ ...draft, rollSource: e.target.value as typeof draft.rollSource })}><option value="single-die">Choose a counted die</option><option value="roll-trait">Use a complete Dice Roll trait</option></select></label>
          {draft.rollSource === 'single-die' ? <>
            <label className="rule-set-field"><span>Number of dice</span><input type="number" min={1} max={20} value={draft.diceCount} onChange={(e) => onChange({ ...draft, diceCount: Number(e.target.value) })} /></label>
            <label className="rule-set-field"><span>Die trait</span><select value={draft.dieTraitId} onChange={(e) => onChange({ ...draft, ...selectDie(e.target.value) })}>{!dice.some((die) => die.id === draft.dieTraitId) && <option value={draft.dieTraitId}>{draft.dieTraitId} (unavailable)</option>}{dice.map((die) => <option key={die.id} value={die.id}>{die.name} (d{die.sides})</option>)}</select><small>Options come from traits that satisfy Die and set their sides.</small></label>
          </> : <>
            <label className="rule-set-field rule-set-field-wide"><span>Dice Roll trait</span><select value={draft.rollTraitId} onChange={(e) => onChange({ ...draft, ...selectDiceRoll(e.target.value) })}><option value="">Select a complete roll…</option>{!diceRolls.some((roll) => roll.id === draft.rollTraitId) && draft.rollTraitId && <option value={draft.rollTraitId}>{draft.rollTraitId} (unavailable)</option>}{diceRolls.map((roll) => <option key={roll.id} value={roll.id}>{roll.name} — {roll.notation}</option>)}</select><small>Only traits that produce one non-empty collection accepting Die are offered.</small></label>
            {!!draft.dicePools.length && <div className="rule-set-field rule-set-field-wide"><span>Resolved pool</span><strong>{draft.dicePools.map((pool) => `${pool.count}d${pool.sides}`).join(' + ')}</strong><small>This normalized pool is checked against the selected trait again when publishing.</small></div>}
          </>}
          <label className="rule-set-field"><span>Purpose</span><select value={draft.rollKind} onChange={(e) => onChange({ ...draft, rollKind: e.target.value as typeof draft.rollKind })}><option value="hit">Hit</option><option value="damage">Damage</option><option value="saving">Saving throw</option><option value="other">Other</option></select></label>
          <ScalarExpressionEditor legend="Bonus" expression={draft.bonusExpression ?? defaultGuidedScalarExpression('actor-field', { key: draft.actorBonusField })} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathResult.repairs} onAddSubjectTrait={addSubjectTrait} onSelectSubjectBranch={selectSubjectBranch} sources={['literal', 'actor-field', 'target-field', 'trait-path-field', 'trait-instance-field', 'input']} onChange={(bonusExpression) => onChange({ ...draft, bonusExpression })} />
          <ScalarExpressionEditor legend="Target number" expression={draft.targetExpression ?? defaultGuidedScalarExpression('target-field', { key: draft.targetField })} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathResult.repairs} onAddSubjectTrait={addSubjectTrait} onSelectSubjectBranch={selectSubjectBranch} sources={['literal', 'actor-field', 'target-field', 'trait-path-field', 'trait-instance-field', 'input']} onChange={(targetExpression) => onChange({ ...draft, targetExpression })} />
        </div>
      )}
      {draft.kind === 'check' && view === 'preview' && (
        <table className="resolution-example-table" role="tabpanel"><thead><tr><th>Recorded pool</th><th>Bonus</th><th>Total</th><th>vs 16</th></tr></thead>
          <tbody>{(() => {
            const pools = draft.rollSource === 'roll-trait' ? draft.dicePools : [{ dieTraitId: draft.dieTraitId, count: draft.diceCount, sides: draft.dieSides }];
            const examples = [
              pools.reduce((sum, pool) => sum + pool.count, 0),
              pools.reduce((sum, pool) => sum + pool.count * Math.ceil(pool.sides / 2), 0),
              pools.reduce((sum, pool) => sum + pool.count * pool.sides, 0),
            ];
            return examples.map((roll, index) => <tr key={`${index}-${roll}`}><td>{roll}</td><td>+3</td><td>{roll + 3}</td><td>{roll + 3 >= 16 ? 'success' : 'failure'}</td></tr>);
          })()}</tbody>
        </table>
      )}

      {/* Operation pipeline builder */}
      {draft.kind === 'operation' && view === 'builder' && (
        <div className="guided-rule-full-form" role="tabpanel">
          <SubjectTraitContextEditor selectedTraitIds={draft.subjectTraitIds} traitSelections={draft.subjectTraitSelections} prerequisiteChoices={prerequisiteChoices} traits={traits} scoped={traitPathResult.scoped} pathCount={traitPathOptions.length} diagnostics={traitPathResult.diagnostics} inheritedSources={operationSubjectContract?.checkSources} onChange={changeSubjectTraits} onSelectionChange={(subjectTraitSelections) => onChange({ ...draft, subjectTraitSelections })} />
          <ul className="pipeline-step-list">{draft.steps.map((step, i) => (
            <StepEditor key={`${i}-${step.stepId}`} index={i} step={step} traitPathOptions={traitPathOptions} traitPathRepairs={traitPathResult.repairs} onAddSubjectTrait={addSubjectTrait} onSelectSubjectBranch={selectSubjectBranch} onChange={(s) => updateStep(i, s)} onRemove={() => removeStep(i)} />
          ))}</ul>
          <div className="pipeline-add-step">
            <select aria-label="New step kind" value={newStepKind} onChange={(e) => setNewStepKind(e.target.value as OperationStepKind)}>{STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
            <button type="button" className="secondary-action" onClick={addStep}>Add step</button>
          </div>
          <label className="rule-set-field"><span>Maximum steps (budget)</span><input type="number" min={1} max={256} value={draft.maximumSteps} onChange={(e) => onChange({ ...draft, maximumSteps: Number(e.target.value) })} /></label>
          <button className="secondary-action resolution-preview-button" type="button" onClick={runPreview}>Run sample preview</button>
        </div>
      )}
      {draft.kind === 'operation' && view === 'preview' && (
        <div className="resolution-preview" role="tabpanel">
          <button className="secondary-action" type="button" onClick={runPreview}>Run sample preview</button>
          {preview && <><strong>Outcome: {preview.outcome}</strong>{!!preview.activeTraits?.length && <p>Expanded traits: {preview.activeTraits.map((trait) => trait.traitId).join(', ')}</p>}{!!preview.traitChoices?.length && <p>Prerequisite choices: {preview.traitChoices.map((choice) => `${choice.traitId} → ${choice.selectedTraitIds.join(' + ')}`).join('; ')}</p>}{!!preview.rolls?.some((roll) => roll.modifierActivations?.length) && <p>Modifier activation: {JSON.stringify(preview.rolls.flatMap((roll) => roll.modifierActivations ?? []))}</p>}<ol>{preview.trace.map((entry) => <li key={entry.stepId}><span>{entry.stepId}</span>{entry.message}{entry.values && <small>{JSON.stringify(entry.values)}</small>}</li>)}</ol></>}
        </div>
      )}
      {draft.kind === 'operation' && view === 'fixture' && (
        <div role="tabpanel"><FixtureRunner operationId={draft.stableId} relatedBodies={relatedBodies} traitSources={traitSources} body={body} /></div>
      )}

      {previewError && <p className="rule-set-notice error">{previewError}</p>}
      {!!diagnostics.length && (
        <div className="guided-rule-diagnostics" aria-live="polite">
          <strong>{diagnostics.some((d) => d.severity === 'error') ? 'Validation errors' : 'Validation notes'}</strong>
          <ul>{diagnostics.map((d) => <li key={`${d.code}-${d.path}`}><span>{d.path}</span>{d.message}</li>)}</ul>
        </div>
      )}
      <details className="guided-rule-advanced"><summary>Advanced canonical source</summary><pre>{JSON.stringify(body, null, 2)}</pre></details>
    </section>
  );
}
