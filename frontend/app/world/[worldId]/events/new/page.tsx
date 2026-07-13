import { LoreCreateRoute } from "@/components/lore-create-route";
export default async function Page({ params }: { params: Promise<{ worldId: string }> }) { const { worldId } = await params; return <LoreCreateRoute worldId={worldId} loreType="events" />; }
