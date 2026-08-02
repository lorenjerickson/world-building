import { proxyMediaAssetApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return proxyMediaAssetApi(request);
}

export function POST(request: Request) {
  return proxyMediaAssetApi(request);
}
