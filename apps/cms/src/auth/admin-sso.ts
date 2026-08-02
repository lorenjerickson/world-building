import { randomUUID } from 'node:crypto'

import { generatePayloadCookie, getFieldsToSign, jwtSign, type PayloadHandler } from 'payload'

import { fallbackEmail, findOrBootstrapUser } from '../collections/Users'
import { verifyAdminSsoTicket } from './admin-sso-ticket'

const consumedTickets = new Map<string, number>()

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, {
    headers: { 'cache-control': 'no-store' },
    status,
  })
}

function consumeTicket(jti: string, expiresAt: number, now: number): boolean {
  for (const [id, expiration] of consumedTickets) {
    if (expiration < now) consumedTickets.delete(id)
  }
  if (consumedTickets.has(jti)) return false
  consumedTickets.set(jti, expiresAt)
  return true
}

export const adminSsoHandler: PayloadHandler = async (req) => {
  const ticket = req.searchParams.get('ticket') || ''
  const now = Math.floor(Date.now() / 1000)
  const claims = verifyAdminSsoTicket(ticket, process.env.CMS_INTERNAL_TOKEN || '', now)
  if (!claims || !consumeTicket(claims.jti, claims.exp, now)) {
    return errorResponse(401, 'CMS_ADMIN_HANDOFF_INVALID', 'This content-management sign-in link is invalid or expired.')
  }

  const user = await findOrBootstrapUser(
    req.payload,
    claims.sub,
    claims.email?.trim().toLowerCase() || fallbackEmail(claims.sub),
  )
  if (!user || user.role !== 'admin') {
    return errorResponse(403, 'CMS_ADMIN_ACCESS_DENIED', 'Your account is not allowed to manage content.')
  }

  const collectionConfig = req.payload.collections.users?.config
  if (!collectionConfig?.auth) {
    return errorResponse(503, 'CMS_ADMIN_AUTH_UNAVAILABLE', 'Content-management authentication is unavailable.')
  }

  const sid = randomUUID()
  const sessionExpiresAt = new Date(Date.now() + collectionConfig.auth.tokenExpiration * 1000)
  const activeSessions = (user.sessions || [])
    .filter(({ expiresAt }) => new Date(expiresAt).getTime() > Date.now())
    .slice(-9)
  const sessionUser = await req.payload.update({
    collection: 'users',
    data: {
      sessions: [...activeSessions, { createdAt: new Date().toISOString(), expiresAt: sessionExpiresAt.toISOString(), id: sid }],
    },
    depth: 0,
    id: user.id,
    overrideAccess: true,
    req,
  })
  const { token } = await jwtSign({
    fieldsToSign: getFieldsToSign({
      collectionConfig,
      email: sessionUser.email,
      sid,
      user: { ...sessionUser, collection: 'users' },
    }),
    secret: req.payload.secret,
    tokenExpiration: collectionConfig.auth.tokenExpiration,
  })
  const cookie = generatePayloadCookie({
    collectionAuthConfig: collectionConfig.auth,
    cookiePrefix: req.payload.config.cookiePrefix,
    token,
  })

  return new Response(null, {
    headers: {
      'cache-control': 'no-store',
      location: req.payload.config.routes.admin,
      'referrer-policy': 'no-referrer',
      'set-cookie': cookie,
    },
    status: 303,
  })
}
