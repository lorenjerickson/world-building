import { LoreCreateRoute } from "@/components/lore-create-route";
export default async function Page({ params, searchParams }: { params: Promise<{ worldId: string }>; searchParams: Promise<{ parentId?: string }> }) { const [{ worldId }, { parentId }] = await Promise.all([params, searchParams]); return <LoreCreateRoute worldId={worldId} loreType="locations" parentId={parentId} />; }
