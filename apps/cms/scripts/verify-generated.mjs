import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const generatedFiles = [
  'src/payload-types.ts',
  'src/payload-generated-schema.ts',
]

const digest = (file) => createHash('sha256').update(readFileSync(path.join(process.cwd(), file))).digest('hex')
const before = new Map(generatedFiles.map((file) => [file, digest(file)]))

for (const script of ['generate:types', 'generate:db-schema']) {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const stale = generatedFiles.filter((file) => before.get(file) !== digest(file))
if (stale.length) {
  console.error(`Generated artifacts were stale and have been refreshed: ${stale.join(', ')}`)
  console.error('Review and check in the refreshed files, then run this command again.')
  process.exit(1)
}

console.log('Generated Payload types and PostgreSQL schema are current.')
