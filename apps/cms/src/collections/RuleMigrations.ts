import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const RuleMigrations: CollectionConfig = {
  slug: 'rule-migrations',
  admin: { defaultColumns: ['name', 'sourceRelease', 'targetRelease', '_status'], group: 'Rule sets', useAsTitle: 'name' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  versions: { drafts: true, maxPerDoc: 50 },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'ruleSet', type: 'relationship', relationTo: 'rule-sets', index: true, required: true },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'name', type: 'text', required: true },
    { name: 'sourceRelease', type: 'relationship', relationTo: 'rule-releases', index: true, required: true },
    { name: 'targetRelease', type: 'relationship', relationTo: 'rule-releases', index: true, required: true },
    { name: 'transformations', type: 'json', required: true },
    { name: 'rehearsal', type: 'json' },
    { name: 'reversibility', type: 'select', defaultValue: 'reversible', options: ['reversible', 'checkpoint-only', 'irreversible'], required: true },
    { name: 'schemaVersion', type: 'number', defaultValue: 1, min: 1, required: true },
  ],
}
