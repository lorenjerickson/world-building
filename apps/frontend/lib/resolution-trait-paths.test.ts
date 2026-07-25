import assert from 'node:assert/strict';
import test from 'node:test';
import {
  guidedOperationSubjectContract,
  guidedTraitPathOptions,
} from './resolution-trait-paths.js';
import type { TraitShapeDefinition } from './trait-shape.js';

function trait(externalId: string, name: string, grants: Record<string, unknown>[]): TraitShapeDefinition {
  return { externalId, name, body: { metamodelVersion: 'trait/1', grants } };
}

const definitions = [
  trait('trait:walk', 'Walk', [{ key: 'rate', label: 'Rate', dataType: 'number' }]),
  trait('trait:speed', 'Speed', [{ key: 'walk', label: 'Walk', dataType: 'trait', ref: 'trait:walk' }]),
  trait('trait:creature', 'Creature', [{ key: 'speed', label: 'Speed', dataType: 'trait', ref: 'trait:speed' }]),
  trait('trait:vision', 'Vision', [{ key: 'range', label: 'Range', dataType: 'number' }]),
];

test('subject traits restrict completion to their guaranteed recursive contract', () => {
  const result = guidedTraitPathOptions(definitions, ['trait:creature']);
  assert.equal(result.scoped, true);
  assert.deepEqual(result.options.map((option) => option.path), ['self.speed.walk.rate']);
  assert.deepEqual(result.options[0].provenance, [{
    rootTraitId: 'trait:creature',
    rootLabel: 'Creature',
    traitChain: ['trait:creature', 'trait:speed', 'trait:walk'],
    traitChainLabels: ['Creature', 'Speed', 'Walk'],
    contractKind: 'direct',
    checkIds: [],
  }]);
});

test('unscoped legacy completion retains paths from the available catalog', () => {
  const result = guidedTraitPathOptions(definitions);
  assert.equal(result.scoped, false);
  assert.ok(result.options.some((option) => option.path === 'self.speed.walk.rate'));
  assert.ok(result.options.some((option) => option.path === 'self.range'));
  assert.equal(
    result.options.find((option) => option.path === 'self.speed.walk.rate')?.provenance[0].contractKind,
    'catalog',
  );
});

test('invalid subject contracts expose diagnostics instead of unrelated completions', () => {
  const result = guidedTraitPathOptions(definitions, ['trait:missing']);
  assert.equal(result.options.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test('operations inherit subject traits from every referenced check', () => {
  const contract = guidedOperationSubjectContract(
    ['trait:creature'],
    [
      { stepId: 'attack', kind: 'perform-check', checkId: 'check:attack', onSuccess: 'damage', onFailure: 'done' },
      { stepId: 'damage', kind: 'perform-check', checkId: 'check:damage', onSuccess: 'done', onFailure: 'done' },
      { stepId: 'done', kind: 'return' },
      { stepId: 'unreachable', kind: 'perform-check', checkId: 'check:unused', onSuccess: 'done', onFailure: 'done' },
    ],
    [
      { body: { metamodelVersion: 'resolution/1', definitionType: 'check', definitionId: 'check:attack', subjectTraitIds: ['trait:combatant'] } },
      { body: { metamodelVersion: 'resolution/1', definitionType: 'check', definitionId: 'check:damage', subjectTraitIds: ['trait:creature'] } },
      { body: { metamodelVersion: 'resolution/1', definitionType: 'check', definitionId: 'check:unused', subjectTraitIds: ['trait:unused'] } },
    ],
  );
  assert.deepEqual(contract.directTraitIds, ['trait:creature']);
  assert.deepEqual(contract.inheritedTraitIds, ['trait:combatant']);
  assert.deepEqual(contract.effectiveTraitIds, ['trait:combatant', 'trait:creature']);
  assert.deepEqual(contract.checkSources, [
    { checkId: 'check:attack', traitIds: ['trait:combatant'] },
    { checkId: 'check:damage', traitIds: ['trait:creature'] },
  ]);
});

test('operation path provenance identifies the check that contributes an inherited root', () => {
  const contract = {
    directTraitIds: [],
    inheritedTraitIds: ['trait:creature'],
    effectiveTraitIds: ['trait:creature'],
    checkSources: [{ checkId: 'check:movement', traitIds: ['trait:creature'] }],
  };
  const result = guidedTraitPathOptions(definitions, contract.effectiveTraitIds, contract);
  const provenance = result.options.find((option) => option.path === 'self.speed.walk.rate')?.provenance[0];
  assert.equal(provenance?.contractKind, 'inherited');
  assert.deepEqual(provenance?.checkIds, ['check:movement']);
  assert.match(result.options[0].explanation, /inherited from check:movement: Creature → Speed → Walk/);
});

test('collection field provenance includes the accepted base trait that owns the field', () => {
  const diceDefinitions = [
    trait('trait:die', 'Die', [{ key: 'sides', label: 'Sides', dataType: 'number' }]),
    trait('trait:dice-roll', 'Dice Roll', [{
      key: 'dice',
      label: 'Dice',
      dataType: 'trait-collection',
      acceptedTraits: ['trait:die'],
    }]),
  ];
  const result = guidedTraitPathOptions(diceDefinitions, ['trait:dice-roll']);
  const option = result.options.find((candidate) => candidate.path === 'self.dice[].sides');
  assert.deepEqual(option?.provenance[0].traitChainLabels, ['Dice Roll', 'Die']);
});

test('unavailable paths offer only roots that safely restore the contract', () => {
  const result = guidedTraitPathOptions(
    definitions,
    ['trait:creature'],
    undefined,
    ['self.range'],
  );
  assert.deepEqual(result.repairs, [{
    path: 'self.range',
    reason: 'outside-subject',
    message: 'This path exists, but the current self contract does not guarantee it.',
    candidates: [{
      traitId: 'trait:vision',
      traitLabel: 'Vision',
      explanation: 'Vision',
    }],
  }]);
});

test('repair refuses a catalog root that conflicts with the current contract', () => {
  const conflictingDefinitions = [
    trait('trait:selected', 'Selected', [{ key: 'shared', dataType: 'number' }]),
    trait('trait:candidate', 'Candidate', [
      { key: 'shared', dataType: 'text' },
      { key: 'wanted', dataType: 'number' },
    ]),
  ];
  const result = guidedTraitPathOptions(
    conflictingDefinitions,
    ['trait:selected'],
    undefined,
    ['self.wanted', 'self.unknown'],
  );
  assert.deepEqual(result.repairs, [{
    path: 'self.wanted',
    reason: 'composition-conflict',
    message: 'Catalog traits define this path, but none can be safely composed with the current self contract.',
    candidates: [],
  }]);
  assert.equal(result.repairs.some((repair) => repair.path === 'self.unknown'), false);
});

test('optional prerequisite paths explain and repair the required branch', () => {
  const branchDefinitions: TraitShapeDefinition[] = [
    trait('trait:brutal', 'Brutal', [{ key: 'damage', dataType: 'number' }]),
    trait('trait:precise', 'Precise', [{ key: 'accuracy', dataType: 'number' }]),
    {
      externalId: 'trait:training',
      name: 'Training',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: { mode: 'any', ids: ['trait:brutal', 'trait:precise'] },
        grants: [],
      },
    },
  ];
  const unavailable = guidedTraitPathOptions(
    branchDefinitions,
    ['trait:training'],
    undefined,
    ['self.damage'],
  );
  assert.equal(unavailable.options.some((option) => option.path === 'self.damage'), false);
  assert.deepEqual(unavailable.repairs, [{
    path: 'self.damage',
    reason: 'optional-prerequisite',
    message: 'This path is available only for a specific prerequisite branch, so the rule must require that choice.',
    candidates: [{
      traitId: 'trait:brutal',
      traitLabel: 'Brutal',
      explanation: 'Training selects Brutal',
      selectionOwnerTraitId: 'trait:training',
      selectionOwnerLabel: 'Training',
    }],
  }]);

  const selected = guidedTraitPathOptions(
    branchDefinitions,
    ['trait:training'],
    undefined,
    ['self.damage'],
    { 'trait:training': ['trait:brutal'] },
  );
  const selectedDamage = selected.options.find((option) => option.path === 'self.damage');
  assert.ok(selectedDamage);
  assert.match(selectedDamage.explanation, /Training → Brutal/);
  assert.equal(selected.repairs.length, 0);
});
