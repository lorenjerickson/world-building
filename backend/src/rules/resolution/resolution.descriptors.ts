import { RESOLUTION_METAMODEL_VERSION } from './resolution.types';

const common = [
  { fieldId: 'definitionId', path: 'definitionId', label: 'Stable ID', control: 'stable-id', required: true },
  { fieldId: 'name', path: 'name', label: 'Name', control: 'text', required: true },
  { fieldId: 'description', path: 'description', label: 'Description', control: 'textarea', required: false },
];

export const resolutionDefinitionDescriptors: Record<string, object> = {
  modifier: { definitionType: 'modifier', label: 'Modifier', help: 'A conditional numeric adjustment to a check.', fields: [...common, { fieldId: 'targetCheckId', path: 'targetCheckId', label: 'Target check', control: 'definition-reference', referenceType: 'check', required: true }, { fieldId: 'operation', path: 'operation', label: 'Adjustment', control: 'select', options: ['add', 'multiply'], required: true }, { fieldId: 'value', path: 'value', label: 'Value', control: 'expression-builder', required: true }] },
  check: { definitionType: 'check', label: 'Check', help: 'A deterministic comparison using explicit recorded entropy.', fields: [...common, { fieldId: 'roll', path: 'roll', label: 'Roll', control: 'dice', required: true }, { fieldId: 'bonus', path: 'bonus', label: 'Bonus', control: 'expression-builder', required: true }, { fieldId: 'target', path: 'target', label: 'Target', control: 'expression-builder', required: true }] },
  resource: { definitionType: 'resource', label: 'Resource', help: 'A bounded quantity consumed by operations.', fields: [...common, { fieldId: 'capacity', path: 'capacity', label: 'Capacity', control: 'number', required: true }, { fieldId: 'refresh', path: 'refresh', label: 'Refresh', control: 'select', options: ['manual', 'encounter', 'turn'], required: true }] },
  effect: { definitionType: 'effect', label: 'Effect', help: 'A bounded state contribution applied by an operation.', fields: [...common, { fieldId: 'duration', path: 'duration', label: 'Duration', control: 'duration', required: true }, { fieldId: 'modifierIds', path: 'modifierIds', label: 'Modifiers', control: 'definition-reference-list', referenceType: 'modifier', required: false }] },
  event: { definitionType: 'event', label: 'Event', help: 'A typed semantic fact emitted by resolution.', fields: [...common, { fieldId: 'visibility', path: 'visibility', label: 'Visibility', control: 'select', options: ['public', 'gm'], required: true }, { fieldId: 'payload', path: 'payload', label: 'Payload fields', control: 'typed-field-list', required: true }] },
  operation: { definitionType: 'operation', label: 'Operation', help: 'A bounded acyclic pipeline of approved gameplay steps.', fields: [...common, { fieldId: 'startStepId', path: 'startStepId', label: 'Starting step', control: 'pipeline-entry', required: true }, { fieldId: 'steps', path: 'steps', label: 'Resolution pipeline', control: 'resolution-pipeline', required: true }, { fieldId: 'budget', path: 'budget', label: 'Execution budget', control: 'step-budget', required: true }] },
};

export const resolutionMetamodelDescriptor = {
  metamodelVersion: RESOLUTION_METAMODEL_VERSION,
  definitionTypes: Object.keys(resolutionDefinitionDescriptors),
  expressionOperators: ['literal', 'actor-field', 'target-field', 'input', 'result', 'add', 'subtract', 'multiply', 'divide'],
  conditionOperators: ['equals', 'gte', 'lte', 'all', 'any', 'not'],
  operationStepKinds: ['validate', 'consume-resource', 'perform-check', 'apply-effect', 'emit-event', 'return'],
  maximumPipelineSteps: 256,
};
