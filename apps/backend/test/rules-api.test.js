const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const { RuleApiActorGuard } = require('../dist/rules/api/rule-api-actor');
const { RuleApiIdPipe, ruleApiValidationPipe } = require('../dist/rules/api/rule-api-validation');
const { CreateRuleSetDto } = require('../dist/rules/api/rule-set.dto');
const { PayloadRuleCatalogRepository } = require('../dist/rules/catalog/payload-rule-catalog.repository');
const { RuleSetCatalogService } = require('../dist/rules/catalog/rule-set-catalog.service');
const { GenerateService } = require('../dist/generate/generate.service');
const { compileCreatureCapabilities } = require('../dist/rules/metamodel/creature-capability.compiler');
const { creatureCapabilityExamples, nonFantasyCapabilityExample } = require('../dist/rules/metamodel/creature-capability.examples');
const { evaluateCreatureCapabilities, evaluateVisualObservation } = require('../dist/rules/metamodel/creature-capability.evaluator');
const { RuleAuthoringService } = require('../dist/rules/api/rule-authoring.service');
const { compileResolutionDefinitions } = require('../dist/rules/resolution/resolution.compiler');
const { previewResolutionOperation } = require('../dist/rules/resolution/resolution.evaluator');
const { meleeResolutionExamples, meleeResolutionFixtures } = require('../dist/rules/resolution/resolution.examples');
const { compileTraitCompositions } = require('../dist/rules/traits/trait-composition.compiler');
const { migrateTraitBody, previewTraitDefinitionMigration } = require('../dist/rules/traits/trait-migration');
const { compileRuleRelease } = require('../dist/rules/releases/rule-release.compiler');
const { RuleSentenceParserService } = require('../dist/rules/assistant/rule-sentence-parser.service');

const originalFetch = global.fetch;
const originalRuleApiToken = process.env.RULE_API_INTERNAL_TOKEN;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalRuleApiToken === undefined) delete process.env.RULE_API_INTERNAL_TOKEN;
  else process.env.RULE_API_INTERNAL_TOKEN = originalRuleApiToken;
});

function context(headers) {
  const request = { headers };
  return {
    request,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

test('rule API actor guard enforces the configured trusted gateway token', () => {
  process.env.RULE_API_INTERNAL_TOKEN = 'gateway-secret';
  const guard = new RuleApiActorGuard();

  assert.throws(
    () => guard.canActivate(context({ 'x-auth0-sub': 'auth0|author' })),
    (error) => error.getResponse().code === 'RULE_TRUST_BOUNDARY_REJECTED',
  );

  const accepted = context({
    'x-auth0-sub': 'auth0|author',
    'x-rule-api-token': 'gateway-secret',
  });
  assert.equal(guard.canActivate(accepted), true);
  assert.deepEqual(accepted.request.ruleApiActor, { auth0Subject: 'auth0|author' });

  const acceptedWithEmail = context({
    'x-auth0-email': '  Author@Example.com ',
    'x-auth0-sub': 'auth0|author',
    'x-rule-api-token': 'gateway-secret',
  });
  assert.equal(guard.canActivate(acceptedWithEmail), true);
  assert.deepEqual(acceptedWithEmail.request.ruleApiActor, {
    auth0Subject: 'auth0|author',
    email: 'author@example.com',
  });
});

test('rule API fails closed when the trusted gateway token is not configured', () => {
  delete process.env.RULE_API_INTERNAL_TOKEN;
  const guard = new RuleApiActorGuard();
  assert.throws(
    () => guard.canActivate(context({ 'x-auth0-sub': 'auth0|author' })),
    (error) => error.getResponse().code === 'RULE_API_NOT_CONFIGURED',
  );
});

test('rule API validation and ID parsing emit stable errors', async () => {
  const idPipe = new RuleApiIdPipe();
  assert.throws(
    () => idPipe.transform('not-an-id'),
    (error) => error.getResponse().code === 'RULE_ID_INVALID',
  );
  await assert.rejects(
    ruleApiValidationPipe.transform(
      { name: '', slug: 'Not a slug' },
      { type: 'body', metatype: CreateRuleSetDto },
    ),
    (error) => error.getResponse().code === 'RULE_REQUEST_INVALID',
  );
});

test('Payload adapter keeps CMS shapes and credentials behind the repository boundary', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/users/me')) {
      return Response.json({
        user: {
          id: 5,
          workspace: { id: 7, externalId: 'workspace-external' },
        },
      });
    }
    return Response.json({
      docs: [{
        _status: 'draft',
        createdAt: '2026-07-15T00:00:00.000Z',
        dashboard: { accentColor: '#112233', featured: true },
        description: {
          root: {
            type: 'root',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Plain API description' }] }],
          },
        },
        engineFeatureLevel: '1',
        externalId: 'rule-set-external',
        id: 42,
        lifecycle: 'active',
        name: 'Test rules',
        slug: 'test-rules',
        summary: 'Summary',
        tags: [{ value: 'test' }],
        updatedAt: '2026-07-15T00:00:00.000Z',
      }],
      limit: 25,
      page: 1,
      totalDocs: 1,
      totalPages: 1,
    });
  };

  process.env.CMS_BASE_URL = 'http://cms.test';
  process.env.CMS_INTERNAL_TOKEN = 'cms-secret';
  const repository = new PayloadRuleCatalogRepository();
  const actor = await repository.resolveActor({
    auth0Subject: 'auth0|author',
    email: 'author@example.com',
  });
  const result = await repository.listRuleSets(actor, { page: 1, limit: 25 });

  assert.equal(actor.workspaceExternalId, 'workspace-external');
  assert.equal(result.items[0].description, 'Plain API description');
  assert.equal(result.items[0].status, 'draft');
  assert.deepEqual(result.items[0].tags, ['test']);
  assert.equal(calls[1].options.headers['x-cms-internal-token'], 'cms-secret');
  assert.equal(calls[0].options.headers['x-auth0-email'], 'author@example.com');
  assert.equal('workspace' in result.items[0], false);
  assert.equal('description.root' in result.items[0], false);
});

test('definition cloning preserves content and records provenance without mutating the source', async () => {
  const source = {
    body: { fields: [{ id: 'claws' }] },
    createdAt: '2026-07-15T00:00:00.000Z',
    definitionType: 'trait',
    externalId: 'source-external',
    id: 11,
    moduleId: 4,
    name: 'Claws',
    presentation: { icon: 'claw' },
    ruleSetId: 2,
    schemaVersion: 1,
    status: 'draft',
    tags: ['creature'],
    updatedAt: '2026-07-15T00:00:00.000Z',
    visibility: 'exported',
  };
  let createInput;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getDefinition: async () => source,
    getModule: async () => ({ id: 4, ruleSetId: 2 }),
    createDefinition: async (_actor, _ruleSetId, input) => {
      createInput = input;
      return { ...source, ...input, id: 12, externalId: 'clone-external' };
    },
  };
  const service = new RuleSetCatalogService(repository);

  const clone = await service.cloneDefinition(
    { auth0Subject: 'auth0|author' },
    2,
    11,
    { name: 'Rending Claws' },
  );

  assert.equal(clone.name, 'Rending Claws');
  assert.equal(createInput.clonedFromId, 11);
  assert.equal(createInput.provenance.sourceDefinitionExternalId, 'source-external');
  assert.notEqual(createInput.body, source.body);
  createInput.body.fields[0].id = 'changed';
  assert.equal(source.body.fields[0].id, 'claws');
});

test('trait migration preserves stable identity, snapshots trait/1, and creates a trait/2 draft revision', async () => {
  const source = {
    body: {
      metamodelVersion: 'trait/1',
      grants: [{ dataType: 'number', key: 'rate' }],
    },
    definitionType: 'trait',
    externalId: 'trait:walk',
    id: 11,
    moduleId: 4,
    name: 'Walk',
    presentation: {},
    ruleSetId: 2,
    schemaVersion: 1,
    status: 'draft',
    tags: ['movement'],
    updatedAt: '2026-07-15T00:00:00.000Z',
    visibility: 'exported',
  };
  let updateInput;
  let snapshotInput;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getDefinition: async () => source,
    listDefinitions: async () => [source],
    updateDefinition: async (_actor, definitionId, input) => {
      updateInput = input;
      return { ...source, ...input, id: definitionId };
    },
  };
  const service = new RuleSetCatalogService(repository, {
    capture: async (input) => { snapshotInput = input; },
  });
  const preview = await service.previewTraitMigration(
    { auth0Subject: 'auth0|author' },
    2,
    11,
  );
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.pathChanges, []);

  const migrated = await service.migrateTraitDefinition(
    { auth0Subject: 'auth0|author' },
    2,
    11,
    { expectedUpdatedAt: source.updatedAt },
  );
  assert.equal(migrated.id, source.id);
  assert.equal(migrated.externalId, source.externalId);
  assert.equal(updateInput.body.metamodelVersion, 'trait/2');
  assert.equal(updateInput.schemaVersion, 2);
  assert.equal(snapshotInput.body.metamodelVersion, 'trait/1');
  assert.equal(snapshotInput.definitionExternalId, source.externalId);
  assert.equal(source.body.metamodelVersion, 'trait/1');
});

test('nested resources from another rule set are concealed as not found', async () => {
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getDefinition: async () => ({ id: 11, ruleSetId: 99, updatedAt: '2026-07-15T00:00:00.000Z' }),
  };
  const service = new RuleSetCatalogService(repository);

  await assert.rejects(
    service.updateDefinition(
      { auth0Subject: 'auth0|author' },
      2,
      11,
      { expectedUpdatedAt: '2026-07-15T00:00:00.000Z', name: 'Should not update' },
    ),
    (error) => error.getResponse().code === 'RULE_DEFINITION_NOT_FOUND',
  );
});

test('draft updates reject stale optimistic revisions', async () => {
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getDefinition: async () => ({
      id: 11,
      ruleSetId: 2,
      updatedAt: '2026-07-15T00:01:00.000Z',
    }),
  };
  const service = new RuleSetCatalogService(repository);

  await assert.rejects(
    service.updateDefinition(
      { auth0Subject: 'auth0|author' },
      2,
      11,
      { expectedUpdatedAt: '2026-07-15T00:00:00.000Z', name: 'Stale update' },
    ),
    (error) => {
      const response = error.getResponse();
      return response.code === 'RULE_DRAFT_STALE' && response.currentUpdatedAt === '2026-07-15T00:01:00.000Z';
    },
  );
});

test('non-empty modules cannot be deleted implicitly', async () => {
  let deleted = false;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getModule: async () => ({
      id: 4,
      ruleSetId: 2,
      status: 'draft',
      updatedAt: '2026-07-15T00:00:00.000Z',
    }),
    listDefinitions: async () => [{ id: 11, moduleId: 4, ruleSetId: 2 }],
    deleteModule: async () => { deleted = true; },
  };
  const service = new RuleSetCatalogService(repository);

  await assert.rejects(
    service.deleteModule(
      { auth0Subject: 'auth0|author' },
      2,
      4,
      '2026-07-15T00:00:00.000Z',
    ),
    (error) => {
      const response = error.getResponse();
      return response.code === 'RULE_MODULE_NOT_EMPTY' && response.definitionCount === 1;
    },
  );
  assert.equal(deleted, false);
});

test('draft definitions can be deleted with their observed revision', async () => {
  let deletedId;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getDefinition: async () => ({
      id: 11,
      ruleSetId: 2,
      status: 'draft',
      updatedAt: '2026-07-15T00:00:00.000Z',
    }),
    deleteDefinition: async (_actor, id) => { deletedId = id; },
  };
  const service = new RuleSetCatalogService(repository);

  const result = await service.deleteDefinition(
    { auth0Subject: 'auth0|author' },
    2,
    11,
    '2026-07-15T00:00:00.000Z',
  );

  assert.deepEqual(result, { deleted: true, id: 11 });
  assert.equal(deletedId, 11);
});

test('rule sets with immutable releases cannot be deleted', async () => {
  let deleted = false;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2, updatedAt: '2026-07-15T00:00:00.000Z' }),
    listReleases: async () => [{ id: 9, ruleSetId: 2 }],
    deleteRuleSet: async () => { deleted = true; },
  };
  const service = new RuleSetCatalogService(repository);

  await assert.rejects(
    service.delete({ auth0Subject: 'auth0|author' }, 2, '2026-07-15T00:00:00.000Z'),
    (error) => error.getResponse().code === 'RULE_SET_RELEASED',
  );
  assert.equal(deleted, false);
});

test('creature capability examples compile deterministically without Payload', () => {
  const first = compileCreatureCapabilities(creatureCapabilityExamples);
  const reordered = compileCreatureCapabilities([...creatureCapabilityExamples].reverse());

  assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
  assert.equal(reordered.valid, true, JSON.stringify(reordered.diagnostics));
  assert.equal(first.artifact.sourceHash, reordered.artifact.sourceHash);
  assert.equal(first.artifact.definitions.length, 6);
});

test('recursive trait contracts compile dice collections and inherited modifiers deterministically', () => {
  const definitions = [
    {
      externalId: 'trait:die',
      name: 'Die',
      body: {
        metamodelVersion: 'trait/1',
        grants: [{ dataType: 'number', key: 'sides', min: 1 }],
      },
    },
    {
      externalId: 'trait:d4',
      name: 'D4',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: { mode: 'all', ids: ['trait:die'] },
        grants: [{ dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 4 }],
      },
    },
    {
      externalId: 'trait:d10',
      name: 'D10',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: { mode: 'all', ids: ['trait:die'] },
        grants: [{ dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 10 }],
      },
    },
    {
      externalId: 'trait:dice-roll',
      name: 'Dice Roll',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'trait-collection', key: 'dice', acceptedTraits: ['trait:die'] },
          { dataType: 'trait', ref: 'trait:d10', into: 'self.dice', count: 3 },
          { dataType: 'trait', ref: 'trait:d4', into: 'self.dice', count: 4 },
        ],
      },
    },
  ];
  const first = compileTraitCompositions(definitions);
  const reordered = compileTraitCompositions([...definitions].reverse());

  assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
  assert.equal(first.artifact.sourceHash, reordered.artifact.sourceHash);
  const d10 = first.artifact.traits.find((trait) => trait.traitId === 'trait:d10');
  assert.deepEqual(d10.nodes.map((node) => [node.path.join('.'), node.kind]), [['sides', 'terminal']]);
  assert.deepEqual(d10.modifiers, [{
    sourceTraitId: 'trait:d10',
    anchor: 'self',
    operation: 'sets',
    path: ['sides'],
    amount: 10,
  }]);
  const roll = first.artifact.traits.find((trait) => trait.traitId === 'trait:dice-roll');
  assert.deepEqual(roll.nodes[0].entries, [
    { traitId: 'trait:d10', count: 3, sourceTraitId: 'trait:dice-roll' },
    { traitId: 'trait:d4', count: 4, sourceTraitId: 'trait:dice-roll' },
  ]);
  assert.deepEqual(first.artifact.activationEdges, [
    { fromTraitId: 'trait:d10', toTraitId: 'trait:die', kind: 'requires' },
    { fromTraitId: 'trait:d4', toTraitId: 'trait:die', kind: 'requires' },
    { fromTraitId: 'trait:dice-roll', toTraitId: 'trait:d10', kind: 'adds', path: 'self.dice[]', count: 3 },
    { fromTraitId: 'trait:dice-roll', toTraitId: 'trait:d4', kind: 'adds', path: 'self.dice[]', count: 4 },
  ]);
});

test('recursive trait compiler rejects incompatible collection entries and invalid modifier targets', () => {
  const result = compileTraitCompositions([
    {
      externalId: 'trait:die',
      name: 'Die',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'sides' }] },
    },
    {
      externalId: 'trait:coin',
      name: 'Coin',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'faces' }] },
    },
    {
      externalId: 'trait:bad-roll',
      name: 'Bad Roll',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'trait-collection', key: 'dice', acceptedTraits: ['trait:die'] },
          { dataType: 'trait', ref: 'trait:coin', into: 'self.dice', count: 1 },
          { dataType: 'modifier', operation: 'increases', field: 'self.missing', amount: 2 },
        ],
      },
    },
  ]);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'RULE_TRAIT_COLLECTION_TYPE_MISMATCH'));
  assert.ok(result.diagnostics.some((item) => item.code === 'RULE_TRAIT_MODIFIER_TARGET_INVALID'));
});

test('trait composition validation preserves keyless equipment-slot grants', () => {
  const result = compileTraitCompositions([
    {
      externalId: 'trait:item',
      name: 'Item',
      body: { metamodelVersion: 'trait/1', grants: [] },
    },
    {
      externalId: 'trait:equipped',
      name: 'Equipped',
      body: {
        metamodelVersion: 'trait/1',
        grants: [{
          dataType: 'slot',
          slotTypes: ['hand'],
          count: 2,
          acceptedTraits: ['trait:item'],
        }],
      },
    },
  ]);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test('trait/1 migration produces explicit trait/2 placement without semantic path changes', () => {
  const legacy = [
    {
      externalId: 'trait:walk',
      name: 'Walk',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'rate' }] },
    },
    {
      externalId: 'trait:speed',
      name: 'Speed',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: ['trait:walk'],
        grants: [{ dataType: 'trait', key: 'walk', ref: 'trait:walk' }],
      },
    },
  ];
  const previews = legacy.map((definition) =>
    previewTraitDefinitionMigration(definition, legacy));
  assert.ok(previews.every((preview) => preview.valid));
  assert.ok(previews.every((preview) => preview.pathChanges.length === 0));
  assert.deepEqual(previews[1].migratedBody, {
    metamodelVersion: 'trait/2',
    prerequisites: { mode: 'all', ids: ['trait:walk'] },
    grants: [{ dataType: 'trait', ref: 'trait:walk', at: 'this.walk' }],
  });

  const migrated = legacy.map((definition) => ({
    ...definition,
    body: migrateTraitBody(definition.body).migratedBody,
  }));
  const before = compileTraitCompositions(legacy);
  const after = compileTraitCompositions(migrated);
  assert.equal(before.valid, true, JSON.stringify(before.diagnostics));
  assert.equal(after.valid, true, JSON.stringify(after.diagnostics));
  assert.deepEqual(after.artifact.traits, before.artifact.traits);
  assert.deepEqual(after.artifact.activationEdges, before.artifact.activationEdges);
  assert.deepEqual(after.artifact.activationChoices, before.artifact.activationChoices);
});

test('trait/1 migration diagnoses missing placement keys instead of inventing paths', () => {
  const result = migrateTraitBody({
    metamodelVersion: 'trait/1',
    grants: [{ dataType: 'trait', ref: 'trait:walk' }],
  });
  assert.equal(result.valid, false);
  assert.equal(result.migratedBody, undefined);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_TRAIT_MIGRATION_PLACEMENT_MISSING'));
});

test('trait/2 compiler requires explicit addition placement', () => {
  const result = compileTraitCompositions([{
    externalId: 'trait:speed',
    name: 'Speed',
    body: {
      metamodelVersion: 'trait/2',
      grants: [{ dataType: 'trait', key: 'walk', ref: 'trait:walk' }],
    },
  }]);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_TRAIT_V2_PLACEMENT_REQUIRED'));
});

test('authoring validation recognizes enveloped trait/1 contracts', () => {
  const service = new RuleAuthoringService();
  const result = service.validate([{
    externalId: 'trait:die',
    name: 'Die',
    body: {
      metamodelVersion: 'trait/1',
      grants: [{ dataType: 'number', key: 'sides' }],
    },
  }]);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.compiled.metamodelVersion, 'trait/2');
  assert.equal(
    service.getMetamodel().extensions.find((extension) => extension.metamodelVersion === 'trait/2').artifactVersion,
    'trait-composition-artifact/1',
  );
});

test('catalog creation rejects an invalid recursive trait before persistence', async () => {
  let created = false;
  const definition = (id, externalId, name, body) => ({
    id,
    externalId,
    name,
    body,
    definitionType: 'trait',
    ruleSetId: 2,
  });
  const repository = {
    resolveActor: async (actor) => ({ ...actor, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ({ id: 2 }),
    getModule: async () => ({ id: 4, ruleSetId: 2 }),
    listDefinitions: async () => [
      definition(10, 'trait:die', 'Die', {
        metamodelVersion: 'trait/1',
        grants: [{ dataType: 'number', key: 'sides' }],
      }),
      definition(11, 'trait:coin', 'Coin', {
        metamodelVersion: 'trait/1',
        grants: [{ dataType: 'number', key: 'faces' }],
      }),
    ],
    createDefinition: async () => {
      created = true;
      return {};
    },
  };
  const service = new RuleSetCatalogService(repository);

  await assert.rejects(
    service.createDefinition(
      { auth0Subject: 'auth0|author' },
      2,
      {
        moduleId: 4,
        definitionType: 'trait',
        name: 'Bad Roll',
        body: {
          metamodelVersion: 'trait/1',
          grants: [
            { dataType: 'trait-collection', key: 'dice', acceptedTraits: ['trait:die'] },
            { dataType: 'trait', ref: 'trait:coin', into: 'self.dice', count: 1 },
          ],
        },
      },
    ),
    (error) => {
      const response = error.getResponse();
      return response.code === 'RULE_TRAIT_COMPOSITION_INVALID'
        && response.diagnostics.some((item) => item.code === 'RULE_TRAIT_COLLECTION_TYPE_MISMATCH');
    },
  );
  assert.equal(created, false);
});

function releaseFixture() {
  const timestamps = {
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T01:00:00.000Z',
  };
  const ruleSet = {
    id: 2,
    externalId: 'rules:core',
    name: 'Core Rules',
    slug: 'core-rules',
    summary: 'Core rules.',
    lifecycle: 'active',
    engineFeatureLevel: '1',
    dashboard: { featured: false },
    tags: [],
    status: 'draft',
    ...timestamps,
  };
  const modules = [{
    id: 4,
    externalId: 'module:dice',
    ruleSetId: 2,
    namespace: 'dice',
    name: 'Dice',
    sortOrder: 0,
    requiredEngineFeatureLevel: '1',
    dependencies: [],
    exports: [],
    status: 'draft',
    ...timestamps,
  }];
  const definition = (id, externalId, name, body) => ({
    id,
    externalId,
    ruleSetId: 2,
    moduleId: 4,
    definitionType: 'trait',
    name,
    schemaVersion: 1,
    visibility: 'exported',
    body,
    tags: [],
    status: 'draft',
    ...timestamps,
  });
  const definitions = [
    definition(10, 'trait:die', 'Die', {
      metamodelVersion: 'trait/1',
      grants: [{ dataType: 'number', key: 'sides' }],
    }),
    definition(11, 'trait:d10', 'D10', {
      metamodelVersion: 'trait/1',
      prerequisites: { mode: 'all', ids: ['trait:die'] },
      grants: [{ dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 10 }],
    }),
    definition(12, 'trait:dice-roll', 'Dice Roll', {
      metamodelVersion: 'trait/1',
      grants: [
        { dataType: 'trait-collection', key: 'dice', acceptedTraits: ['trait:die'] },
        { dataType: 'trait', ref: 'trait:d10', into: 'self.dice', count: 3 },
      ],
    }),
  ];
  return { ruleSet, modules, definitions };
}

test('release compiler produces a deterministic immutable source snapshot and trait artifact', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  const first = compileRuleRelease(ruleSet, modules, definitions);
  const reordered = compileRuleRelease(ruleSet, [...modules].reverse(), [...definitions].reverse());

  assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
  assert.equal(reordered.valid, true, JSON.stringify(reordered.diagnostics));
  assert.equal(first.release.contentHash, reordered.release.contentHash);
  assert.equal(first.release.manifest.formatVersion, 'rule-release/1');
  assert.equal(first.release.manifest.compilerVersion, 'rule-release-compiler/1');
  assert.equal(first.release.manifest.artifacts.traitComposition.metamodelVersion, 'trait/2');
  assert.deepEqual(first.release.manifest.artifacts.traitComposition.activationEdges, [
    { fromTraitId: 'trait:d10', toTraitId: 'trait:die', kind: 'requires' },
    { fromTraitId: 'trait:dice-roll', toTraitId: 'trait:d10', kind: 'adds', path: 'self.dice[]', count: 3 },
  ]);
  assert.equal(first.release.sourceSnapshot.definitions.length, 3);
});

test('release compilation verifies normalized die sides against the selected reusable trait', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  const check = {
    ...definitions[0],
    id: 20,
    externalId: 'check:damage',
    definitionType: 'check',
    name: 'Damage',
    body: {
      formatVersion: '1',
      metamodelVersion: 'resolution/1',
      definitionType: 'check',
      definitionId: 'check:damage',
      name: 'Damage',
      checkKind: 'target-number',
      roll: { dice: [{ dieTraitId: 'trait:d10', count: 1, sides: 12 }], rollKind: 'damage' },
      bonus: { op: 'literal', value: 0 },
      target: { op: 'literal', value: 0 },
      comparison: 'gte',
    },
  };
  const result = compileRuleRelease(ruleSet, modules, [...definitions, check]);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_RELEASE_DIE_SIDES_MISMATCH'
    && diagnostic.message.includes('compiles to 10 sides')));
});

test('release compilation binds a check to the exact pool produced by a Dice Roll trait', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  const makeCheck = (count) => ({
    ...definitions[0],
    id: 21,
    externalId: 'check:brutal-damage',
    definitionType: 'check',
    name: 'Brutal Damage',
    body: {
      formatVersion: '1',
      metamodelVersion: 'resolution/1',
      definitionType: 'check',
      definitionId: 'check:brutal-damage',
      name: 'Brutal Damage',
      checkKind: 'target-number',
      roll: {
        rollTraitId: 'trait:dice-roll',
        dice: [{ dieTraitId: 'trait:d10', count, sides: 10 }],
        rollKind: 'damage',
      },
      bonus: { op: 'literal', value: 0 },
      target: { op: 'literal', value: 0 },
      comparison: 'gte',
    },
  });

  const valid = compileRuleRelease(ruleSet, modules, [...definitions, makeCheck(3)]);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  const stalePool = compileRuleRelease(ruleSet, modules, [...definitions, makeCheck(2)]);
  assert.equal(stalePool.valid, false);
  assert.ok(stalePool.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_RELEASE_ROLL_TRAIT_POOL_MISMATCH'));
});

test('release compilation rejects semantic modifier targets that are not complete roll traits', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  const modifier = {
    ...definitions[0],
    id: 22,
    externalId: 'modifier:unknown-roll',
    definitionType: 'modifier',
    name: 'Unknown Roll Modifier',
    body: {
      formatVersion: '1',
      metamodelVersion: 'resolution/1',
      definitionType: 'modifier',
      definitionId: 'modifier:unknown-roll',
      name: 'Unknown Roll Modifier',
      appliesTo: { rollTraitIds: ['trait:not-a-roll'] },
      activatedByTraitIds: ['trait:not-a-trait'],
      subjectTraitIds: ['trait:not-a-subject'],
      operation: 'add',
      value: { op: 'literal', value: 1 },
    },
  };
  const result = compileRuleRelease(ruleSet, modules, [...definitions, modifier]);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_RELEASE_ROLL_TRAIT_TARGET_INVALID'));
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_RELEASE_ACTIVATING_TRAIT_INVALID'));
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_RELEASE_SUBJECT_TRAIT_INVALID'));
});

test('release compilation rejects trait paths outside the declared self contract', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  const check = {
    ...definitions[0],
    id: 23,
    externalId: 'check:bad-subject-path',
    definitionType: 'check',
    name: 'Bad Subject Path',
    body: {
      formatVersion: '1',
      metamodelVersion: 'resolution/1',
      definitionType: 'check',
      definitionId: 'check:bad-subject-path',
      name: 'Bad Subject Path',
      subjectTraitIds: ['trait:dice-roll'],
      checkKind: 'target-number',
      roll: { dice: [{ dieTraitId: 'trait:d10', count: 1, sides: 10 }], rollKind: 'damage' },
      bonus: { op: 'trait-path-field', path: 'self.speed.walk.rate' },
      target: { op: 'literal', value: 0 },
      comparison: 'gte',
    },
  };
  const result = compileRuleRelease(ruleSet, modules, [...definitions, check]);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_RELEASE_TRAIT_PATH_OUTSIDE_SUBJECT'));
});

test('release compilation validates operation paths against inherited check contracts', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  const checkBody = {
    formatVersion: '1',
    metamodelVersion: 'resolution/1',
    definitionType: 'check',
    definitionId: 'check:damage-contract',
    name: 'Damage Contract',
    subjectTraitIds: ['trait:dice-roll'],
    checkKind: 'target-number',
    roll: { dice: [{ dieTraitId: 'trait:d10', count: 1, sides: 10 }], rollKind: 'damage' },
    bonus: { op: 'literal', value: 0 },
    target: { op: 'literal', value: 0 },
    comparison: 'gte',
  };
  const operationBody = {
    formatVersion: '1',
    metamodelVersion: 'resolution/1',
    definitionType: 'operation',
    definitionId: 'operation:damage-contract',
    name: 'Damage Contract Operation',
    startStepId: 'roll',
    budget: { maximumSteps: 2 },
    steps: [
      { stepId: 'roll', kind: 'perform-check', checkId: checkBody.definitionId, resultKey: 'damage', onSuccess: 'done', onFailure: 'done' },
      {
        stepId: 'done',
        kind: 'return',
        outcome: 'success',
        data: {
          firstDieSides: {
            op: 'trait-path-field',
            path: 'self.dice[].sides',
            mountSelector: { mode: 'ordinal', ordinal: 1 },
          },
        },
      },
    ],
  };
  const resource = (id, body) => ({
    ...definitions[0],
    id,
    externalId: body.definitionId,
    definitionType: body.definitionType,
    name: body.name,
    body,
  });
  const result = compileRuleRelease(ruleSet, modules, [
    ...definitions,
    resource(24, checkBody),
    resource(25, operationBody),
  ]);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.release.manifest.artifacts.resolution.operationSubjectContracts['operation:damage-contract'].effectiveTraitIds,
    ['trait:dice-roll'],
  );
});

test('release compiler rejects unversioned definitions instead of publishing opaque JSON', () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  definitions.push({
    ...definitions[0],
    id: 13,
    externalId: 'trait:opaque',
    name: 'Opaque',
    body: { arbitrary: true },
  });
  const result = compileRuleRelease(ruleSet, modules, definitions);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'RULE_RELEASE_METAMODEL_UNKNOWN'));
});

test('publishing compiles and persists one content-addressed release', async () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  let createInput;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, userId: 5, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ruleSet,
    listModules: async () => modules,
    listDefinitions: async () => definitions,
    listReleases: async () => [],
    createRelease: async (_actor, _ruleSetId, input) => {
      createInput = input;
      return {
        id: 20,
        externalId: 'release:one',
        ruleSetId: 2,
        lifecycle: 'published',
        createdAt: input.publishedAt,
        updatedAt: input.publishedAt,
        ...input,
      };
    },
  };
  const service = new RuleSetCatalogService(repository);
  const release = await service.publish(
    { auth0Subject: 'auth0|author' },
    2,
    {
      version: '1.0.0',
      expectedUpdatedAt: ruleSet.updatedAt,
      releaseNotes: 'First release',
    },
  );

  assert.equal(release.version, '1.0.0');
  assert.equal(createInput.publishedById, 5);
  assert.equal(createInput.manifest.artifacts.traitComposition.artifactVersion, 'trait-composition-artifact/1');
  assert.equal(createInput.sourceSnapshot.definitions.length, 3);
  assert.match(createInput.contentHash, /^[a-f0-9]{64}$/);
});

test('publishing aborts when a definition changes during compilation', async () => {
  const { ruleSet, modules, definitions } = releaseFixture();
  let definitionReads = 0;
  let created = false;
  const repository = {
    resolveActor: async (actor) => ({ ...actor, userId: 5, workspaceExternalId: 'workspace' }),
    getRuleSet: async () => ruleSet,
    listModules: async () => modules,
    listDefinitions: async () => {
      definitionReads += 1;
      return definitionReads === 1
        ? definitions
        : definitions.map((definition, index) => index === 0
          ? { ...definition, updatedAt: '2026-07-23T02:00:00.000Z' }
          : definition);
    },
    listReleases: async () => [],
    createRelease: async () => {
      created = true;
      return {};
    },
  };
  const service = new RuleSetCatalogService(repository);

  await assert.rejects(
    service.publish(
      { auth0Subject: 'auth0|author' },
      2,
      { version: '1.0.0', expectedUpdatedAt: ruleSet.updatedAt },
    ),
    (error) => error.getResponse().code === 'RULE_PUBLISH_STALE',
  );
  assert.equal(created, false);
});

test('Vision returns a typed observation and Running derives from Walking', () => {
  const compilation = compileCreatureCapabilities(creatureCapabilityExamples);
  const evaluation = evaluateCreatureCapabilities(compilation.artifact, {
    fields: { 'field:walking-speed': 7 },
    traits: [
      { traitId: 'trait:legged' },
      { traitId: 'trait:running' },
      { traitId: 'trait:vision', parameters: { 'vision-distance': 40 } },
      { traitId: 'trait:hearing' },
    ],
  });

  assert.equal(evaluation.capabilities['movement.walk'].rate, 7);
  assert.equal(evaluation.capabilities['movement.run'].rate, 14);
  assert.deepEqual(
    evaluateCreatureCapabilities(compilation.artifact, {
      fields: { 'field:walking-speed': 7 },
      traits: [
        { traitId: 'trait:legged' },
        { traitId: 'trait:running' },
        { traitId: 'trait:vision', parameters: { 'vision-distance': 40 } },
        { traitId: 'trait:hearing' },
      ],
    }),
    evaluation,
  );
  assert.deepEqual(
    evaluateVisualObservation(evaluation, {
      distance: 35,
      lighting: 'normal-daytime',
      hasLineOfSight: true,
      opaqueBarrier: false,
    }),
    {
      channel: 'visual',
      perceived: true,
      distance: 35,
      maximumRange: 40,
      blockedBy: null,
    },
  );
  assert.equal(
    evaluateVisualObservation(evaluation, {
      distance: 41,
      lighting: 'normal-daytime',
      hasLineOfSight: true,
      opaqueBarrier: false,
    }).blockedBy,
    'range',
  );
  assert.ok(evaluation.trace.some((entry) => entry.path === 'capabilities.movement.run'));
});

test('the same capability contract supports a non-fantasy sonar trait', () => {
  const compilation = compileCreatureCapabilities([nonFantasyCapabilityExample]);
  assert.equal(compilation.valid, true, JSON.stringify(compilation.diagnostics));
  const evaluation = evaluateCreatureCapabilities(compilation.artifact, {
    traits: [{ traitId: 'trait:sonar-array', parameters: { 'sonar-range': 1200 } }],
  });
  assert.deepEqual(evaluation.capabilities['perception.audio'], {
    maximumRange: 1200,
    minimumVolume: 0.01,
    attenuation: 'linear',
  });
});

test('metamodel validation rejects unknown semantic fields with stable paths', () => {
  const invalid = {
    ...creatureCapabilityExamples[0],
    executableJavascript: 'return 999',
  };
  const result = compileCreatureCapabilities([invalid]);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.diagnostics.find((entry) => entry.code === 'RULE_UNKNOWN_SEMANTIC_FIELD'),
    {
      code: 'RULE_UNKNOWN_SEMANTIC_FIELD',
      message: "Unknown semantic field 'executableJavascript'.",
      path: 'definitions[0].executableJavascript',
      severity: 'error',
    },
  );
});

test('metamodel validation reports malformed drafts instead of throwing', () => {
  const result = compileCreatureCapabilities([{
    formatVersion: '1',
    metamodelVersion: 'creature-capabilities/1',
    definitionId: 'trait:broken',
    definitionType: 'trait',
    name: 'Broken',
    parameters: [{ parameterId: 'range', name: 'Range' }],
    contributes: [{ capability: 'perception.visual', values: null }],
  }]);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((entry) => entry.path === 'definitions[0].parameters[0].value'));
  assert.ok(result.diagnostics.some((entry) => entry.path === 'definitions[0].contributes[0].values'));
});

test('authoring service exposes versioned descriptors and compilation diagnostics', () => {
  const service = new RuleAuthoringService();
  assert.equal(service.getMetamodel().metamodelVersion, 'creature-capabilities/1');
  assert.equal(service.getDescriptor('trait').definitionType, 'trait');
  assert.equal(service.getDescriptor('trait').semanticFrames.length, 2);
  assert.equal(service.validate(creatureCapabilityExamples).valid, true);
});

test('rule sentence parser extracts semantic slots and deterministic draft patches', () => {
  const parser = new RuleSentenceParserService();
  const result = parser.parse('When the scout attacks from cover, roll 2d6+1 damage and gain +2 bonus if target is unaware.');

  assert.ok(result.slots.length >= 1);
  assert.ok(result.slots[0].confidence >= 0.5);
  assert.ok(result.slots[0].parameters.some((parameter) => parameter.kind === 'dice'));
  assert.ok(result.slots[0].predicates.some((predicate) => predicate.startsWith('when ')));
  assert.ok(result.draftDefinitionPatches.length >= 1);
  assert.ok(result.draftDefinitionPatches.some((patch) => patch.definitionType === 'check' || patch.definitionType === 'modifier'));
});

test('authoring service delegates assistant sentence parsing to the assistant provider', () => {
  let receivedMessage;
  const expected = {
    slots: [{ sentence: 'test', parameters: [], predicates: [], confidence: 1 }],
    draftDefinitionPatches: [],
  };
  const service = new RuleAuthoringService({
    parseSentence(message) {
      receivedMessage = message;
      return expected;
    },
  });

  const parsed = service.parseRuleSentence('the actor may roll 1d20');
  assert.equal(receivedMessage, 'the actor may roll 1d20');
  assert.deepEqual(parsed, expected);
});

test('Phase 2 melee resolution compiles and produces a deterministic trace', () => {
  const first = compileResolutionDefinitions(meleeResolutionExamples);
  const second = compileResolutionDefinitions([...meleeResolutionExamples].reverse());
  assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
  assert.equal(first.artifact.sourceHash, second.artifact.sourceHash);

  const preview = previewResolutionOperation(first.artifact, meleeResolutionFixtures[0].operationId, meleeResolutionFixtures[0].context);
  assert.equal(preview.outcome, 'success');
  assert.deepEqual(preview.entropyConsumed, [14]);
  assert.deepEqual(preview.resourceChanges, [{ resourceId: 'resource:action-points', before: 2, after: 1 }]);
  assert.deepEqual(preview.effects, [{ effectId: 'effect:wounded', targetId: 'creature:target' }]);
  assert.equal(preview.events[0].eventId, 'event:melee-attack-hit');
  assert.equal(preview.events[0].payload.total, 18);
  assert.equal(preview.trace[1].values.total, 18);
  assert.deepEqual(
    previewResolutionOperation(first.artifact, meleeResolutionFixtures[0].operationId, meleeResolutionFixtures[0].context),
    preview,
  );
});

test('roll-result modifiers preserve die traits and provenance for add, replace, and increase', () => {
  const base = { formatVersion: '1', metamodelVersion: 'resolution/1' };
  const returnOperation = (definitionId, checkId) => ({
    ...base,
    definitionType: 'operation',
    definitionId,
    name: definitionId,
    startStepId: 'roll',
    budget: { maximumSteps: 2 },
    steps: [
      { stepId: 'roll', kind: 'perform-check', checkId, resultKey: 'result', onSuccess: 'done', onFailure: 'done' },
      {
        stepId: 'done',
        kind: 'return',
        outcome: 'success',
        data: {
          total: { op: 'result', key: 'result', property: 'total' },
          damage: { op: 'result', key: 'result', property: 'damage' },
        },
      },
    ],
  });
  const definitions = [
    {
      ...base,
      definitionType: 'check',
      definitionId: 'check:attack-roll',
      name: 'Attack Roll',
      checkKind: 'target-number',
      roll: { rollTraitId: 'trait:attack-roll', dice: [{ dieTraitId: 'trait:d20', count: 1, sides: 20 }], rollKind: 'hit' },
      bonus: { op: 'literal', value: 0 },
      target: { op: 'literal', value: 10 },
      comparison: 'gte',
    },
    {
      ...base,
      definitionType: 'modifier',
      definitionId: 'modifier:blessed',
      name: 'Blessed',
      modifierKind: 'roll-result',
      appliesTo: { rollKinds: ['hit'] },
      priority: 0,
      selector: { dieTraitIds: ['trait:d20'], rawResults: [1], origins: ['original'] },
      rollOperation: { kind: 'replace-result', die: { dieTraitId: 'trait:d20', sides: 20 }, maximumApplications: 1 },
    },
    {
      ...base,
      definitionType: 'modifier',
      definitionId: 'modifier:brutal',
      name: 'Brutal',
      modifierKind: 'roll-result',
      appliesTo: { rollKinds: ['hit'] },
      activatedByTraitIds: ['trait:brutal'],
      priority: 10,
      rollOperation: { kind: 'add-dice', dice: { dieTraitId: 'trait:d10', count: 1, sides: 10, rollKind: 'damage' } },
    },
    {
      ...base,
      definitionType: 'modifier',
      definitionId: 'modifier:roll-specialist',
      name: 'Roll Specialist',
      appliesTo: { rollTraitIds: ['trait:attack-roll'] },
      activatedByTraitIds: ['trait:roll-specialist'],
      operation: 'add',
      value: { op: 'literal', value: 2 },
    },
    {
      ...base,
      definitionType: 'effect',
      definitionId: 'effect:blessing',
      name: 'Blessing',
      duration: { kind: 'persistent' },
      modifierIds: ['modifier:blessed'],
    },
    returnOperation('operation:attack-roll', 'check:attack-roll'),
    {
      ...base,
      definitionType: 'operation',
      definitionId: 'operation:blessed-attack',
      name: 'Blessed Attack',
      startStepId: 'apply-blessing',
      budget: { maximumSteps: 3 },
      steps: [
        { stepId: 'apply-blessing', kind: 'apply-effect', effectId: 'effect:blessing', target: 'actor', next: 'roll' },
        { stepId: 'roll', kind: 'perform-check', checkId: 'check:attack-roll', resultKey: 'result', onSuccess: 'done', onFailure: 'done' },
        { stepId: 'done', kind: 'return', outcome: 'success', data: { total: { op: 'result', key: 'result', property: 'total' }, damage: { op: 'result', key: 'result', property: 'damage' } } },
      ],
    },
    {
      ...base,
      definitionType: 'check',
      definitionId: 'check:d4-roll',
      name: 'D4 Roll',
      checkKind: 'target-number',
      roll: { dice: [{ dieTraitId: 'trait:d4', count: 1, sides: 4 }], rollKind: 'damage' },
      bonus: { op: 'literal', value: 0 },
      target: { op: 'literal', value: 0 },
      comparison: 'gte',
    },
    {
      ...base,
      definitionType: 'modifier',
      definitionId: 'modifier:empowered',
      name: 'Empowered',
      modifierKind: 'roll-result',
      appliesTo: { allRolls: true },
      activatedByTraitIds: ['trait:empowered'],
      selector: { dieTraitIds: ['trait:d4'] },
      rollOperation: { kind: 'increase-result', value: { op: 'literal', value: 2 } },
    },
    returnOperation('operation:d4-roll', 'check:d4-roll'),
  ];
  const compilation = compileResolutionDefinitions(definitions);
  assert.equal(compilation.valid, true, JSON.stringify(compilation.diagnostics));
  const traitCompilation = compileTraitCompositions([
    {
      externalId: 'trait:all-features',
      name: 'All Features',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'trait', key: 'brutal', ref: 'trait:brutal' },
          { dataType: 'trait', key: 'empowered', ref: 'trait:empowered' },
          { dataType: 'trait', key: 'roll-specialist', ref: 'trait:roll-specialist' },
        ],
      },
    },
    { externalId: 'trait:brutal', name: 'Brutal', body: { metamodelVersion: 'trait/1', grants: [] } },
    { externalId: 'trait:empowered', name: 'Empowered', body: { metamodelVersion: 'trait/1', grants: [] } },
    { externalId: 'trait:roll-specialist', name: 'Roll Specialist', body: { metamodelVersion: 'trait/1', grants: [] } },
  ]);
  assert.equal(traitCompilation.valid, true, JSON.stringify(traitCompilation.diagnostics));

  const attack = previewResolutionOperation(compilation.artifact, 'operation:blessed-attack', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitIds: ['trait:all-features'],
    entropy: [1, 15, 8],
  }, traitCompilation.artifact);
  assert.deepEqual(attack.entropyConsumed, [1, 15, 8]);
  assert.equal(attack.rolls[0].rollTraitId, 'trait:attack-roll');
  assert.equal(attack.rolls[0].dice[0].sourceRollTraitId, 'trait:attack-roll');
  assert.equal(attack.rolls[0].dice[1].sourceRollTraitId, undefined, 'replacement dice retain modifier provenance instead');
  assert.equal(attack.rolls[0].total, 17, 'damage dice do not change the attack total, while a matching roll-trait modifier does');
  assert.deepEqual(attack.rolls[0].totals, { hit: 15, damage: 8 });
  assert.deepEqual(attack.rolls[0].appliedModifierIds, ['modifier:blessed', 'modifier:brutal', 'modifier:roll-specialist']);
  assert.deepEqual(attack.rolls[0].modifierActivations, [
    { modifierId: 'modifier:blessed', sources: [{ kind: 'effect', id: 'effect:blessing' }] },
    { modifierId: 'modifier:brutal', sources: [{ kind: 'trait', id: 'trait:brutal', rootTraitId: 'trait:all-features', traitChain: ['trait:all-features', 'trait:brutal'] }] },
    { modifierId: 'modifier:roll-specialist', sources: [{ kind: 'trait', id: 'trait:roll-specialist', rootTraitId: 'trait:all-features', traitChain: ['trait:all-features', 'trait:roll-specialist'] }] },
  ]);
  assert.deepEqual(attack.activeTraits.map((trait) => trait.traitId), [
    'trait:all-features',
    'trait:brutal',
    'trait:empowered',
    'trait:roll-specialist',
  ]);
  assert.equal(attack.data.damage, 8);
  assert.deepEqual(
    attack.rolls[0].dice.map((die) => ({
      trait: die.dieTraitId,
      raw: die.rawResult,
      effective: die.effectiveResult,
      origin: die.origin,
      active: die.active,
      source: die.sourceDefinitionId,
    })),
    [
      { trait: 'trait:d20', raw: 1, effective: 1, origin: 'original', active: false, source: 'check:attack-roll' },
      { trait: 'trait:d20', raw: 15, effective: 15, origin: 'replacement', active: true, source: 'modifier:blessed' },
      { trait: 'trait:d10', raw: 8, effective: 8, origin: 'added', active: true, source: 'modifier:brutal' },
    ],
  );

  const empowered = previewResolutionOperation(compilation.artifact, 'operation:d4-roll', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitIds: ['trait:all-features'],
    activeEffectIds: ['effect:blessing'],
    entropy: [3],
  }, traitCompilation.artifact);
  assert.equal(empowered.rolls[0].dice[0].rawResult, 3);
  assert.equal(empowered.rolls[0].dice[0].effectiveResult, 5);
  assert.deepEqual(empowered.rolls[0].dice[0].appliedModifierIds, ['modifier:empowered']);
  assert.deepEqual(empowered.rolls[0].appliedModifierIds, ['modifier:empowered']);
  assert.deepEqual(empowered.rolls[0].modifierActivations, [
    { modifierId: 'modifier:empowered', sources: [{ kind: 'trait', id: 'trait:empowered', rootTraitId: 'trait:all-features', traitChain: ['trait:all-features', 'trait:empowered'] }] },
  ]);
  assert.equal(empowered.rolls[0].total, 5);

  const choiceCompilation = compileTraitCompositions([
    {
      externalId: 'trait:adaptive-training',
      name: 'Adaptive Training',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: { mode: 'any', ids: ['trait:brutal', 'trait:empowered'] },
        grants: [{ dataType: 'enum', key: 'stance', allowedValues: ['brutal', 'empowered'] }],
      },
    },
    { externalId: 'trait:brutal', name: 'Brutal', body: { metamodelVersion: 'trait/1', grants: [] } },
    { externalId: 'trait:empowered', name: 'Empowered', body: { metamodelVersion: 'trait/1', grants: [] } },
  ]);
  assert.deepEqual(choiceCompilation.artifact.activationChoices, [{
    traitId: 'trait:adaptive-training',
    optionTraitIds: ['trait:brutal', 'trait:empowered'],
  }]);
  const selectedChoice = previewResolutionOperation(compilation.artifact, 'operation:blessed-attack', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitIds: ['trait:adaptive-training'],
    traitPrerequisiteSelections: { 'trait:adaptive-training': ['trait:brutal'] },
    entropy: [1, 15, 8],
  }, choiceCompilation.artifact);
  assert.deepEqual(selectedChoice.traitChoices, [{
    traitId: 'trait:adaptive-training',
    selectedTraitIds: ['trait:brutal'],
    source: 'context',
  }]);
  assert.deepEqual(selectedChoice.activeTraits.map((trait) => trait.traitId), ['trait:adaptive-training', 'trait:brutal']);
  assert.equal(selectedChoice.rolls[0].totals.damage, 8);
  assert.throws(
    () => previewResolutionOperation(compilation.artifact, 'operation:attack-roll', {
      actor: { id: 'actor:one', fields: {}, resources: {} },
      target: { id: 'target:one', fields: {} },
      activeTraitIds: ['trait:adaptive-training'],
      entropy: [10],
    }, choiceCompilation.artifact),
    /requires a prerequisite selection/,
  );
  const rootFallback = previewResolutionOperation(compilation.artifact, 'operation:d4-roll', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitIds: ['trait:adaptive-training', 'trait:empowered'],
    entropy: [2],
  }, choiceCompilation.artifact);
  assert.deepEqual(rootFallback.traitChoices, [{
    traitId: 'trait:adaptive-training',
    selectedTraitIds: ['trait:empowered'],
    source: 'active-roots',
  }]);

  const instanceChoices = previewResolutionOperation(compilation.artifact, 'operation:blessed-attack', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [
      { instanceId: 'training:left', traitId: 'trait:adaptive-training', values: { stance: 'brutal' } },
      { instanceId: 'training:right', traitId: 'trait:adaptive-training', values: { stance: 'empowered' } },
    ],
    traitInstancePrerequisiteSelections: {
      'training:left': ['trait:brutal'],
      'training:right': ['trait:empowered'],
    },
    entropy: [1, 15, 8],
  }, choiceCompilation.artifact);
  assert.deepEqual(instanceChoices.traitChoices, [
    {
      traitId: 'trait:adaptive-training',
      traitInstanceId: 'training:left',
      selectedTraitIds: ['trait:brutal'],
      source: 'context',
    },
    {
      traitId: 'trait:adaptive-training',
      traitInstanceId: 'training:right',
      selectedTraitIds: ['trait:empowered'],
      source: 'context',
    },
  ]);
  assert.deepEqual(
    instanceChoices.activeTraitInstances
      .filter((instance) => instance.traitId === 'trait:adaptive-training')
      .map((instance) => ({ instanceId: instance.instanceId, values: instance.values })),
    [
      { instanceId: 'training:left', values: { stance: 'brutal' } },
      { instanceId: 'training:right', values: { stance: 'empowered' } },
    ],
  );
  assert.ok(instanceChoices.rolls[0].modifierActivations
    .find((activation) => activation.modifierId === 'modifier:brutal')
    .sources.some((source) =>
      source.instanceId === 'training:left/choice:trait%3Abrutal'
      && source.rootInstanceId === 'training:left'));
  assert.throws(
    () => previewResolutionOperation(compilation.artifact, 'operation:d4-roll', {
      actor: { id: 'actor:one', fields: {}, resources: {} },
      target: { id: 'target:one', fields: {} },
      activeTraitInstances: [
        { instanceId: 'training:left', traitId: 'trait:adaptive-training' },
        { instanceId: 'training:right', traitId: 'trait:adaptive-training' },
      ],
      traitPrerequisiteSelections: { 'trait:adaptive-training': ['trait:empowered'] },
      entropy: [2],
    }, choiceCompilation.artifact),
    /ambiguous across instances/,
  );

  const countedCompilation = compileTraitCompositions([
    { externalId: 'trait:die', name: 'Die', body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'sides' }] } },
    { externalId: 'trait:d10', name: 'D10', body: { metamodelVersion: 'trait/1', prerequisites: ['trait:die'], grants: [{ dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 10 }] } },
    {
      externalId: 'trait:dice-roll',
      name: 'Dice Roll',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'trait-collection', key: 'dice', acceptedTraits: ['trait:die'], acceptsMode: 'any' },
          { dataType: 'trait', ref: 'trait:d10', into: 'self.dice', count: 3 },
          { dataType: 'modifier', operation: 'increases', field: 'self.dice[].sides', amount: 2, mountSelector: { mode: 'all' } },
          { dataType: 'modifier', operation: 'increases', field: 'self.dice[].sides', amount: 3, mountSelector: { mode: 'ordinal', ordinal: 2 } },
        ],
      },
    },
  ]);
  assert.equal(countedCompilation.valid, true, JSON.stringify(countedCompilation.diagnostics));
  assert.deepEqual(
    countedCompilation.artifact.traits.find((trait) => trait.traitId === 'trait:dice-roll').modifiers,
    [
      {
        sourceTraitId: 'trait:dice-roll',
        anchor: 'self',
        operation: 'increases',
        path: ['dice[]', 'sides'],
        amount: 2,
        mountSelector: { mode: 'all' },
      },
      {
        sourceTraitId: 'trait:dice-roll',
        anchor: 'self',
        operation: 'increases',
        path: ['dice[]', 'sides'],
        amount: 3,
        mountSelector: { mode: 'ordinal', ordinal: 2 },
      },
    ],
  );
  const counted = previewResolutionOperation(compilation.artifact, 'operation:d4-roll', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [{ instanceId: 'roll:damage', traitId: 'trait:dice-roll' }],
    entropy: [2],
  }, countedCompilation.artifact);
  assert.deepEqual(
    counted.activeTraitInstances
      .filter((instance) => instance.traitId === 'trait:d10')
      .map((instance) => ({ instanceId: instance.instanceId, ordinal: instance.ordinal })),
    [
      { instanceId: 'roll:damage/adds:self.dice%5B%5D:trait%3Ad10#1', ordinal: 1 },
      { instanceId: 'roll:damage/adds:self.dice%5B%5D:trait%3Ad10#2', ordinal: 2 },
      { instanceId: 'roll:damage/adds:self.dice%5B%5D:trait%3Ad10#3', ordinal: 3 },
    ],
  );
  assert.deepEqual(
    counted.activeTraitInstances
      .filter((instance) => instance.traitId === 'trait:d10')
      .map((instance) => instance.values.sides),
    [12, 15, 12],
  );
  assert.deepEqual(
    counted.activeTraitInstances
      .filter((instance) => instance.traitId === 'trait:d10')
      .map((instance) => instance.valueModifiers.map((modifier) => ({
        sourceTraitId: modifier.sourceTraitId,
        mountSelector: modifier.mountSelector,
        before: modifier.before,
        after: modifier.after,
      }))),
    [
      [
        { sourceTraitId: 'trait:d10', mountSelector: undefined, before: undefined, after: 10 },
        { sourceTraitId: 'trait:dice-roll', mountSelector: { mode: 'all' }, before: 10, after: 12 },
      ],
      [
        { sourceTraitId: 'trait:d10', mountSelector: undefined, before: undefined, after: 10 },
        { sourceTraitId: 'trait:dice-roll', mountSelector: { mode: 'all' }, before: 10, after: 12 },
        { sourceTraitId: 'trait:dice-roll', mountSelector: { mode: 'ordinal', ordinal: 2 }, before: 12, after: 15 },
      ],
      [
        { sourceTraitId: 'trait:d10', mountSelector: undefined, before: undefined, after: 10 },
        { sourceTraitId: 'trait:dice-roll', mountSelector: { mode: 'all' }, before: 10, after: 12 },
      ],
    ],
  );
  const pathCheck = {
    ...base,
    definitionType: 'check',
    definitionId: 'check:second-die-sides',
    name: 'Second Die Sides',
    subjectTraitIds: ['trait:dice-roll'],
    checkKind: 'target-number',
    roll: { count: 1, sides: 20, rollKind: 'damage' },
    bonus: { op: 'trait-path-field', path: 'self.dice[].sides', mountSelector: { mode: 'ordinal', ordinal: 2 } },
    target: { op: 'literal', value: 16 },
    comparison: 'gte',
  };
  const pathResolution = compileResolutionDefinitions([
    pathCheck,
    returnOperation('operation:second-die-sides', pathCheck.definitionId),
  ]);
  assert.equal(pathResolution.valid, true, JSON.stringify(pathResolution.diagnostics));
  assert.deepEqual(
    pathResolution.artifact.operationSubjectContracts['operation:second-die-sides'],
    {
      directTraitIds: [],
      inheritedTraitIds: ['trait:dice-roll'],
      effectiveTraitIds: ['trait:dice-roll'],
      checkSources: [{ checkId: 'check:second-die-sides', traitIds: ['trait:dice-roll'] }],
    },
  );
  const pathPreview = previewResolutionOperation(pathResolution.artifact, 'operation:second-die-sides', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [{ instanceId: 'roll:path', traitId: 'trait:dice-roll' }],
    entropy: [1],
  }, countedCompilation.artifact);
  assert.equal(pathPreview.rolls[0].bonus, 15);
  assert.equal(pathPreview.rolls[0].total, 16);
  assert.throws(
    () => previewResolutionOperation(pathResolution.artifact, 'operation:second-die-sides', {
      actor: { id: 'actor:one', fields: {}, resources: {} },
      target: { id: 'target:one', fields: {} },
      entropy: [1],
    }, countedCompilation.artifact),
    /requires self to have: trait:dice-roll/,
  );
  const invalidSubjectContract = compileResolutionDefinitions([
    { ...pathCheck, subjectTraitIds: ['not-a-trait'] },
  ]);
  assert.equal(invalidSubjectContract.valid, false);
  assert.ok(invalidSubjectContract.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_SUBJECT_TRAITS_INVALID'));
  const missingPathOrdinal = compileResolutionDefinitions([
    { ...pathCheck, bonus: { op: 'trait-path-field', path: 'self.dice[].sides' } },
  ]);
  assert.equal(missingPathOrdinal.valid, false);
  assert.ok(missingPathOrdinal.diagnostics.some((diagnostic) =>
    diagnostic.code === 'RULE_EXPRESSION_TRAIT_PATH_SELECTOR_REQUIRED'));
  const missingSelector = compileTraitCompositions([
    { externalId: 'trait:die', name: 'Die', body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'sides' }] } },
    {
      externalId: 'trait:bad-pool',
      name: 'Bad Pool',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'trait-collection', key: 'dice', acceptedTraits: ['trait:die'] },
          { dataType: 'modifier', operation: 'increases', field: 'self.dice[].sides', amount: 1 },
        ],
      },
    },
  ]);
  assert.equal(missingSelector.valid, false);
  assert.ok(missingSelector.diagnostics.some((diagnostic) => diagnostic.code === 'RULE_TRAIT_MODIFIER_SELECTOR_REQUIRED'));
});

test('mounted trait instance values are typed, materialized, and addressable by expressions', () => {
  const base = { formatVersion: '1', metamodelVersion: 'resolution/1' };
  const operation = (definitionId, checkId) => ({
    ...base,
    definitionType: 'operation',
    definitionId,
    name: definitionId,
    startStepId: 'roll',
    budget: { maximumSteps: 2 },
    steps: [
      { stepId: 'roll', kind: 'perform-check', checkId, resultKey: 'result', onSuccess: 'done', onFailure: 'done' },
      { stepId: 'done', kind: 'return', outcome: 'success', data: { total: { op: 'result', key: 'result', property: 'total' } } },
    ],
  });
  const walkCheck = {
    ...base,
    definitionType: 'check',
    definitionId: 'check:instance-speed',
    name: 'Instance Speed',
    checkKind: 'target-number',
    roll: { count: 1, sides: 20 },
    bonus: { op: 'trait-instance-field', instanceId: 'movement:right', key: 'rate' },
    target: { op: 'literal', value: 10 },
    comparison: 'gte',
  };
  const walkPathCheck = {
    ...base,
    definitionType: 'check',
    definitionId: 'check:path-speed',
    name: 'Path Speed',
    checkKind: 'target-number',
    roll: { count: 1, sides: 20 },
    bonus: { op: 'trait-path-field', path: 'self.rate' },
    target: { op: 'literal', value: 10 },
    comparison: 'gte',
  };
  const dieCheck = {
    ...base,
    definitionType: 'check',
    definitionId: 'check:instance-die',
    name: 'Instance Die',
    checkKind: 'target-number',
    roll: { count: 1, sides: 20 },
    bonus: { op: 'trait-instance-field', instanceId: 'die:damage', key: 'sides' },
    target: { op: 'literal', value: 11 },
    comparison: 'gte',
  };
  const bootsWalkInstanceId = 'boots:worn/requires:trait%3Acreature:trait%3Acreature/adds:this.speed:trait%3Aspeed/adds:this.walk:trait%3Awalk';
  const bootsCheck = {
    ...base,
    definitionType: 'check',
    definitionId: 'check:boots-speed',
    name: 'Boots Speed',
    checkKind: 'target-number',
    roll: { count: 1, sides: 20 },
    bonus: { op: 'trait-path-field', path: 'self.speed.walk.rate' },
    target: { op: 'literal', value: 13 },
    comparison: 'gte',
  };
  const resolution = compileResolutionDefinitions([
    walkCheck,
    walkPathCheck,
    dieCheck,
    bootsCheck,
    operation('operation:instance-speed', walkCheck.definitionId),
    operation('operation:path-speed', walkPathCheck.definitionId),
    operation('operation:instance-die', dieCheck.definitionId),
    operation('operation:boots-speed', bootsCheck.definitionId),
  ]);
  assert.equal(resolution.valid, true, JSON.stringify(resolution.diagnostics));
  const traits = compileTraitCompositions([
    {
      externalId: 'trait:walk',
      name: 'Walk',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'number', key: 'rate' },
          { dataType: 'enum', key: 'gait', allowedValues: ['ground', 'hover'] },
          { dataType: 'boolean', key: 'enabled' },
        ],
      },
    },
    { externalId: 'trait:die', name: 'Die', body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'sides' }] } },
    {
      externalId: 'trait:d10',
      name: 'D10',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: ['trait:die'],
        grants: [{ dataType: 'modifier', operation: 'sets', field: 'self.sides', amount: 10 }],
      },
    },
    {
      externalId: 'trait:speed',
      name: 'Speed',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'trait', key: 'walk', ref: 'trait:walk' },
          { dataType: 'modifier', operation: 'increases', field: 'this.walk.rate', amount: 2 },
        ],
      },
    },
    {
      externalId: 'trait:creature',
      name: 'Creature',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'trait', key: 'speed', ref: 'trait:speed' }] },
    },
    {
      externalId: 'trait:boots',
      name: 'Boots of Striding',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: ['trait:creature'],
        grants: [{ dataType: 'modifier', operation: 'increases', field: 'self.speed.walk.rate', amount: 5 }],
      },
    },
    {
      externalId: 'trait:speed-a',
      name: 'Speed A',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'trait', key: 'walk', ref: 'trait:walk' }] },
    },
    {
      externalId: 'trait:speed-b',
      name: 'Speed B',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'trait', key: 'walk', ref: 'trait:walk' }] },
    },
    {
      externalId: 'trait:ambiguous-boots',
      name: 'Ambiguous Boots',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: { mode: 'all', ids: ['trait:speed-a', 'trait:speed-b'] },
        grants: [{ dataType: 'modifier', operation: 'increases', field: 'self.walk.rate', amount: 1 }],
      },
    },
  ]);
  assert.equal(traits.valid, true, JSON.stringify(traits.diagnostics));

  const preview = previewResolutionOperation(resolution.artifact, 'operation:instance-speed', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [
      { instanceId: 'movement:left', traitId: 'trait:walk', values: { rate: 2, gait: 'ground', enabled: true } },
      { instanceId: 'movement:right', traitId: 'trait:walk', values: { rate: 7, gait: 'hover', enabled: false } },
    ],
    entropy: [3],
  }, traits.artifact);
  assert.equal(preview.rolls[0].bonus, 7);
  assert.equal(preview.rolls[0].total, 10);
  assert.deepEqual(
    preview.activeTraitInstances
      .filter((instance) => instance.traitId === 'trait:walk')
      .map((instance) => ({ instanceId: instance.instanceId, values: instance.values })),
    [
      { instanceId: 'movement:left', values: { rate: 2, gait: 'ground', enabled: true } },
      { instanceId: 'movement:right', values: { rate: 7, gait: 'hover', enabled: false } },
    ],
  );
  assert.throws(
    () => previewResolutionOperation(resolution.artifact, 'operation:path-speed', {
      actor: { id: 'actor:one', fields: {}, resources: {} },
      target: { id: 'target:one', fields: {} },
      activeTraitInstances: [
        { instanceId: 'movement:left', traitId: 'trait:walk', values: { rate: 2 } },
        { instanceId: 'movement:right', traitId: 'trait:walk', values: { rate: 7 } },
      ],
      entropy: [3],
    }, traits.artifact),
    /Trait path field 'self\.rate' is ambiguous across instances/,
  );

  const d10 = previewResolutionOperation(resolution.artifact, 'operation:instance-die', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [{ instanceId: 'die:damage', traitId: 'trait:d10' }],
    entropy: [1],
  }, traits.artifact);
  assert.equal(d10.rolls[0].bonus, 10);
  assert.deepEqual(
    d10.activeTraitInstances.find((instance) => instance.instanceId === 'die:damage').values,
    { sides: 10 },
  );

  const boots = previewResolutionOperation(resolution.artifact, 'operation:boots-speed', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [{ instanceId: 'boots:worn', traitId: 'trait:boots' }],
    traitInstanceValues: { [bootsWalkInstanceId]: { rate: 5 } },
    entropy: [1],
  }, traits.artifact);
  assert.equal(boots.rolls[0].bonus, 12);
  assert.equal(boots.rolls[0].total, 13);
  const modifiedWalk = boots.activeTraitInstances.find((instance) => instance.instanceId === bootsWalkInstanceId);
  assert.deepEqual(modifiedWalk.mountPath, ['speed', 'walk']);
  assert.deepEqual(modifiedWalk.values, { rate: 12 });
  assert.deepEqual(modifiedWalk.valueModifiers, [
    {
      sourceInstanceId: 'boots:worn',
      sourceTraitId: 'trait:boots',
      anchor: 'self',
      operation: 'increases',
      path: ['speed', 'walk', 'rate'],
      amount: 5,
      before: 5,
      after: 10,
    },
    {
      sourceInstanceId: 'boots:worn/requires:trait%3Acreature:trait%3Acreature/adds:this.speed:trait%3Aspeed',
      sourceTraitId: 'trait:speed',
      anchor: 'this',
      operation: 'increases',
      path: ['walk', 'rate'],
      amount: 2,
      before: 10,
      after: 12,
    },
  ]);
  assert.throws(
    () => previewResolutionOperation(resolution.artifact, 'operation:instance-speed', {
      actor: { id: 'actor:one', fields: {}, resources: {} },
      target: { id: 'target:one', fields: {} },
      activeTraitInstances: [{ instanceId: 'boots:ambiguous', traitId: 'trait:ambiguous-boots' }],
      entropy: [1],
    }, traits.artifact),
    /resolves 'self\.walk\.rate' ambiguously/,
  );

  const invalidContext = (values) => () => previewResolutionOperation(resolution.artifact, 'operation:instance-speed', {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitInstances: [
      { instanceId: 'movement:right', traitId: 'trait:walk', values },
    ],
    entropy: [3],
  }, traits.artifact);
  assert.throws(invalidContext({ rate: 'fast' }), /movement:right\.rate' must be number/);
  assert.throws(invalidContext({ rate: 7, gait: 'flying' }), /must be one of: ground, hover/);
  assert.throws(invalidContext({ rate: 7, 'walk.rate': 2 }), /is not declared directly/);
  assert.throws(
    () => previewResolutionOperation(resolution.artifact, 'operation:instance-speed', {
      actor: { id: 'actor:one', fields: {}, resources: {} },
      target: { id: 'target:one', fields: {} },
      activeTraitInstances: [{ instanceId: 'movement:left', traitId: 'trait:walk', values: { rate: 2 } }],
      entropy: [3],
    }, traits.artifact),
    /Trait instance 'movement:right' is unavailable/,
  );

  const malformed = compileResolutionDefinitions([
    { ...walkCheck, bonus: { op: 'trait-instance-field', instanceId: '', key: 'rate' } },
  ]);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.diagnostics.some((diagnostic) => diagnostic.code === 'RULE_EXPRESSION_TRAIT_INSTANCE_INVALID'));
});

test('modifier compiler rejects ambiguous or implicit roll targeting', () => {
  const ambiguous = meleeResolutionExamples.map((definition) =>
    definition.definitionId === 'modifier:accurate'
      ? { ...definition, appliesTo: { rollKinds: ['hit'] } }
      : definition);
  const ambiguousResult = compileResolutionDefinitions(ambiguous);
  assert.equal(ambiguousResult.valid, false);
  assert.ok(ambiguousResult.diagnostics.some((diagnostic) => diagnostic.code === 'RULE_MODIFIER_TARGET_AMBIGUOUS'));

  const implicit = ambiguous.map((definition) =>
    definition.definitionId === 'modifier:accurate'
      ? { ...definition, targetCheckId: undefined, appliesTo: undefined }
      : definition);
  const implicitResult = compileResolutionDefinitions(implicit);
  assert.equal(implicitResult.valid, false);
  assert.ok(implicitResult.diagnostics.some((diagnostic) => diagnostic.code === 'RULE_MODIFIER_TARGET_REQUIRED'));
});

test('Phase 2 operation compiler rejects pipeline cycles', () => {
  const cyclic = {
    formatVersion: '1', metamodelVersion: 'resolution/1', definitionType: 'operation',
    definitionId: 'operation:cycle', name: 'Cycle', startStepId: 'again', budget: { maximumSteps: 4 },
    steps: [{ stepId: 'again', kind: 'validate', condition: { op: 'equals', left: { op: 'literal', value: true }, right: { op: 'literal', value: true } }, failureMessage: 'never', next: 'again' }],
  };
  const result = compileResolutionDefinitions([cyclic]);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'RULE_OPERATION_CYCLE'));
});

test('Phase 2 fixtures cover both success and failure branches', () => {
  const service = new RuleAuthoringService();
  const result = service.runFixtures(meleeResolutionExamples, meleeResolutionFixtures);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.results.map((fixture) => [fixture.name, fixture.passed, fixture.preview.outcome]), [
    ['Strong attacker hits and wounds the target', true, 'success'],
    ['Low roll misses without applying an effect', true, 'failure'],
  ]);
  assert.equal(service.getDescriptor('operation').definitionType, 'operation');
  assert.equal(service.getMetamodel().extensions[0].metamodelVersion, 'resolution/1');
});

test('authoring preview expands high-level active traits across mixed metamodel definitions', () => {
  const service = new RuleAuthoringService();
  const resolution = meleeResolutionExamples.map((definition) =>
    definition.definitionId === 'modifier:accurate'
      ? { ...definition, activatedByTraitIds: ['trait:accurate'] }
      : definition);
  const traits = [
    {
      externalId: 'trait:combat-training',
      name: 'Combat Training',
      body: {
        metamodelVersion: 'trait/1',
        grants: [{ dataType: 'trait', key: 'accurate', ref: 'trait:accurate' }],
      },
    },
    {
      externalId: 'trait:accurate',
      name: 'Accurate',
      body: { metamodelVersion: 'trait/1', grants: [] },
    },
  ];
  const context = {
    ...meleeResolutionFixtures[0].context,
    activeModifierIds: [],
    activeTraitIds: ['trait:combat-training'],
  };
  const result = service.preview([...resolution, ...traits], 'operation:melee-attack', context);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.preview.rolls[0].total, 18);
  assert.deepEqual(result.preview.rolls[0].modifierActivations, [{
    modifierId: 'modifier:accurate',
    sources: [{
      kind: 'trait',
      id: 'trait:accurate',
      rootTraitId: 'trait:combat-training',
      traitChain: ['trait:combat-training', 'trait:accurate'],
    }],
  }]);
});

test('Payload adapter deletes draft rule-set children before the rule set', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if ((options.method || 'GET') === 'GET') return Response.json({ docs: [] });
    return Response.json({ id: 2 });
  };
  process.env.CMS_BASE_URL = 'http://cms.test';
  process.env.CMS_INTERNAL_TOKEN = 'cms-secret';
  const repository = new PayloadRuleCatalogRepository();

  await repository.deleteRuleSet({ auth0Subject: 'auth0|author', workspaceExternalId: 'workspace' }, 2);

  assert.equal(calls.at(-1).url, 'http://cms.test/api/rule-sets/2');
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.equal(calls.filter((call) => call.method === 'GET').length, 5);
});

test('Payload adapter stores compiled releases as one immutable CMS document', async () => {
  let request;
  global.fetch = async (url, options = {}) => {
    request = { url: String(url), options };
    const data = JSON.parse(options.body);
    return Response.json({
      doc: {
        id: 21,
        externalId: data.externalId,
        ruleSet: data.ruleSet,
        version: data.version,
        contentHash: data.contentHash,
        engineCompatibility: data.engineCompatibility,
        dependencyLock: data.dependencyLock,
        manifest: data.manifest,
        sourceSnapshot: data.sourceSnapshot,
        publishedAt: data.publishedAt,
        lifecycle: data.lifecycle,
        createdAt: data.publishedAt,
        updatedAt: data.publishedAt,
      },
    });
  };
  process.env.CMS_BASE_URL = 'http://cms.test';
  process.env.CMS_INTERNAL_TOKEN = 'cms-secret';
  const repository = new PayloadRuleCatalogRepository();
  const release = await repository.createRelease(
    { auth0Subject: 'auth0|author' },
    2,
    {
      version: '1.0.0',
      contentHash: 'a'.repeat(64),
      engineCompatibility: { ruleSetFeatureLevel: '1' },
      dependencyLock: [],
      manifest: { formatVersion: 'rule-release/1', artifacts: {} },
      sourceSnapshot: { definitions: [] },
      publishedById: 5,
      publishedAt: '2026-07-23T03:00:00.000Z',
      releaseNotes: 'Initial release',
    },
  );

  assert.equal(request.url, 'http://cms.test/api/rule-releases');
  assert.equal(request.options.method, 'POST');
  const body = JSON.parse(request.options.body);
  assert.equal(body.publishedBy, 5);
  assert.equal(body.lifecycle, 'published');
  assert.equal(body.manifest.formatVersion, 'rule-release/1');
  assert.equal(release.contentHash, 'a'.repeat(64));
});

test('world deletion removes its recorded graph triples before its database record', async () => {
  const operations = [];
  const world = {
    id: 'world-id',
    metadata: {
      triples: [{ subject: 'Hero', predicate: 'livesIn', object: 'Harbor' }],
    },
  };
  const repository = {
    findOne: async () => world,
    remove: async (value) => { operations.push(['remove', value.id]); },
  };
  const graph = {
    del: async (triples) => { operations.push(['graph', triples]); },
  };
  const service = new GenerateService(repository, graph, { isConfigured: false });

  const result = await service.deleteWorld('world-id');

  assert.deepEqual(result, { deleted: true, id: 'world-id' });
  assert.deepEqual(operations, [
    ['graph', world.metadata.triples],
    ['remove', 'world-id'],
  ]);
});

test('resolution subject contracts can require and enforce an any-prerequisite branch', () => {
  const traits = compileTraitCompositions([
    {
      externalId: 'trait:brutal',
      name: 'Brutal',
      body: {
        metamodelVersion: 'trait/1',
        grants: [
          { dataType: 'number', key: 'damage' },
          { dataType: 'modifier', operation: 'sets', field: 'self.damage', amount: 3 },
        ],
      },
    },
    {
      externalId: 'trait:precise',
      name: 'Precise',
      body: { metamodelVersion: 'trait/1', grants: [{ dataType: 'number', key: 'accuracy' }] },
    },
    {
      externalId: 'trait:training',
      name: 'Training',
      body: {
        metamodelVersion: 'trait/1',
        prerequisites: { mode: 'any', ids: ['trait:brutal', 'trait:precise'] },
        grants: [],
      },
    },
  ]);
  assert.equal(traits.valid, true, JSON.stringify(traits.diagnostics));
  const base = { formatVersion: '1', metamodelVersion: 'resolution/1' };
  const check = {
    ...base,
    definitionType: 'check',
    definitionId: 'check:brutal-damage',
    name: 'Brutal Damage',
    subjectTraitIds: ['trait:training'],
    subjectTraitSelections: { 'trait:training': ['trait:brutal'] },
    checkKind: 'target-number',
    roll: { count: 1, sides: 20 },
    bonus: { op: 'trait-path-field', path: 'self.damage' },
    target: { op: 'literal', value: 4 },
    comparison: 'gte',
  };
  const operation = {
    ...base,
    definitionType: 'operation',
    definitionId: 'operation:brutal-damage',
    name: 'Brutal Damage',
    startStepId: 'check',
    steps: [
      { stepId: 'check', kind: 'perform-check', checkId: check.definitionId, resultKey: 'roll', onSuccess: 'done', onFailure: 'done' },
      { stepId: 'done', kind: 'return', outcome: 'success' },
    ],
    budget: { maximumSteps: 3 },
  };
  const resolution = compileResolutionDefinitions([check, operation]);
  assert.equal(resolution.valid, true, JSON.stringify(resolution.diagnostics));
  assert.deepEqual(
    resolution.artifact.operationSubjectContracts[operation.definitionId].effectiveTraitSelections,
    { 'trait:training': ['trait:brutal'] },
  );
  const context = {
    actor: { id: 'actor:one', fields: {}, resources: {} },
    target: { id: 'target:one', fields: {} },
    activeTraitIds: ['trait:training'],
    traitPrerequisiteSelections: { 'trait:training': ['trait:brutal'] },
    entropy: [1],
  };
  const preview = previewResolutionOperation(
    resolution.artifact,
    operation.definitionId,
    context,
    traits.artifact,
  );
  assert.equal(preview.rolls[0].bonus, 3);
  assert.throws(
    () => previewResolutionOperation(
      resolution.artifact,
      operation.definitionId,
      {
        ...context,
        traitPrerequisiteSelections: { 'trait:training': ['trait:precise'] },
      },
      traits.artifact,
    ),
    /requires 'trait:training' to select: trait:brutal/,
  );
});
