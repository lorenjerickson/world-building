import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

const boundsFields = [
  { name: 'x', type: 'number' as const, min: 1, max: 100, required: true },
  { name: 'y', type: 'number' as const, min: 1, max: 100, required: true },
  { name: 'z', type: 'number' as const, min: 1, max: 100, required: true },
]

export const EncounterMapDrafts: CollectionConfig = {
  slug: 'encounter-map-drafts',
  admin: { defaultColumns: ['map', 'draftVersion', 'validationStatus', 'updatedAt'], group: 'Encounter maps', useAsTitle: 'externalId' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'map', type: 'relationship', relationTo: 'encounter-maps', index: true, required: true },
    { name: 'draftVersion', type: 'number', min: 1, required: true },
    { name: 'lastCommandId', type: 'text', index: true },
    { name: 'scaleInFeet', type: 'select', options: [{ label: '6 inches', value: '0.5' }, { label: '1 foot', value: '1' }, { label: '5 feet', value: '5' }], required: true },
    { name: 'bounds', type: 'group', fields: boundsFields, required: true },
    { name: 'paletteVersion', type: 'text', required: true },
    { name: 'canonicalChecksum', type: 'text', index: true, required: true },
    { name: 'canonicalArtifact', type: 'relationship', relationTo: 'encounter-map-artifacts', required: true },
    { name: 'validationStatus', type: 'select', options: ['pending', 'valid', 'invalid'], defaultValue: 'pending', index: true, required: true },
    { name: 'validationErrors', type: 'array', fields: [{ name: 'message', type: 'text', required: true }] },
    { name: 'validatedAt', type: 'date' },
  ],
}
