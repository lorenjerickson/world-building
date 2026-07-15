import { createHash, randomUUID } from 'node:crypto'

import type { CollectionConfig, Payload } from 'payload'
import type { User } from '../payload-types'

let firstUserBootstrap: Promise<User | null> | undefined

function fallbackEmail(subject: string): string {
  const digest = createHash('sha256').update(subject).digest('hex').slice(0, 24)
  return `auth0-${digest}@users.invalid`
}

async function findUser(payload: Payload, subject: string): Promise<User | null> {
  const result = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    where: { auth0Subject: { equals: subject } },
  })
  return result.docs[0] || null
}

async function bootstrapInitialAdministrator(
  payload: Payload,
  subject: string,
  email: string,
): Promise<User | null> {
  const existing = await findUser(payload, subject)
  if (existing) return existing

  const userCount = await payload.count({ collection: 'users', overrideAccess: true })
  if (userCount.totalDocs !== 0) return null

  const existingWorkspaces = await payload.find({
    collection: 'workspaces',
    limit: 1,
    overrideAccess: true,
    sort: 'createdAt',
    where: { name: { equals: 'Primary Workspace' } },
  })
  const workspace = existingWorkspaces.docs[0] || (await payload.create({
    collection: 'workspaces',
    data: {
      externalId: randomUUID(),
      name: 'Primary Workspace',
    },
    overrideAccess: true,
  }))
  return payload.create({
    collection: 'users',
    data: {
      auth0Subject: subject,
      email,
      role: 'admin',
      workspace: workspace.id,
    },
    overrideAccess: true,
  })
}

async function findOrBootstrapUser(
  payload: Payload,
  subject: string,
  email: string,
): Promise<User | null> {
  const existing = await findUser(payload, subject)
  if (existing) return existing

  if (!firstUserBootstrap) {
    firstUserBootstrap = bootstrapInitialAdministrator(payload, subject, email)
  }
  const pendingBootstrap = firstUserBootstrap
  try {
    const bootstrapped = await pendingBootstrap
    return bootstrapped?.auth0Subject === subject ? bootstrapped : findUser(payload, subject)
  } finally {
    if (firstUserBootstrap === pendingBootstrap) firstUserBootstrap = undefined
  }
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  access: {
    admin: ({ req: { user } }) => user?.collection === 'users' && user.role === 'admin',
    read: ({ req: { user } }) => {
      if (user?.collection !== 'users') return false
      if (user.role === 'admin') return true
      return { id: { equals: user.id } }
    },
  },
  auth: {
    disableLocalStrategy: {
      enableFields: true,
      optionalPassword: true,
    },
    strategies: [
      {
        name: 'trusted-auth0-subject',
        authenticate: async ({ headers, payload }) => {
          const internalToken = headers.get('x-cms-internal-token')
          const subject = headers.get('x-auth0-sub')
          if (!subject || !internalToken || internalToken !== process.env.CMS_INTERNAL_TOKEN) {
            return { user: null }
          }
          const email = headers.get('x-auth0-email')?.trim().toLowerCase() || fallbackEmail(subject)
          return {
            user: await findOrBootstrapUser(payload, subject, email),
          }
        },
      },
    ],
  },
  fields: [
    {
      name: 'auth0Subject',
      type: 'text',
      index: true,
      required: true,
      unique: true,
    },
    {
      name: 'role',
      type: 'select',
      defaultValue: 'author',
      options: ['admin', 'author'],
      required: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
    },
  ],
}
