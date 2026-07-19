import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const Worlds: CollectionConfig = {
  slug: 'worlds',
  admin: { useAsTitle: 'title' },
  access: {
    create: authenticated,
    delete: workspaceReadAccess,
    read: workspaceReadAccess,
    update: workspaceReadAccess,
  },
  versions: { drafts: true, maxPerDoc: 20 },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hooks: { beforeValidate: [setActorWorkspace] },
    },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'title', type: 'text', required: true },
    { name: 'summary', type: 'textarea', required: true },
    { name: 'body', type: 'richText', required: true },
    { name: 'featuredMedia', type: 'relationship', relationTo: 'media' },
    { name: 'locations', type: 'relationship', relationTo: 'locations', hasMany: true },
    { name: 'characters', type: 'relationship', relationTo: 'characters', hasMany: true },
  ],
}
