import assert from 'node:assert/strict';
import test from 'node:test';
import type { TraitShape } from './trait-shape';
import { diffTraitShapes } from './trait-shape-diff';

test('diffTraitShapes reports a nested addition relative to prerequisite structure', () => {
  const before: TraitShape = {
    diagnostics: [],
    nodes: [{
      kind: 'branch',
      path: ['speed'],
      label: 'Speed',
      traitId: 'trait:speed',
      sourceTraitId: 'trait:creature',
    }],
  };
  const after: TraitShape = {
    diagnostics: [],
    nodes: [
      ...before.nodes,
      {
        kind: 'branch',
        path: ['speed', 'fly'],
        label: 'Fly',
        traitId: 'trait:fly',
        sourceTraitId: 'trait:winged',
      },
      {
        kind: 'terminal',
        path: ['speed', 'fly', 'rate'],
        label: 'Rate',
        dataType: 'number',
        required: true,
        min: 0,
        sourceTraitId: 'trait:fly',
      },
    ],
  };

  assert.deepEqual(
    diffTraitShapes(before, after).map((change) => ({
      kind: change.kind,
      path: change.path.join('.'),
      summary: change.summary,
    })),
    [
      {
        kind: 'added',
        path: 'speed.fly',
        summary: 'Adds trait branch for trait:fly.',
      },
      {
        kind: 'added',
        path: 'speed.fly.rate',
        summary: 'Adds required, number, minimum 0 field.',
      },
    ],
  );
});

test('diffTraitShapes reports semantic changes and ignores ordering-only collection changes', () => {
  const before: TraitShape = {
    diagnostics: [],
    nodes: [
      {
        kind: 'terminal',
        path: ['speed', 'rate'],
        label: 'Rate',
        dataType: 'number',
        min: 0,
        max: 10,
      },
      {
        kind: 'collection',
        path: ['attacks'],
        label: 'Attacks',
        acceptedTraitIds: ['trait:melee', 'trait:attack'],
        acceptsMode: 'any',
        entries: [
          { traitId: 'trait:claw', count: 1 },
          { traitId: 'trait:bite', count: 1 },
        ],
      },
    ],
  };
  const after: TraitShape = {
    diagnostics: [],
    nodes: [
      {
        kind: 'terminal',
        path: ['speed', 'rate'],
        label: 'Rate',
        dataType: 'number',
        min: 0,
        max: 20,
      },
      {
        kind: 'collection',
        path: ['attacks'],
        label: 'Attacks',
        acceptedTraitIds: ['trait:attack', 'trait:melee'],
        acceptsMode: 'any',
        entries: [
          { traitId: 'trait:bite', count: 1 },
          { traitId: 'trait:claw', count: 1 },
        ],
      },
    ],
  };

  const changes = diffTraitShapes(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, 'changed');
  assert.equal(changes[0]?.summary, 'Changes optional, number, minimum 0, maximum 10 field to optional, number, minimum 0, maximum 20 field.');
});
