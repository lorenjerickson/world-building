import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'node:path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { Characters } from './collections/Characters'
import { Locations } from './collections/Locations'
import { Media } from './collections/Media'
import { Users } from './collections/Users'
import { Workspaces } from './collections/Workspaces'
import { Worlds } from './collections/Worlds'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },
  collections: [Users, Workspaces, Media, Worlds, Locations, Characters],
  db: postgresAdapter({
    migrationDir: path.resolve(dirname, 'migrations'),
    pool: { connectionString: process.env.CMS_DATABASE_URL || '' },
    push: false,
  }),
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL,
  sharp,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
