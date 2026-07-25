import { RESOLUTION_METAMODEL_VERSION } from './resolution.types';

const common = [
  { fieldId: 'definitionId', path: 'definitionId', label: 'Stable ID', control: 'stable-id', required: true },
  { fieldId: 'name', path: 'name', label: 'Name', control: 'text', required: true },
  { fieldId: 'description', path: 'description', label: 'Description', control: 'textarea', required: false },
  { fieldId: 'subjectTraitIds', path: 'subjectTraitIds', label: 'Self contract', control: 'definition-reference-list', referenceType: 'trait', required: false },
  { fieldId: 'subjectTraitSelections', path: 'subjectTraitSelections', label: 'Required self branches', control: 'trait-prerequisite-selections', referenceType: 'trait', required: false },
];

export const resolutionDefinitionDescriptors: Record<string, object> = {
  modifier: {
    definitionType: 'modifier',
    label: 'Modifier',
    help: 'Adjust a final check total or add, replace, and increase individual die results with preserved provenance.',
    modes: ['total', 'add-dice', 'replace-result', 'increase-result'],
    fields: [
      ...common,
      { fieldId: 'targetCheckId', path: 'targetCheckId', label: 'Target check', control: 'definition-reference', referenceType: 'check', required: false },
      { fieldId: 'appliesTo', path: 'appliesTo', label: 'Semantic roll target', control: 'roll-target', options: ['all-rolls', 'check', 'roll-kind', 'roll-trait'], required: false },
      { fieldId: 'activatedByTraitIds', path: 'activatedByTraitIds', label: 'Activating traits', control: 'definition-reference-list', referenceType: 'trait', required: false },
      { fieldId: 'modifierKind', path: 'modifierKind', label: 'What changes', control: 'select', options: ['total', 'roll-result'], required: true },
      { fieldId: 'operation', path: 'operation', label: 'Adjustment', control: 'select', options: ['add', 'multiply'], required: false },
      { fieldId: 'rollOperation', path: 'rollOperation', label: 'Die-result operation', control: 'roll-result-operation', options: ['add-dice', 'replace-result', 'increase-result'], required: false },
      { fieldId: 'dieTraitId', path: 'rollOperation.dieTraitId', label: 'Die', control: 'compatible-trait-reference', acceptedTraits: ['trait:die'], required: false },
      { fieldId: 'value', path: 'value', label: 'Value', control: 'expression-builder', required: false },
    ],
  },
  check: { definitionType: 'check', label: 'Check', help: 'A deterministic comparison using explicit recorded entropy and either reusable dice or a complete Dice Roll trait.', fields: [...common, { fieldId: 'rollTraitId', path: 'roll.rollTraitId', label: 'Dice Roll trait', control: 'trait-with-compatible-collection', acceptedTraits: ['trait:die'], required: false }, { fieldId: 'roll', path: 'roll.dice', label: 'Normalized dice', control: 'compatible-trait-collection', acceptedTraits: ['trait:die'], required: true }, { fieldId: 'rollKind', path: 'roll.rollKind', label: 'Purpose', control: 'select', options: ['saving', 'hit', 'damage', 'other'], required: true }, { fieldId: 'bonus', path: 'bonus', label: 'Bonus', control: 'expression-builder', required: true }, { fieldId: 'target', path: 'target', label: 'Target', control: 'expression-builder', required: true }] },
  resource: { definitionType: 'resource', label: 'Resource', help: 'A bounded quantity consumed by operations.', fields: [...common, { fieldId: 'capacity', path: 'capacity', label: 'Capacity', control: 'number', required: true }, { fieldId: 'refresh', path: 'refresh', label: 'Refresh', control: 'select', options: ['manual', 'encounter', 'turn'], required: true }] },
  effect: { definitionType: 'effect', label: 'Effect', help: 'A bounded state contribution applied by an operation.', fields: [...common, { fieldId: 'duration', path: 'duration', label: 'Duration', control: 'duration', required: true }, { fieldId: 'modifierIds', path: 'modifierIds', label: 'Modifiers', control: 'definition-reference-list', referenceType: 'modifier', required: false }] },
  event: { definitionType: 'event', label: 'Event', help: 'A typed semantic fact emitted by resolution.', fields: [...common, { fieldId: 'visibility', path: 'visibility', label: 'Visibility', control: 'select', options: ['public', 'gm'], required: true }, { fieldId: 'payload', path: 'payload', label: 'Payload fields', control: 'typed-field-list', required: true }] },
  operation: { definitionType: 'operation', label: 'Operation', help: 'A bounded acyclic pipeline of approved gameplay steps.', fields: [...common, { fieldId: 'startStepId', path: 'startStepId', label: 'Starting step', control: 'pipeline-entry', required: true }, { fieldId: 'steps', path: 'steps', label: 'Resolution pipeline', control: 'resolution-pipeline', required: true }, { fieldId: 'budget', path: 'budget', label: 'Execution budget', control: 'step-budget', required: true }] },
};

export const resolutionMetamodelDescriptor = {
  metamodelVersion: RESOLUTION_METAMODEL_VERSION,
  definitionTypes: Object.keys(resolutionDefinitionDescriptors),
  expressionOperators: ['literal', 'actor-field', 'target-field', 'trait-instance-field', 'trait-path-field', 'input', 'result', 'add', 'subtract', 'multiply', 'divide'],
  conditionOperators: ['equals', 'gte', 'lte', 'all', 'any', 'not'],
  operationStepKinds: ['validate', 'consume-resource', 'perform-check', 'apply-effect', 'emit-event', 'return'],
  rollKinds: ['saving', 'hit', 'damage', 'other'],
  rollResultOperations: ['add-dice', 'replace-result', 'increase-result'],
  modifierTargetKinds: ['all-rolls', 'check', 'roll-kind', 'roll-trait'],
  maximumPipelineSteps: 256,
};
