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
