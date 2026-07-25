import type { CollectionConfig } from 'payload';

export const Sessions: CollectionConfig = {
  slug: 'sessions',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'campaign', 'status', 'scheduledAt', 'updatedAt'],
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
    // {
    //   name: 'campaign',
    //   type: 'relationship',
    //   relationTo: 'campaigns',
    //   required: true,
    //   index: true,
    // },
    {
      name: 'sessionNumber',
      type: 'number',
      defaultValue: 1,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'scheduled',
      options: [
        { label: 'Scheduled', value: 'scheduled' },
        { label: 'Live', value: 'live' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'scheduledAt',
      type: 'date',
    },
    {
      name: 'summary',
      type: 'textarea',
    },
  ],
  timestamps: true,
};
