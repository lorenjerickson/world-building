import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

const immutableFields = [
  'workspace',
  'ruleSet',
  'externalId',
  'version',
  'contentHash',
  'engineCompatibility',
  'dependencyLock',
  'manifest',
  'sourceSnapshot',
  'publishedBy',
  'publishedAt',
] as const

const preservePublishedRelease: CollectionBeforeChangeHook = ({ data, operation, originalDoc }) => {
  if (operation !== 'update' || !originalDoc) return data
  for (const field of immutableFields) {
    if (field in data && JSON.stringify(data[field]) !== JSON.stringify(originalDoc[field])) {
      throw new Error(`Published rule-set release field '${field}' is immutable`)
    }
  }
  return data
}

export const RuleReleases: CollectionConfig = {
  slug: 'rule-releases',
  admin: { defaultColumns: ['version', 'ruleSet', 'lifecycle', 'publishedAt'], group: 'Rule sets', useAsTitle: 'version' },
  access: { create: authenticated, delete: () => false, read: workspaceReadAccess, update: workspaceReadAccess },
  hooks: { beforeChange: [preservePublishedRelease] },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'ruleSet', type: 'relationship', relationTo: 'rule-sets', index: true, required: true },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'version', type: 'text', index: true, required: true },
    { name: 'contentHash', type: 'text', index: true, required: true },
    { name: 'engineCompatibility', type: 'json', required: true },
    { name: 'dependencyLock', type: 'json', defaultValue: [], required: true },
    { name: 'manifest', type: 'json', required: true },
    { name: 'sourceSnapshot', type: 'json', required: true },
    { name: 'publishedBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'publishedAt', type: 'date', index: true, required: true },
    { name: 'releaseNotes', type: 'richText' },
    { name: 'lifecycle', type: 'select', defaultValue: 'published', index: true, options: ['published', 'deprecated', 'retired'], required: true },
  ],
}
