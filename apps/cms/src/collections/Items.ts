import type { CollectionConfig } from 'payload';

export const Items: CollectionConfig = {
  slug: 'items',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'world', 'itemType', 'updatedAt'],
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
      name: 'world',
      type: 'relationship',
      relationTo: 'worlds',
      required: true,
      index: true,
    },
    {
      name: 'itemType',
      type: 'text',
      defaultValue: 'artifact',
    },
    {
      name: 'properties',
      type: 'json',
    },
  ],
  timestamps: true,
};
