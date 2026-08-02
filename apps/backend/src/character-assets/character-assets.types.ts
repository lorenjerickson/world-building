export const CHARACTER_MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.obj', '.ply', '.stl']);

export const CHARACTER_MODEL_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/sla',
  'application/vnd.ms-pki.stl',
  'model/gltf+json',
  'model/gltf-binary',
  'model/obj',
  'model/ply',
  'model/stl',
  'text/plain',
]);

export interface UploadedCharacterModel {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface CharacterModelAsset {
  assetId: number;
  filename: string;
  mimeType: string;
  url: string;
}

export interface CharacterModelDownload {
  bytes: Buffer;
  filename: string;
  mimeType: string;
}
