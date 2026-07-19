import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const migrationsDirectory = path.join(process.cwd(), 'src/migrations')

function migrationDigest() {
  const hash = createHash('sha256')
  for (const filename of readdirSync(migrationsDirectory).sort()) {
    hash.update(filename)
    hash.update(readFileSync(path.join(migrationsDirectory, filename)))
  }
  return hash.digest('hex')
}

const before = migrationDigest()
const result = spawnSync(
  'npm',
  ['run', 'migrate:create', '--', 'schema_drift_check', '--skip-empty'],
  { stdio: 'inherit' },
)

if (result.status !== 0) process.exit(result.status ?? 1)

if (before !== migrationDigest()) {
  console.error('Payload model drift created a migration. Review and check it in, then rerun verification.')
  process.exit(1)
}

console.log('Payload collection model is represented by checked-in migrations.')
