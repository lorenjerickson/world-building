import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const Characters: CollectionConfig = {
  slug: 'characters',
  admin: { useAsTitle: 'name' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'world', type: 'relationship', relationTo: 'worlds', required: true },
    { name: 'location', type: 'relationship', relationTo: 'locations', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'biography', type: 'richText', required: true },
    { name: 'portrait', type: 'relationship', relationTo: 'media' },
  ],
}
