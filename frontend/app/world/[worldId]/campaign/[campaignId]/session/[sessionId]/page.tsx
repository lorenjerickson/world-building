import { SessionRoute } from "@/components/session-route";
export default async function Page({ params }: { params: Promise<{ worldId: string; campaignId: string; sessionId: string }> }) { const values = await params; return <SessionRoute {...values} />; }
