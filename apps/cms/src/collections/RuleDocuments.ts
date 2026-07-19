import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const RuleDocuments: CollectionConfig = {
  slug: 'rule-documents',
  admin: { defaultColumns: ['title', 'kind', 'ruleSet', '_status'], group: 'Rule sets', useAsTitle: 'title' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  versions: { drafts: true, maxPerDoc: 50 },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'ruleSet', type: 'relationship', relationTo: 'rule-sets', index: true, required: true },
    { name: 'module', type: 'relationship', relationTo: 'rule-modules', index: true },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'title', type: 'text', index: true, required: true },
    { name: 'kind', type: 'select', defaultValue: 'guide', options: ['guide', 'example', 'reference', 'changelog'], required: true },
    { name: 'body', type: 'richText', required: true },
    { name: 'sortOrder', type: 'number', defaultValue: 0, required: true },
  ],
}
