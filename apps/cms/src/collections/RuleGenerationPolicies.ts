import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const RuleGenerationPolicies: CollectionConfig = {
  slug: 'rule-generation-policies',
  admin: { defaultColumns: ['name', 'ruleSet', 'module', '_status'], group: 'Rule sets', useAsTitle: 'name' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  versions: { drafts: true, maxPerDoc: 50 },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'ruleSet', type: 'relationship', relationTo: 'rule-sets', index: true, required: true },
    { name: 'module', type: 'relationship', relationTo: 'rule-modules', index: true },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'name', type: 'text', index: true, required: true },
    { name: 'description', type: 'richText' },
    { name: 'capabilities', type: 'json', defaultValue: [], required: true },
    { name: 'artifactKinds', type: 'json', defaultValue: [], required: true },
    { name: 'prohibitions', type: 'json', defaultValue: [], required: true },
    { name: 'policy', type: 'json', required: true },
    { name: 'schemaVersion', type: 'number', defaultValue: 1, min: 1, required: true },
  ],
}
