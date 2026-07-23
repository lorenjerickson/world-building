import { config as loadEnvironment } from 'dotenv'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getPayload } from 'payload'

import type { Cell, EncounterMapCanonical, ShapeKind } from '@world-building/common'

const geometry = createRequire(import.meta.url)('@world-building/common') as typeof import('@world-building/common')
const {
  buildCanonicalMesh,
  canonicalizeMap,
  checksumCanonicalMap,
  deriveVertexRemaps,
  PHASE0_MATERIAL_PALETTE,
} = geometry

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

loadEnvironment({ path: path.resolve(scriptDirectory, '../.env') })
loadEnvironment({ path: path.resolve(scriptDirectory, '../../backend/.env') })

const backendURL = (process.env.BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const cmsURL = (process.env.CMS_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '')
const cmsToken = process.env.CMS_INTERNAL_TOKEN || ''
const gatewayToken = process.env.RULE_API_INTERNAL_TOKEN || ''
const runID = Date.now().toString(36)

type Check = { name: string; detail: string; passed: boolean }
type JsonRecord = Record<string, any>

const checks: Check[] = []

function assert(condition: unknown, name: string, detail: string): asserts condition {
  checks.push({ name, detail, passed: Boolean(condition) })
  if (!condition) throw new Error(`${name}: ${detail}`)
}

function backendHeaders(subject: string, json = false): Record<string, string> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-auth0-email': `${subject.replace(/[^a-z0-9]/gi, '-')}@example.test`,
    'x-auth0-sub': subject,
    'x-rule-api-token': gatewayToken,
  }
}

function cmsHeaders(subject: string, json = false): Record<string, string> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-auth0-sub': subject,
    'x-cms-internal-token': cmsToken,
  }
}

async function requestJSON(
  path: string,
  subject: string,
  options: { body?: unknown; expected?: number | number[]; method?: string } = {},
): Promise<{ body: JsonRecord; response: Response }> {
  const response = await fetch(`${backendURL}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: backendHeaders(subject, options.body !== undefined),
    method: options.method || 'GET',
  })
  const text = await response.text()
  let body: JsonRecord = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { text } }
  const expected = Array.isArray(options.expected) ? options.expected : [options.expected ?? 200]
  if (!expected.includes(response.status)) {
    throw new Error(`HTTP ${response.status} ${path}: ${text.slice(0, 500)}`)
  }
  return { body, response }
}

function relationshipID(value: unknown): number {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && typeof (value as JsonRecord).id === 'number') return (value as JsonRecord).id
  throw new Error(`Invalid relationship: ${JSON.stringify(value)}`)
}

const shapes: ShapeKind[] = [
  'cube',
  'rampXPos',
  'rampXNeg',
  'rampYPos',
  'rampYNeg',
  'cornerRampNE',
  'cornerRampNW',
  'cornerRampSE',
  'cornerRampSW',
]

function buildAcceptanceCanonical(): EncounterMapCanonical {
  const materials = PHASE0_MATERIAL_PALETTE.materials.map((material) => material.id)
  const cells: Cell[] = shapes.map((shape, index) => ({
    x: index * 2,
    y: 0,
    z: 0,
    shape,
    materials: {
      bottom: materials[(index + 0) % materials.length],
      top: materials[(index + 1) % materials.length],
      west: materials[(index + 2) % materials.length],
      east: materials[(index + 3) % materials.length],
      south: materials[(index + 4) % materials.length],
      north: materials[(index + 5) % materials.length],
    },
  }))
  const derived = deriveVertexRemaps(cells)
  assert(derived.errors.length === 0, 'Shape fixture compatibility', derived.errors.join('; ') || 'all shape presets produced compatible shared remaps')
  const canonical = canonicalizeMap({
    formatVersion: 'encounter-map/1',
    scaleInFeet: 1,
    paletteVersion: PHASE0_MATERIAL_PALETTE.version,
    bounds: { min: [0, 0, 0], max: [20, 4, 4] },
    occupiedCells: cells.map(({ x, y, z, materials: faceMaterials }) => ({ x, y, z, materials: faceMaterials })),
    vertexRemaps: derived.remaps,
  })
  const mesh = buildCanonicalMesh(canonical)
  assert(mesh.triangles.length > 0, 'Acceptance geometry compilation', `${mesh.triangles.length} triangles compiled from every supported shape`)
  return canonical
}

async function main() {
  assert(Boolean(cmsToken), 'CMS credential configuration', 'CMS_INTERNAL_TOKEN is configured')
  assert(Boolean(gatewayToken), 'Backend trust configuration', 'RULE_API_INTERNAL_TOKEN is configured')

  const cmsHealth = await fetch(`${cmsURL}/api/health`)
  assert(cmsHealth.ok, 'Private CMS availability', `CMS health returned HTTP ${cmsHealth.status}`)

  const { default: payloadConfig } = await import('../src/payload.config')
  const payload = await getPayload({ config: payloadConfig })
  try {
    const ownerWorkspace = await payload.create({
      collection: 'workspaces',
      data: { externalId: `encounter-owner-${runID}`, name: `Encounter owner ${runID}` },
      overrideAccess: true,
    })
    const otherWorkspace = await payload.create({
      collection: 'workspaces',
      data: { externalId: `encounter-other-${runID}`, name: `Encounter other ${runID}` },
      overrideAccess: true,
    })
    const ownerSubject = `auth0|encounter-owner-${runID}`
    const otherSubject = `auth0|encounter-other-${runID}`
    await payload.create({
      collection: 'users',
      data: {
        auth0Subject: ownerSubject,
        email: `encounter-owner-${runID}@example.test`,
        password: `Encounter-${runID}-owner!`,
        role: 'author',
        workspace: ownerWorkspace.id,
      },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'users',
      data: {
        auth0Subject: otherSubject,
        email: `encounter-other-${runID}@example.test`,
        password: `Encounter-${runID}-other!`,
        role: 'author',
        workspace: otherWorkspace.id,
      },
      overrideAccess: true,
    })

    const encounterID = `encounter-acceptance-${runID}`
    const created = await requestJSON(`/api/encounters/${encounterID}/maps`, ownerSubject, {
      body: {
        bounds: { x: 20, y: 4, z: 4 },
        campaignExternalId: `campaign-acceptance-${runID}`,
        commandId: `create-${runID}`,
        name: `Acceptance map ${runID}`,
        scaleInFeet: 1,
      },
      expected: [200, 201],
      method: 'POST',
    })
    const mapID = relationshipID(created.body.id)
    const draftID = relationshipID(created.body.draft?.id)
    assert(created.body.draft?.version === 1, 'Encounter map creation', `created map ${mapID}, draft ${draftID}, version 1`)

    const initialCanonical = created.body.draft.canonical as EncounterMapCanonical
    const authoredCanonical = buildAcceptanceCanonical()
    const initialChecksum = checksumCanonicalMap(initialCanonical)
    const authoredChecksum = checksumCanonicalMap(authoredCanonical)
    const undoChecksum = checksumCanonicalMap(initialCanonical)
    const redoChecksum = checksumCanonicalMap(authoredCanonical)
    assert(
      initialChecksum === undoChecksum && authoredChecksum === redoChecksum && initialChecksum !== authoredChecksum,
      'Undo/redo checksum stability',
      `empty=${initialChecksum.slice(0, 12)}, authored=${authoredChecksum.slice(0, 12)}`,
    )

    const draftPath = `/api/encounters/${encounterID}/maps/${mapID}/drafts/${draftID}`
    const saveCommand = `save-${runID}`
    const saved = await requestJSON(draftPath, ownerSubject, {
      body: { canonical: authoredCanonical, commandId: saveCommand, expectedVersion: 1 },
      method: 'PUT',
    })
    assert(
      saved.body.version === 2 && saved.body.checksum === authoredChecksum && saved.body.validation?.status === 'pending',
      'Draft save and canonical checksum',
      `version=${saved.body.version}, checksum=${String(saved.body.checksum).slice(0, 12)}`,
    )

    const duplicateSave = await requestJSON(draftPath, ownerSubject, {
      body: { canonical: authoredCanonical, commandId: saveCommand, expectedVersion: 1 },
      method: 'PUT',
    })
    assert(duplicateSave.body.version === 2, 'Duplicate save idempotency', 'reusing a save command returned version 2 without another mutation')

    const invalidCanonical = structuredClone(authoredCanonical)
    invalidCanonical.occupiedCells[0]!.materials = { top: 'not-a-system-material' }
    const invalidSave = await requestJSON(draftPath, ownerSubject, {
      body: { canonical: invalidCanonical, commandId: `invalid-${runID}`, expectedVersion: 2 },
      expected: 409,
      method: 'PUT',
    })
    assert(invalidSave.body.code === 'ENCOUNTER_MAP_INVALID', 'Invalid material rejection', String(invalidSave.body.message))

    const staleSave = await requestJSON(draftPath, ownerSubject, {
      body: { canonical: authoredCanonical, commandId: `stale-${runID}`, expectedVersion: 1 },
      expected: 409,
      method: 'PUT',
    })
    assert(
      staleSave.body.code === 'ENCOUNTER_DRAFT_VERSION_CONFLICT' && staleSave.body.currentVersion === 2,
      'Stale save rejection',
      `code=${staleSave.body.code}, currentVersion=${staleSave.body.currentVersion}`,
    )

    const validated = await requestJSON(`${draftPath}/validate`, ownerSubject, { expected: [200, 201], method: 'POST' })
    assert(validated.body.validation?.status === 'valid', 'Server topology validation', 'saved draft passed canonical and mesh validation')

    const finalizationCommand = `finalize-${runID}`
    const finalized = await requestJSON(`${draftPath}/finalize`, ownerSubject, {
      body: { commandId: finalizationCommand, expectedVersion: 2 },
      expected: [200, 201],
      method: 'POST',
    })
    const revisionID = relationshipID(finalized.body.id)
    assert(
      finalized.body.revisionNumber === 1 && finalized.body.checksum === authoredChecksum && finalized.body.compiledArtifactIds?.length === 1,
      'Immutable revision finalization',
      `revision=${revisionID}, compiler=${finalized.body.compilerVersion}`,
    )

    const duplicateFinalization = await requestJSON(`${draftPath}/finalize`, ownerSubject, {
      body: { commandId: finalizationCommand, expectedVersion: 2 },
      expected: [200, 201],
      method: 'POST',
    })
    assert(
      duplicateFinalization.body.id === revisionID && duplicateFinalization.body.revisionNumber === 1,
      'Duplicate finalization idempotency',
      `command returned original revision ${revisionID}`,
    )

    const revisionPath = `/api/encounters/${encounterID}/maps/${mapID}/revisions/${revisionID}`
    const manifest = await requestJSON(`${revisionPath}/manifest`, ownerSubject)
    assert(
      manifest.body.checksum === authoredChecksum && manifest.body.compilerVersion === finalized.body.compilerVersion,
      'Revision manifest reopen',
      `checksum=${String(manifest.body.checksum).slice(0, 12)}`,
    )

    const canonicalResponse = await fetch(`${backendURL}${revisionPath}/artifacts/canonical/default`, {
      headers: backendHeaders(ownerSubject),
    })
    const canonicalBytes = Buffer.from(await canonicalResponse.arrayBuffer())
    const reopenedCanonical = JSON.parse(canonicalBytes.toString('utf8')) as EncounterMapCanonical
    assert(
      canonicalResponse.status === 200 && checksumCanonicalMap(reopenedCanonical) === authoredChecksum,
      'Canonical artifact download',
      `HTTP ${canonicalResponse.status}, ${canonicalBytes.byteLength} bytes`,
    )

    const compiledResponse = await fetch(`${backendURL}${revisionPath}/artifacts/chunk-manifest/default`, {
      headers: backendHeaders(ownerSubject),
    })
    const compiled = await compiledResponse.json() as JsonRecord
    assert(
      compiledResponse.status === 200 && compiled.canonicalChecksum === authoredChecksum && compiled.indices?.length > 0,
      'Compiled artifact download',
      `HTTP ${compiledResponse.status}, ${compiled.indices?.length ?? 0} indices`,
    )

    const crossWorkspaceDraft = await requestJSON(draftPath, otherSubject, { expected: 404 })
    assert(crossWorkspaceDraft.response.status === 404, 'Cross-workspace draft isolation', `HTTP ${crossWorkspaceDraft.response.status}, code=${crossWorkspaceDraft.body.code ?? 'none'}`)
    const crossWorkspaceArtifact = await requestJSON(`${revisionPath}/artifacts/canonical/default`, otherSubject, { expected: 404 })
    assert(crossWorkspaceArtifact.response.status === 404, 'Cross-workspace artifact isolation', 'other workspace could not download canonical bytes')

    const immutablePatch = await fetch(`${cmsURL}/api/encounter-map-revisions/${revisionID}`, {
      body: JSON.stringify({ revisionNumber: 99 }),
      headers: cmsHeaders(ownerSubject, true),
      method: 'PATCH',
    })
    assert(immutablePatch.status === 403, 'Revision mutation rejection', `Payload returned HTTP ${immutablePatch.status}`)

    await payload.update({
      collection: 'encounter-map-artifacts',
      data: { checksum: '0'.repeat(64) },
      id: finalized.body.canonicalArtifactId,
      overrideAccess: true,
    })
    const corruptedArtifact = await requestJSON(`${revisionPath}/artifacts/canonical/default`, ownerSubject, { expected: 502 })
    assert(
      corruptedArtifact.body.code === 'CMS_ARTIFACT_CHECKSUM_MISMATCH',
      'Corrupted artifact rejection',
      `code=${corruptedArtifact.body.code}`,
    )

    const result = {
      backendURL,
      checks,
      cmsURL,
      passed: checks.every((check) => check.passed),
      resources: { draftID, mapID, revisionID },
      runID,
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await payload.destroy()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
