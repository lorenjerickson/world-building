import { createHmac, timingSafeEqual } from 'node:crypto'

export interface AdminSsoTicketClaims {
  aud: 'payload-admin'
  email?: string
  exp: number
  iat: number
  iss: 'wanderlust-api'
  jti: string
  sub: string
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyAdminSsoTicket(
  ticket: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): AdminSsoTicketClaims | null {
  if (!secret || !ticket || ticket.length > 4096) return null
  const separator = ticket.indexOf('.')
  if (separator < 1 || separator !== ticket.lastIndexOf('.')) return null

  const encodedClaims = ticket.slice(0, separator)
  const suppliedSignature = ticket.slice(separator + 1)
  const expectedSignature = createHmac('sha256', secret).update(encodedClaims).digest('base64url')
  if (!safeEqual(suppliedSignature, expectedSignature)) return null

  try {
    const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as Partial<AdminSsoTicketClaims>
    const validEmail = claims.email === undefined
      || (typeof claims.email === 'string' && claims.email.length > 0 && claims.email.length <= 320)
    if (
      claims.aud !== 'payload-admin'
      || claims.iss !== 'wanderlust-api'
      || typeof claims.sub !== 'string'
      || claims.sub.length < 1
      || claims.sub.length > 512
      || typeof claims.jti !== 'string'
      || claims.jti.length < 1
      || claims.jti.length > 128
      || !Number.isSafeInteger(claims.iat)
      || !Number.isSafeInteger(claims.exp)
      || !validEmail
      || claims.iat! > now + 5
      || claims.exp! < now
      || claims.exp! - claims.iat! > 30
      || claims.exp! > now + 30
    ) return null

    return claims as AdminSsoTicketClaims
  } catch {
    return null
  }
}
