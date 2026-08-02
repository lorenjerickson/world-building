export type CharacterModelGenerationStatus =
  | 'queued'
  | 'running'
  | 'persisting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface CharacterModelGeneration {
  id: string;
  inputType: 'image' | 'text';
  status: CharacterModelGenerationStatus;
  progress: number;
  stage: string;
  seed: number;
  error?: string;
  url?: string;
}

export interface ShapEJob {
  id: string;
  inputType: 'image' | 'text';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  seed: number;
  error?: string | null;
}

export interface UploadedSourceImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
