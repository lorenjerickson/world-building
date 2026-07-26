import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTraitShape,
  traitShapeTerminalPaths,
  type TraitShapeDefinition,
} from '../src';

function trait(
  externalId: string,
  grants: Record<string, unknown>[],
): TraitShapeDefinition {
  return {
    externalId,
    name: externalId,
    body: { metamodelVersion: 'trait/2', grants },
  };
}

test('terminal paths recurse through every repeated collection segment', () => {
  const definitions = [
    trait('trait:member', [{ dataType: 'number', key: 'score' }]),
    trait('trait:group', [{
      dataType: 'trait-collection',
      key: 'members',
      acceptedTraits: ['trait:member'],
    }]),
    trait('trait:roster', [{
      dataType: 'trait-collection',
      key: 'groups',
      acceptedTraits: ['trait:group'],
    }]),
  ];
  const shape = buildTraitShape({
    definitions,
    prerequisiteIds: ['trait:roster'],
    prerequisiteMode: 'all',
  });

  assert.deepEqual(traitShapeTerminalPaths(shape, definitions).map((candidate) => ({
    path: candidate.path,
    repeatedCollectionPaths: candidate.repeatedCollectionPaths,
  })), [{
    path: ['groups[]', 'members[]', 'score'],
    repeatedCollectionPaths: [
      ['groups[]'],
      ['groups[]', 'members[]'],
    ],
  }]);
});
