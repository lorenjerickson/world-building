import type { CollectionConfig } from 'payload';

export const Events: CollectionConfig = {
  slug: 'events',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'world', 'eventType', 'updatedAt'],
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
      name: 'eventType',
      type: 'text',
      defaultValue: 'historical',
    },
    {
      name: 'timelinePosition',
      type: 'text',
    },
  ],
  timestamps: true,
};
