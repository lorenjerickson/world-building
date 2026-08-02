import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import { verifyAdminSsoTicket } from './admin-sso-ticket'

function ticket(claims: Record<string, unknown>, secret = 'test-secret'): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`
}

const claims = {
  aud: 'payload-admin',
  email: 'gm@example.com',
  exp: 1_030,
  iat: 1_000,
  iss: 'wanderlust-api',
  jti: 'single-use-id',
  sub: 'auth0|gm',
}

test('accepts a correctly signed, short-lived admin handoff', () => {
  assert.deepEqual(verifyAdminSsoTicket(ticket(claims), 'test-secret', 1_010), claims)
})

test('rejects tampered, expired, and overlong admin handoffs', () => {
  assert.equal(verifyAdminSsoTicket(`${ticket(claims)}x`, 'test-secret', 1_010), null)
  assert.equal(verifyAdminSsoTicket(ticket(claims), 'test-secret', 1_031), null)
  assert.equal(verifyAdminSsoTicket('x'.repeat(4097), 'test-secret', 1_010), null)
})
