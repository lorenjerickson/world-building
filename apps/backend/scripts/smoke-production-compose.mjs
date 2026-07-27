import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const suffix = `${process.pid}-${Date.now()}`;
const image = `wanderlust-vtt-backend:smoke-${suffix}`;
const baseProject = `wb-backend-smoke-${suffix}`;
const failureProject = `${baseProject}-failure`;
const composeFile = 'docker-compose.yml';
const smokeWorldId = '00000000-0000-4000-8000-000000000404';

function compose(project, env, args, expectedStatus = 0) {
  const result = spawnSync(
    'docker',
    ['compose', '-p', project, '-f', composeFile, ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(
    result.status,
    expectedStatus,
    `docker compose ${args.join(' ')} exited with ${result.status}`,
  );
  return result;
}

function cleanup(project, env) {
  spawnSync(
    'docker',
    ['compose', '-p', project, '-f', composeFile, 'down', '-v', '--remove-orphans'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
}

const healthyEnv = {
  BACKEND_IMAGE: image,
  BACKEND_PORT: '0',
  DB_PORT: '0',
};
const failureEnv = {
  BACKEND_IMAGE: image,
  BACKEND_PORT: '0',
  DB_PORT: '0',
  BACKEND_DATABASE_URL: 'postgresql://worldbuilder:password123@missing-database:5432/worlddb',
};

try {
  const buildArgs = process.env.SMOKE_REUSE_BUILD === '1'
    ? ['build', 'backend']
    : ['build', '--no-cache', 'backend'];
  compose(baseProject, healthyEnv, buildArgs);
  compose(baseProject, healthyEnv, ['up', '-d', '--wait', 'backend']);

  const portResult = compose(baseProject, healthyEnv, [
    'port',
    'backend',
    '8000',
  ]);
  const backendPort = Number(portResult.stdout.trim().match(/:(\d+)$/)?.[1]);
  assert.ok(Number.isInteger(backendPort) && backendPort > 0);

  const health = await fetch(`http://127.0.0.1:${backendPort}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  compose(baseProject, healthyEnv, [
    'exec',
    '-T',
    'backend',
    'node',
    '--input-type=module',
    '-e',
    `import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
await prisma.world.create({
  data: {
    id: '${smokeWorldId}',
    prompt: 'Production smoke prompt',
    generatedContent: 'Production smoke content',
    metadata: { smoke: 'seed' },
  },
});
await prisma.$disconnect();`,
  ]);

  const update = await fetch(
    `http://127.0.0.1:${backendPort}/api/generate/world/${smokeWorldId}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { smoke: 'updated' } }),
    },
  );
  assert.equal(update.status, 200);
  const updatedWorld = await update.json();
  assert.equal(updatedWorld.status, 'success');
  assert.deepEqual(updatedWorld.world.metadata, { smoke: 'updated' });

  compose(baseProject, healthyEnv, [
    'run',
    '--rm',
    'backend-migrate',
    'pnpm',
    'run',
    'prisma:migrate:status',
  ]);

  const failedStart = spawnSync(
    'docker',
    ['compose', '-p', failureProject, '-f', composeFile, 'up', '--no-build', 'backend'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, ...failureEnv },
    },
  );
  if (failedStart.stdout) process.stdout.write(failedStart.stdout);
  if (failedStart.stderr) process.stderr.write(failedStart.stderr);
  assert.notEqual(failedStart.status, 0, 'Backend unexpectedly started after migration failure.');

  const backendState = spawnSync(
    'docker',
    ['compose', '-p', failureProject, '-f', composeFile, 'ps', '-a', '--format', 'json', 'backend'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, ...failureEnv },
    },
  );
  assert.equal(backendState.status, 0);
  const backendDetails = JSON.parse(backendState.stdout.trim());
  assert.equal(
    backendDetails.State,
    'created',
    `Backend entered ${backendDetails.State} state despite failed migration.`,
  );

  console.log('Production backend image and migration gate smoke test passed.');
} finally {
  cleanup(failureProject, failureEnv);
  cleanup(baseProject, healthyEnv);
  spawnSync('docker', ['image', 'rm', image], { encoding: 'utf8' });
}
