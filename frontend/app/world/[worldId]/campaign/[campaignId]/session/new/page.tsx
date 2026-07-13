import { QuickCreate } from "@/components/quick-create";
export default async function Page({ params }: { params: Promise<{ worldId: string; campaignId: string }> }) { const values = await params; return <QuickCreate type="session" {...values} />; }
