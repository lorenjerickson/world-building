import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const RuleModules: CollectionConfig = {
  slug: 'rule-modules',
  admin: { defaultColumns: ['name', 'namespace', 'ruleSet', '_status'], group: 'Rule sets', useAsTitle: 'name' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  versions: { drafts: true, maxPerDoc: 50 },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'ruleSet', type: 'relationship', relationTo: 'rule-sets', index: true, required: true },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'namespace', type: 'text', index: true, required: true },
    { name: 'name', type: 'text', index: true, required: true },
    { name: 'description', type: 'richText' },
    { name: 'sortOrder', type: 'number', defaultValue: 0, required: true },
    { name: 'requiredEngineFeatureLevel', type: 'text', required: true },
    { name: 'dependencies', type: 'json', defaultValue: [], required: true },
    { name: 'exports', type: 'json', defaultValue: [], required: true },
  ],
}
