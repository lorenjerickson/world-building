import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const ruleDefinitionTypes = [
  'entity-type',
  'trait',
  'field',
  'catalog',
  'template',
  'operation',
  'effect',
  'event',
  'constraint',
  'presentation',
  'fixture',
] as const

export const RuleDefinitions: CollectionConfig = {
  slug: 'rule-definitions',
  admin: { defaultColumns: ['name', 'definitionType', 'module', '_status'], group: 'Rule sets', useAsTitle: 'name' },
  access: { create: authenticated, delete: workspaceReadAccess, read: workspaceReadAccess, update: workspaceReadAccess },
  versions: { drafts: true, maxPerDoc: 100 },
  fields: [
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces', required: true, hooks: { beforeValidate: [setActorWorkspace] } },
    { name: 'ruleSet', type: 'relationship', relationTo: 'rule-sets', index: true, required: true },
    { name: 'module', type: 'relationship', relationTo: 'rule-modules', index: true, required: true },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'definitionType', type: 'select', index: true, options: [...ruleDefinitionTypes], required: true },
    { name: 'name', type: 'text', index: true, required: true },
    { name: 'description', type: 'richText' },
    { name: 'schemaVersion', type: 'number', defaultValue: 1, min: 1, required: true },
    { name: 'visibility', type: 'select', defaultValue: 'exported', options: ['exported', 'private'], required: true },
    { name: 'body', type: 'json', required: true },
    { name: 'presentation', type: 'json' },
    { name: 'clonedFrom', type: 'relationship', relationTo: 'rule-definitions' },
    { name: 'provenance', type: 'json' },
    { name: 'tags', type: 'array', fields: [{ name: 'value', type: 'text', required: true }] },
  ],
}
