const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const { CharacterArtController } = require('../dist/character-art.controller');

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

test('generated 2D artwork is persisted as generated Payload media', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  let uploaded;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return Response.json({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] });
  };
  const assets = {
    upload: async (actor, mediaType, file, options) => {
      uploaded = { actor, file, mediaType, options };
      return { id: '31', url: '/api/media-assets/31/ada-portrait.png' };
    },
  };
  const controller = new CharacterArtController(assets);
  const result = await controller.generate(
    { auth0Subject: 'auth0|gm', email: 'gm@example.com' },
    {
      description: 'A clockwork investigator',
      kind: 'portrait',
      name: 'Ada Gearwright',
      worldName: 'Brasshaven',
    },
  );

  assert.equal(result.url, '/api/media-assets/31/ada-portrait.png');
  assert.equal(uploaded.actor.auth0Subject, 'auth0|gm');
  assert.equal(uploaded.mediaType, 'image');
  assert.equal(uploaded.file.originalname, 'ada-gearwright-portrait.png');
  assert.equal(uploaded.file.buffer.toString(), 'png-bytes');
  assert.equal(uploaded.options.purpose, 'portrait');
  assert.equal(uploaded.options.generation.provider, 'openai');
  assert.match(uploaded.options.generation.promptHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(uploaded.options.tags, ['generated', 'character-portrait']);
});

test('generated 2D edits load their reference through Payload media', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  let referenceRead;
  let editForm;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    editForm = options.body;
    return Response.json({ data: [{ b64_json: Buffer.from('token-bytes').toString('base64') }] });
  };
  const assets = {
    downloadUrl: async (actor, url, type) => {
      referenceRead = { actor, type, url };
      return { bytes: Buffer.from('portrait'), filename: 'ada.png', mimeType: 'image/png' };
    },
    upload: async () => ({ id: '32', url: '/api/media-assets/32/ada-token.png' }),
  };
  const controller = new CharacterArtController(assets);
  await controller.generate(
    { auth0Subject: 'auth0|gm' },
    {
      kind: 'token',
      name: 'Ada',
      referenceUrl: '/api/media-assets/31/ada.png',
    },
  );

  assert.deepEqual(referenceRead, {
    actor: { auth0Subject: 'auth0|gm' },
    type: 'image',
    url: '/api/media-assets/31/ada.png',
  });
  assert.equal(editForm.get('image').name, 'ada.png');
});
