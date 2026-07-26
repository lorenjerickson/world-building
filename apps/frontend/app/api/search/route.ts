import { proxySearchApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return proxySearchApi(request);
}
