import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const config = readFileSync(path.join(root, 'src/payload.config.ts'), 'utf8')
const compose = readFileSync(path.join(root, 'compose.yml'), 'utf8')
const dockerignore = readFileSync(path.join(root, '.dockerignore'), 'utf8')

const failures = []
if (!/push:\s*false\b/.test(config)) failures.push('Payload postgresAdapter must contain literal push: false')
if (/push:\s*true\b/.test(config)) failures.push('Executable CMS config contains prohibited push: true')
if (!/cms_private:\s*\n\s*internal:\s*true/.test(compose)) failures.push('CMS Docker network must be internal')

const cmsBlock = compose.match(/\n  cms:\n([\s\S]*?)(?=\n  [a-zA-Z][\w-]*:\n|\nvolumes:)/)?.[1] || ''
const dbBlock = compose.match(/\n  cms-db:\n([\s\S]*?)(?=\n  [a-zA-Z][\w-]*:\n|\nvolumes:)/)?.[1] || ''
if (/^\s{4}ports:/m.test(cmsBlock)) failures.push('Payload service must not publish ports')
if (/^\s{4}ports:/m.test(dbBlock)) failures.push('CMS database must not publish ports')
if (!/^\.env$/m.test(dockerignore)) failures.push('.dockerignore must exclude the local .env file')

if (failures.length) {
  for (const failure of failures) console.error(`POLICY FAILURE: ${failure}`)
  process.exit(1)
}

console.log('Policy verified: push=false is literal; CMS and database have no published ports; cms_private is internal; .env is excluded from Docker builds.')
