import type { CollectionConfig } from 'payload'

import { authenticated, immutable, setActorUser, setActorWorkspace, workspaceReadAccess } from '../access'

const boundsFields = [
  { name: 'x', type: 'number' as const, min: 1, max: 100, required: true },
  { name: 'y', type: 'number' as const, min: 1, max: 100, required: true },
  { name: 'z', type: 'number' as const, min: 1, max: 100, required: true },
]

export const EncounterMapRevisions: CollectionConfig = {
  slug: 'encounter-map-revisions',
  admin: { defaultColumns: ['map', 'revisionNumber', 'canonicalChecksum', 'finalizedAt'], group: 'Encounter maps', useAsTitle: 'externalId' },
  access: { create: authenticated, delete: immutable, read: workspaceReadAccess, update: immutable },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'map', type: 'relationship', relationTo: 'encounter-maps', index: true, required: true },
    { name: 'sourceDraft', type: 'relationship', relationTo: 'encounter-map-drafts', required: true },
    { name: 'revisionNumber', type: 'number', min: 1, required: true },
    { name: 'finalizationCommandId', type: 'text', index: true, required: true, unique: true },
    { name: 'scaleInFeet', type: 'select', options: [{ label: '6 inches', value: '0.5' }, { label: '1 foot', value: '1' }, { label: '5 feet', value: '5' }], required: true },
    { name: 'bounds', type: 'group', fields: boundsFields, required: true },
    { name: 'paletteVersion', type: 'text', required: true },
    { name: 'canonicalChecksum', type: 'text', index: true, required: true },
    { name: 'compilerVersion', type: 'text', required: true },
    { name: 'canonicalArtifact', type: 'relationship', relationTo: 'encounter-map-artifacts', required: true },
    { name: 'compiledArtifacts', type: 'relationship', relationTo: 'encounter-map-artifacts', hasMany: true },
    { name: 'finalizedBy', type: 'relationship', relationTo: 'users', required: true, hooks: { beforeValidate: [setActorUser] } },
    { name: 'finalizedAt', type: 'date', required: true },
  ],
}
