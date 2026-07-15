import {
  CompiledCreatureCapabilityArtifact,
  Condition,
  CreatureEvaluation,
  CreatureEvaluationContext,
  Expression,
  PrimitiveValue,
  TraitDefinition,
  VisualObservation,
  ValueSchema,
} from './creature-capability.types';
import { creatureCapabilityContracts } from './creature-capability.compiler';

class MissingCapabilityError extends Error {}

function numeric(value: PrimitiveValue, path: string): number {
  if (typeof value !== 'number') throw new Error(`${path} did not evaluate to a number.`);
  return value;
}

function assertValue(value: PrimitiveValue, schema: ValueSchema, path: string): void {
  const numericType = ['integer', 'decimal', 'distance', 'movement-rate'].includes(schema.type);
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be boolean.`);
  if (schema.type === 'text' && typeof value !== 'string') throw new Error(`${path} must be text.`);
  if (numericType && typeof value !== 'number') throw new Error(`${path} must be numeric.`);
  if (schema.type === 'integer' && !Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} must be at least ${schema.minimum}.`);
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} must be at most ${schema.maximum}.`);
  if (schema.allowedValues && !schema.allowedValues.includes(String(value))) throw new Error(`${path} must be one of: ${schema.allowedValues.join(', ')}.`);
}

function evaluateExpression(
  expression: Expression,
  values: Record<string, PrimitiveValue>,
  capabilities: Record<string, Record<string, PrimitiveValue>>,
  parameters: Record<string, PrimitiveValue>,
): PrimitiveValue {
  switch (expression.op) {
    case 'literal': return expression.value;
    case 'parameter': {
      if (!(expression.parameterId in parameters)) throw new Error(`Parameter '${expression.parameterId}' has no value.`);
      return parameters[expression.parameterId];
    }
    case 'get': {
      if (!(expression.definitionId in values)) throw new Error(`Definition '${expression.definitionId}' has no evaluated value.`);
      return values[expression.definitionId];
    }
    case 'capability': {
      if (!(expression.capability in capabilities)) throw new MissingCapabilityError(`Capability '${expression.capability}' is not available.`);
      const property = capabilities[expression.capability][expression.property];
      if (property === undefined) throw new MissingCapabilityError(`Capability property '${expression.capability}.${expression.property}' is not available.`);
      return property;
    }
    case 'floor': return Math.floor(numeric(evaluateExpression(expression.value, values, capabilities, parameters), 'floor'));
    case 'add': return numeric(evaluateExpression(expression.left, values, capabilities, parameters), 'left') + numeric(evaluateExpression(expression.right, values, capabilities, parameters), 'right');
    case 'subtract': return numeric(evaluateExpression(expression.left, values, capabilities, parameters), 'left') - numeric(evaluateExpression(expression.right, values, capabilities, parameters), 'right');
    case 'multiply': return numeric(evaluateExpression(expression.left, values, capabilities, parameters), 'left') * numeric(evaluateExpression(expression.right, values, capabilities, parameters), 'right');
    case 'divide': {
      const divisor = numeric(evaluateExpression(expression.right, values, capabilities, parameters), 'right');
      if (divisor === 0) throw new Error('Division by zero is not allowed.');
      return numeric(evaluateExpression(expression.left, values, capabilities, parameters), 'left') / divisor;
    }
  }
}

function evaluateCondition(
  condition: Condition,
  values: Record<string, PrimitiveValue>,
  capabilities: Record<string, Record<string, PrimitiveValue>>,
  parameters: Record<string, PrimitiveValue>,
): boolean {
  if (condition.op === 'equals') return evaluateExpression(condition.left, values, capabilities, parameters) === evaluateExpression(condition.right, values, capabilities, parameters);
  if (condition.op === 'all') return condition.conditions.every((child) => evaluateCondition(child, values, capabilities, parameters));
  if (condition.op === 'any') return condition.conditions.some((child) => evaluateCondition(child, values, capabilities, parameters));
  if (condition.op === 'not') return !evaluateCondition(condition.condition, values, capabilities, parameters);
  return false;
}

export function evaluateCreatureCapabilities(
  artifact: CompiledCreatureCapabilityArtifact,
  context: CreatureEvaluationContext,
): CreatureEvaluation {
  const definitions = new Map(artifact.definitions.map((definition) => [definition.definitionId, definition]));
  const values: Record<string, PrimitiveValue> = {};
  const capabilities: Record<string, Record<string, PrimitiveValue>> = {};
  const trace: CreatureEvaluation['trace'] = [];
  const resolving = new Set<string>();

  const resolveValue = (definitionId: string): PrimitiveValue => {
    if (definitionId in values) return values[definitionId];
    const definition = definitions.get(definitionId);
    if (!definition || definition.definitionType === 'trait') throw new Error(`Value definition '${definitionId}' was not compiled.`);
    if (resolving.has(definitionId)) throw new Error(`Derived-value cycle encountered at '${definitionId}'.`);
    resolving.add(definitionId);
    let value: PrimitiveValue;
    if (definition.definitionType === 'field') {
      value = context.fields?.[definitionId] ?? definition.defaultValue;
      if (value === undefined) throw new Error(`Field '${definitionId}' requires a value.`);
    } else {
      const dependencies = collectValueReferences(definition.expression);
      dependencies.forEach(resolveValue);
      value = evaluateExpression(definition.expression, values, capabilities, {});
    }
    assertValue(value, definition.value, definitionId);
    resolving.delete(definitionId);
    values[definitionId] = value;
    trace.push({ path: `values.${definitionId}`, message: `Evaluated ${definition.name}.`, value });
    return value;
  };

  artifact.definitions.filter((definition) => definition.definitionType !== 'trait').forEach((definition) => resolveValue(definition.definitionId));

  const pending: Array<{ trait: TraitDefinition; parameters: Record<string, PrimitiveValue>; contributionIndex: number }> = [];
  for (const application of context.traits) {
    const trait = definitions.get(application.traitId);
    if (!trait || trait.definitionType !== 'trait') throw new Error(`Trait '${application.traitId}' was not compiled.`);
    const parameters: Record<string, PrimitiveValue> = {};
    for (const parameter of trait.parameters ?? []) {
      const value = application.parameters?.[parameter.parameterId] ?? parameter.defaultValue;
      if (value === undefined && parameter.required) throw new Error(`Trait '${trait.definitionId}' requires parameter '${parameter.parameterId}'.`);
      if (value !== undefined) {
        assertValue(value, parameter.value, `${trait.definitionId}.${parameter.parameterId}`);
        parameters[parameter.parameterId] = value;
      }
    }
    trait.contributes.forEach((_contribution, contributionIndex) => pending.push({ trait, parameters, contributionIndex }));
  }

  while (pending.length) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const item = pending[index];
      const contribution = item.trait.contributes[item.contributionIndex];
      try {
        if (contribution.when && !evaluateCondition(contribution.when, values, capabilities, item.parameters)) {
          trace.push({ path: `traits.${item.trait.definitionId}.contributes[${item.contributionIndex}]`, message: `Skipped ${contribution.capability}; its condition was false.` });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }
        if (capabilities[contribution.capability]) throw new Error(`Capability '${contribution.capability}' has more than one active provider.`);
        const capabilityValues: Record<string, PrimitiveValue> = {};
        for (const [property, expression] of Object.entries(contribution.values)) {
          const value = evaluateExpression(expression, values, capabilities, item.parameters);
          assertValue(value, creatureCapabilityContracts[contribution.capability][property], `${contribution.capability}.${property}`);
          capabilityValues[property] = value;
        }
        capabilities[contribution.capability] = capabilityValues;
        trace.push({ path: `capabilities.${contribution.capability}`, message: `${item.trait.name} contributed ${contribution.capability}.` });
        pending.splice(index, 1);
        progressed = true;
      } catch (error) {
        if (!(error instanceof MissingCapabilityError)) throw error;
      }
    }
    if (!progressed) throw new Error(`Capability dependency cycle or missing provider: ${pending.map((item) => item.trait.contributes[item.contributionIndex].capability).join(', ')}.`);
  }

  return { values, capabilities, trace };
}

function collectValueReferences(expression: Expression): string[] {
  if (expression.op === 'get') return [expression.definitionId];
  if (expression.op === 'floor') return collectValueReferences(expression.value);
  if (['add', 'subtract', 'multiply', 'divide'].includes(expression.op)) {
    const binary = expression as Extract<Expression, { left: Expression }>;
    return [...collectValueReferences(binary.left), ...collectValueReferences(binary.right)];
  }
  return [];
}

export function evaluateVisualObservation(
  evaluation: CreatureEvaluation,
  probe: { distance: number; lighting: string; hasLineOfSight: boolean; opaqueBarrier: boolean },
): VisualObservation {
  const visual = evaluation.capabilities['perception.visual'];
  if (!visual) throw new Error("Capability 'perception.visual' is not available.");
  const maximumRange = numeric(visual.maximumRange, 'perception.visual.maximumRange');
  let blockedBy: VisualObservation['blockedBy'] = null;
  if (probe.distance > maximumRange) blockedBy = 'range';
  else if (typeof visual.lighting === 'string' && visual.lighting !== probe.lighting) blockedBy = 'lighting';
  else if (visual.requiresLineOfSight === true && !probe.hasLineOfSight) blockedBy = 'line-of-sight';
  else if (visual.opaqueBarriersBlock === true && probe.opaqueBarrier) blockedBy = 'opaque-barrier';
  return { channel: 'visual', perceived: blockedBy === null, distance: probe.distance, maximumRange, blockedBy };
}
