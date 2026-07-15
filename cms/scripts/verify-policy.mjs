import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const config = readFileSync(path.join(root, 'src/payload.config.ts'), 'utf8')
const compose = readFileSync(path.resolve(root, '../docker-compose.yml'), 'utf8')
const dockerignore = readFileSync(path.join(root, '.dockerignore'), 'utf8')

const failures = []
if (!/push:\s*false\b/.test(config)) failures.push('Payload postgresAdapter must contain literal push: false')
if (/push:\s*true\b/.test(config)) failures.push('Executable CMS config contains prohibited push: true')
if (!/cms_private:\s*\n\s*internal:\s*true/.test(compose)) failures.push('CMS Docker network must be internal')
if (!/^\.env$/m.test(dockerignore)) failures.push('.dockerignore must exclude the local .env file')

function serviceBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return compose.match(new RegExp(`\\n  ${escaped}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z][\\w-]*:\\n|\\nvolumes:)`))?.[1] || ''
}

for (const service of ['cms', 'cms-db', 'cms-storage', 'cms-storage-init']) {
  const block = serviceBlock(service)
  if (!block) failures.push(`Docker Compose must define ${service}`)
  if (/^\s{4}ports:/m.test(block)) failures.push(`${service} must not publish ports`)
  if (block && !/^\s{4}networks:\s*\n\s{6}- cms_private/m.test(block)) {
    failures.push(`${service} must attach to cms_private`)
  }
}

const backend = serviceBlock('backend')
const frontend = serviceBlock('frontend')
if (!/^\s{4}networks:\s*\n(?:\s{6}- .*\n)*\s{6}- cms_private/m.test(backend)) {
  failures.push('Nest backend must attach to cms_private')
}
if (/cms_private/.test(frontend)) failures.push('Frontend must not attach to cms_private')
if (/NEXT_PUBLIC_[A-Z0-9_]*(CMS|PAYLOAD)/.test(compose)) {
  failures.push('Browser-exposed environment variables must not contain CMS or Payload service details')
}

if (failures.length) {
  for (const failure of failures) console.error(`POLICY FAILURE: ${failure}`)
  process.exit(1)
}

console.log('Policy verified: push=false is literal; CMS infrastructure is unpublished and internal; only Nest joins the private network as an application service; .env is excluded from Docker builds.')
