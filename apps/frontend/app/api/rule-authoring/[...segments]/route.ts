import { proxyRuleAuthoringApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  const { segments } = await context.params;
  return proxyRuleAuthoringApi(request, segments);
}

export async function POST(request: Request, context: RouteContext) {
  const { segments } = await context.params;
  return proxyRuleAuthoringApi(request, segments);
}
