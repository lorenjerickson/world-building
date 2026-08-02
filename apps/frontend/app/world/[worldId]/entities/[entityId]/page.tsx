import { WorldEntityEditor } from '@/components/world-entity-editor';

export default async function WorldEntityPage({ params, searchParams }: {
  params: Promise<{ worldId: string; entityId: string }>;
  searchParams: Promise<{ trail?: string }>;
}) {
  const [{ worldId, entityId }, query] = await Promise.all([params, searchParams]);
  return <WorldEntityEditor
    worldId={worldId}
    entityId={entityId}
    trail={query.trail?.split(',').filter(Boolean) ?? []}
  />;
}
