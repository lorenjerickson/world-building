import assert from 'node:assert/strict';
import test from 'node:test';
import {
  searchTraitModifierPaths,
  traitModifierPathOptions,
} from './trait-modifier-paths.js';
import {
  buildTraitShape,
  type TraitShapeDefinition,
} from './trait-shape.js';

function trait(
  externalId: string,
  name: string,
  grants: Record<string, unknown>[],
): TraitShapeDefinition {
  return {
    externalId,
    name,
    body: { metamodelVersion: 'trait/2', grants },
  };
}

const walk = trait('trait:walk', 'Walking Movement', [
  { dataType: 'number', key: 'rate', label: 'Travel Rate' },
  { dataType: 'boolean', key: 'enabled', label: 'Enabled' },
]);
const speed = trait('trait:speed', 'Speed Profile', [
  { dataType: 'trait', ref: 'trait:walk', at: 'this.walk' },
]);
const creature = trait('trait:creature', 'Creature', [
  { dataType: 'trait', ref: 'trait:speed', at: 'this.speed' },
]);

test('indexes complete modifier paths by breadcrumb, key, label, stable ID, type, and source label', () => {
  const definitions = [walk, speed, creature];
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: ['trait:creature'],
    prerequisiteMode: 'all',
  });
  const options = traitModifierPathOptions(shape, definitions, 'increases');

  assert.deepEqual(options.map((candidate) => candidate.path), [
    'self.speed.walk.rate',
    'this.speed.walk.rate',
  ]);
  for (const query of [
    'speed walk rate',
    'Travel Rate',
    'trait:walk',
    'Walking Movement',
    'number',
  ]) {
    assert.deepEqual(
      searchTraitModifierPaths(options, query).map((candidate) => candidate.path),
      ['self.speed.walk.rate', 'this.speed.walk.rate'],
    );
  }
});

test('operation filtering retains nonnumeric fields only for set', () => {
  const definitions = [walk, speed, creature];
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: ['trait:creature'],
    prerequisiteMode: 'all',
  });

  assert.equal(
    traitModifierPathOptions(shape, definitions, 'increases')
      .some((candidate) => candidate.path.endsWith('.enabled')),
    false,
  );
  assert.equal(
    traitModifierPathOptions(shape, definitions, 'sets')
      .some((candidate) => candidate.path === 'self.speed.walk.enabled'),
    true,
  );
});

test('indexes one direct field beneath a repeated collection mount', () => {
  const die = trait('trait:die', 'Die', [
    { dataType: 'number', key: 'sides', label: 'Sides' },
  ]);
  const roll = trait('trait:roll', 'Dice Roll', [
    {
      dataType: 'trait-collection',
      key: 'dice',
      label: 'Dice',
      acceptedTraits: ['trait:die'],
    },
  ]);
  const definitions = [die, roll];
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: ['trait:roll'],
    prerequisiteMode: 'all',
  });

  assert.ok(
    traitModifierPathOptions(shape, definitions, 'increases')
      .some((candidate) => candidate.path === 'self.dice[].sides'),
  );
});

test('indexes fields beneath multiple repeated collection mounts', () => {
  const member = trait('trait:member', 'Member', [
    { dataType: 'number', key: 'score', label: 'Score' },
  ]);
  const group = trait('trait:group', 'Group', [{
    dataType: 'trait-collection',
    key: 'members',
    acceptedTraits: ['trait:member'],
  }]);
  const roster = trait('trait:roster', 'Roster', [{
    dataType: 'trait-collection',
    key: 'groups',
    acceptedTraits: ['trait:group'],
  }]);
  const definitions = [member, group, roster];
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: ['trait:roster'],
    prerequisiteMode: 'all',
  });
  const option = traitModifierPathOptions(shape, definitions, 'increases')
    .find((candidate) => candidate.path === 'self.groups[].members[].score');

  assert.deepEqual(option?.repeatedCollectionPaths, [
    ['groups[]'],
    ['groups[]', 'members[]'],
  ]);
});
