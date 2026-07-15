import { createHash } from 'crypto';
import {
  CapabilityId,
  CompilationResult,
  Condition,
  CREATURE_CAPABILITY_ARTIFACT_VERSION,
  CREATURE_CAPABILITY_METAMODEL_VERSION,
  CreatureCapabilityDefinition,
  Diagnostic,
  Expression,
  PrimitiveValue,
  ValueSchema,
  ValueType,
} from './creature-capability.types';

const CAPABILITY_CONTRACTS: Record<CapabilityId, Record<string, ValueSchema>> = {
  'perception.visual': {
    maximumRange: { type: 'distance', unit: 'meter', minimum: 0 },
    lighting: { type: 'text' },
    requiresLineOfSight: { type: 'boolean' },
    opaqueBarriersBlock: { type: 'boolean' },
  },
  'perception.audio': {
    maximumRange: { type: 'distance', unit: 'meter', minimum: 0 },
    minimumVolume: { type: 'decimal', minimum: 0 },
    attenuation: { type: 'text', allowedValues: ['none', 'linear', 'inverse-square'] },
  },
  'movement.walk': { rate: { type: 'movement-rate', unit: 'meter-per-turn', minimum: 0 } },
  'movement.run': { rate: { type: 'movement-rate', unit: 'meter-per-turn', minimum: 0 } },
};

const DEFINITION_KEYS = {
  field: ['formatVersion', 'metamodelVersion', 'definitionId', 'definitionType', 'name', 'description', 'value', 'defaultValue'],
  'derived-value': ['formatVersion', 'metamodelVersion', 'definitionId', 'definitionType', 'name', 'description', 'value', 'expression'],
  trait: ['formatVersion', 'metamodelVersion', 'definitionId', 'definitionType', 'name', 'description', 'parameters', 'contributes'],
};

function diagnostic(diagnostics: Diagnostic[], code: string, path: string, message: string): void {
  diagnostics.push({ code, path, message, severity: 'error' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], path: string, diagnostics: Diagnostic[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) diagnostic(diagnostics, 'RULE_UNKNOWN_SEMANTIC_FIELD', `${path}.${key}`, `Unknown semantic field '${key}'.`);
  }
}

function validateValueSchemaShape(value: unknown, path: string, diagnostics: Diagnostic[]): value is ValueSchema {
  if (!isRecord(value)) {
    diagnostic(diagnostics, 'RULE_VALUE_SCHEMA_REQUIRED', path, 'A value schema is required.');
    return false;
  }
  rejectUnknownKeys(value, ['type', 'unit', 'minimum', 'maximum', 'allowedValues'], path, diagnostics);
  if (!['boolean', 'integer', 'decimal', 'text', 'distance', 'movement-rate'].includes(String(value.type))) {
    diagnostic(diagnostics, 'RULE_VALUE_SCHEMA_TYPE_INVALID', `${path}.type`, 'Value schema type is invalid.');
    return false;
  }
  if (value.minimum !== undefined && typeof value.minimum !== 'number') diagnostic(diagnostics, 'RULE_VALUE_CONSTRAINT_INVALID', `${path}.minimum`, 'Minimum must be numeric.');
  if (value.maximum !== undefined && typeof value.maximum !== 'number') diagnostic(diagnostics, 'RULE_VALUE_CONSTRAINT_INVALID', `${path}.maximum`, 'Maximum must be numeric.');
  if (value.allowedValues !== undefined && (!Array.isArray(value.allowedValues) || value.allowedValues.some((item) => typeof item !== 'string'))) diagnostic(diagnostics, 'RULE_VALUE_CONSTRAINT_INVALID', `${path}.allowedValues`, 'Allowed values must be strings.');
  return true;
}

function validateExpressionShape(value: unknown, path: string, diagnostics: Diagnostic[]): value is Expression {
  if (!isRecord(value) || typeof value.op !== 'string') {
    diagnostic(diagnostics, 'RULE_EXPRESSION_INVALID', path, 'Expression must be an object with an operator.');
    return false;
  }
  const keys: Record<string, string[]> = {
    literal: ['op', 'value', 'valueType'], parameter: ['op', 'parameterId'], get: ['op', 'definitionId'],
    capability: ['op', 'capability', 'property'], floor: ['op', 'value'],
    add: ['op', 'left', 'right'], subtract: ['op', 'left', 'right'], multiply: ['op', 'left', 'right'], divide: ['op', 'left', 'right'],
  };
  const allowed = keys[value.op];
  if (!allowed) {
    diagnostic(diagnostics, 'RULE_EXPRESSION_OPERATOR_UNKNOWN', `${path}.op`, `Expression operator '${value.op}' is not supported.`);
    return false;
  }
  rejectUnknownKeys(value, allowed, path, diagnostics);
  if (value.op === 'floor') return validateExpressionShape(value.value, `${path}.value`, diagnostics);
  if (['add', 'subtract', 'multiply', 'divide'].includes(value.op)) {
    return validateExpressionShape(value.left, `${path}.left`, diagnostics) && validateExpressionShape(value.right, `${path}.right`, diagnostics);
  }
  return true;
}

function validateConditionShape(value: unknown, path: string, diagnostics: Diagnostic[]): value is Condition {
  if (!isRecord(value) || typeof value.op !== 'string') {
    diagnostic(diagnostics, 'RULE_CONDITION_INVALID', path, 'Condition must be an object with an operator.');
    return false;
  }
  if (value.op === 'equals') {
    rejectUnknownKeys(value, ['op', 'left', 'right'], path, diagnostics);
    return validateExpressionShape(value.left, `${path}.left`, diagnostics) && validateExpressionShape(value.right, `${path}.right`, diagnostics);
  }
  if (value.op === 'all' || value.op === 'any') {
    rejectUnknownKeys(value, ['op', 'conditions'], path, diagnostics);
    if (!Array.isArray(value.conditions)) {
      diagnostic(diagnostics, 'RULE_CONDITION_INVALID', `${path}.conditions`, 'Condition group must be an array.');
      return false;
    }
    return value.conditions.every((condition, index) => validateConditionShape(condition, `${path}.conditions[${index}]`, diagnostics));
  }
  if (value.op === 'not') {
    rejectUnknownKeys(value, ['op', 'condition'], path, diagnostics);
    return validateConditionShape(value.condition, `${path}.condition`, diagnostics);
  }
  diagnostic(diagnostics, 'RULE_CONDITION_OPERATOR_UNKNOWN', `${path}.op`, `Condition operator '${value.op}' is not supported.`);
  return false;
}

function typeOfPrimitive(value: PrimitiveValue): ValueType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'text';
  return Number.isInteger(value) ? 'integer' : 'decimal';
}

function typesCompatible(actual: ValueType, expected: ValueType): boolean {
  if (actual === expected) return true;
  if ((actual === 'integer' || actual === 'decimal') && expected === 'decimal') return true;
  return false;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateValue(value: PrimitiveValue, schema: ValueSchema, path: string, diagnostics: Diagnostic[]): void {
  const actual = typeOfPrimitive(value);
  if (!typesCompatible(actual, schema.type) && !(typeof value === 'number' && ['distance', 'movement-rate'].includes(schema.type))) {
    diagnostic(diagnostics, 'RULE_VALUE_TYPE_INVALID', path, `Expected ${schema.type}; received ${actual}.`);
    return;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) diagnostic(diagnostics, 'RULE_VALUE_BELOW_MINIMUM', path, `Value must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) diagnostic(diagnostics, 'RULE_VALUE_ABOVE_MAXIMUM', path, `Value must be at most ${schema.maximum}.`);
  }
  if (schema.allowedValues && !schema.allowedValues.includes(String(value))) {
    diagnostic(diagnostics, 'RULE_VALUE_NOT_ALLOWED', path, `Value must be one of: ${schema.allowedValues.join(', ')}.`);
  }
}

function validateShape(input: unknown, index: number, diagnostics: Diagnostic[]): input is CreatureCapabilityDefinition {
  const path = `definitions[${index}]`;
  if (!isRecord(input)) {
    diagnostic(diagnostics, 'RULE_DEFINITION_INVALID', path, 'Definition must be an object.');
    return false;
  }
  const type = input.definitionType;
  if (type !== 'field' && type !== 'derived-value' && type !== 'trait') {
    diagnostic(diagnostics, 'RULE_DEFINITION_TYPE_UNKNOWN', `${path}.definitionType`, 'Definition type is not supported by this metamodel.');
    return false;
  }
  rejectUnknownKeys(input, DEFINITION_KEYS[type], path, diagnostics);
  if (input.formatVersion !== '1') diagnostic(diagnostics, 'RULE_FORMAT_VERSION_UNSUPPORTED', `${path}.formatVersion`, "formatVersion must be '1'.");
  if (input.metamodelVersion !== CREATURE_CAPABILITY_METAMODEL_VERSION) diagnostic(diagnostics, 'RULE_METAMODEL_VERSION_UNSUPPORTED', `${path}.metamodelVersion`, `metamodelVersion must be '${CREATURE_CAPABILITY_METAMODEL_VERSION}'.`);
  if (typeof input.definitionId !== 'string' || !/^(field|derived|trait):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.definitionId)) diagnostic(diagnostics, 'RULE_DEFINITION_ID_INVALID', `${path}.definitionId`, 'Use a stable ID such as trait:vision.');
  if (typeof input.name !== 'string' || !input.name.trim()) diagnostic(diagnostics, 'RULE_NAME_REQUIRED', `${path}.name`, 'A name is required.');
  if (type === 'field') return validateValueSchemaShape(input.value, `${path}.value`, diagnostics);
  if (type === 'derived-value') {
    return validateValueSchemaShape(input.value, `${path}.value`, diagnostics)
      && validateExpressionShape(input.expression, `${path}.expression`, diagnostics);
  }
  let structurallyValid = true;
  if (input.parameters !== undefined) {
    if (!Array.isArray(input.parameters)) {
      diagnostic(diagnostics, 'RULE_PARAMETERS_INVALID', `${path}.parameters`, 'Parameters must be an array.');
      structurallyValid = false;
    } else {
      input.parameters.forEach((parameter, parameterIndex) => {
        const parameterPath = `${path}.parameters[${parameterIndex}]`;
        if (!isRecord(parameter)) {
          diagnostic(diagnostics, 'RULE_PARAMETER_INVALID', parameterPath, 'Parameter must be an object.');
          structurallyValid = false;
          return;
        }
        rejectUnknownKeys(parameter, ['parameterId', 'name', 'value', 'required', 'defaultValue'], parameterPath, diagnostics);
        if (typeof parameter.parameterId !== 'string' || !parameter.parameterId) diagnostic(diagnostics, 'RULE_PARAMETER_ID_INVALID', `${parameterPath}.parameterId`, 'Parameter ID is required.');
        if (!validateValueSchemaShape(parameter.value, `${parameterPath}.value`, diagnostics)) structurallyValid = false;
      });
    }
  }
  if (!Array.isArray(input.contributes)) {
    diagnostic(diagnostics, 'RULE_TRAIT_CONTRIBUTIONS_REQUIRED', `${path}.contributes`, 'A trait requires a contributions array.');
    return false;
  }
  input.contributes.forEach((contribution, contributionIndex) => {
    const contributionPath = `${path}.contributes[${contributionIndex}]`;
    if (!isRecord(contribution)) {
      diagnostic(diagnostics, 'RULE_CAPABILITY_CONTRIBUTION_INVALID', contributionPath, 'Capability contribution must be an object.');
      structurallyValid = false;
      return;
    }
    rejectUnknownKeys(contribution, ['capability', 'values', 'when'], contributionPath, diagnostics);
    if (!isRecord(contribution.values)) {
      diagnostic(diagnostics, 'RULE_CAPABILITY_VALUES_REQUIRED', `${contributionPath}.values`, 'Capability values must be an object.');
      structurallyValid = false;
    } else {
      Object.entries(contribution.values).forEach(([property, expression]) => {
        if (!validateExpressionShape(expression, `${contributionPath}.values.${property}`, diagnostics)) structurallyValid = false;
      });
    }
    if (contribution.when !== undefined && !validateConditionShape(contribution.when, `${contributionPath}.when`, diagnostics)) structurallyValid = false;
  });
  return structurallyValid;
}

interface TypeContext {
  definitions: Map<string, CreatureCapabilityDefinition>;
  parameters: Map<string, ValueSchema>;
  diagnostics: Diagnostic[];
}

function inferExpression(expression: Expression, path: string, context: TypeContext): ValueSchema | undefined {
  if (!isRecord(expression) || typeof expression.op !== 'string') {
    diagnostic(context.diagnostics, 'RULE_EXPRESSION_INVALID', path, 'Expression must have a known operator.');
    return undefined;
  }
  switch (expression.op) {
    case 'literal': {
      if (!['boolean', 'integer', 'decimal', 'text', 'distance', 'movement-rate'].includes(expression.valueType)) {
        diagnostic(context.diagnostics, 'RULE_EXPRESSION_LITERAL_TYPE_INVALID', `${path}.valueType`, 'Literal value type is invalid.');
        return undefined;
      }
      validateValue(expression.value, { type: expression.valueType }, `${path}.value`, context.diagnostics);
      return { type: expression.valueType };
    }
    case 'parameter': {
      const schema = context.parameters.get(expression.parameterId);
      if (!schema) diagnostic(context.diagnostics, 'RULE_PARAMETER_REFERENCE_MISSING', `${path}.parameterId`, `Parameter '${expression.parameterId}' does not exist on this trait.`);
      return schema;
    }
    case 'get': {
      const target = context.definitions.get(expression.definitionId);
      if (!target || target.definitionType === 'trait') {
        diagnostic(context.diagnostics, 'RULE_DEFINITION_REFERENCE_MISSING', `${path}.definitionId`, `Value definition '${expression.definitionId}' was not found.`);
        return undefined;
      }
      return target.value;
    }
    case 'capability': {
      const contract = CAPABILITY_CONTRACTS[expression.capability]?.[expression.property];
      if (!contract) diagnostic(context.diagnostics, 'RULE_CAPABILITY_REFERENCE_INVALID', path, `Capability property '${expression.capability}.${expression.property}' does not exist.`);
      return contract;
    }
    case 'floor': {
      const value = inferExpression(expression.value, `${path}.value`, context);
      if (value && !['integer', 'decimal', 'distance', 'movement-rate'].includes(value.type)) diagnostic(context.diagnostics, 'RULE_EXPRESSION_TYPE_INVALID', path, 'floor requires a numeric expression.');
      return value ? { ...value, type: value.type === 'decimal' ? 'integer' : value.type } : undefined;
    }
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      const left = inferExpression(expression.left, `${path}.left`, context);
      const right = inferExpression(expression.right, `${path}.right`, context);
      if (!left || !right) return undefined;
      const numeric = ['integer', 'decimal', 'distance', 'movement-rate'];
      if (!numeric.includes(left.type) || !numeric.includes(right.type)) {
        diagnostic(context.diagnostics, 'RULE_EXPRESSION_TYPE_INVALID', path, `${expression.op} requires numeric operands.`);
        return undefined;
      }
      if (expression.op === 'multiply' || expression.op === 'divide') {
        if (left.type === 'distance' || left.type === 'movement-rate') return left;
        if (right.type === 'distance' || right.type === 'movement-rate') return right;
      }
      if (left.type !== right.type && !(numeric.includes(left.type) && ['integer', 'decimal'].includes(right.type))) {
        diagnostic(context.diagnostics, 'RULE_EXPRESSION_UNIT_MISMATCH', path, `Cannot ${expression.op} ${left.type} and ${right.type}.`);
      }
      return left.type === 'decimal' || right.type === 'decimal' ? { type: 'decimal' } : left;
    }
    default:
      diagnostic(context.diagnostics, 'RULE_EXPRESSION_OPERATOR_UNKNOWN', `${path}.op`, `Expression operator '${String((expression as any).op)}' is not supported.`);
      return undefined;
  }
}

function validateCondition(condition: Condition, path: string, context: TypeContext): void {
  if (!isRecord(condition)) return diagnostic(context.diagnostics, 'RULE_CONDITION_INVALID', path, 'Condition must be an object.');
  if (condition.op === 'equals') {
    const left = inferExpression(condition.left, `${path}.left`, context);
    const right = inferExpression(condition.right, `${path}.right`, context);
    if (left && right && !typesCompatible(left.type, right.type) && !typesCompatible(right.type, left.type)) diagnostic(context.diagnostics, 'RULE_CONDITION_TYPE_INVALID', path, `Cannot compare ${left.type} with ${right.type}.`);
  } else if (condition.op === 'all' || condition.op === 'any') {
    if (!Array.isArray(condition.conditions) || !condition.conditions.length) diagnostic(context.diagnostics, 'RULE_CONDITION_EMPTY', `${path}.conditions`, 'Condition group cannot be empty.');
    else condition.conditions.forEach((child, index) => validateCondition(child, `${path}.conditions[${index}]`, context));
  } else if (condition.op === 'not') validateCondition(condition.condition, `${path}.condition`, context);
  else diagnostic(context.diagnostics, 'RULE_CONDITION_OPERATOR_UNKNOWN', `${path}.op`, 'Condition operator is not supported.');
}

function expressionDefinitionReferences(expression: Expression): string[] {
  if (expression.op === 'get') return [expression.definitionId];
  if (expression.op === 'floor') return expressionDefinitionReferences(expression.value);
  if (['add', 'subtract', 'multiply', 'divide'].includes(expression.op)) {
    const binary = expression as Extract<Expression, { left: Expression }>;
    return [...expressionDefinitionReferences(binary.left), ...expressionDefinitionReferences(binary.right)];
  }
  return [];
}

function detectDerivedCycles(definitions: CreatureCapabilityDefinition[], diagnostics: Diagnostic[]): void {
  const derived = new Map(definitions.filter((definition) => definition.definitionType === 'derived-value').map((definition) => [definition.definitionId, definition]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (definitionId: string): void => {
    if (active.has(definitionId)) {
      diagnostic(diagnostics, 'RULE_DERIVED_VALUE_CYCLE', `definitions.${definitionId}.expression`, `Derived-value cycle includes '${definitionId}'.`);
      return;
    }
    if (visited.has(definitionId)) return;
    const definition = derived.get(definitionId);
    if (!definition) return;
    active.add(definitionId);
    expressionDefinitionReferences(definition.expression).filter((reference) => derived.has(reference)).forEach(visit);
    active.delete(definitionId);
    visited.add(definitionId);
  };
  derived.forEach((_definition, definitionId) => visit(definitionId));
}

export function compileCreatureCapabilities(inputs: unknown[]): CompilationResult {
  const diagnostics: Diagnostic[] = [];
  const definitions = inputs.filter((input, index): input is CreatureCapabilityDefinition => validateShape(input, index, diagnostics));
  const byId = new Map<string, CreatureCapabilityDefinition>();
  definitions.forEach((definition, index) => {
    if (byId.has(definition.definitionId)) diagnostic(diagnostics, 'RULE_DEFINITION_ID_DUPLICATE', `definitions[${index}].definitionId`, `Definition '${definition.definitionId}' is duplicated.`);
    byId.set(definition.definitionId, definition);
  });

  definitions.forEach((definition, index) => {
    const path = `definitions[${index}]`;
    if (definition.definitionType === 'field') {
      if (definition.defaultValue !== undefined) validateValue(definition.defaultValue, definition.value, `${path}.defaultValue`, diagnostics);
      return;
    }
    if (definition.definitionType === 'derived-value') {
      const actual = inferExpression(definition.expression, `${path}.expression`, { definitions: byId, parameters: new Map(), diagnostics });
      if (actual && !typesCompatible(actual.type, definition.value.type)) diagnostic(diagnostics, 'RULE_DERIVED_VALUE_TYPE_INVALID', `${path}.expression`, `Expression returns ${actual.type}, not ${definition.value.type}.`);
      return;
    }
    const parameters = new Map<string, ValueSchema>();
    (definition.parameters ?? []).forEach((parameter, parameterIndex) => {
      const parameterPath = `${path}.parameters[${parameterIndex}]`;
      if (parameters.has(parameter.parameterId)) diagnostic(diagnostics, 'RULE_PARAMETER_ID_DUPLICATE', `${parameterPath}.parameterId`, `Parameter '${parameter.parameterId}' is duplicated.`);
      parameters.set(parameter.parameterId, parameter.value);
      if (parameter.defaultValue !== undefined) validateValue(parameter.defaultValue, parameter.value, `${parameterPath}.defaultValue`, diagnostics);
      if (parameter.required && parameter.defaultValue === undefined) diagnostics.push({ code: 'RULE_PARAMETER_REQUIRES_APPLICATION_VALUE', path: parameterPath, message: 'Required parameter must be supplied by each trait application.', severity: 'warning' });
    });
    definition.contributes.forEach((contribution, contributionIndex) => {
      const contributionPath = `${path}.contributes[${contributionIndex}]`;
      const contract = CAPABILITY_CONTRACTS[contribution.capability];
      if (!contract) return diagnostic(diagnostics, 'RULE_CAPABILITY_UNKNOWN', `${contributionPath}.capability`, `Capability '${contribution.capability}' is not supported.`);
      for (const required of Object.keys(contract)) {
        if (!contribution.values?.[required]) diagnostic(diagnostics, 'RULE_CAPABILITY_PROPERTY_REQUIRED', `${contributionPath}.values.${required}`, `Capability property '${required}' is required.`);
      }
      for (const [property, expression] of Object.entries(contribution.values ?? {})) {
        if (!contract[property]) {
          diagnostic(diagnostics, 'RULE_CAPABILITY_PROPERTY_UNKNOWN', `${contributionPath}.values.${property}`, `Capability property '${property}' is unknown.`);
          continue;
        }
        const actual = inferExpression(expression, `${contributionPath}.values.${property}`, { definitions: byId, parameters, diagnostics });
        if (actual && !typesCompatible(actual.type, contract[property].type)) diagnostic(diagnostics, 'RULE_CAPABILITY_PROPERTY_TYPE_INVALID', `${contributionPath}.values.${property}`, `Expected ${contract[property].type}; expression returns ${actual.type}.`);
      }
      if (contribution.when) validateCondition(contribution.when, `${contributionPath}.when`, { definitions: byId, parameters, diagnostics });
    });
  });
  detectDerivedCycles(definitions, diagnostics);

  const valid = !diagnostics.some((entry) => entry.severity === 'error');
  if (!valid) return { valid, diagnostics };
  const normalized = [...definitions].sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  return {
    valid,
    diagnostics,
    artifact: {
      artifactVersion: CREATURE_CAPABILITY_ARTIFACT_VERSION,
      metamodelVersion: CREATURE_CAPABILITY_METAMODEL_VERSION,
      sourceHash: createHash('sha256').update(canonicalJson(normalized)).digest('hex'),
      definitions: normalized,
    },
  };
}

export const creatureCapabilityContracts = CAPABILITY_CONTRACTS;
