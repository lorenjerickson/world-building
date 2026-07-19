import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const Locations: CollectionConfig = {
  slug: 'locations',
  admin: { useAsTitle: 'title' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'world', type: 'relationship', relationTo: 'worlds', required: true },
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'richText', required: true },
    { name: 'map', type: 'relationship', relationTo: 'media' },
  ],
}
