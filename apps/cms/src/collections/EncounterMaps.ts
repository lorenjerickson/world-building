import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const EncounterMaps: CollectionConfig = {
  slug: 'encounter-maps',
  admin: { defaultColumns: ['name', 'campaignExternalId', 'encounterExternalId', 'updatedAt'], group: 'Encounter maps', useAsTitle: 'name' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'campaignExternalId', type: 'text', index: true, required: true },
    { name: 'encounterExternalId', type: 'text', index: true, required: true },
    { name: 'location', type: 'relationship', relationTo: 'locations' },
    { name: 'name', type: 'text', required: true },
    { name: 'currentDraft', type: 'relationship', relationTo: 'encounter-map-drafts' },
    { name: 'currentRevision', type: 'relationship', relationTo: 'encounter-map-revisions' },
  ],
}
