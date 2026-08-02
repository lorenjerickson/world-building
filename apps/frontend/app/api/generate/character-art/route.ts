import { proxyCharacterArtApi } from '@/lib/rule-api-proxy';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return proxyCharacterArtApi(request);
}
