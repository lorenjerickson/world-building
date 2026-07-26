import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGuidedScalarExpression,
  defaultGuidedScalarExpression,
  parseGuidedScalarExpression,
} from './resolution-expression.js';

test('guided scalar expressions round-trip exact composed trait paths', () => {
  const source = defaultGuidedScalarExpression('trait-path-field', {
    traitPath: 'self.speed.walk.rate',
  });
  const body = buildGuidedScalarExpression(source);
  assert.deepEqual(body, { op: 'trait-path-field', path: 'self.speed.walk.rate' });
  assert.deepEqual(parseGuidedScalarExpression(body), source);
});

test('guided scalar expressions preserve repeated-path ordinals', () => {
  const source = defaultGuidedScalarExpression('trait-path-field', {
    traitPath: 'self.dice[].sides',
    mountOrdinal: 3,
  });
  const body = buildGuidedScalarExpression(source);
  assert.deepEqual(body, {
    op: 'trait-path-field',
    path: 'self.dice[].sides',
    mountSelector: { mode: 'ordinal', ordinal: 3 },
  });
  assert.deepEqual(parseGuidedScalarExpression(body), source);
});

test('guided scalar expressions preserve ordered identity and tag selectors', () => {
  const source = defaultGuidedScalarExpression('trait-path-field', {
    traitPath: 'self.groups[].members[].score',
    mountSelectors: [
      { mode: 'trait', traitId: 'trait:adventurers' },
      { mode: 'tag', tag: 'leader' },
    ],
  });
  const body = buildGuidedScalarExpression(source);

  assert.deepEqual(body, {
    op: 'trait-path-field',
    path: 'self.groups[].members[].score',
    mountSelectors: [
      { mode: 'trait', traitId: 'trait:adventurers' },
      { mode: 'tag', tag: 'leader' },
    ],
  });
  assert.deepEqual(parseGuidedScalarExpression(body), source);
});

test('guided scalar expressions preserve literal, instance, and result forms', () => {
  const expressions = [
    defaultGuidedScalarExpression('literal', { literalValue: 4 }),
    defaultGuidedScalarExpression('trait-instance-field', { instanceId: 'movement:left', key: 'rate' }),
    defaultGuidedScalarExpression('result', { key: 'attack', resultProperty: 'damage' }),
  ];
  for (const expression of expressions) {
    assert.deepEqual(parseGuidedScalarExpression(buildGuidedScalarExpression(expression)), expression);
  }
});
