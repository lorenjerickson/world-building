import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTraitShape,
  resolveTraitShapeTerminal,
  selectTraitDefinitionScope,
  traitSatisfiesCollection,
  traitShapeChildren,
  type TraitShapeDefinition,
} from './trait-shape.js';

function trait(
  externalId: string,
  name: string,
  grants: Record<string, unknown>[],
  prerequisites?: { mode: 'any' | 'all'; ids: string[] },
): TraitShapeDefinition {
  return {
    externalId,
    name,
    body: { metamodelVersion: 'trait/1', grants, ...(prerequisites ? { prerequisites } : {}) },
  };
}

const walk = trait('trait:walk', 'Walk', [
  { key: 'rate', label: 'Rate', dataType: 'number', min: 0 },
]);
const run = trait('trait:run', 'Run', [
  { key: 'rate', label: 'Rate', dataType: 'number', min: 0 },
  { key: 'exertion', label: 'Exertion', dataType: 'number', min: 0 },
]);
const speed = trait('trait:speed', 'Speed', [
  { key: 'walk', dataType: 'trait', ref: 'trait:walk' },
  { key: 'run', dataType: 'trait', ref: 'trait:run' },
]);
const creature = trait('trait:creature', 'Creature', [
  { key: 'speed', dataType: 'trait', ref: 'trait:speed' },
]);

test('selects only the trait graph affected by incremental authoring', () => {
  const invalidUnrelated = trait('trait:invalid', 'Invalid Legacy Draft', [
    { dataType: 'modifier' },
  ]);
  const speedConsumer = trait(
    'trait:sprinter',
    'Sprinter',
    [],
    { mode: 'all', ids: ['trait:speed'] },
  );
  const definitions = [invalidUnrelated, creature, speed, walk, run, speedConsumer];

  assert.deepEqual(
    selectTraitDefinitionScope(definitions, ['trait:creature']).map((definition) => definition.externalId),
    ['trait:creature', 'trait:speed', 'trait:walk', 'trait:run'],
  );
  assert.deepEqual(
    selectTraitDefinitionScope(definitions, ['trait:speed'], true).map((definition) => definition.externalId),
    ['trait:creature', 'trait:speed', 'trait:walk', 'trait:run', 'trait:sprinter'],
  );
});

test('recursively expands trait grants into arbitrary-depth modifier paths', () => {
  const shape = buildTraitShape({
    definitions: [creature, speed, walk, run],
    prerequisiteIds: ['trait:creature'],
  });

  assert.deepEqual(
    traitShapeChildren(shape, []).map((node) => [node.path.join('.'), node.kind]),
    [['speed', 'branch']],
  );
  assert.deepEqual(
    traitShapeChildren(shape, ['speed']).map((node) => [node.path.join('.'), node.kind]),
    [['speed.run', 'branch'], ['speed.walk', 'branch']],
  );
  assert.deepEqual(
    traitShapeChildren(shape, ['speed', 'walk']).map((node) => [node.path.join('.'), node.kind]),
    [['speed.walk.rate', 'terminal']],
  );
  assert.equal(resolveTraitShapeTerminal(shape, ['speed', 'walk', 'rate'])?.dataType, 'number');
  assert.deepEqual(shape.diagnostics, []);
});

test('draft trait grants participate in the effective shape', () => {
  const fly = trait('trait:fly', 'Fly', [
    { key: 'rate', label: 'Rate', dataType: 'number' },
  ]);
  const shape = buildTraitShape({
    definitions: [fly],
    prerequisiteIds: [],
    draftGrants: [{ key: 'fly', dataType: 'trait', ref: 'trait:fly' }],
  });

  const flyBranch = traitShapeChildren(shape, [])[0];
  assert.equal(flyBranch?.kind, 'branch');
  assert.equal(flyBranch?.sourceTraitId, undefined);
  assert.equal(resolveTraitShapeTerminal(shape, ['fly', 'rate'])?.sourceTraitId, 'trait:fly');
});

test('retains the trait that contributes each recursively mounted node', () => {
  const shape = buildTraitShape({
    definitions: [creature, speed, walk, run],
    prerequisiteIds: ['trait:creature'],
  });

  const speedBranch = traitShapeChildren(shape, [])[0];
  const walkBranch = traitShapeChildren(shape, ['speed'])
    .find((node) => node.path.at(-1) === 'walk');
  assert.equal(speedBranch?.sourceTraitId, 'trait:creature');
  assert.equal(walkBranch?.sourceTraitId, 'trait:speed');
  assert.equal(resolveTraitShapeTerminal(shape, ['speed', 'walk', 'rate'])?.sourceTraitId, 'trait:walk');
});

test('preserves the complete authored terminal field schema', () => {
  const scored = trait('trait:scored', 'Scored', [
    {
      key: 'score',
      label: 'Score',
      dataType: 'number',
      required: true,
      min: 0,
      max: 10,
      default: 4,
      unit: 'ft',
    },
  ]);
  const shape = buildTraitShape({
    definitions: [scored],
    prerequisiteIds: ['trait:scored'],
  });

  assert.deepEqual(resolveTraitShapeTerminal(shape, ['score']), {
    kind: 'terminal',
    path: ['score'],
    label: 'Score',
    dataType: 'number',
    required: true,
    min: 0,
    max: 10,
    default: 4,
    unit: 'ft',
    allowedValues: undefined,
    sourceTraitId: 'trait:scored',
  });
});

test('treats different numeric units at one terminal path as a conflict', () => {
  const feet = trait('trait:feet', 'Feet', [
    { key: 'distance', dataType: 'number', unit: 'ft' },
  ]);
  const meters = trait('trait:meters', 'Meters', [
    { key: 'distance', dataType: 'number', unit: 'm' },
  ]);
  const shape = buildTraitShape({
    definitions: [feet, meters],
    prerequisiteIds: ['trait:feet', 'trait:meters'],
    prerequisiteMode: 'all',
  });

  assert.ok(shape.diagnostics.some((diagnostic) => diagnostic.code === 'path-conflict'));
});

test('treats incompatible terminal constraints at one path as a conflict', () => {
  const bounded = trait('trait:bounded', 'Bounded', [
    { key: 'score', dataType: 'number', min: 0, max: 10 },
  ]);
  const differentlyBounded = trait('trait:differently-bounded', 'Differently Bounded', [
    { key: 'score', dataType: 'number', min: 0, max: 20 },
  ]);
  const shape = buildTraitShape({
    definitions: [bounded, differentlyBounded],
    prerequisiteIds: ['trait:bounded', 'trait:differently-bounded'],
    prerequisiteMode: 'all',
  });

  assert.ok(shape.diagnostics.some((diagnostic) => diagnostic.code === 'path-conflict'));
});

test('preserves every compatible contributor at one singular path', () => {
  const first = trait('trait:first-score', 'First Score', [
    { key: 'score', dataType: 'number', min: 0, max: 10 },
  ]);
  const second = trait('trait:second-score', 'Second Score', [
    { key: 'score', dataType: 'number', min: 0, max: 10 },
  ]);
  const shape = buildTraitShape({
    definitions: [first, second],
    prerequisiteIds: ['trait:first-score', 'trait:second-score'],
    prerequisiteMode: 'all',
  });
  const score = resolveTraitShapeTerminal(shape, ['score']);

  assert.deepEqual(shape.diagnostics, []);
  assert.equal(score?.sourceTraitId, 'trait:first-score');
  assert.deepEqual(score?.sourceTraitIds, ['trait:first-score', 'trait:second-score']);
});

test('any-of prerequisites expose only their common guaranteed paths', () => {
  const slow = trait('trait:slow-mover', 'Slow Mover', [
    { key: 'speed', dataType: 'trait', ref: 'trait:speed' },
    { key: 'stamina', dataType: 'number' },
  ]);
  const fast = trait('trait:fast-mover', 'Fast Mover', [
    { key: 'speed', dataType: 'trait', ref: 'trait:speed' },
    { key: 'momentum', dataType: 'number' },
  ]);
  const shape = buildTraitShape({
    definitions: [slow, fast, speed, walk, run],
    prerequisiteIds: ['trait:slow-mover', 'trait:fast-mover'],
    prerequisiteMode: 'any',
  });

  assert.ok(resolveTraitShapeTerminal(shape, ['speed', 'walk', 'rate']));
  assert.equal(resolveTraitShapeTerminal(shape, ['stamina']), null);
  assert.equal(resolveTraitShapeTerminal(shape, ['momentum']), null);
});

test('all-of prerequisites merge their effective shapes', () => {
  const physical = trait('trait:physical', 'Physical', [
    { key: 'strength', dataType: 'number' },
  ]);
  const mental = trait('trait:mental', 'Mental', [
    { key: 'will', dataType: 'number' },
  ]);
  const shape = buildTraitShape({
    definitions: [physical, mental],
    prerequisiteIds: ['trait:physical', 'trait:mental'],
    prerequisiteMode: 'all',
  });

  assert.ok(resolveTraitShapeTerminal(shape, ['strength']));
  assert.ok(resolveTraitShapeTerminal(shape, ['will']));
});

test('reports recursive grant cycles without recursing forever', () => {
  const first = trait('trait:first', 'First', [
    { key: 'second', dataType: 'trait', ref: 'trait:second' },
  ]);
  const second = trait('trait:second', 'Second', [
    { key: 'first', dataType: 'trait', ref: 'trait:first' },
  ]);
  const shape = buildTraitShape({
    definitions: [first, second],
    prerequisiteIds: ['trait:first'],
  });

  assert.equal(shape.diagnostics.length, 1);
  assert.equal(shape.diagnostics[0]?.code, 'cycle');
  assert.deepEqual(shape.diagnostics[0]?.path, ['second', 'first']);
});

test('reports incompatible contributions at the same path', () => {
  const numeric = trait('trait:numeric', 'Numeric', [
    { key: 'value', dataType: 'number' },
  ]);
  const textual = trait('trait:textual', 'Textual', [
    { key: 'value', dataType: 'text' },
  ]);
  const shape = buildTraitShape({
    definitions: [numeric, textual],
    prerequisiteIds: ['trait:numeric', 'trait:textual'],
    prerequisiteMode: 'all',
  });

  assert.equal(shape.diagnostics[0]?.code, 'path-conflict');
  assert.deepEqual(shape.diagnostics[0]?.path, ['value']);
});

test('collects counted reusable traits that satisfy an accepted base trait', () => {
  const die = trait('trait:die', 'Die', [
    { key: 'sides', dataType: 'number', min: 1 },
  ]);
  const d4 = trait('trait:d4', 'D4', [
    { dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 4 },
  ], { mode: 'all', ids: ['trait:die'] });
  const d10 = trait('trait:d10', 'D10', [
    { dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 10 },
  ], { mode: 'all', ids: ['trait:die'] });
  const diceRoll = trait('trait:dice-roll', 'Dice Roll', [
    {
      key: 'dice',
      label: 'Dice',
      dataType: 'trait-collection',
      acceptedTraits: ['trait:die'],
    },
    { dataType: 'trait', ref: 'trait:d10', into: 'dice', count: 3 },
    { dataType: 'trait', ref: 'trait:d4', into: 'dice', count: 4 },
  ]);

  const shape = buildTraitShape({
    definitions: [die, d4, d10, diceRoll],
    prerequisiteIds: ['trait:dice-roll'],
  });
  const d10Shape = buildTraitShape({
    definitions: [die, d10],
    prerequisiteIds: ['trait:d10'],
  });
  const collection = traitShapeChildren(shape, [])[0];

  assert.equal(traitSatisfiesCollection('trait:d10', ['trait:die'], 'any', [die, d4, d10]), true);
  assert.equal(resolveTraitShapeTerminal(d10Shape, ['sides'])?.sourceTraitId, 'trait:die');
  assert.equal(collection?.kind, 'collection');
  assert.deepEqual(collection?.kind === 'collection' ? collection.entries : [], [
    { traitId: 'trait:d10', count: 3, sourceTraitId: 'trait:dice-roll' },
    { traitId: 'trait:d4', count: 4, sourceTraitId: 'trait:dice-roll' },
  ]);
  assert.deepEqual(shape.diagnostics, []);
});

test('rejects counted traits that do not satisfy the collection base trait', () => {
  const die = trait('trait:die', 'Die', [{ key: 'sides', dataType: 'number' }]);
  const coin = trait('trait:coin', 'Coin', [{ key: 'faces', dataType: 'number' }]);
  const roll = trait('trait:roll', 'Roll', [
    { key: 'dice', dataType: 'trait-collection', acceptedTraits: ['trait:die'] },
    { dataType: 'trait', ref: 'trait:coin', into: 'dice', count: 1 },
  ]);
  const shape = buildTraitShape({
    definitions: [die, coin, roll],
    prerequisiteIds: ['trait:roll'],
  });

  assert.equal(shape.diagnostics[0]?.code, 'collection-type-mismatch');
  const collection = traitShapeChildren(shape, [])[0];
  assert.deepEqual(collection?.kind === 'collection' ? collection.entries : [], []);
});

test('adds counted traits to a collection inherited through a prerequisite', () => {
  const die = trait('trait:die', 'Die', [{ key: 'sides', dataType: 'number' }]);
  const d6 = trait('trait:d6', 'D6', [], { mode: 'all', ids: ['trait:die'] });
  const diceRoll = trait('trait:dice-roll', 'Dice Roll', [
    { key: 'dice', dataType: 'trait-collection', acceptedTraits: ['trait:die'] },
  ]);
  const preciseRoll = trait('trait:precise-roll', 'Precise Roll', [
    { dataType: 'trait', ref: 'trait:d6', into: 'self.dice', count: 2 },
  ], { mode: 'all', ids: ['trait:dice-roll'] });
  const shape = buildTraitShape({
    definitions: [die, d6, diceRoll, preciseRoll],
    prerequisiteIds: ['trait:precise-roll'],
  });
  const collection = traitShapeChildren(shape, [])[0];

  assert.deepEqual(collection?.kind === 'collection' ? collection.entries : [], [
    { traitId: 'trait:d6', count: 2, sourceTraitId: 'trait:precise-roll' },
  ]);
  assert.deepEqual(shape.diagnostics, []);
});

test('requires counted trait contributions to use a positive whole number', () => {
  const die = trait('trait:die', 'Die', [{ key: 'sides', dataType: 'number' }]);
  const d6 = trait('trait:d6', 'D6', [], { mode: 'all', ids: ['trait:die'] });
  const roll = trait('trait:roll', 'Roll', [
    { key: 'dice', dataType: 'trait-collection', acceptedTraits: ['trait:die'] },
    { dataType: 'trait', ref: 'trait:d6', into: 'dice', count: 1.5 },
  ]);
  const shape = buildTraitShape({
    definitions: [die, d6, roll],
    prerequisiteIds: ['trait:roll'],
  });

  assert.equal(shape.diagnostics[0]?.code, 'invalid-count');
});

test('adds a trait beneath an existing recursively composed branch', () => {
  const fly = trait('trait:fly', 'Fly', [
    { key: 'rate', dataType: 'number' },
  ]);
  const winged = trait('trait:winged', 'Winged', [
    { dataType: 'trait', ref: 'trait:fly', at: 'self.speed.fly' },
  ], { mode: 'all', ids: ['trait:creature'] });
  const shape = buildTraitShape({
    definitions: [creature, speed, walk, run, fly, winged],
    prerequisiteIds: ['trait:winged'],
  });

  const flyBranch = traitShapeChildren(shape, ['speed'])
    .find((node) => node.path.at(-1) === 'fly');
  assert.equal(flyBranch?.kind, 'branch');
  assert.equal(flyBranch?.sourceTraitId, 'trait:winged');
  assert.equal(resolveTraitShapeTerminal(shape, ['speed', 'fly', 'rate'])?.sourceTraitId, 'trait:fly');
  assert.deepEqual(shape.diagnostics, []);
});

test('rejects a nested trait addition when its parent branch is unavailable', () => {
  const fly = trait('trait:fly', 'Fly', [{ key: 'rate', dataType: 'number' }]);
  const winged = trait('trait:winged', 'Winged', [
    { dataType: 'trait', ref: 'trait:fly', at: 'self.speed.fly' },
  ]);
  const shape = buildTraitShape({
    definitions: [fly, winged],
    prerequisiteIds: ['trait:winged'],
  });

  assert.equal(shape.diagnostics[0]?.code, 'missing-reference');
  assert.deepEqual(shape.diagnostics[0]?.path, ['speed', 'fly']);
});

test('trait/2 explicit local placement resolves like a legacy named addition', () => {
  const definitions: TraitShapeDefinition[] = [
    trait('trait:walk', 'Walk', [{ dataType: 'number', key: 'rate' }]),
    {
      externalId: 'trait:speed-v2',
      name: 'Speed V2',
      body: {
        metamodelVersion: 'trait/2',
        grants: [{ dataType: 'trait', ref: 'trait:walk', at: 'this.walk' }],
      },
    },
  ];
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: ['trait:speed-v2'],
    prerequisiteMode: 'all',
  });
  assert.deepEqual(shape.diagnostics, []);
  assert.deepEqual(shape.nodes.map((node) => [node.path.join('.'), node.kind]), [
    ['walk', 'branch'],
    ['walk.rate', 'terminal'],
  ]);
});
