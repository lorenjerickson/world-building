import type { WorldAsset } from '@/components/world-view';
import { deleteLoreImage } from '@/lib/image-uploads';

export interface CampaignArtifact {
  id: string;
  worldId: string;
  title: string;
  system?: string;
  summary?: string;
  updatedAt?: string;
}

const WORLD_STORAGE_KEY = 'aethelgard_worlds';
const CAMPAIGN_STORAGE_KEY = 'aethelgard_campaigns';

function parseStoredArray<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function loadCampaignArtifacts(): CampaignArtifact[] {
  return parseStoredArray<CampaignArtifact>(CAMPAIGN_STORAGE_KEY)
    .filter((campaign) => campaign && typeof campaign.id === 'string' && typeof campaign.title === 'string');
}

export async function deleteWorldArtifact(world: WorldAsset): Promise<void> {
  const response = await fetch(`/api/generate/world/${encodeURIComponent(world.id)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || 'The world could not be deleted.');
  }

  const imageUrls = new Set<string>();
  if (world.mapUrl) imageUrls.add(world.mapUrl);
  world.locations?.forEach((location) => { if (location.mapUrl) imageUrls.add(location.mapUrl); });
  world.characters?.forEach((character) => {
    if (typeof character === 'string') return;
    if (character.portraitUrl) imageUrls.add(character.portraitUrl);
    if (character.tokenUrl) imageUrls.add(character.tokenUrl);
  });
  await Promise.allSettled([...imageUrls].map((url) => deleteLoreImage(url)));

  const worlds = parseStoredArray<WorldAsset>(WORLD_STORAGE_KEY);
  localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(worlds.filter((candidate) => candidate.id !== world.id)));

  const campaigns = loadCampaignArtifacts();
  localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaigns.filter((campaign) => campaign.worldId !== world.id)));
}

export function deleteCampaignArtifact(campaignId: string): void {
  const campaigns = loadCampaignArtifacts();
  localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaigns.filter((campaign) => campaign.id !== campaignId)));
}
