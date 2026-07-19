import { WorldRoute } from "@/components/world-route";
export default async function Page({ params }: { params: Promise<{ worldId: string; itemId: string }> }) {
  const { worldId, itemId } = await params;
  return <WorldRoute worldId={worldId} tab="locations" itemId={itemId} />;
}
