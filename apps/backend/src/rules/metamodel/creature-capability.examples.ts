import { CreatureCapabilityDefinition } from './creature-capability.types';

const base = {
  formatVersion: '1' as const,
  metamodelVersion: 'creature-capabilities/1' as const,
};

export const creatureCapabilityExamples: CreatureCapabilityDefinition[] = [
  {
    ...base,
    definitionId: 'field:walking-speed',
    definitionType: 'field',
    name: 'Walking Speed',
    value: { type: 'movement-rate', unit: 'meter-per-turn', minimum: 0 },
    defaultValue: 6,
  },
  {
    ...base,
    definitionId: 'derived:running-speed',
    definitionType: 'derived-value',
    name: 'Running Speed',
    value: { type: 'movement-rate', unit: 'meter-per-turn', minimum: 0 },
    expression: {
      op: 'multiply',
      left: { op: 'get', definitionId: 'field:walking-speed' },
      right: { op: 'literal', value: 2, valueType: 'integer' },
    },
  },
  {
    ...base,
    definitionId: 'trait:legged',
    definitionType: 'trait',
    name: 'Legged',
    contributes: [{
      capability: 'movement.walk',
      values: { rate: { op: 'get', definitionId: 'field:walking-speed' } },
    }],
  },
  {
    ...base,
    definitionId: 'trait:running',
    definitionType: 'trait',
    name: 'Running',
    contributes: [{
      capability: 'movement.run',
      values: {
        rate: {
          op: 'multiply',
          left: { op: 'capability', capability: 'movement.walk', property: 'rate' },
          right: { op: 'literal', value: 2, valueType: 'integer' },
        },
      },
    }],
  },
  {
    ...base,
    definitionId: 'trait:vision',
    definitionType: 'trait',
    name: 'Vision',
    parameters: [{
      parameterId: 'vision-distance',
      name: 'Vision Distance',
      value: { type: 'distance', unit: 'meter', minimum: 0 },
      defaultValue: 60,
    }],
    contributes: [{
      capability: 'perception.visual',
      values: {
        maximumRange: { op: 'parameter', parameterId: 'vision-distance' },
        lighting: { op: 'literal', value: 'normal-daytime', valueType: 'text' },
        requiresLineOfSight: { op: 'literal', value: true, valueType: 'boolean' },
        opaqueBarriersBlock: { op: 'literal', value: true, valueType: 'boolean' },
      },
    }],
  },
  {
    ...base,
    definitionId: 'trait:hearing',
    definitionType: 'trait',
    name: 'Hearing',
    parameters: [{
      parameterId: 'hearing-distance',
      name: 'Hearing Distance',
      value: { type: 'distance', unit: 'meter', minimum: 0 },
      defaultValue: 30,
    }],
    contributes: [{
      capability: 'perception.audio',
      values: {
        maximumRange: { op: 'parameter', parameterId: 'hearing-distance' },
        minimumVolume: { op: 'literal', value: 0.2, valueType: 'decimal' },
        attenuation: { op: 'literal', value: 'inverse-square', valueType: 'text' },
      },
    }],
  },
];

export const nonFantasyCapabilityExample: CreatureCapabilityDefinition = {
  ...base,
  definitionId: 'trait:sonar-array',
  definitionType: 'trait',
  name: 'Sonar Array',
  parameters: [{
    parameterId: 'sonar-range',
    name: 'Sonar Range',
    value: { type: 'distance', unit: 'meter', minimum: 0 },
    required: true,
  }],
  contributes: [{
    capability: 'perception.audio',
    values: {
      maximumRange: { op: 'parameter', parameterId: 'sonar-range' },
      minimumVolume: { op: 'literal', value: 0.01, valueType: 'decimal' },
      attenuation: { op: 'literal', value: 'linear', valueType: 'text' },
    },
  }],
};
