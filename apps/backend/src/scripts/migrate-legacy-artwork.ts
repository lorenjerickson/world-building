import { Prisma, PrismaClient } from '@prisma/client';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

type JsonObject = Record<string, unknown>;
type ArtworkPurpose = 'world-map' | 'location-map' | 'portrait' | 'token' | 'handout';

const LEGACY_URL = /^\/(?:api\/uploads\/images|uploads)\/([^/]+)$/;
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.obj', '.ply', '.stl']);
const MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.obj': 'model/obj',
  '.ply': 'model/ply',
  '.png': 'image/png',
  '.stl': 'model/stl',
  '.webp': 'image/webp',
};

const prisma = new PrismaClient();
const cmsBaseUrl = (process.env.CMS_BASE_URL || 'http://cms:3000').replace(/\/$/, '');
const legacyDirectory = process.env.LEGACY_UPLOAD_DIRECTORY || join(process.cwd(), 'data', 'uploads');
const internalToken = process.env.CMS_INTERNAL_TOKEN?.trim();
const auth0Subject = process.env.LEGACY_MEDIA_AUTH0_SUBJECT?.trim();
const email = process.env.LEGACY_MEDIA_EMAIL?.trim();
const dryRun = process.env.LEGACY_MEDIA_DRY_RUN === 'true';
const migrated = new Map<string, string>();
let uploads = 0;
let reused = 0;
let references = 0;

function actorHeaders(): Record<string, string> {
  if (!internalToken || !auth0Subject) {
    throw new Error('CMS_INTERNAL_TOKEN and LEGACY_MEDIA_AUTH0_SUBJECT are required.');
  }
  return {
    ...(email ? { 'x-auth0-email': email } : {}),
    'x-auth0-sub': auth0Subject,
    'x-cms-internal-token': internalToken,
  };
}

function purposeFor(path: string[], key: string): ArtworkPurpose {
  if (key === 'portraitUrl') return 'portrait';
  if (key === 'tokenUrl' || key === 'token3dUrl') return 'token';
  if (key === 'mapUrl') return path.includes('locations') ? 'location-map' : 'world-map';
  return 'handout';
}

function publicUrl(id: number, filename: string, model: boolean): string {
  const root = model ? '/api/character-assets/models' : '/api/media-assets';
  return `${root}/${id}/${encodeURIComponent(filename)}`;
}

async function json(response: Response, operation: string): Promise<JsonObject> {
  const body = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function findExisting(
  filename: string,
  filesize: number,
  purpose: ArtworkPurpose,
): Promise<{ id: number; filename: string } | undefined> {
  const query = new URLSearchParams({ depth: '0', limit: '50' });
  query.set('where[and][0][filesize][equals]', String(filesize));
  query.set('where[and][1][filename][like]', filename);
  query.set('where[and][2][purpose][equals]', purpose);
  const body = await json(await fetch(`${cmsBaseUrl}/api/media?${query}`, {
    headers: actorHeaders(),
    signal: AbortSignal.timeout(15_000),
  }), 'Duplicate lookup');
  const normalized = filename.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  return (Array.isArray(body.docs) ? body.docs : [])
    .filter((doc): doc is JsonObject => Boolean(doc) && typeof doc === 'object')
    .map((doc) => ({
      filename: typeof doc.filename === 'string' ? doc.filename : '',
      filesize: Number(doc.filesize),
      id: Number(doc.id),
      purpose: doc.purpose,
    }))
    .find((doc) => Number.isSafeInteger(doc.id)
      && doc.filename.normalize('NFKC').trim().toLocaleLowerCase('en-US') === normalized
      && doc.filesize === filesize
      && doc.purpose === purpose);
}

async function migrateUrl(url: string, purpose: ArtworkPurpose): Promise<string> {
  const cacheKey = `${purpose}:${url}`;
  const cached = migrated.get(cacheKey);
  if (cached) return cached;
  const match = LEGACY_URL.exec(new URL(url, 'https://legacy.invalid').pathname);
  if (!match) return url;
  const decoded = decodeURIComponent(match[1]);
  const filename = basename(decoded);
  if (!filename || filename !== decoded) throw new Error(`Unsafe legacy artwork path: ${url}`);
  const extension = extname(filename).toLowerCase();
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) throw new Error(`Unsupported legacy artwork type: ${filename}`);
  const model = MODEL_EXTENSIONS.has(extension);
  const path = join(legacyDirectory, filename);
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat?.isFile()) throw new Error(`Legacy artwork is missing: ${path}`);
  references += 1;
  if (dryRun) {
    console.log(`[dry-run] ${url} (${fileStat.size} bytes, ${purpose})`);
    return url;
  }
  const existing = await findExisting(filename, fileStat.size, purpose);
  if (existing) {
    const nextUrl = publicUrl(existing.id, existing.filename, model);
    migrated.set(cacheKey, nextUrl);
    reused += 1;
    return nextUrl;
  }
  const bytes = await readFile(path);
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(bytes)], { type: mimeType }), filename);
  form.append('_payload', JSON.stringify({
    altText: `Migrated artwork: ${filename}`,
    purpose,
    tags: [{ value: 'legacy-migration' }, ...(model ? [{ value: 'token-3d' }] : [])],
  }));
  const body = await json(await fetch(`${cmsBaseUrl}/api/media`, {
    body: form,
    headers: actorHeaders(),
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
  }), 'Media upload');
  const doc = (body.doc ?? body) as JsonObject;
  const id = Number(doc.id);
  const storedFilename = typeof doc.filename === 'string' ? doc.filename : '';
  if (!Number.isSafeInteger(id) || !storedFilename) {
    throw new Error(`Payload returned an invalid media record for ${filename}.`);
  }
  const nextUrl = publicUrl(id, storedFilename, model);
  migrated.set(cacheKey, nextUrl);
  uploads += 1;
  return nextUrl;
}

async function transform(value: unknown, path: string[] = []): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry, index) => transform(entry, [...path, String(index)])));
  }
  if (!value || typeof value !== 'object') return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (typeof child === 'string' && LEGACY_URL.test(new URL(child, 'https://legacy.invalid').pathname)) {
      result[key] = await migrateUrl(child, purposeFor(path, key));
    } else {
      result[key] = await transform(child, [...path, key]);
    }
  }
  return result;
}

async function main(): Promise<void> {
  actorHeaders();
  const worlds = await prisma.world.findMany({ orderBy: { createdAt: 'asc' } });
  let updatedWorlds = 0;
  for (const world of worlds) {
    const before = world.metadata ?? {};
    const after = await transform(before) as Prisma.InputJsonValue;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (!dryRun) {
      await prisma.world.update({ where: { id: world.id }, data: { metadata: after } });
    }
    updatedWorlds += 1;
  }
  console.log(JSON.stringify({
    dryRun,
    references,
    reused,
    updatedWorlds,
    uploads,
    worldsScanned: worlds.length,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
