import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'node:path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { Characters } from './collections/Characters'
import { Locations } from './collections/Locations'
import { Media } from './collections/Media'
import { RuleDefinitions } from './collections/RuleDefinitions'
import { RuleDocuments } from './collections/RuleDocuments'
import { RuleGenerationPolicies } from './collections/RuleGenerationPolicies'
import { RuleMigrations } from './collections/RuleMigrations'
import { RuleModules } from './collections/RuleModules'
import { RuleReleases } from './collections/RuleReleases'
import { RuleSets } from './collections/RuleSets'
import { Users } from './collections/Users'
import { Workspaces } from './collections/Workspaces'
import { Worlds } from './collections/Worlds'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },
  collections: [
    Users,
    Workspaces,
    Media,
    Worlds,
    Locations,
    Characters,
    RuleSets,
    RuleModules,
    RuleDefinitions,
    RuleGenerationPolicies,
    RuleReleases,
    RuleMigrations,
    RuleDocuments,
  ],
  db: postgresAdapter({
    migrationDir: path.resolve(dirname, 'migrations'),
    pool: { connectionString: process.env.CMS_DATABASE_URL || '' },
    push: false,
  }),
  editor: lexicalEditor(),
  endpoints: [
    {
      handler: async () => Response.json({ status: 'ok' }),
      method: 'get',
      path: '/health',
    },
  ],
  plugins: [
    s3Storage({
      bucket: process.env.S3_BUCKET || 'worldcms-media',
      collections: {
        media: { prefix: 'media' },
      },
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || 'cms-local-access-key',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'cms-local-secret-key',
        },
        endpoint: process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
        region: process.env.S3_REGION || 'us-east-1',
      },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || '',
  sharp,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
