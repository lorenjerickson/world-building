const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { CompositionManifestService } = require('../dist/rules/releases/composition-manifest.service');
const { RuleDefinitionSnapshotService } = require('../dist/rules/catalog/rule-definition-snapshot.service');
const { GenerateService } = require('../dist/generate/generate.service');
const { serializePrismaValue } = require('../dist/database/prisma-response.interceptor');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Prisma runtime integration tests.');
}

const prisma = new PrismaClient();
const workspaceExternalId = 'workspace:phase3-runtime';
const definitionId = 930001;

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.ruleDefinitionSnapshot.deleteMany({ where: { definitionId } });
  await prisma.ruleSetBinding.deleteMany({ where: { workspaceExternalId } });
  await prisma.ruleSetComposition.deleteMany({ where: { workspaceExternalId } });
  await prisma.world.deleteMany({ where: { prompt: 'Phase 3 runtime deletion' } });
  await prisma.$disconnect();
});

test('composition nested writes are atomic and content-addressed', async () => {
  const service = new CompositionManifestService(prisma);
  const input = {
    workspaceExternalId,
    gameplayProfileName: 'default',
    members: [
      {
        ruleSetId: 2,
        releaseId: 22,
        releaseHash: 'phase3-release-b',
        namespaceAlias: 'b',
        sortOrder: 2,
      },
      {
        ruleSetId: 1,
        releaseId: 11,
        releaseHash: 'phase3-release-a',
        namespaceAlias: 'a',
        sortOrder: 1,
      },
    ],
    createdBy: 'actor:phase3',
  };

  const created = await service.createComposition(input);
  const repeated = await service.createComposition(input);
  const persisted = await prisma.ruleSetComposition.findUniqueOrThrow({
    where: { id: created.id },
    include: { members: { orderBy: { sortOrder: 'asc' } } },
  });

  assert.equal(repeated.id, created.id);
  assert.deepEqual(persisted.members.map((member) => member.namespaceAlias), ['a', 'b']);

  const invalidInput = {
    ...input,
    gameplayProfileName: 'invalid',
    members: [{
      ruleSetId: 9,
      releaseId: 99,
      releaseHash: null,
      namespaceAlias: 'invalid',
      sortOrder: 1,
    }],
  };
  const invalidHash = service.computeCompositionHash(invalidInput.members);
  await assert.rejects(service.createComposition(invalidInput));
  assert.equal(
    await prisma.ruleSetComposition.findUnique({
      where: {
        workspaceExternalId_compositionHash: {
          workspaceExternalId,
          compositionHash: invalidHash,
        },
      },
    }),
    null,
  );
});

test('binding bigint values remain JSON-safe at the HTTP serialization boundary', async () => {
  const service = new CompositionManifestService(prisma);
  const composition = await prisma.ruleSetComposition.findFirstOrThrow({
    where: { workspaceExternalId },
  });
  const binding = await service.bindCompositionToScope({
    workspaceExternalId,
    scopeType: 'world',
    scopeId: 'world:phase3',
    gameplayProfileName: 'default',
    compositionId: composition.id,
  });
  await prisma.ruleSetBinding.update({
    where: { id: binding.id },
    data: { stateVersion: 9007199254740993n },
  });
  const persisted = await prisma.ruleSetBinding.findUniqueOrThrow({
    where: { id: binding.id },
  });

  const serialized = serializePrismaValue(persisted);
  assert.equal(serialized.stateVersion, '9007199254740993');
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('concurrent snapshot captures retain exactly fifty rows', async () => {
  const service = new RuleDefinitionSnapshotService(prisma);
  await Promise.all(
    Array.from({ length: 60 }, (_, index) => service.capture({
      ruleSetId: 91,
      definitionId,
      definitionExternalId: 'definition:phase3',
      name: `Snapshot ${index}`,
      body: { index },
      actorId: 'actor:phase3',
      reason: 'autosave',
    })),
  );

  const snapshots = await prisma.ruleDefinitionSnapshot.findMany({
    where: { definitionId },
  });
  assert.equal(snapshots.length, 50);
});

test('world deletion removes graph triples before the Prisma row', async () => {
  const world = await prisma.world.create({
    data: {
      prompt: 'Phase 3 runtime deletion',
      generatedContent: 'Runtime fixture',
      metadata: {
        triples: [{ subject: 'Hero', predicate: 'visits', object: 'Harbor' }],
      },
    },
  });
  const operations = [];
  const graph = {
    del: async (triples) => { operations.push(['graph', triples.length]); },
  };
  const service = new GenerateService(prisma, graph, { isConfigured: false });

  await service.deleteWorld(world.id);

  assert.deepEqual(operations, [['graph', 1]]);
  assert.equal(await prisma.world.findUnique({ where: { id: world.id } }), null);
});
