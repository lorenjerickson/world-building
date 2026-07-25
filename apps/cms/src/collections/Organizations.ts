import type { CollectionConfig } from 'payload';

export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'world', 'updatedAt'],
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
      name: 'headquarters',
      type: 'text',
    },
    {
      name: 'alignment',
      type: 'text',
    },
  ],
  timestamps: true,
};
