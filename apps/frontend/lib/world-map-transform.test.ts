import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampMapZoom,
  getContainedMapRect,
  mapPercentToViewportPoint,
  screenPointToMapPercent,
} from './world-map-transform.js';

test('converts an untransformed screen point into map percentages', () => {
  assert.deepEqual(screenPointToMapPercent(
    { x: 250, y: 75 },
    { height: 300, panX: 0, panY: 0, width: 500, zoom: 1 },
  ), { x: 50, y: 25 });
});

test('inverts map pan and zoom before placing a pin', () => {
  assert.deepEqual(screenPointToMapPercent(
    { x: 350, y: 200 },
    { height: 300, panX: 50, panY: -20, width: 500, zoom: 2 },
  ), { x: 55, y: 61.67 });
});

test('clamps placements and zoom to supported map bounds', () => {
  assert.deepEqual(screenPointToMapPercent(
    { x: -500, y: 900 },
    { height: 300, panX: 0, panY: 0, width: 500, zoom: 1 },
  ), { x: 0, y: 100 });
  assert.equal(clampMapZoom(0.25), 1);
  assert.equal(clampMapZoom(9), 9);
  assert.equal(clampMapZoom(24), 16);
});

test('accounts for horizontal letterboxing around a portrait map', () => {
  const mapRect = getContainedMapRect(
    { height: 300, width: 600 },
    { height: 1200, width: 600 },
  );
  assert.deepEqual(mapRect, { height: 300, left: 225, top: 0, width: 150 });
  assert.deepEqual(mapPercentToViewportPoint({ x: 20, y: 75 }, mapRect), { x: 255, y: 225 });
  assert.deepEqual(screenPointToMapPercent(
    { x: 255, y: 225 },
    { height: 300, panX: 0, panY: 0, width: 600, zoom: 1 },
    { height: 1200, width: 600 },
  ), { x: 20, y: 75 });
});
