import { NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import type { NextRequest } from 'next/server';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { metadata, description, triples } = body;

    const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/generate/world/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata, description, triples }),
    });

    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: 'Failed to update world' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession(request as NextRequest, new NextResponse());
    const subject = session?.user?.sub;
    const internalToken = process.env.RULE_API_INTERNAL_TOKEN?.trim();
    if (typeof subject !== 'string' || !subject) {
      return NextResponse.json({ code: 'WORLD_AUTH_REQUIRED', message: 'Sign in to delete worlds.' }, { status: 401 });
    }
    if (!internalToken) {
      return NextResponse.json({ code: 'WORLD_GATEWAY_NOT_CONFIGURED', message: 'World deletion is not configured.' }, { status: 503 });
    }
    const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/generate/world/${encodeURIComponent(id)}`, {
      headers: { 'x-auth0-sub': subject, 'x-rule-api-token': internalToken },
      method: 'DELETE',
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('World deletion API error:', error);
    return NextResponse.json({ code: 'WORLD_DELETE_FAILED', message: 'The world could not be deleted.' }, { status: 502 });
  }
}
