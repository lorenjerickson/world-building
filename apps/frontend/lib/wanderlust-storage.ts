export const WORLD_STORAGE_KEY = 'wanderlust_vtt_worlds';
export const CAMPAIGN_STORAGE_KEY = 'wanderlust_vtt_campaigns';

const LEGACY_WORLD_STORAGE_KEYS = ['aethelgard_worlds'] as const;
const LEGACY_CAMPAIGN_STORAGE_KEYS = ['aethelgard_campaigns'] as const;

function readArray<T>(key: string): T[] | undefined {
  const serialized = localStorage.getItem(key);
  if (serialized === null) return undefined;

  try {
    const value = JSON.parse(serialized);
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

function loadCollection<T>(key: string, legacyKeys: readonly string[]): T[] {
  const current = readArray<T>(key);
  if (current !== undefined) return current;

  for (const legacyKey of legacyKeys) {
    const legacy = readArray<T>(legacyKey);
    if (legacy === undefined) continue;
    localStorage.setItem(key, JSON.stringify(legacy));
    return legacy;
  }

  return [];
}

export function loadStoredWorlds<T>(): T[] {
  return loadCollection<T>(WORLD_STORAGE_KEY, LEGACY_WORLD_STORAGE_KEYS);
}

export function saveStoredWorlds<T>(worlds: T[]): void {
  localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(worlds));
}

export function loadStoredCampaigns<T>(): T[] {
  return loadCollection<T>(CAMPAIGN_STORAGE_KEY, LEGACY_CAMPAIGN_STORAGE_KEYS);
}

export function saveStoredCampaigns<T>(campaigns: T[]): void {
  localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaigns));
}
