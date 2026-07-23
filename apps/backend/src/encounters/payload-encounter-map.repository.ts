import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildCanonicalMesh,
  buildIndexedMeshBuffers,
  canonicalizeMap,
  checksumCanonicalMap,
  PHASE0_MATERIAL_PALETTE,
  subdivideMesh,
  validateCanonicalMap,
  type EncounterMapCanonical,
} from '@world-building/common';
import { createHash, randomUUID } from 'crypto';
import type { RuleApiActor } from '../rules/api/rule-api-actor';
import type {
  CreateEncounterMapInput,
  EncounterDraftResource,
  EncounterRevisionResource,
  FinalizeEncounterDraftInput,
  SaveEncounterDraftInput,
} from './encounter-map.types';

type JsonRecord = Record<string, any>;
type PayloadPage = { docs: JsonRecord[]; totalDocs?: number };

const COMPILER_VERSION = 'encounter-geometry/2';

function checksumBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function relationshipId(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof (value as JsonRecord).id === 'number') return (value as JsonRecord).id;
  throw new BadGatewayException({ code: 'CMS_CONTRACT_INVALID', message: 'CMS returned an invalid relationship.', retryable: false });
}

function validationErrors(canonical: EncounterMapCanonical): string[] {
  const validation = validateCanonicalMap(canonical, PHASE0_MATERIAL_PALETTE);
  if (!validation.ok) return validation.errors;
  try {
    buildCanonicalMesh(canonical);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'Canonical topology validation failed.'];
  }
}

@Injectable()
export class PayloadEncounterMapRepository {
  private readonly baseUrl = (process.env.CMS_BASE_URL || 'http://cms:3000').replace(/\/$/, '');
  private readonly internalToken = process.env.CMS_INTERNAL_TOKEN || '';

  async createMap(actor: RuleApiActor, encounterExternalId: string, input: CreateEncounterMapInput) {
    const bounds = input.bounds ?? { x: 16, y: 16, z: 8 };
    const canonical: EncounterMapCanonical = {
      formatVersion: 'encounter-map/1',
      scaleInFeet: input.scaleInFeet ?? 5,
      paletteVersion: PHASE0_MATERIAL_PALETTE.version,
      surfaceSubdivisionLevel: 0,
      bounds: { min: [0, 0, 0], max: [bounds.x, bounds.y, bounds.z] },
      occupiedCells: [],
      vertexRemaps: [],
    };
    const errors = validationErrors(canonical);
    if (errors.length) throw new ConflictException({ code: 'ENCOUNTER_MAP_INVALID', errors, message: 'Initial map geometry is invalid.', retryable: false });
    const map = await this.mutate('/api/encounter-maps', actor, 'POST', {
      campaignExternalId: input.campaignExternalId,
      encounterExternalId,
      externalId: randomUUID(),
      ...(input.locationId ? { location: input.locationId } : {}),
      name: input.name,
    });
    const mapId = relationshipId(map.id);
    const artifact = await this.uploadArtifact(actor, mapId, 'canonical', canonical, checksumCanonicalMap(canonical));
    const draft = await this.mutate('/api/encounter-map-drafts', actor, 'POST', {
      bounds,
      canonicalArtifact: relationshipId(artifact.id),
      canonicalChecksum: checksumCanonicalMap(canonical),
      draftVersion: 1,
      externalId: randomUUID(),
      lastCommandId: input.commandId,
      map: mapId,
      paletteVersion: canonical.paletteVersion,
      scaleInFeet: String(canonical.scaleInFeet),
      validationErrors: [],
      validationStatus: 'valid',
      validatedAt: new Date().toISOString(),
    });
    await this.mutate(`/api/encounter-maps/${mapId}`, actor, 'PATCH', { currentDraft: relationshipId(draft.id) });
    return { id: mapId, name: map.name, draft: await this.mapDraft(draft, canonical) };
  }

  async getDraft(actor: RuleApiActor, encounterId: string, mapId: number, draftId: number): Promise<EncounterDraftResource> {
    await this.requireMap(actor, encounterId, mapId);
    const draft = await this.request<JsonRecord>(`/api/encounter-map-drafts/${draftId}?depth=0`, actor, 'ENCOUNTER_DRAFT_NOT_FOUND');
    if (relationshipId(draft.map) !== mapId) throw this.notFound('ENCOUNTER_DRAFT_NOT_FOUND', 'Draft does not belong to this map.');
    const canonical = await this.downloadCanonical(actor, relationshipId(draft.canonicalArtifact));
    if (checksumCanonicalMap(canonical) !== draft.canonicalChecksum) {
      throw new BadGatewayException({ code: 'CMS_ARTIFACT_CHECKSUM_MISMATCH', message: 'Canonical artifact does not match the draft checksum.', retryable: false });
    }
    return this.mapDraft(draft, canonical);
  }

  async saveDraft(actor: RuleApiActor, encounterId: string, mapId: number, draftId: number, input: SaveEncounterDraftInput): Promise<EncounterDraftResource> {
    const current = await this.getDraft(actor, encounterId, mapId, draftId);
    const currentDocument = await this.request<JsonRecord>(`/api/encounter-map-drafts/${draftId}?depth=0`, actor, 'ENCOUNTER_DRAFT_NOT_FOUND');
    if (currentDocument.lastCommandId === input.commandId) return current;
    if (current.version !== input.expectedVersion) {
      throw new ConflictException({ code: 'ENCOUNTER_DRAFT_VERSION_CONFLICT', currentVersion: current.version, message: 'Draft changed since it was loaded.', retryable: true });
    }
    const syntax = validateCanonicalMap(input.canonical, PHASE0_MATERIAL_PALETTE);
    if (!syntax.ok) throw new ConflictException({ code: 'ENCOUNTER_MAP_INVALID', errors: syntax.errors, message: 'Draft cannot be saved because its canonical envelope is invalid.', retryable: false });
    const canonical = canonicalizeMap(input.canonical);
    const checksum = checksumCanonicalMap(canonical);
    const artifact = await this.uploadArtifact(actor, mapId, 'canonical', canonical, checksum);
    const updated = await this.mutate(`/api/encounter-map-drafts/${draftId}`, actor, 'PATCH', {
      bounds: {
        x: canonical.bounds.max[0] - canonical.bounds.min[0],
        y: canonical.bounds.max[1] - canonical.bounds.min[1],
        z: canonical.bounds.max[2] - canonical.bounds.min[2],
      },
      canonicalArtifact: relationshipId(artifact.id),
      canonicalChecksum: checksum,
      draftVersion: current.version + 1,
      lastCommandId: input.commandId,
      paletteVersion: canonical.paletteVersion,
      scaleInFeet: String(canonical.scaleInFeet),
      validationErrors: [],
      validationStatus: 'pending',
      validatedAt: null,
    });
    return this.mapDraft(updated, canonical);
  }

  async validateDraft(actor: RuleApiActor, encounterId: string, mapId: number, draftId: number): Promise<EncounterDraftResource> {
    const draft = await this.getDraft(actor, encounterId, mapId, draftId);
    const errors = validationErrors(draft.canonical);
    const updated = await this.mutate(`/api/encounter-map-drafts/${draftId}`, actor, 'PATCH', {
      validationErrors: errors.map((message) => ({ message })),
      validationStatus: errors.length ? 'invalid' : 'valid',
      validatedAt: new Date().toISOString(),
    });
    return this.mapDraft(updated, draft.canonical);
  }

  async finalizeDraft(actor: RuleApiActor, encounterId: string, mapId: number, draftId: number, input: FinalizeEncounterDraftInput): Promise<EncounterRevisionResource> {
    await this.requireMap(actor, encounterId, mapId);
    const idempotent = await this.findOne(actor, 'encounter-map-revisions', 'finalizationCommandId', input.commandId);
    if (idempotent) return this.mapRevision(idempotent);
    const draft = await this.getDraft(actor, encounterId, mapId, draftId);
    if (draft.version !== input.expectedVersion) {
      throw new ConflictException({ code: 'ENCOUNTER_DRAFT_VERSION_CONFLICT', currentVersion: draft.version, message: 'Only the expected saved draft version can be finalized.', retryable: true });
    }
    const errors = validationErrors(draft.canonical);
    if (errors.length) throw new ConflictException({ code: 'ENCOUNTER_MAP_INVALID', errors, message: 'Draft must pass validation before finalization.', retryable: false });
    const draftDocument = await this.request<JsonRecord>(`/api/encounter-map-drafts/${draftId}?depth=0`, actor, 'ENCOUNTER_DRAFT_NOT_FOUND');
    const revisions = await this.request<PayloadPage>(`/api/encounter-map-revisions?depth=0&limit=1&sort=-revisionNumber&where[map][equals]=${mapId}`, actor);
    const revisionNumber = revisions.docs.length ? Number(revisions.docs[0].revisionNumber) + 1 : 1;
    const subdivisionLevel = draft.canonical.surfaceSubdivisionLevel ?? 0;
    const mesh = subdivideMesh(buildCanonicalMesh(draft.canonical), subdivisionLevel);
    const buffers = buildIndexedMeshBuffers(mesh, { smoothNormals: subdivisionLevel > 0 });
    const compiled = {
      formatVersion: draft.canonical.formatVersion,
      compilerVersion: COMPILER_VERSION,
      canonicalChecksum: draft.checksum,
      surfaceSubdivisionLevel: subdivisionLevel,
      positions: Array.from(buffers.positions),
      normals: Array.from(buffers.normals),
      uvs: Array.from(buffers.uvs),
      indices: Array.from(buffers.indices),
      materialIds: buffers.materialIds,
      materialIndexByTriangle: Array.from(buffers.materialIndexByTriangle),
      triangleCellKeys: buffers.triangleCellKeys,
      triangleFaceNames: buffers.triangleFaceNames,
    };
    const compiledArtifact = await this.uploadArtifact(actor, mapId, 'chunk-manifest', compiled, draft.checksum, COMPILER_VERSION);
    const revision = await this.mutate('/api/encounter-map-revisions', actor, 'POST', {
      bounds: {
        x: draft.canonical.bounds.max[0] - draft.canonical.bounds.min[0],
        y: draft.canonical.bounds.max[1] - draft.canonical.bounds.min[1],
        z: draft.canonical.bounds.max[2] - draft.canonical.bounds.min[2],
      },
      canonicalArtifact: relationshipId(draftDocument.canonicalArtifact),
      canonicalChecksum: draft.checksum,
      compiledArtifacts: [relationshipId(compiledArtifact.id)],
      compilerVersion: COMPILER_VERSION,
      externalId: randomUUID(),
      finalizationCommandId: input.commandId,
      finalizedAt: new Date().toISOString(),
      map: mapId,
      paletteVersion: draft.canonical.paletteVersion,
      revisionNumber,
      scaleInFeet: String(draft.canonical.scaleInFeet),
      sourceDraft: draftId,
    });
    await this.mutate(`/api/encounter-maps/${mapId}`, actor, 'PATCH', { currentRevision: relationshipId(revision.id) });
    return this.mapRevision(revision);
  }

  async getRevisionManifest(actor: RuleApiActor, encounterId: string, mapId: number, revisionId: number) {
    await this.requireMap(actor, encounterId, mapId);
    const revision = await this.request<JsonRecord>(`/api/encounter-map-revisions/${revisionId}?depth=0`, actor, 'ENCOUNTER_REVISION_NOT_FOUND');
    if (relationshipId(revision.map) !== mapId) throw this.notFound('ENCOUNTER_REVISION_NOT_FOUND', 'Revision does not belong to this map.');
    if (relationshipId(revision.map) !== mapId) throw this.notFound('ENCOUNTER_REVISION_NOT_FOUND', 'Revision does not belong to this map.');
    return this.mapRevision(revision);
  }

  async downloadRevisionArtifact(actor: RuleApiActor, encounterId: string, mapId: number, revisionId: number, artifactKind: string) {
    await this.requireMap(actor, encounterId, mapId);
    const revision = await this.request<JsonRecord>(`/api/encounter-map-revisions/${revisionId}?depth=0`, actor, 'ENCOUNTER_REVISION_NOT_FOUND');
    const artifactIds = [relationshipId(revision.canonicalArtifact), ...(revision.compiledArtifacts ?? []).map(relationshipId)];
    for (const artifactId of artifactIds) {
      const artifact = await this.request<JsonRecord>(`/api/encounter-map-artifacts/${artifactId}?depth=0`, actor, 'ENCOUNTER_ARTIFACT_NOT_FOUND');
      if (artifact.kind === artifactKind) return this.downloadArtifact(actor, artifact);
    }
    throw this.notFound('ENCOUNTER_ARTIFACT_NOT_FOUND', `Revision has no '${artifactKind}' artifact.`);
  }

  private async requireMap(actor: RuleApiActor, encounterId: string, mapId: number) {
    const map = await this.request<JsonRecord>(`/api/encounter-maps/${mapId}?depth=0`, actor, 'ENCOUNTER_MAP_NOT_FOUND');
    if (map.encounterExternalId !== encounterId) throw this.notFound('ENCOUNTER_MAP_NOT_FOUND', 'Map does not belong to this encounter.');
    return map;
  }

  private async mapDraft(document: JsonRecord, canonical: EncounterMapCanonical): Promise<EncounterDraftResource> {
    return {
      id: relationshipId(document.id),
      mapId: relationshipId(document.map),
      version: Number(document.draftVersion),
      checksum: document.canonicalChecksum,
      canonical,
      validation: {
        status: document.validationStatus,
        errors: Array.isArray(document.validationErrors) ? document.validationErrors.map((error: JsonRecord) => error.message).filter(Boolean) : [],
        ...(document.validatedAt ? { validatedAt: document.validatedAt } : {}),
      },
      updatedAt: document.updatedAt,
    };
  }

  private mapRevision(document: JsonRecord): EncounterRevisionResource {
    return {
      id: relationshipId(document.id),
      mapId: relationshipId(document.map),
      revisionNumber: Number(document.revisionNumber),
      checksum: document.canonicalChecksum,
      compilerVersion: document.compilerVersion,
      finalizedAt: document.finalizedAt,
      canonicalArtifactId: relationshipId(document.canonicalArtifact),
      compiledArtifactIds: Array.isArray(document.compiledArtifacts) ? document.compiledArtifacts.map(relationshipId) : [],
    };
  }

  private async downloadCanonical(actor: RuleApiActor, artifactId: number): Promise<EncounterMapCanonical> {
    const artifact = await this.request<JsonRecord>(`/api/encounter-map-artifacts/${artifactId}?depth=0`, actor, 'ENCOUNTER_ARTIFACT_NOT_FOUND');
    const bytes = await this.downloadArtifact(actor, artifact);
    try { return JSON.parse(bytes.toString('utf8')) as EncounterMapCanonical; }
    catch { throw new BadGatewayException({ code: 'CMS_ARTIFACT_INVALID', message: 'Canonical artifact is not valid JSON.', retryable: false }); }
  }

  private async downloadArtifact(actor: RuleApiActor, artifact: JsonRecord): Promise<Buffer> {
    if (typeof artifact.filename !== 'string') throw new BadGatewayException({ code: 'CMS_ARTIFACT_INVALID', message: 'Artifact filename is missing.', retryable: false });
    const response = await fetch(`${this.baseUrl}/api/encounter-map-artifacts/file/${encodeURIComponent(artifact.filename)}`, {
      headers: this.actorHeaders(actor), signal: AbortSignal.timeout(10_000),
    }).catch((error) => { throw this.unavailable(error); });
    if (!response.ok) throw new BadGatewayException({ code: 'CMS_ARTIFACT_READ_FAILED', message: `CMS artifact read returned HTTP ${response.status}.`, retryable: true });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (typeof artifact.checksum !== 'string' || checksumBytes(bytes) !== artifact.checksum) {
      throw new BadGatewayException({ code: 'CMS_ARTIFACT_CHECKSUM_MISMATCH', message: 'Encounter artifact failed checksum verification.', retryable: false });
    }
    return bytes;
  }

  private async uploadArtifact(actor: RuleApiActor, mapId: number, kind: string, value: unknown, cacheKey: string, compilerVersion?: string) {
    const bytes = Buffer.from(JSON.stringify(value));
    const artifactChecksum = checksumBytes(bytes);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/json' }), `${kind}-${cacheKey}-${randomUUID()}.json`);
    form.append('_payload', JSON.stringify({ map: mapId, kind, checksum: artifactChecksum, formatVersion: 'encounter-map/1', paletteVersion: PHASE0_MATERIAL_PALETTE.version, ...(compilerVersion ? { compilerVersion } : {}) }));
    const response = await fetch(`${this.baseUrl}/api/encounter-map-artifacts`, {
      body: form, headers: this.actorHeaders(actor), method: 'POST', signal: AbortSignal.timeout(20_000),
    }).catch((error) => { throw this.unavailable(error); });
    const body = await this.readResponse<JsonRecord>(response, 'ENCOUNTER_ARTIFACT_UPLOAD_FAILED');
    return body.doc ?? body;
  }

  private async findOne(actor: RuleApiActor, collection: string, field: string, value: string) {
    const params = new URLSearchParams({ depth: '0', limit: '1', [`where[${field}][equals]`]: value });
    const page = await this.request<PayloadPage>(`/api/${collection}?${params}`, actor);
    return page.docs[0];
  }

  private actorHeaders(actor: RuleApiActor, json = false): Record<string, string> {
    return { ...(json ? { 'content-type': 'application/json' } : {}), ...(actor.email ? { 'x-auth0-email': actor.email } : {}), 'x-auth0-sub': actor.auth0Subject, 'x-cms-internal-token': this.internalToken };
  }

  private async request<T>(path: string, actor: RuleApiActor, notFoundCode = 'ENCOUNTER_RESOURCE_NOT_FOUND'): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.actorHeaders(actor), signal: AbortSignal.timeout(10_000) })
      .catch((error) => { throw this.unavailable(error); });
    return this.readResponse<T>(response, notFoundCode);
  }

  private async mutate(path: string, actor: RuleApiActor, method: 'POST' | 'PATCH', data: JsonRecord): Promise<JsonRecord> {
    const response = await fetch(`${this.baseUrl}${path}`, { body: JSON.stringify(data), headers: this.actorHeaders(actor, true), method, signal: AbortSignal.timeout(15_000) })
      .catch((error) => { throw this.unavailable(error); });
    const body = await this.readResponse<JsonRecord>(response);
    return body.doc ?? body;
  }

  private async readResponse<T>(response: Response, notFoundCode = 'ENCOUNTER_RESOURCE_NOT_FOUND'): Promise<T> {
    const body = await response.json().catch(() => ({})) as JsonRecord;
    if (response.status === 404) throw this.notFound(notFoundCode, 'Encounter resource was not found.');
    if (!response.ok) throw new BadGatewayException({ code: 'ENCOUNTER_CMS_REJECTED', details: body, message: `CMS returned HTTP ${response.status}.`, retryable: response.status >= 500 });
    return body as T;
  }

  private notFound(code: string, message: string) { return new NotFoundException({ code, message, retryable: false }); }
  private unavailable(cause: unknown) { return new ServiceUnavailableException({ code: 'ENCOUNTER_CMS_UNAVAILABLE', message: 'Encounter content storage is unavailable.', retryable: true }, { cause }); }
}
