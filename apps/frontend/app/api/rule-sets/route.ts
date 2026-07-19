import { proxyRuleApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return proxyRuleApi(request);
}

export function POST(request: Request) {
  return proxyRuleApi(request);
}
