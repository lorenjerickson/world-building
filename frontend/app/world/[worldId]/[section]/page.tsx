import { notFound } from "next/navigation";
import { WorldRoute } from "@/components/world-route";
import type { WorldTab } from "@/components/world-view";

const sections = new Set<WorldTab>(["map", "locations", "characters", "organizations", "events", "items", "relations"]);

export default async function WorldSectionPage({ params }: { params: Promise<{ worldId: string; section: string }> }) {
  const { worldId, section } = await params;
  if (!sections.has(section as WorldTab)) notFound();
  return <WorldRoute worldId={worldId} tab={section as WorldTab} />;
}
