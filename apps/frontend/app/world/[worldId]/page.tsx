import { WorldRoute } from "@/components/world-route";

export default async function WorldPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return <WorldRoute worldId={worldId} />;
}
