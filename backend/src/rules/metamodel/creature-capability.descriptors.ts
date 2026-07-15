import { creatureCapabilityContracts } from './creature-capability.compiler';
import { CREATURE_CAPABILITY_METAMODEL_VERSION } from './creature-capability.types';

export type CreatureDefinitionType = 'field' | 'derived-value' | 'trait';

const common = [
  { fieldId: 'definitionId', path: 'definitionId', label: 'Stable ID', control: 'stable-id', valueType: 'text', required: true, level: 'basic', affects: ['runtime', 'migration'] },
  { fieldId: 'name', path: 'name', label: 'Name', control: 'text', valueType: 'text', required: true, level: 'basic', affects: ['runtime', 'generation', 'presentation'] },
  { fieldId: 'description', path: 'description', label: 'Description', control: 'textarea', valueType: 'text', required: false, level: 'basic', affects: ['generation', 'presentation'] },
];

export const creatureDefinitionDescriptors: Record<CreatureDefinitionType, object> = {
  field: {
    definitionType: 'field',
    label: 'Field',
    help: 'A typed value stored on, or supplied for, a creature.',
    fields: [...common,
      { fieldId: 'value', path: 'value', label: 'Value type', control: 'value-schema', valueType: 'value-schema', required: true, level: 'basic', affects: ['runtime', 'migration'] },
      { fieldId: 'defaultValue', path: 'defaultValue', label: 'Default value', control: 'typed-value', valueTypeFrom: 'value', required: false, level: 'basic', affects: ['runtime', 'generation'] },
    ],
  },
  'derived-value': {
    definitionType: 'derived-value',
    label: 'Derived value',
    help: 'A read-only typed value calculated from other values.',
    fields: [...common,
      { fieldId: 'value', path: 'value', label: 'Result type', control: 'value-schema', valueType: 'value-schema', required: true, level: 'basic', affects: ['runtime', 'migration'] },
      { fieldId: 'expression', path: 'expression', label: 'Calculation', control: 'expression-builder', valueType: 'expression', required: true, level: 'basic', affects: ['runtime', 'generation'] },
    ],
  },
  trait: {
    definitionType: 'trait',
    label: 'Trait',
    help: 'A reusable creature capability with optional application-time parameters.',
    fields: [...common,
      { fieldId: 'parameters', path: 'parameters', label: 'Parameters', control: 'parameter-list', valueType: 'parameter-list', required: false, level: 'basic', affects: ['runtime', 'generation'] },
      { fieldId: 'contributes', path: 'contributes', label: 'Capabilities', control: 'capability-contribution-list', valueType: 'capability-contribution-list', required: true, level: 'basic', affects: ['runtime', 'generation'] },
    ],
    semanticFrames: [
      { frameId: 'trait-perception', sentence: '[Trait] allows [its holder] to [perceive] up to [distance] in [environment].' },
      { frameId: 'trait-movement', sentence: '[Trait] allows [its holder] to move by [mode] at [rate expression].' },
    ],
  },
};

export const creatureCapabilityMetamodelDescriptor = {
  metamodelVersion: CREATURE_CAPABILITY_METAMODEL_VERSION,
  definitionTypes: Object.keys(creatureDefinitionDescriptors),
  valueTypes: ['boolean', 'integer', 'decimal', 'text', 'distance', 'movement-rate'],
  units: ['meter', 'meter-per-turn'],
  expressionOperators: ['literal', 'parameter', 'get', 'capability', 'add', 'subtract', 'multiply', 'divide', 'floor'],
  conditionOperators: ['equals', 'all', 'any', 'not'],
  capabilityContracts: creatureCapabilityContracts,
};

export function getCreatureDefinitionDescriptor(type: string): object | undefined {
  return creatureDefinitionDescriptors[type as CreatureDefinitionType];
}
