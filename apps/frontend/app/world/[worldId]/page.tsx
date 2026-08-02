import { WorldEntityIndex } from '@/components/world-entity-index';

export default async function WorldPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return <WorldEntityIndex worldId={worldId} />;
}
