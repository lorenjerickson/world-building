import { createHash } from 'crypto';
import {
  CompiledResolutionArtifact,
  OperationDefinition,
  OperationStep,
  RESOLUTION_ARTIFACT_VERSION,
  RESOLUTION_METAMODEL_VERSION,
  ResolutionCompilationResult,
  ResolutionCondition,
  ResolutionDefinition,
  ResolutionDiagnostic,
  ResolutionExpression,
} from './resolution.types';
import { deriveOperationSubjectContract } from './resolution.subject-contracts';

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

function validateExpression(value: unknown, path: string, diagnostics: ResolutionDiagnostic[]): value is ResolutionExpression {
  if (!record(value) || typeof value.op !== 'string') {
    add(diagnostics, 'RULE_EXPRESSION_INVALID', path, 'Expression requires a supported operator.');
    return false;
  }
  if (value.op === 'literal') {
    if (!['string', 'number', 'boolean'].includes(typeof value.value)
      || (typeof value.value === 'number' && !Number.isFinite(value.value))) {
      add(diagnostics, 'RULE_EXPRESSION_LITERAL_INVALID', `${path}.value`, 'Literal must be a finite number, string, or boolean.');
      return false;
    }
    return true;
  }
  if (['actor-field', 'target-field', 'input'].includes(value.op)) {
    if (typeof value.key !== 'string' || !value.key.trim()) {
      add(diagnostics, 'RULE_EXPRESSION_FIELD_INVALID', `${path}.key`, 'Field expression requires a non-empty key.');
      return false;
    }
    return true;
  }
  if (value.op === 'trait-instance-field') {
    let valid = true;
    if (typeof value.instanceId !== 'string' || !value.instanceId.trim()) {
      add(diagnostics, 'RULE_EXPRESSION_TRAIT_INSTANCE_INVALID', `${path}.instanceId`, 'Trait-instance expression requires a non-empty instance ID.');
      valid = false;
    }
    if (typeof value.key !== 'string' || !value.key.trim() || value.key.includes('.')) {
      add(diagnostics, 'RULE_EXPRESSION_FIELD_INVALID', `${path}.key`, 'Trait-instance expression requires one direct field key.');
      valid = false;
    }
    return valid;
  }
  if (value.op === 'trait-path-field') {
    if (typeof value.path !== 'string' || !value.path.trim()) {
      add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_INVALID', `${path}.path`, 'Trait-path expression requires a non-empty path.');
      return false;
    }
    const segments = value.path.split('.').map((segment) => segment.trim());
    const repeated = segments.filter((segment) => segment.endsWith('[]'));
    let valid = true;
    if (segments[0] !== 'self' || segments.length < 2 || segments.some((segment) => !/^[a-zA-Z0-9_-]+(?:\[\])?$/.test(segment))) {
      add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_INVALID', `${path}.path`, "Trait paths must begin with 'self' and contain valid named segments.");
      valid = false;
    }
    const validateSelector = (selector: unknown, selectorPath: string): boolean => {
      if (!record(selector)) {
        add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_INVALID', selectorPath, 'A scalar path selector must be an object.');
        return false;
      }
      if (selector.mode === 'ordinal') {
        if (!Number.isInteger(selector.ordinal) || Number(selector.ordinal) < 1) {
          add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_INVALID', `${selectorPath}.ordinal`, 'Ordinal selectors require a positive whole number.');
          return false;
        }
        return true;
      }
      if (selector.mode === 'trait') {
        if (typeof selector.traitId !== 'string' || !selector.traitId.trim()) {
          add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_INVALID', `${selectorPath}.traitId`, 'Trait selectors require a stable trait identity.');
          return false;
        }
        return true;
      }
      if (selector.mode === 'tag') {
        if (typeof selector.tag !== 'string' || !selector.tag.trim()) {
          add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_INVALID', `${selectorPath}.tag`, 'Semantic-tag selectors require a non-empty tag.');
          return false;
        }
        return true;
      }
      if (selector.mode === 'all' || selector.mode === 'wildcard') {
        add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_COLLECTION_RESULT_INVALID', `${selectorPath}.mode`, 'Scalar trait fields must select one collection entry; use a collection-valued operation for all entries.');
        return false;
      }
      add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_INVALID', `${selectorPath}.mode`, 'Scalar paths support ordinal, trait-identity, or semantic-tag selectors; wildcard results are collections.');
      return false;
    };
    if (repeated.length) {
      if (value.mountSelector !== undefined && value.mountSelectors !== undefined) {
        add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_AMBIGUOUS', `${path}.mountSelectors`, 'Use either mountSelector or mountSelectors, not both.');
        valid = false;
      } else if (value.mountSelector !== undefined) {
        if (repeated.length !== 1 || !validateSelector(value.mountSelector, `${path}.mountSelector`)) valid = false;
      } else if (!Array.isArray(value.mountSelectors) || value.mountSelectors.length !== repeated.length) {
        add(
          diagnostics,
          repeated.length === 1
            ? 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_REQUIRED'
            : 'RULE_EXPRESSION_TRAIT_PATH_SELECTORS_REQUIRED',
          repeated.length === 1 ? `${path}.mountSelector` : `${path}.mountSelectors`,
          repeated.length === 1
            ? 'A repeated trait path requires one scalar mount selector.'
            : `A scalar path with ${repeated.length} repeated segments requires ${repeated.length} ordered selectors.`,
        );
        valid = false;
      } else {
        value.mountSelectors.forEach((selector, index) => {
          if (!validateSelector(selector, `${path}.mountSelectors[${index}]`)) valid = false;
        });
      }
    } else if (value.mountSelector !== undefined || value.mountSelectors !== undefined) {
      add(diagnostics, 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_UNUSED', `${path}.mountSelectors`, 'Selectors require a repeated [] path segment.');
      valid = false;
    }
    return valid;
  }
  if (value.op === 'result') {
    if (typeof value.key !== 'string' || !value.key.trim() || typeof value.property !== 'string' || !value.property.trim()) {
      add(diagnostics, 'RULE_EXPRESSION_RESULT_INVALID', path, 'Result expression requires non-empty result and property keys.');
      return false;
    }
    return true;
  }
  if (['add', 'subtract', 'multiply', 'divide'].includes(value.op)) {
    const left = validateExpression(value.left, `${path}.left`, diagnostics);
    const right = validateExpression(value.right, `${path}.right`, diagnostics);
    return left && right;
  }
  add(diagnostics, 'RULE_EXPRESSION_OPERATOR_INVALID', `${path}.op`, `Expression operator '${value.op}' is unsupported.`);
  return false;
}

function validateCondition(value: unknown, path: string, diagnostics: ResolutionDiagnostic[]): value is ResolutionCondition {
  if (!record(value) || typeof value.op !== 'string') {
    add(diagnostics, 'RULE_CONDITION_INVALID', path, 'Condition requires a supported operator.');
    return false;
  }
  if (value.op === 'all' || value.op === 'any') {
    if (!Array.isArray(value.conditions) || !value.conditions.length) {
      add(diagnostics, 'RULE_CONDITION_INVALID', `${path}.conditions`, `${value.op} requires one or more conditions.`);
      return false;
    }
    return value.conditions.map((item, index) =>
      validateCondition(item, `${path}.conditions[${index}]`, diagnostics)).every(Boolean);
  }
  if (value.op === 'not') return validateCondition(value.condition, `${path}.condition`, diagnostics);
  if (['equals', 'gte', 'lte'].includes(value.op)) {
    const left = validateExpression(value.left, `${path}.left`, diagnostics);
    const right = validateExpression(value.right, `${path}.right`, diagnostics);
    return left && right;
  }
  add(diagnostics, 'RULE_CONDITION_OPERATOR_INVALID', `${path}.op`, `Condition operator '${value.op}' is unsupported.`);
  return false;
}

function validateDiePool(value: unknown, path: string, diagnostics: ResolutionDiagnostic[], requireCount = true): void {
  if (!record(value)) return add(diagnostics, 'RULE_CHECK_DICE_INVALID', path, 'Die selection must be an object.');
  if (typeof value.dieTraitId !== 'string' || !value.dieTraitId.trim()) {
    add(diagnostics, 'RULE_DIE_TRAIT_REQUIRED', `${path}.dieTraitId`, 'Reusable dice require a die trait selection.');
  }
  if (requireCount && (!Number.isInteger(value.count) || Number(value.count) < 1)) {
    add(diagnostics, 'RULE_CHECK_DICE_INVALID', `${path}.count`, 'Die count must be a positive integer.');
  }
  if (!Number.isInteger(value.sides) || Number(value.sides) < 1) {
    add(diagnostics, 'RULE_CHECK_DICE_INVALID', `${path}.sides`, 'Compiled die sides must be a positive integer.');
  }
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
    if (step.kind === 'validate') validateCondition(step.condition, `${path}.steps[${index}].condition`, diagnostics);
    if (step.kind === 'consume-resource') validateExpression(step.amount, `${path}.steps[${index}].amount`, diagnostics);
    if (step.kind === 'emit-event') {
      Object.entries(step.payload ?? {}).forEach(([key, value]) =>
        validateExpression(value, `${path}.steps[${index}].payload.${key}`, diagnostics));
    }
    if (step.kind === 'return') {
      Object.entries(step.data ?? {}).forEach(([key, value]) =>
        validateExpression(value, `${path}.steps[${index}].data.${key}`, diagnostics));
    }
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
    if (definition.subjectTraitIds !== undefined
      && (!Array.isArray(definition.subjectTraitIds)
        || !definition.subjectTraitIds.length
        || definition.subjectTraitIds.some((traitId) =>
          typeof traitId !== 'string'
          || !/^trait:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(traitId)))) {
      add(diagnostics, 'RULE_SUBJECT_TRAITS_INVALID', `${path}.subjectTraitIds`, 'Subject traits must be a non-empty list of stable trait IDs.');
    }
    if (definition.subjectTraitSelections !== undefined
      && (!record(definition.subjectTraitSelections)
        || !Object.keys(definition.subjectTraitSelections).length
        || Object.entries(definition.subjectTraitSelections).some(([ownerTraitId, selectedTraitIds]) =>
          !/^trait:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ownerTraitId)
          || !Array.isArray(selectedTraitIds)
          || !selectedTraitIds.length
          || selectedTraitIds.some((traitId) =>
            typeof traitId !== 'string'
            || !/^trait:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(traitId))))) {
      add(diagnostics, 'RULE_SUBJECT_TRAIT_SELECTIONS_INVALID', `${path}.subjectTraitSelections`, 'Subject trait selections must map stable trait IDs to non-empty lists of stable trait IDs.');
    }
    if (definition.definitionType === 'operation') validateOperation(definition, byId, path, diagnostics);
    if (definition.definitionType === 'check') {
      validateExpression(definition.bonus, `${path}.bonus`, diagnostics);
      validateExpression(definition.target, `${path}.target`, diagnostics);
      if (!record(definition.roll)) {
        add(diagnostics, 'RULE_CHECK_DICE_INVALID', `${path}.roll`, 'Check requires a die selection.');
      } else if ('dice' in definition.roll) {
        if (definition.roll.rollTraitId !== undefined
          && (typeof definition.roll.rollTraitId !== 'string' || !definition.roll.rollTraitId.trim())) {
          add(diagnostics, 'RULE_ROLL_TRAIT_INVALID', `${path}.roll.rollTraitId`, 'Roll trait ID must be a non-empty stable trait reference.');
        }
        if (!Array.isArray(definition.roll.dice) || !definition.roll.dice.length) {
          add(diagnostics, 'RULE_CHECK_DICE_INVALID', `${path}.roll.dice`, 'Check requires at least one die selection.');
        } else {
          definition.roll.dice.forEach((die, dieIndex) => validateDiePool(die, `${path}.roll.dice[${dieIndex}]`, diagnostics));
        }
      } else if (!Number.isInteger(definition.roll.count) || definition.roll.count < 1 || !Number.isInteger(definition.roll.sides) || definition.roll.sides < 1) {
        add(diagnostics, 'RULE_CHECK_DICE_INVALID', `${path}.roll`, 'Legacy check dice require positive count and sides.');
      }
    }
    if (definition.definitionType === 'modifier') {
      if (definition.when !== undefined) validateCondition(definition.when, `${path}.when`, diagnostics);
      if (definition.activatedByTraitIds !== undefined
        && (!Array.isArray(definition.activatedByTraitIds)
          || !definition.activatedByTraitIds.length
          || definition.activatedByTraitIds.some((traitId) => typeof traitId !== 'string' || !traitId.trim()))) {
        add(diagnostics, 'RULE_MODIFIER_ACTIVATING_TRAITS_INVALID', `${path}.activatedByTraitIds`, 'Activating traits must be a non-empty list of stable trait IDs.');
      }
      if (definition.targetCheckId && definition.appliesTo) {
        add(diagnostics, 'RULE_MODIFIER_TARGET_AMBIGUOUS', path, 'Choose either one legacy targetCheckId or semantic appliesTo targeting, not both.');
      } else if (definition.targetCheckId) {
        const target = byId.get(definition.targetCheckId);
        if (!target) add(diagnostics, 'RULE_REFERENCE_UNRESOLVED', `${path}.targetCheckId`, `Check '${definition.targetCheckId}' is not in this draft validation set.`, 'warning');
        else if (target.definitionType !== 'check') add(diagnostics, 'RULE_REFERENCE_TYPE_INVALID', `${path}.targetCheckId`, `'${definition.targetCheckId}' is not a check.`);
      } else if (!record(definition.appliesTo)) {
        add(diagnostics, 'RULE_MODIFIER_TARGET_REQUIRED', `${path}.appliesTo`, 'Modifier requires a specific check or an explicit semantic roll target.');
      } else {
        const appliesTo = definition.appliesTo;
        const checkIds = Array.isArray(appliesTo.checkIds) ? appliesTo.checkIds : [];
        const rollKinds = Array.isArray(appliesTo.rollKinds) ? appliesTo.rollKinds : [];
        const rollTraitIds = Array.isArray(appliesTo.rollTraitIds) ? appliesTo.rollTraitIds : [];
        const hasInvalidList = [
          ['checkIds', appliesTo.checkIds],
          ['rollKinds', appliesTo.rollKinds],
          ['rollTraitIds', appliesTo.rollTraitIds],
        ].some(([field, value]) => {
          if (value === undefined || (Array.isArray(value) && value.length && value.every((item) => typeof item === 'string' && item.trim()))) return false;
          add(diagnostics, 'RULE_MODIFIER_TARGET_LIST_INVALID', `${path}.appliesTo.${String(field)}`, 'Semantic target lists require at least one non-empty value.');
          return true;
        });
        if (appliesTo.allRolls === true) {
          if (checkIds.length || rollKinds.length || rollTraitIds.length) {
            add(diagnostics, 'RULE_MODIFIER_TARGET_AMBIGUOUS', `${path}.appliesTo`, 'allRolls cannot be combined with narrower semantic targets.');
          }
        } else if (!hasInvalidList && !checkIds.length && !rollKinds.length && !rollTraitIds.length) {
          add(diagnostics, 'RULE_MODIFIER_TARGET_REQUIRED', `${path}.appliesTo`, 'Semantic targeting requires checkIds, rollKinds, rollTraitIds, or allRolls.');
        }
        rollKinds.forEach((kind, kindIndex) => {
          if (!['saving', 'hit', 'damage', 'other'].includes(kind)) {
            add(diagnostics, 'RULE_MODIFIER_ROLL_KIND_INVALID', `${path}.appliesTo.rollKinds[${kindIndex}]`, `Roll kind '${kind}' is unsupported.`);
          }
        });
        checkIds.forEach((checkId, checkIndex) => {
          const target = byId.get(checkId);
          if (!target) add(diagnostics, 'RULE_REFERENCE_UNRESOLVED', `${path}.appliesTo.checkIds[${checkIndex}]`, `Check '${checkId}' is not in this draft validation set.`, 'warning');
          else if (target.definitionType !== 'check') add(diagnostics, 'RULE_REFERENCE_TYPE_INVALID', `${path}.appliesTo.checkIds[${checkIndex}]`, `'${checkId}' is not a check.`);
        });
      }
      if (definition.modifierKind === 'roll-result') {
        if (definition.priority !== undefined && !Number.isInteger(definition.priority)) {
          add(diagnostics, 'RULE_ROLL_MODIFIER_PRIORITY_INVALID', `${path}.priority`, 'Roll modifier priority must be an integer.');
        }
        if (!record(definition.rollOperation)) {
          add(diagnostics, 'RULE_ROLL_OPERATION_INVALID', `${path}.rollOperation`, 'Roll-result modifier requires an operation.');
        } else if (definition.rollOperation.kind === 'add-dice') {
          validateDiePool(definition.rollOperation.dice, `${path}.rollOperation.dice`, diagnostics);
          if (definition.selector) add(diagnostics, 'RULE_ROLL_SELECTOR_UNUSED', `${path}.selector`, 'Add-dice modifiers target the check and cannot select existing dice.');
        } else if (definition.rollOperation.kind === 'replace-result') {
          validateDiePool(definition.rollOperation.die, `${path}.rollOperation.die`, diagnostics, false);
          if (definition.rollOperation.maximumApplications !== undefined
            && (!Number.isInteger(definition.rollOperation.maximumApplications) || definition.rollOperation.maximumApplications < 1)) {
            add(diagnostics, 'RULE_ROLL_REPLACEMENT_LIMIT_INVALID', `${path}.rollOperation.maximumApplications`, 'Replacement limit must be a positive integer.');
          }
        } else if (definition.rollOperation.kind === 'increase-result') {
          if (!record(definition.rollOperation.value)) add(diagnostics, 'RULE_ROLL_VALUE_INVALID', `${path}.rollOperation.value`, 'Result increase requires an expression.');
          else validateExpression(definition.rollOperation.value, `${path}.rollOperation.value`, diagnostics);
        } else {
          add(diagnostics, 'RULE_ROLL_OPERATION_INVALID', `${path}.rollOperation.kind`, 'Roll-result operation is unsupported.');
        }
      } else if (!['add', 'multiply'].includes(definition.operation) || !record(definition.value)) {
        add(diagnostics, 'RULE_MODIFIER_INVALID', path, 'Total modifier requires add or multiply and a value expression.');
      } else validateExpression(definition.value, `${path}.value`, diagnostics);
    }
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
    operationSubjectContracts: Object.fromEntries(
      normalized
        .filter((definition): definition is OperationDefinition => definition.definitionType === 'operation')
        .map((operation) => [
          operation.definitionId,
          deriveOperationSubjectContract(operation, normalized),
        ]),
    ),
  };
  return { valid, diagnostics, artifact };
}
