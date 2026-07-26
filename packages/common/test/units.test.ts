import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compatibleUnits,
  convertUnitValue,
  normalizeUnitId,
  unitsAreCompatible,
} from '../src/units.js';

test('normalizes unit aliases to stable canonical identities', () => {
  assert.equal(normalizeUnitId('feet per turn'), 'ft/turn');
  assert.equal(normalizeUnitId('METRES'), 'm');
  assert.equal(normalizeUnitId('unknown'), null);
});

test('converts only values with compatible dimensions', () => {
  assert.equal(convertUnitValue(10, 'ft', 'm'), 3.048);
  assert.equal(convertUnitValue(10, 'ft/turn', 'm/turn'), 3.048);
  assert.equal(convertUnitValue(1, 'min', 's'), 60);
  assert.equal(convertUnitValue(1, 'ft', 's'), null);
  assert.equal(unitsAreCompatible('yd/turn', 'm/turn'), true);
  assert.equal(unitsAreCompatible('yd', 'm/turn'), false);
  assert.deepEqual(
    compatibleUnits('ft/turn').map((unit) => unit.id),
    ['m/turn', 'ft/turn', 'yd/turn'],
  );
});
