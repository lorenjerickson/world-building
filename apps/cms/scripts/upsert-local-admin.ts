import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { config as loadEnvironment } from 'dotenv'
import { getPayload } from 'payload'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
loadEnvironment({ path: path.resolve(scriptDirectory, '../.env') })

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.CMS_ENABLE_LOCAL_ADMIN !== 'true') {
    throw new Error('Local admin bootstrap requires CMS_ENABLE_LOCAL_ADMIN=true outside production.')
  }

  const email = process.env.CMS_LOCAL_ADMIN_EMAIL?.trim().toLowerCase() || ''
  const password = process.env.CMS_LOCAL_ADMIN_PASSWORD || ''
  if (!email.includes('@')) throw new Error('CMS_LOCAL_ADMIN_EMAIL must contain a valid local administrator email.')
  if (password.length < 12) throw new Error('CMS_LOCAL_ADMIN_PASSWORD must contain at least 12 characters.')

  const { default: payloadConfig } = await import('../src/payload.config')
  const payload = await getPayload({ config: payloadConfig })
  try {
    const existing = await payload.find({
      collection: 'users',
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: email } },
    })

    if (existing.docs[0]) {
      await payload.update({
        collection: 'users',
        data: { password, role: 'admin' },
        id: existing.docs[0].id,
        overrideAccess: true,
      })
      console.log(`Local Payload administrator reset for ${email}.`)
      return
    }

    const workspaces = await payload.find({
      collection: 'workspaces',
      limit: 1,
      overrideAccess: true,
      sort: 'createdAt',
    })
    const workspace = workspaces.docs[0] || await payload.create({
      collection: 'workspaces',
      data: { externalId: `local-admin-${createHash('sha256').update(email).digest('hex').slice(0, 24)}`, name: 'Primary Workspace' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'users',
      data: {
        auth0Subject: `local-admin|${createHash('sha256').update(email).digest('hex')}`,
        email,
        password,
        role: 'admin',
        workspace: workspace.id,
      },
      overrideAccess: true,
    })
    console.log(`Local Payload administrator created for ${email}.`)
  } finally {
    await payload.destroy()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
