import { proxyWorldApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ segments: string[] }> };

async function segments(context: RouteContext) { return (await context.params).segments; }

export async function GET(request: Request, context: RouteContext) { return proxyWorldApi(request, await segments(context)); }
export async function POST(request: Request, context: RouteContext) { return proxyWorldApi(request, await segments(context)); }
export async function PATCH(request: Request, context: RouteContext) { return proxyWorldApi(request, await segments(context)); }
export async function DELETE(request: Request, context: RouteContext) { return proxyWorldApi(request, await segments(context)); }
