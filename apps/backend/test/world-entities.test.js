const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWorldEntitySchema,
  listCreateableTraits,
  normalizeAndValidateValues,
} = require('../dist/worlds/world-entity-domain');

function trait(externalId, name, prerequisites = [], grants = [], visibility = 'exported') {
  return {
    externalId,
    name,
    visibility,
    tags: [],
    body: {
      metamodelVersion: 'trait/2',
      prerequisites,
      grants,
    },
  };
}

const definitions = [
  trait('trait:item', 'Item', [], [
    { dataType: 'text', key: 'name', label: 'Name', required: true },
    { dataType: 'text', key: 'description', label: 'Description', required: true },
  ]),
  trait('trait:armor', 'Armor', ['trait:item'], [
    { dataType: 'number', key: 'protection', label: 'Protection', required: true, min: 0 },
  ]),
  trait('trait:chest-armor', 'Chest Armor', ['trait:armor'], [
    { dataType: 'enum', key: 'material', label: 'Material', allowedValues: ['steel', 'leather'] },
  ]),
  trait('trait:hidden-tool', 'Hidden Tool', ['trait:item'], [
    { dataType: 'boolean', key: 'concealed', label: 'Concealed' },
  ], 'private'),
];

test('createable traits are exported configurable leaves with inherited name and description', () => {
  const createable = listCreateableTraits(definitions);
  assert.deepEqual(createable.map((entry) => entry.id), ['trait:chest-armor']);
  assert.deepEqual(createable[0].inheritedTraitIds, ['trait:armor', 'trait:chest-armor', 'trait:item']);
});

test('a world entity schema covers the complete prerequisite closure', () => {
  const schema = buildWorldEntitySchema(['trait:chest-armor'], definitions);
  assert.deepEqual(
    schema.shape.nodes.filter((node) => node.kind === 'terminal').map((node) => node.path.join('.')),
    ['description', 'material', 'name', 'protection'],
  );
});

test('normalization applies defaults, rejects invalid terminals, and retains removed fields for migration', () => {
  const schema = buildWorldEntitySchema(['trait:chest-armor'], definitions);
  const result = normalizeAndValidateValues(schema, {
    name: 'Mail shirt',
    description: 'Light rings.',
    protection: -1,
    material: 'cloth',
    removedField: 'legacy value',
  });
  assert.deepEqual(result.retainedValues, {
    removedField: 'legacy value',
    material: 'cloth',
    protection: -1,
  });
  assert.deepEqual(result.diagnostics.map((item) => item.code), ['FIELD_ENUM_INVALID', 'FIELD_MINIMUM']);
});
