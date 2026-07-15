import { ResolutionDefinition, ResolutionFixture } from './resolution.types';

const base = { formatVersion: '1' as const, metamodelVersion: 'resolution/1' as const };

export const meleeResolutionExamples: ResolutionDefinition[] = [
  { ...base, definitionType: 'resource', definitionId: 'resource:action-points', name: 'Action Points', capacity: 2, minimum: 0, refresh: 'turn' },
  { ...base, definitionType: 'modifier', definitionId: 'modifier:accurate', name: 'Accurate', targetCheckId: 'check:melee-attack', operation: 'add', value: { op: 'literal', value: 1 } },
  { ...base, definitionType: 'check', definitionId: 'check:melee-attack', name: 'Melee Attack Check', checkKind: 'target-number', roll: { count: 1, sides: 20 }, bonus: { op: 'actor-field', key: 'strength-modifier' }, target: { op: 'target-field', key: 'defense' }, comparison: 'gte' },
  { ...base, definitionType: 'effect', definitionId: 'effect:wounded', name: 'Wounded', duration: { kind: 'persistent' } },
  { ...base, definitionType: 'event', definitionId: 'event:melee-attack-hit', name: 'Melee Attack Hit', visibility: 'public', payload: { attackerId: 'string', targetId: 'string', total: 'number' } },
  { ...base, definitionType: 'event', definitionId: 'event:melee-attack-missed', name: 'Melee Attack Missed', visibility: 'public', payload: { attackerId: 'string', targetId: 'string', total: 'number' } },
  {
    ...base, definitionType: 'operation', definitionId: 'operation:melee-attack', name: 'Melee Attack', startStepId: 'spend-action', budget: { maximumSteps: 8 },
    steps: [
      { stepId: 'spend-action', kind: 'consume-resource', resourceId: 'resource:action-points', amount: { op: 'literal', value: 1 }, next: 'attack-check' },
      { stepId: 'attack-check', kind: 'perform-check', checkId: 'check:melee-attack', resultKey: 'attack', onSuccess: 'wound-target', onFailure: 'emit-miss' },
      { stepId: 'wound-target', kind: 'apply-effect', effectId: 'effect:wounded', target: 'target', next: 'emit-hit' },
      { stepId: 'emit-hit', kind: 'emit-event', eventId: 'event:melee-attack-hit', payload: { attackerId: { op: 'actor-field', key: 'id' }, targetId: { op: 'target-field', key: 'id' }, total: { op: 'result', key: 'attack', property: 'total' } }, next: 'success' },
      { stepId: 'emit-miss', kind: 'emit-event', eventId: 'event:melee-attack-missed', payload: { attackerId: { op: 'actor-field', key: 'id' }, targetId: { op: 'target-field', key: 'id' }, total: { op: 'result', key: 'attack', property: 'total' } }, next: 'failure' },
      { stepId: 'success', kind: 'return', outcome: 'success', data: { checkTotal: { op: 'result', key: 'attack', property: 'total' } } },
      { stepId: 'failure', kind: 'return', outcome: 'failure', data: { checkTotal: { op: 'result', key: 'attack', property: 'total' } } },
    ],
  },
];

export const meleeResolutionFixtures: ResolutionFixture[] = [
  {
    name: 'Strong attacker hits and wounds the target', operationId: 'operation:melee-attack',
    context: { actor: { id: 'creature:attacker', fields: { id: 'creature:attacker', 'strength-modifier': 3 }, resources: { 'resource:action-points': 2 } }, target: { id: 'creature:target', fields: { id: 'creature:target', defense: 16 } }, activeModifierIds: ['modifier:accurate'], entropy: [14] },
    expected: { outcome: 'success', effects: [{ effectId: 'effect:wounded', targetId: 'creature:target' }] },
  },
  {
    name: 'Low roll misses without applying an effect', operationId: 'operation:melee-attack',
    context: { actor: { id: 'creature:attacker', fields: { id: 'creature:attacker', 'strength-modifier': 1 }, resources: { 'resource:action-points': 2 } }, target: { id: 'creature:target', fields: { id: 'creature:target', defense: 16 } }, entropy: [4] },
    expected: { outcome: 'failure', effects: [] },
  },
];
