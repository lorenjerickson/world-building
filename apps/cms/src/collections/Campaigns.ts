import type { CollectionConfig } from 'payload';

export const Campaigns: CollectionConfig = {
  slug: 'campaigns',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'workspace', 'world', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'world',
      type: 'relationship',
      relationTo: 'worlds',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'planning',
      options: [
        { label: 'Planning', value: 'planning' },
        { label: 'Active', value: 'active' },
        { label: 'Paused', value: 'paused' },
        { label: 'Completed', value: 'completed' },
      ],
    },
    {
      name: 'gameplayProfileName',
      type: 'text',
      defaultValue: 'default',
    },
  ],
  timestamps: true,
};
