import type { CollectionConfig } from 'payload'

import { authenticated, setActorWorkspace, workspaceReadAccess } from '../access'

export const RuleSets: CollectionConfig = {
  slug: 'rule-sets',
  admin: {
    defaultColumns: ['name', 'lifecycle', '_status', 'updatedAt'],
    group: 'Rule sets',
    useAsTitle: 'name',
  },
  access: {
    create: authenticated,
    delete: workspaceReadAccess,
    read: workspaceReadAccess,
    update: workspaceReadAccess,
  },
  versions: { drafts: true, maxPerDoc: 50 },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hooks: { beforeValidate: [setActorWorkspace] },
    },
    { name: 'externalId', type: 'text', index: true, required: true, unique: true },
    { name: 'name', type: 'text', index: true, required: true },
    { name: 'slug', type: 'text', index: true, required: true },
    { name: 'summary', type: 'textarea', required: true },
    { name: 'description', type: 'richText' },
    {
      name: 'lifecycle',
      type: 'select',
      defaultValue: 'active',
      index: true,
      options: ['active', 'deprecated', 'retired'],
      required: true,
    },
    { name: 'engineFeatureLevel', type: 'text', required: true },
    {
      name: 'dashboard',
      type: 'group',
      fields: [
        { name: 'icon', type: 'relationship', relationTo: 'media' },
        { name: 'accentColor', type: 'text' },
        { name: 'featured', type: 'checkbox', defaultValue: false },
      ],
    },
    {
      name: 'tags',
      type: 'array',
      fields: [{ name: 'value', type: 'text', required: true }],
    },
  ],
}
