import { getSession } from '@auth0/nextjs-auth0';
import { NextRequest, NextResponse } from 'next/server';

const LOCAL_CMS_ADMIN_URL = 'https://local.cms.wanderlust-vtt.com:3100/admin';

function configuredAdminUrl(): URL | null {
  const configured = process.env.CMS_ADMIN_URL?.trim();
  const rawUrl = configured || (process.env.NODE_ENV === 'production' ? '' : LOCAL_CMS_ADMIN_URL);
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession(request as NextRequest, new NextResponse());
  if (!session?.user) {
    return NextResponse.redirect(new URL('/api/auth/login', request.url));
  }

  const adminUrl = configuredAdminUrl();
  if (!adminUrl) {
    return NextResponse.json({
      code: 'CMS_ADMIN_NOT_CONFIGURED',
      message: 'The private content-management interface is not configured for this environment.',
    }, { status: 503 });
  }

  const subject = typeof session.user.sub === 'string' ? session.user.sub.trim() : '';
  const internalToken = process.env.RULE_API_INTERNAL_TOKEN?.trim();
  if (!subject || !internalToken) {
    return NextResponse.json({
      code: 'CMS_ADMIN_AUTH_NOT_CONFIGURED',
      message: 'Content-management sign-in is not configured for this application.',
    }, { status: 503 });
  }

  const backendUrl = (process.env.BACKEND_URL || 'https://local.api.wanderlust-vtt.com:8444').replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/api/cms/admin-session`, {
      cache: 'no-store',
      headers: {
        ...(typeof session.user.email === 'string' && session.user.email.trim()
          ? { 'x-auth0-email': session.user.email.trim() }
          : {}),
        'x-auth0-sub': subject,
        'x-rule-api-token': internalToken,
      },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({
      code: 'CMS_ADMIN_BACKEND_UNAVAILABLE',
      message: 'Content-management sign-in is temporarily unavailable.',
    }, { status: 502 });
  }

  const body = await response.json().catch(() => null) as { ticket?: unknown } | null;
  if (!response.ok || typeof body?.ticket !== 'string' || !body.ticket) {
    return NextResponse.json({
      code: 'CMS_ADMIN_HANDOFF_FAILED',
      message: 'Content-management sign-in could not be started.',
    }, { status: response.ok ? 502 : response.status });
  }

  const handoffUrl = new URL(adminUrl.origin);
  handoffUrl.pathname = '/api/admin-sso';
  handoffUrl.searchParams.set('ticket', body.ticket);
  return NextResponse.redirect(handoffUrl, 303);
}
