import { createHash } from 'crypto';
import {
  CompiledResolutionArtifact,
  OperationDefinition,
  OperationStep,
  RESOLUTION_ARTIFACT_VERSION,
  RESOLUTION_METAMODEL_VERSION,
  ResolutionCompilationResult,
  ResolutionDefinition,
  ResolutionDiagnostic,
} from './resolution.types';

const definitionTypes = ['modifier', 'check', 'resource', 'effect', 'event', 'operation'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function add(diagnostics: ResolutionDiagnostic[], code: string, path: string, message: string, severity: 'error' | 'warning' = 'error'): void {
  diagnostics.push({ code, path, message, severity });
}

function references(step: OperationStep): Array<{ id: string; type: ResolutionDefinition['definitionType']; path: string }> {
  if (step.kind === 'consume-resource') return [{ id: step.resourceId, type: 'resource', path: 'resourceId' }];
  if (step.kind === 'perform-check') return [{ id: step.checkId, type: 'check', path: 'checkId' }];
  if (step.kind === 'apply-effect') return [{ id: step.effectId, type: 'effect', path: 'effectId' }];
  if (step.kind === 'emit-event') return [{ id: step.eventId, type: 'event', path: 'eventId' }];
  return [];
}

function successors(step: OperationStep): string[] {
  if (step.kind === 'return') return [];
  if (step.kind === 'perform-check') return [step.onSuccess, step.onFailure];
  return [step.next];
}

function validateOperation(operation: OperationDefinition, byId: Map<string, ResolutionDefinition>, path: string, diagnostics: ResolutionDiagnostic[]): void {
  if (!Array.isArray(operation.steps) || !operation.steps.length) return add(diagnostics, 'RULE_OPERATION_STEPS_REQUIRED', `${path}.steps`, 'Operation requires at least one step.');
  if (!Number.isInteger(operation.budget?.maximumSteps) || operation.budget.maximumSteps < 1 || operation.budget.maximumSteps > 256) add(diagnostics, 'RULE_OPERATION_BUDGET_INVALID', `${path}.budget.maximumSteps`, 'Maximum steps must be between 1 and 256.');
  const steps = new Map<string, OperationStep>();
  operation.steps.forEach((step, index) => {
    if (!record(step) || typeof step.stepId !== 'string' || typeof step.kind !== 'string') {
      add(diagnostics, 'RULE_OPERATION_STEP_INVALID', `${path}.steps[${index}]`, 'Step requires a stable stepId and kind.');
      return;
    }
    if (steps.has(step.stepId)) add(diagnostics, 'RULE_OPERATION_STEP_DUPLICATE', `${path}.steps[${index}].stepId`, `Step '${step.stepId}' is duplicated.`);
    steps.set(step.stepId, step);
    references(step).forEach((reference) => {
      const target = byId.get(reference.id);
      if (!target) add(diagnostics, 'RULE_REFERENCE_UNRESOLVED', `${path}.steps[${index}].${reference.path}`, `Referenced ${reference.type} '${reference.id}' is not in this draft validation set.`, 'warning');
      else if (target.definitionType !== reference.type) add(diagnostics, 'RULE_REFERENCE_TYPE_INVALID', `${path}.steps[${index}].${reference.path}`, `Expected ${reference.type}; '${reference.id}' is ${target.definitionType}.`);
    });
  });
  if (!steps.has(operation.startStepId)) add(diagnostics, 'RULE_OPERATION_START_MISSING', `${path}.startStepId`, `Start step '${operation.startStepId}' does not exist.`);
  const active = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (active.has(stepId)) return add(diagnostics, 'RULE_OPERATION_CYCLE', `${path}.steps.${stepId}`, `Operation pipeline contains a cycle at '${stepId}'.`);
    if (visited.has(stepId)) return;
    const step = steps.get(stepId);
    if (!step) return add(diagnostics, 'RULE_OPERATION_CONNECTION_MISSING', `${path}.steps.${stepId}`, `Connected step '${stepId}' does not exist.`);
    active.add(stepId);
    successors(step).forEach(visit);
    active.delete(stepId);
    visited.add(stepId);
  };
  if (steps.has(operation.startStepId)) visit(operation.startStepId);
  operation.steps.forEach((step, index) => {
    if (!visited.has(step.stepId)) add(diagnostics, 'RULE_OPERATION_STEP_UNREACHABLE', `${path}.steps[${index}]`, `Step '${step.stepId}' is unreachable.`, 'warning');
  });
}

export function compileResolutionDefinitions(inputs: unknown[]): ResolutionCompilationResult {
  const diagnostics: ResolutionDiagnostic[] = [];
  const definitions: ResolutionDefinition[] = [];
  inputs.forEach((input, index) => {
    const path = `definitions[${index}]`;
    if (!record(input)) return add(diagnostics, 'RULE_DEFINITION_INVALID', path, 'Definition must be an object.');
    if (input.formatVersion !== '1' || input.metamodelVersion !== RESOLUTION_METAMODEL_VERSION) add(diagnostics, 'RULE_RESOLUTION_VERSION_INVALID', path, `Resolution definitions require ${RESOLUTION_METAMODEL_VERSION}.`);
    if (!definitionTypes.includes(String(input.definitionType))) return add(diagnostics, 'RULE_DEFINITION_TYPE_UNKNOWN', `${path}.definitionType`, 'Resolution definition type is unsupported.');
    if (typeof input.definitionId !== 'string' || !/^(modifier|check|resource|effect|event|operation):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.definitionId)) add(diagnostics, 'RULE_DEFINITION_ID_INVALID', `${path}.definitionId`, 'Definition requires a stable typed ID.');
    if (typeof input.name !== 'string' || !input.name.trim()) add(diagnostics, 'RULE_NAME_REQUIRED', `${path}.name`, 'Definition name is required.');
    definitions.push(input as unknown as ResolutionDefinition);
  });
  const byId = new Map<string, ResolutionDefinition>();
  definitions.forEach((definition, index) => {
    if (byId.has(definition.definitionId)) add(diagnostics, 'RULE_DEFINITION_ID_DUPLICATE', `definitions[${index}].definitionId`, `Definition '${definition.definitionId}' is duplicated.`);
    byId.set(definition.definitionId, definition);
  });
  definitions.forEach((definition, index) => {
    const path = `definitions[${index}]`;
    if (definition.definitionType === 'operation') validateOperation(definition, byId, path, diagnostics);
    if (definition.definitionType === 'check' && (!Number.isInteger(definition.roll?.count) || definition.roll.count < 1 || !Number.isInteger(definition.roll?.sides) || definition.roll.sides < 2)) add(diagnostics, 'RULE_CHECK_DICE_INVALID', `${path}.roll`, 'Check dice require positive count and at least two sides.');
    if (definition.definitionType === 'resource' && (definition.minimum > definition.capacity || definition.minimum < 0)) add(diagnostics, 'RULE_RESOURCE_BOUNDS_INVALID', path, 'Resource minimum must be non-negative and no greater than capacity.');
    if (definition.definitionType === 'effect') (definition.modifierIds ?? []).forEach((id, modifierIndex) => {
      const target = byId.get(id);
      if (!target) add(diagnostics, 'RULE_REFERENCE_UNRESOLVED', `${path}.modifierIds[${modifierIndex}]`, `Modifier '${id}' is not in this draft validation set.`, 'warning');
      else if (target.definitionType !== 'modifier') add(diagnostics, 'RULE_REFERENCE_TYPE_INVALID', `${path}.modifierIds[${modifierIndex}]`, `'${id}' is not a modifier.`);
    });
  });
  const valid = !diagnostics.some((item) => item.severity === 'error');
  if (!valid) return { valid, diagnostics };
  const normalized = [...definitions].sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  const artifact: CompiledResolutionArtifact = {
    artifactVersion: RESOLUTION_ARTIFACT_VERSION,
    metamodelVersion: RESOLUTION_METAMODEL_VERSION,
    sourceHash: createHash('sha256').update(canonical(normalized)).digest('hex'),
    definitions: normalized,
  };
  return { valid, diagnostics, artifact };
}
