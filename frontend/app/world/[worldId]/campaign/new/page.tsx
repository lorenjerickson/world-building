import { QuickCreate } from "@/components/quick-create";
export default async function Page({ params }: { params: Promise<{ worldId: string }> }) { const { worldId } = await params; return <QuickCreate type="campaign" worldId={worldId} />; }
