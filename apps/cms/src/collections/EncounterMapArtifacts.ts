import path from 'node:path'
import type { CollectionConfig } from 'payload'

import { authenticated, immutable, setActorWorkspace, workspaceReadAccess } from '../access'

export const EncounterMapArtifacts: CollectionConfig = {
  slug: 'encounter-map-artifacts',
  admin: { defaultColumns: ['filename', 'kind', 'checksum', 'createdAt'], group: 'Encounter maps', useAsTitle: 'filename' },
  access: { create: authenticated, delete: immutable, read: workspaceReadAccess, update: immutable },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'map', type: 'relationship', relationTo: 'encounter-maps', index: true, required: true },
    { name: 'kind', type: 'select', options: ['canonical', 'debug-export', 'chunk-manifest', 'chunk'], index: true, required: true },
    { name: 'checksum', type: 'text', index: true, required: true },
    { name: 'formatVersion', type: 'text', required: true },
    { name: 'compilerVersion', type: 'text' },
    { name: 'paletteVersion', type: 'text', required: true },
  ],
  upload: {
    mimeTypes: ['application/json', 'application/octet-stream'],
    staticDir: path.resolve(process.cwd(), 'encounter-map-artifacts'),
  },
}
