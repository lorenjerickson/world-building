import type { EncounterMapCanonical } from '@world-building/common';

export interface CreateEncounterMapInput {
  campaignExternalId: string;
  commandId: string;
  locationId?: number;
  name: string;
  bounds?: { x: number; y: number; z: number };
  scaleInFeet?: 0.5 | 1 | 5;
}

export interface SaveEncounterDraftInput {
  canonical: EncounterMapCanonical;
  commandId: string;
  expectedVersion: number;
}

export interface FinalizeEncounterDraftInput {
  commandId: string;
  expectedVersion: number;
}

export interface EncounterDraftResource {
  id: number;
  mapId: number;
  version: number;
  checksum: string;
  canonical: EncounterMapCanonical;
  validation: { status: 'pending' | 'valid' | 'invalid'; errors: string[]; validatedAt?: string };
  updatedAt: string;
}

export interface EncounterRevisionResource {
  id: number;
  mapId: number;
  revisionNumber: number;
  checksum: string;
  compilerVersion: string;
  finalizedAt: string;
  canonicalArtifactId: number;
  compiledArtifactIds: number[];
}
