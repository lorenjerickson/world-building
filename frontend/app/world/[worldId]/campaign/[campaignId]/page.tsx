import { CampaignRoute } from "@/components/campaign-route";

export default async function CampaignPage({ params }: { params: Promise<{ worldId: string; campaignId: string }> }) {
  const { worldId, campaignId } = await params;
  return <CampaignRoute worldId={worldId} campaignId={campaignId} />;
}
