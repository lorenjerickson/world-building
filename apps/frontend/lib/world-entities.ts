import type { TraitMediaType, TraitShape } from '@wanderlust-vtt/common';

export type WorldSummary = {
  id: string;
  name: string;
  description: string;
  ruleSetId: number;
  releaseId: number;
  releaseHash: string;
  ruleSetName?: string;
  releaseVersion?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateableTrait = {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  inheritedTraitIds: string[];
  prerequisiteChoices: Array<{
    traitId: string;
    traitName: string;
    optionTraitIds: string[];
    options: Array<{ id: string; name: string }>;
  }>;
};

export type WorldEntityReference = {
  id: string;
  childEntityId: string;
  parentEntityId: string;
  collectionPath: string;
  implementationMap: Record<string, string>;
  childEntity?: WorldEntity;
  parentEntity?: WorldEntity;
};

export type WorldEntity = {
  id: string;
  rootTraitIds: string[];
  satisfiedTraitIds: string[];
  prerequisiteSelections: Record<string, string[]>;
  values: Record<string, string | number | boolean | null>;
  migrationStatus: 'current' | 'needs_attention';
  migrationDiagnostics: Array<{ code: string; path?: string; message: string }>;
  retainedValues: Record<string, unknown>;
  outgoingReferences?: WorldEntityReference[];
  incomingReferences?: WorldEntityReference[];
  schema?: WorldEntitySchema;
  createdAt: string;
  updatedAt: string;
};

export type WorldEntitySchema = {
  rootTraitIds: string[];
  prerequisiteSelections: Record<string, string[]>;
  satisfiedTraitIds: string[];
  shape: TraitShape;
};

export type AvailableRuleSet = {
  id: number;
  name: string;
  summary: string;
  release: { id: number; version: string; publishedAt: string };
};

export type MediaTerminal = {
  mediaType?: TraitMediaType;
};

export async function worldApi<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/worlds${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as T | { message?: string; details?: unknown } | null;
  if (!response.ok) {
    const failure = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body as { message?: string; details?: unknown }
      : undefined;
    const error = new Error(failure?.message || 'The request could not be completed.');
    Object.assign(error, { status: response.status, details: failure?.details });
    throw error;
  }
  return body as T;
}
