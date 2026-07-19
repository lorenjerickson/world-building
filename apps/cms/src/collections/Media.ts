import path from 'node:path'
import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    create: authenticated,
    delete: workspaceReadAccess,
    read: workspaceReadAccess,
    update: workspaceReadAccess,
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hooks: { beforeValidate: [setActorWorkspace] },
    },
    { name: 'altText', type: 'text', required: true },
    {
      name: 'purpose',
      type: 'select',
      options: ['world-map', 'location-map', 'portrait', 'token', 'handout', 'reference'],
      required: true,
    },
    {
      name: 'tags',
      type: 'array',
      fields: [{ name: 'value', type: 'text', required: true }],
    },
    {
      name: 'generation',
      type: 'group',
      fields: [
        { name: 'provider', type: 'text' },
        { name: 'model', type: 'text' },
        { name: 'promptHash', type: 'text', index: true },
        { name: 'correlationId', type: 'text', index: true },
      ],
    },
  ],
  upload: {
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    staticDir: path.resolve(process.cwd(), 'uploads'),
  },
}
