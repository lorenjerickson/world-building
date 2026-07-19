import { getSession } from '@auth0/nextjs-auth0';
import { NextRequest, NextResponse } from 'next/server';

const allowedMethods = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

type SessionActor = {
  email?: string;
  subject: string;
};

async function sessionActor(request: Request): Promise<SessionActor | undefined> {
  try {
    const session = await getSession(request as NextRequest, new NextResponse());
    if (typeof session?.user?.sub === 'string' && session.user.sub) {
      const email = typeof session.user.email === 'string' ? session.user.email.trim() : '';
      return {
        ...(email ? { email } : {}),
        subject: session.user.sub,
      };
    }
  } catch {
    // Authentication failures remain fail-closed at the application gateway.
  }
  return undefined;
}

async function proxyAuthenticatedRuleApi(request: Request, apiRoot: string, segments: string[] = []): Promise<NextResponse> {
  if (!allowedMethods.has(request.method)) {
    return NextResponse.json({
      code: 'RULE_METHOD_NOT_ALLOWED',
      message: 'This rule operation is not available.',
      retryable: false,
    }, { status: 405 });
  }

  const actor = await sessionActor(request);
  if (!actor) {
    return NextResponse.json({
      code: 'RULE_AUTH_REQUIRED',
      message: 'Sign in to access rule authoring.',
      retryable: false,
    }, { status: 401 });
  }

  const internalToken = process.env.RULE_API_INTERNAL_TOKEN?.trim();
  if (!internalToken) {
    return NextResponse.json({
      code: 'RULE_GATEWAY_NOT_CONFIGURED',
      message: 'Rule-set access is not configured for this application.',
      retryable: false,
    }, { status: 503 });
  }

  const backendUrl = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
  const sourceUrl = new URL(request.url);
  const encodedPath = segments.map(encodeURIComponent).join('/');
  const target = `${backendUrl}/api/${apiRoot}${encodedPath ? `/${encodedPath}` : ''}${sourceUrl.search}`;
  const hasBody = request.method === 'POST' || request.method === 'PATCH';

  try {
    const response = await fetch(target, {
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
      headers: {
        ...(hasBody ? { 'content-type': request.headers.get('content-type') || 'application/json' } : {}),
        ...(actor.email ? { 'x-auth0-email': actor.email } : {}),
        'x-auth0-sub': actor.subject,
        'x-rule-api-token': internalToken,
      },
      method: request.method,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    return new NextResponse(body || null, {
      headers: {
        'cache-control': response.headers.get('cache-control') || 'no-store',
        'content-type': response.headers.get('content-type') || 'application/json',
      },
      status: response.status,
    });
  } catch {
    return NextResponse.json({
      code: 'RULE_BACKEND_UNAVAILABLE',
      message: 'Rule-set services are temporarily unavailable.',
      retryable: true,
    }, { status: 502 });
  }
}

export function proxyRuleApi(request: Request, segments: string[] = []): Promise<NextResponse> {
  return proxyAuthenticatedRuleApi(request, 'rule-sets', segments);
}

export function proxyRuleAuthoringApi(request: Request, segments: string[] = []): Promise<NextResponse> {
  return proxyAuthenticatedRuleApi(request, 'rule-authoring', segments);
}
