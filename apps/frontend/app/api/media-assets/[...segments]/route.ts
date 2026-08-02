import { proxyMediaAssetApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  return proxyMediaAssetApi(request, (await context.params).segments);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyMediaAssetApi(request, (await context.params).segments);
}
