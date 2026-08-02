export const MEDIA_ASSET_TYPES = ['text', 'audio', 'video', 'image'] as const;

export type MediaAssetType = typeof MEDIA_ASSET_TYPES[number];

export const MEDIA_ASSET_PURPOSES = [
  'world-map',
  'location-map',
  'portrait',
  'token',
  'handout',
  'reference',
] as const;

export type MediaAssetPurpose = typeof MEDIA_ASSET_PURPOSES[number];

export interface MediaAssetUploadOptions {
  altText?: string;
  generation?: {
    correlationId?: string;
    model?: string;
    promptHash?: string;
    provider?: string;
  };
  purpose?: MediaAssetPurpose;
  tags?: string[];
}

export interface MediaAssetSummary {
  id: string;
  filename: string;
  label: string;
  mediaType: MediaAssetType;
  mimeType: string;
  reusedExisting?: boolean;
  size: number;
  url: string;
}

export interface MediaAssetCatalogPage {
  items: MediaAssetSummary[];
  page: number;
  totalItems: number;
  totalPages: number;
}

export interface MediaAssetDownload {
  bytes: Buffer;
  filename: string;
  mimeType: string;
}

export type UploadedMediaAsset = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

const MIME_PREFIXES: Record<Exclude<MediaAssetType, 'text'>, string> = {
  audio: 'audio/',
  image: 'image/',
  video: 'video/',
};

export const MEDIA_ASSET_MIME_TYPES: Record<MediaAssetType, readonly string[]> = {
  audio: ['audio/flac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
  image: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
  text: ['application/json', 'text/markdown', 'text/plain'],
  video: ['video/mp4', 'video/ogg', 'video/quicktime', 'video/webm'],
};

const TEXT_MIME_TYPES = new Set(MEDIA_ASSET_MIME_TYPES.text);

export function mediaTypeAcceptsMimeType(mediaType: MediaAssetType, mimeType: string): boolean {
  return mediaType === 'text'
    ? TEXT_MIME_TYPES.has(mimeType)
    : mimeType.startsWith(MIME_PREFIXES[mediaType]);
}
