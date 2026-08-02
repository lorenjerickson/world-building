import { WorldEntityEditor } from '@/components/world-entity-editor';

export default async function NewWorldEntityPage({ params, searchParams }: {
  params: Promise<{ worldId: string }>;
  searchParams: Promise<{ parent?: string; collection?: string; trail?: string }>;
}) {
  const [{ worldId }, query] = await Promise.all([params, searchParams]);
  return <WorldEntityEditor
    worldId={worldId}
    parentId={query.parent}
    collectionPath={query.collection}
    trail={query.trail?.split(',').filter(Boolean) ?? []}
  />;
}
