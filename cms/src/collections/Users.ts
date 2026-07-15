import type { CollectionConfig } from 'payload'

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
    strategies: [
      {
        name: 'trusted-auth0-subject',
        authenticate: async ({ headers, payload }) => {
          const internalToken = headers.get('x-cms-internal-token')
          const subject = headers.get('x-auth0-sub')
          if (!subject || !internalToken || internalToken !== process.env.CMS_INTERNAL_TOKEN) {
            return { user: null }
          }
          const result = await payload.find({
            collection: 'users',
            limit: 1,
            overrideAccess: true,
            where: { auth0Subject: { equals: subject } },
          })
          return {
            user: result.docs[0] || null,
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
