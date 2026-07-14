import 'dotenv/config'
import config from '@payload-config'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'
import { getPayload } from 'payload'

import type { User, Workspace } from '../src/payload-types'

const baseURL = process.env.POC_BASE_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3100'
const internalToken = process.env.CMS_INTERNAL_TOKEN || ''
const runID = Date.now().toString(36)

type Check = { name: string; detail: string; durationMs?: number; passed: boolean }
const checks: Check[] = []

function assert(condition: unknown, name: string, detail: string): asserts condition {
  checks.push({ name, detail, passed: Boolean(condition) })
  if (!condition) throw new Error(`${name}: ${detail}`)
}

function actorHeaders(subject: string, json = false): Record<string, string> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-auth0-sub': subject,
    'x-cms-internal-token': internalToken,
  }
}

function relationshipID(value: number | Workspace): number {
  return typeof value === 'number' ? value : value.id
}

const richText = (text: string) => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 },
        ],
        direction: 'ltr' as const,
        format: '' as const,
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1,
      },
    ],
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
})

async function jsonResponse(response: Response, expected: number | number[] = 200) {
  const accepted = Array.isArray(expected) ? expected : [expected]
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }
  if (!accepted.includes(response.status)) {
    throw new Error(`HTTP ${response.status} ${response.url}: ${text.slice(0, 500)}`)
  }
  return body as Record<string, any>
}

async function createViaREST(collection: string, subject: string, data: Record<string, unknown>) {
  const response = await fetch(`${baseURL}/api/${collection}`, {
    body: JSON.stringify(data),
    headers: actorHeaders(subject, true),
    method: 'POST',
  })
  const body = await jsonResponse(response, [200, 201])
  return body.doc || body
}

async function main() {
  const payload = await getPayload({ config })
  try {
    const workspace = await payload.create({
      collection: 'workspaces',
      data: { externalId: `workspace-primary-${runID}`, name: `Primary ${runID}` },
      overrideAccess: true,
    })
    const otherWorkspace = await payload.create({
      collection: 'workspaces',
      data: { externalId: `workspace-other-${runID}`, name: `Other ${runID}` },
      overrideAccess: true,
    })
    const subject = `auth0|poc-author-${runID}`
    const otherSubject = `auth0|poc-other-${runID}`
    const actor = await payload.create({
      collection: 'users',
      data: {
        auth0Subject: subject,
        email: `author-${runID}@example.test`,
        password: `Poc-${runID}-password!`,
        role: 'author',
        workspace: workspace.id,
      },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'users',
      data: {
        auth0Subject: otherSubject,
        email: `other-${runID}@example.test`,
        password: `Poc-${runID}-password!`,
        role: 'author',
        workspace: otherWorkspace.id,
      },
      overrideAccess: true,
    })

    const meResponse = await fetch(`${baseURL}/api/users/me`, { headers: actorHeaders(subject) })
    const me = await jsonResponse(meResponse)
    assert(me.user?.auth0Subject === subject, 'Auth0 identity propagation', 'trusted internal headers resolved the expected Payload user')

    const sourceRichText = richText(`The Glass Archive remembers run ${runID}.`)
    const world = await createViaREST('worlds', subject, {
      _status: 'published',
      body: sourceRichText,
      externalId: `world-${runID}`,
      summary: 'A representative nested world used by the Payload CMS proof of concept.',
      title: `Glass Archive ${runID}`,
    })
    assert(
      relationshipID(world.workspace) === workspace.id,
      'Actor workspace injection',
      'the authenticated actor workspace was applied server-side instead of trusted from client data',
    )

    const form = new FormData()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nLkAAAAASUVORK5CYII=', 'base64')
    form.append('file', new Blob([png], { type: 'image/png' }), `generated-${runID}.png`)
    form.append('_payload', JSON.stringify({
      altText: 'Generated one-pixel PoC portrait',
      generation: {
        correlationId: `generation-${runID}`,
        model: 'poc-image-model',
        promptHash: `sha256:${runID}`,
        provider: 'openai',
      },
      purpose: 'portrait',
      tags: [{ value: 'generated' }, { value: 'poc' }],
    }))
    const mediaResponse = await fetch(`${baseURL}/api/media`, {
      body: form,
      headers: actorHeaders(subject),
      method: 'POST',
    })
    const mediaBody = await jsonResponse(mediaResponse, [200, 201])
    const media = mediaBody.doc || mediaBody
    assert(
      media.generation?.correlationId === `generation-${runID}` && media.purpose === 'portrait',
      'Multipart generated-image ingestion',
      'file bytes and generation metadata were persisted in one authenticated multipart request',
    )

    const assetURL = new URL(media.url, baseURL).toString()
    const anonymousAsset = await fetch(assetURL)
    const wrongWorkspaceAsset = await fetch(assetURL, { headers: actorHeaders(otherSubject) })
    const authorizedAsset = await fetch(assetURL, { headers: actorHeaders(subject) })
    const authorizedBytes = Buffer.from(await authorizedAsset.arrayBuffer())
    assert(
      anonymousAsset.status !== 200 && wrongWorkspaceAsset.status !== 200 && authorizedAsset.status === 200,
      'Private asset authorization',
      `anonymous=${anonymousAsset.status}, other-workspace=${wrongWorkspaceAsset.status}, owner=${authorizedAsset.status}`,
    )
    assert(authorizedBytes.equals(png), 'Private asset byte fidelity', 'authorized media response exactly matched uploaded bytes')

    const locationIDs: number[] = []
    const characterIDs: number[] = []
    for (let index = 0; index < 12; index += 1) {
      const location = await payload.create({
        collection: 'locations',
        data: {
          description: richText(`Nested location ${index}`),
          title: `Location ${index}`,
          workspace: workspace.id,
          world: world.id,
        },
        overrideAccess: false,
        user: actor as User,
      })
      locationIDs.push(location.id)
      for (let characterIndex = 0; characterIndex < 2; characterIndex += 1) {
        const character = await payload.create({
          collection: 'characters',
          data: {
            biography: richText(`Character ${index}-${characterIndex}`),
            location: location.id,
            name: `Character ${index}-${characterIndex}`,
            portrait: media.id,
            workspace: workspace.id,
            world: world.id,
          },
          overrideAccess: false,
          user: actor as User,
        })
        characterIDs.push(character.id)
      }
    }
    await payload.update({
      collection: 'worlds',
      data: { characters: characterIDs, featuredMedia: media.id, locations: locationIDs },
      id: world.id,
      overrideAccess: false,
      user: actor as User,
    })

    const worldResponse = await fetch(`${baseURL}/api/worlds/${world.id}?depth=2`, { headers: actorHeaders(subject) })
    const nestedWorld = await jsonResponse(worldResponse)
    assert(
      isDeepStrictEqual(nestedWorld.body, sourceRichText),
      'Rich-text round trip',
      'Lexical JSON returned through REST exactly matched the submitted structure',
    )
    assert(
      nestedWorld.locations?.length === 12 && nestedWorld.characters?.length === 24 && typeof nestedWorld.locations[0] === 'object',
      'Representative nested query',
      'depth=2 returned 12 locations and 24 characters as populated documents',
    )

    const timings: number[] = []
    let responseBytes = 0
    for (let index = 0; index < 21; index += 1) {
      const started = performance.now()
      const response = await fetch(`${baseURL}/api/worlds/${world.id}?depth=2`, { headers: actorHeaders(subject) })
      const text = await response.text()
      if (!response.ok) throw new Error(`Benchmark query failed with ${response.status}`)
      if (index > 0) timings.push(performance.now() - started)
      responseBytes = Buffer.byteLength(text)
    }
    timings.sort((a, b) => a - b)
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1]
    checks.push({
      detail: `20 warm local REST reads: p95=${p95.toFixed(1)}ms, response=${responseBytes} bytes`,
      durationMs: p95,
      name: 'Nested query performance',
      passed: p95 < 250 && responseBytes < 1_000_000,
    })
    if (p95 >= 250 || responseBytes >= 1_000_000) throw new Error('Nested query performance exceeded PoC thresholds')

    const wrongWorkspaceWorld = await fetch(`${baseURL}/api/worlds/${world.id}?depth=0`, { headers: actorHeaders(otherSubject) })
    assert(wrongWorkspaceWorld.status !== 200, 'Workspace content isolation', `other workspace received HTTP ${wrongWorkspaceWorld.status}`)

    const adminStarted = performance.now()
    const adminResponse = await fetch(`${baseURL}/admin`)
    const adminHTML = await adminResponse.text()
    checks.push({
      detail: `HTTP ${adminResponse.status}, ${Buffer.byteLength(adminHTML)} HTML bytes`,
      durationMs: performance.now() - adminStarted,
      name: 'Admin UI production render',
      passed: adminResponse.status === 200 && adminHTML.includes('/_next/static/'),
    })
    if (adminResponse.status !== 200 || !adminHTML.includes('/_next/static/')) throw new Error('Admin UI did not render a production bundle')

    const result = {
      baseURL,
      checks,
      nestedContent: { characters: 24, locations: 12, responseBytes },
      passed: checks.every((check) => check.passed),
      versions: { next: '16.2.2', payload: '3.84.0', react: '19.2.4', typescript: '6.0.2' },
    }
    await writeFile(path.resolve(process.cwd(), 'poc-results.json'), `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await payload.destroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
