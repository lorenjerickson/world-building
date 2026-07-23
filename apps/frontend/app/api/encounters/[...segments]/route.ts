import { proxyEncounterApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  return proxyEncounterApi(request, (await context.params).segments);
}
export async function POST(request: Request, context: RouteContext) {
  return proxyEncounterApi(request, (await context.params).segments);
}
export async function PUT(request: Request, context: RouteContext) {
  return proxyEncounterApi(request, (await context.params).segments);
}
