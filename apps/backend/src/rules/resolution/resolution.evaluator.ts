import {
  CheckDefinition,
  CompiledResolutionArtifact,
  ModifierDefinition,
  OperationDefinition,
  ResolutionCondition,
  ResolutionContext,
  ResolutionExpression,
  ResolutionPreview,
  ResolutionPrimitive,
} from './resolution.types';

function number(value: ResolutionPrimitive, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function expression(
  node: ResolutionExpression,
  context: ResolutionContext,
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

function condition(node: ResolutionCondition, context: ResolutionContext, results: Record<string, Record<string, ResolutionPrimitive>>): boolean {
  if (node.op === 'all') return node.conditions.every((item) => condition(item, context, results));
  if (node.op === 'any') return node.conditions.some((item) => condition(item, context, results));
  if (node.op === 'not') return !condition(node.condition, context, results);
  const left = expression(node.left, context, results);
  const right = expression(node.right, context, results);
  if (node.op === 'equals') return left === right;
  return node.op === 'gte' ? number(left, 'condition.left') >= number(right, 'condition.right') : number(left, 'condition.left') <= number(right, 'condition.right');
}

function performCheck(
  check: CheckDefinition,
  modifiers: ModifierDefinition[],
  context: ResolutionContext,
  results: Record<string, Record<string, ResolutionPrimitive>>,
  entropy: number[],
): Record<string, ResolutionPrimitive> {
  const rolls: number[] = [];
  for (let index = 0; index < check.roll.count; index += 1) {
    const roll = context.entropy[entropy.length];
    if (!Number.isInteger(roll) || roll < 1 || roll > check.roll.sides) throw new Error(`Recorded entropy must be an integer from 1 to ${check.roll.sides}.`);
    entropy.push(roll);
    rolls.push(roll);
  }
  const baseBonus = number(expression(check.bonus, context, results), `${check.definitionId}.bonus`);
  let total = rolls.reduce((sum, roll) => sum + roll, 0) + baseBonus;
  for (const modifier of modifiers) {
    if (modifier.when && !condition(modifier.when, context, results)) continue;
    const value = number(expression(modifier.value, context, results), modifier.definitionId);
    total = modifier.operation === 'add' ? total + value : total * value;
  }
  const target = number(expression(check.target, context, results), `${check.definitionId}.target`);
  return { roll: rolls.reduce((sum, roll) => sum + roll, 0), bonus: total - rolls.reduce((sum, roll) => sum + roll, 0), total, target, success: total >= target };
}

export function previewResolutionOperation(
  artifact: CompiledResolutionArtifact,
  operationId: string,
  sourceContext: ResolutionContext,
): ResolutionPreview {
  const definitions = new Map(artifact.definitions.map((definition) => [definition.definitionId, definition]));
  const operation = definitions.get(operationId);
  if (!operation || operation.definitionType !== 'operation') throw new Error(`Operation '${operationId}' is not compiled.`);
  const steps = new Map(operation.steps.map((step) => [step.stepId, step]));
  const context: ResolutionContext = {
    ...sourceContext,
    actor: { ...sourceContext.actor, fields: { ...sourceContext.actor.fields }, resources: { ...sourceContext.actor.resources } },
    target: { ...sourceContext.target, fields: { ...sourceContext.target.fields } },
  };
  const results: Record<string, Record<string, ResolutionPrimitive>> = {};
  const trace: ResolutionPreview['trace'] = [];
  const resourceChanges: ResolutionPreview['resourceChanges'] = [];
  const effects: ResolutionPreview['effects'] = [];
  const events: ResolutionPreview['events'] = [];
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
      if (!allowed) return { outcome: 'failure', data: { reason: step.failureMessage }, resourceChanges, effects, events, entropyConsumed, trace };
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
      const active = new Set(context.activeModifierIds ?? []);
      const modifiers = artifact.definitions.filter((definition): definition is ModifierDefinition => definition.definitionType === 'modifier' && definition.targetCheckId === check.definitionId && active.has(definition.definitionId));
      const result = performCheck(check, modifiers, context, results, entropyConsumed);
      results[step.resultKey] = result;
      trace.push({ stepId, kind: step.kind, message: result.success ? `${check.name} succeeded.` : `${check.name} failed.`, values: result });
      stepId = result.success ? step.onSuccess : step.onFailure;
    } else if (step.kind === 'apply-effect') {
      const effect = definitions.get(step.effectId);
      if (!effect || effect.definitionType !== 'effect') throw new Error(`Effect '${step.effectId}' is unavailable.`);
      const targetId = step.target === 'actor' ? context.actor.id : context.target.id;
      effects.push({ effectId: step.effectId, targetId });
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
      return { outcome: step.outcome, data, resourceChanges, effects, events, entropyConsumed, trace };
    }
  }
}
