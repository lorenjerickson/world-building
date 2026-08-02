import type { WorldAsset } from '@/components/world-view';
import { deleteLoreImage } from '@/lib/image-uploads';
import { deleteCharacterModel } from '@/lib/model-uploads';
import {
  loadStoredCampaigns,
  loadStoredWorlds,
  saveStoredCampaigns,
  saveStoredWorlds,
} from '@/lib/wanderlust-storage';

export interface CampaignArtifact {
  id: string;
  worldId: string;
  title: string;
  system?: string;
  summary?: string;
  updatedAt?: string;
}

export function loadCampaignArtifacts(): CampaignArtifact[] {
  return loadStoredCampaigns<CampaignArtifact>()
    .filter((campaign) => campaign && typeof campaign.id === 'string' && typeof campaign.title === 'string');
}

export async function deleteWorldArtifact(world: WorldAsset): Promise<void> {
  const response = await fetch(`/api/generate/world/${encodeURIComponent(world.id)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || 'The world could not be deleted.');
  }

  const imageUrls = new Set<string>();
  const modelUrls = new Set<string>();
  if (world.mapUrl) imageUrls.add(world.mapUrl);
  world.locations?.forEach((location) => { if (location.mapUrl) imageUrls.add(location.mapUrl); });
  world.characters?.forEach((character) => {
    if (typeof character === 'string') return;
    if (character.portraitUrl) imageUrls.add(character.portraitUrl);
    if (character.tokenUrl) imageUrls.add(character.tokenUrl);
    if (character.token3dUrl) modelUrls.add(character.token3dUrl);
  });
  await Promise.allSettled([
    ...[...imageUrls].map((url) => deleteLoreImage(url)),
    ...[...modelUrls].map((url) => deleteCharacterModel(url)),
  ]);

  const worlds = loadStoredWorlds<WorldAsset>();
  saveStoredWorlds(worlds.filter((candidate) => candidate.id !== world.id));

  const campaigns = loadCampaignArtifacts();
  saveStoredCampaigns(campaigns.filter((campaign) => campaign.worldId !== world.id));
}

export function deleteCampaignArtifact(campaignId: string): void {
  const campaigns = loadCampaignArtifacts();
  saveStoredCampaigns(campaigns.filter((campaign) => campaign.id !== campaignId));
}
