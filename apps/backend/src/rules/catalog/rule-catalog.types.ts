import type { RuleApiActor } from '../api/rule-api-actor';
import type { RuleDefinitionType } from '../api/rule-set.dto';

export type RuleLifecycle = 'active' | 'deprecated' | 'retired';
export type DraftStatus = 'draft' | 'published';

export interface RuleSetResource {
  id: number;
  externalId: string;
  name: string;
  slug: string;
  summary: string;
  description?: string;
  lifecycle: RuleLifecycle;
  engineFeatureLevel: string;
  dashboard: {
    accentColor?: string;
    featured: boolean;
  };
  tags: string[];
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RuleModuleResource {
  id: number;
  externalId: string;
  ruleSetId: number;
  namespace: string;
  name: string;
  description?: string;
  sortOrder: number;
  requiredEngineFeatureLevel: string;
  dependencies: unknown[];
  exports: unknown[];
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RuleDefinitionResource {
  id: number;
  externalId: string;
  ruleSetId: number;
  moduleId: number;
  definitionType: RuleDefinitionType;
  name: string;
  description?: string;
  schemaVersion: number;
  visibility: 'exported' | 'private';
  body: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  clonedFromId?: number;
  provenance?: Record<string, unknown>;
  tags: string[];
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RuleReleaseResource {
  id: number;
  externalId: string;
  ruleSetId: number;
  version: string;
  contentHash: string;
  engineCompatibility: unknown;
  dependencyLock: unknown;
  manifest: unknown;
  sourceSnapshot: unknown;
  publishedAt: string;
  lifecycle: 'published' | 'deprecated' | 'retired';
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface RuleSetListOptions {
  search?: string;
  lifecycle?: RuleLifecycle;
  status?: DraftStatus;
  page: number;
  limit: number;
}

export interface CreateRuleSetInput {
  name: string;
  slug: string;
  summary: string;
  description?: string;
  engineFeatureLevel: string;
  tags: string[];
  accentColor?: string;
  featured: boolean;
}

export type UpdateRuleSetInput = Partial<CreateRuleSetInput> & { lifecycle?: RuleLifecycle };

export interface CreateRuleModuleInput {
  namespace: string;
  name: string;
  description?: string;
  sortOrder: number;
  requiredEngineFeatureLevel: string;
  dependencies: unknown[];
  exports: unknown[];
}

export type UpdateRuleModuleInput = Partial<CreateRuleModuleInput>;

export interface CreateRuleDefinitionInput {
  moduleId: number;
  definitionType: RuleDefinitionType;
  name: string;
  description?: string;
  schemaVersion: number;
  visibility: 'exported' | 'private';
  body: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  tags: string[];
  clonedFromId?: number;
  provenance?: Record<string, unknown>;
}

export type UpdateRuleDefinitionInput = Partial<Omit<CreateRuleDefinitionInput, 'definitionType'>>;

export interface RuleDefinitionListOptions {
  type?: RuleDefinitionType;
  moduleId?: number;
}

export interface RuleCatalogActor extends RuleApiActor {
  workspaceExternalId: string;
}

// ── Export/import bundle ──────────────────────────────────────────────────────

export interface RuleSetExportedModule {
  namespace: string;
  name: string;
  description?: string;
  sortOrder: number;
  requiredEngineFeatureLevel: string;
  dependencies: unknown[];
  exports: unknown[];
}

export interface RuleSetExportedDefinition {
  /** The definition's externalId at export time, used to remap cross-references on import. */
  externalId?: string;
  moduleNamespace: string;
  definitionType: string;
  name: string;
  description?: string;
  schemaVersion: number;
  visibility: 'exported' | 'private';
  body: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  tags: string[];
}

export interface RuleSetExportBundle {
  formatVersion: '1';
  schemaId: 'rule-set-export';
  exportedAt: string;
  ruleSetName: string;
  engineFeatureLevel: string;
  modules: RuleSetExportedModule[];
  definitions: RuleSetExportedDefinition[];
}

export interface RuleSetImportResult {
  modulesCreated: number;
  modulesExisting: number;
  definitionsCreated: number;
  definitionsFailed: Array<{ name: string; reason: string }>;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface RuleDefinitionSnapshotResource {
  id: string;
  definitionId: number;
  name: string;
  reason: 'autosave' | 'manual' | 'restore' | 'import';
  actorId: string;
  createdAt: string;
}
