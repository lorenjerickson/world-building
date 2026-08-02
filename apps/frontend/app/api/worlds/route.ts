import { proxyWorldApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

export function GET(request: Request) { return proxyWorldApi(request); }
export function POST(request: Request) { return proxyWorldApi(request); }
