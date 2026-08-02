const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const {
  CharacterModelGenerationService,
} = require('../dist/character-assets/character-model-generation.service');

const originalFetch = global.fetch;
const originalBaseUrl = process.env.SHAP_E_BASE_URL;
const originalPollInterval = process.env.SHAP_E_POLL_INTERVAL_MS;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.SHAP_E_BASE_URL;
  else process.env.SHAP_E_BASE_URL = originalBaseUrl;
  if (originalPollInterval === undefined) delete process.env.SHAP_E_POLL_INTERVAL_MS;
  else process.env.SHAP_E_POLL_INTERVAL_MS = originalPollInterval;
});

const actor = { auth0Subject: 'auth0|character-author', email: 'author@example.com' };

function shapJob(overrides = {}) {
  return {
    id: 'shape-job-1',
    inputType: 'text',
    progress: 0,
    seed: 42,
    stage: 'Queued',
    status: 'queued',
    ...overrides,
  };
}

async function waitFor(predicate, timeout = 500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for generation state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('text generation is non-blocking, reports progress, and persists the completed GLB', async () => {
  process.env.SHAP_E_BASE_URL = 'http://shap-e.test:8000';
  process.env.SHAP_E_POLL_INTERVAL_MS = '5';
  const calls = [];
  let statusReads = 0;
  let uploaded;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/jobs/text')) {
      assert.deepEqual(JSON.parse(options.body), {
        prompt: 'A crimson knight with a gold shield',
      });
      return Response.json(shapJob(), { status: 202 });
    }
    if (String(url).endsWith('/artifact')) {
      return new Response(Uint8Array.from([103, 108, 84, 70]), {
        headers: { 'content-type': 'model/gltf-binary' },
      });
    }
    statusReads += 1;
    return Response.json(statusReads === 1
      ? shapJob({ progress: 50, stage: 'Sampling 3D latent', status: 'running' })
      : shapJob({ progress: 100, stage: 'Model ready', status: 'succeeded' }));
  };
  const assets = {
    uploadModel: async (requestActor, file, altText) => {
      uploaded = { requestActor, file, altText };
      return {
        assetId: 19,
        filename: file.originalname,
        mimeType: file.mimetype,
        url: '/api/character-assets/models/19/crimson-knight-token.glb',
      };
    },
  };
  const service = new CharacterModelGenerationService(assets, {});

  const created = await service.createFromText(actor, {
    characterName: 'Crimson Knight',
    prompt: 'A crimson knight with a gold shield',
  });
  assert.equal(created.status, 'queued');
  assert.equal(created.progress, 0);

  await waitFor(() => service.get(actor, created.id).status === 'succeeded');
  const completed = service.get(actor, created.id);
  assert.equal(completed.progress, 100);
  assert.equal(completed.url, '/api/character-assets/models/19/crimson-knight-token.glb');
  assert.equal(uploaded.file.mimetype, 'model/gltf-binary');
  assert.equal(uploaded.file.originalname, 'crimson-knight-token.glb');
  assert.equal(uploaded.altText, 'Crimson Knight generated 3D character token');
  assert.equal(uploaded.requestActor.auth0Subject, actor.auth0Subject);
  assert.ok(calls.every((call) => call.url.startsWith('http://shap-e.test:8000/')));
});

test('image generation forwards uploaded bytes and can be cancelled by its owner', async () => {
  process.env.SHAP_E_BASE_URL = 'http://shap-e.test:8000';
  process.env.SHAP_E_POLL_INTERVAL_MS = '5';
  let imageForm;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/v1/jobs/image')) {
      imageForm = options.body;
      return Response.json(shapJob({ inputType: 'image' }), { status: 202 });
    }
    if (options.method === 'DELETE') {
      return Response.json(shapJob({
        inputType: 'image',
        stage: 'Cancelled',
        status: 'cancelled',
      }));
    }
    return Response.json(shapJob({ inputType: 'image' }));
  };
  const service = new CharacterModelGenerationService({
    uploadModel: async () => {
      throw new Error('Cancelled generations must not be uploaded');
    },
  }, {});
  const created = await service.createFromImage(actor, {
    characterName: 'Lantern Mage',
    file: {
      buffer: Buffer.from('image-bytes'),
      mimetype: 'image/png',
      originalname: 'mage.png',
      size: 11,
    },
  });

  assert.equal(imageForm.get('image').name, 'mage.png');
  assert.throws(
    () => service.get({ auth0Subject: 'auth0|other' }, created.id),
    (error) => error.getResponse().code === 'CHARACTER_MODEL_GENERATION_NOT_FOUND',
  );
  const cancelled = await service.cancel(actor, created.id);
  assert.equal(cancelled.status, 'cancelled');
});
