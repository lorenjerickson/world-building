export type RuleSetLifecycle = 'active' | 'deprecated' | 'retired';
export type RuleSetStatus = 'draft' | 'published';

export interface RuleSetResource {
  id: number;
  externalId: string;
  name: string;
  slug: string;
  summary: string;
  description?: string;
  lifecycle: RuleSetLifecycle;
  engineFeatureLevel: string;
  dashboard: {
    accentColor?: string;
    featured: boolean;
  };
  tags: string[];
  status: RuleSetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RuleSetPage {
  items: RuleSetResource[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface CreateRuleSetInput {
  name: string;
  slug: string;
  summary: string;
  description?: string;
  engineFeatureLevel: string;
  tags: string[];
  accentColor?: string;
}

export const ruleDefinitionTypes = [
  'entity-type',
  'trait',
  'field',
  'derived-value',
  'modifier',
  'check',
  'resource',
  'catalog',
  'template',
  'operation',
  'effect',
  'event',
  'constraint',
  'presentation',
  'fixture',
] as const;

export type RuleDefinitionType = typeof ruleDefinitionTypes[number];

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
  status: RuleSetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuleModuleInput {
  namespace: string;
  name: string;
  description?: string;
  sortOrder?: number;
  requiredEngineFeatureLevel?: string;
  dependencies?: unknown[];
  exports?: unknown[];
}

export type UpdateRuleModuleInput = Partial<CreateRuleModuleInput> & {
  expectedUpdatedAt: string;
};

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
  tags: string[];
  status: RuleSetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuleDefinitionInput {
  moduleId: number;
  definitionType: RuleDefinitionType;
  name: string;
  description?: string;
  schemaVersion?: number;
  visibility?: 'exported' | 'private';
  body: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  tags?: string[];
}

export type UpdateRuleDefinitionInput = Partial<Omit<CreateRuleDefinitionInput, 'moduleId' | 'definitionType'>> & {
  expectedUpdatedAt: string;
};

type RuleApiError = { code?: string; message?: string; retryable?: boolean };

export class RuleSetApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & RuleApiError;
  if (!response.ok) {
    throw new RuleSetApiError(
      body.message || 'The rule-set request failed.',
      body.code || 'RULE_REQUEST_FAILED',
      response.status,
      body.retryable === true,
    );
  }
  return body;
}

export async function listRuleSets(limit = 25, signal?: AbortSignal): Promise<RuleSetPage> {
  const response = await fetch(`/api/rule-sets?limit=${limit}`, { cache: 'no-store', signal });
  return readResponse<RuleSetPage>(response);
}

export async function createRuleSet(input: CreateRuleSetInput): Promise<RuleSetResource> {
  const response = await fetch('/api/rule-sets', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readResponse<RuleSetResource>(response);
}

export async function getRuleSet(id: number, signal?: AbortSignal): Promise<RuleSetResource> {
  const response = await fetch(`/api/rule-sets/${id}`, { cache: 'no-store', signal });
  return readResponse<RuleSetResource>(response);
}

export async function getRuleSetChildren<T>(id: number, child: 'modules' | 'definitions' | 'releases', signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`/api/rule-sets/${id}/${child}`, { cache: 'no-store', signal });
  return readResponse<T[]>(response);
}

export async function createRuleModule(ruleSetId: number, input: CreateRuleModuleInput): Promise<RuleModuleResource> {
  const response = await fetch(`/api/rule-sets/${ruleSetId}/modules`, {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readResponse<RuleModuleResource>(response);
}

export async function createRuleDefinition(ruleSetId: number, input: CreateRuleDefinitionInput): Promise<RuleDefinitionResource> {
  const response = await fetch(`/api/rule-sets/${ruleSetId}/definitions`, {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readResponse<RuleDefinitionResource>(response);
}

export async function updateRuleModule(ruleSetId: number, moduleId: number, input: UpdateRuleModuleInput): Promise<RuleModuleResource> {
  const response = await fetch(`/api/rule-sets/${ruleSetId}/modules/${moduleId}`, {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  });
  return readResponse<RuleModuleResource>(response);
}

export async function updateRuleDefinition(ruleSetId: number, definitionId: number, input: UpdateRuleDefinitionInput): Promise<RuleDefinitionResource> {
  const response = await fetch(`/api/rule-sets/${ruleSetId}/definitions/${definitionId}`, {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  });
  return readResponse<RuleDefinitionResource>(response);
}

export async function deleteRuleModule(ruleSetId: number, module: RuleModuleResource): Promise<void> {
  const params = new URLSearchParams({ expectedUpdatedAt: module.updatedAt });
  const response = await fetch(`/api/rule-sets/${ruleSetId}/modules/${module.id}?${params}`, { method: 'DELETE' });
  await readResponse<{ deleted: true; id: number }>(response);
}

export async function deleteRuleDefinition(ruleSetId: number, definition: RuleDefinitionResource): Promise<void> {
  const params = new URLSearchParams({ expectedUpdatedAt: definition.updatedAt });
  const response = await fetch(`/api/rule-sets/${ruleSetId}/definitions/${definition.id}?${params}`, { method: 'DELETE' });
  await readResponse<{ deleted: true; id: number }>(response);
}

export async function deleteRuleSet(ruleSet: RuleSetResource): Promise<void> {
  const params = new URLSearchParams({ expectedUpdatedAt: ruleSet.updatedAt });
  const response = await fetch(`/api/rule-sets/${ruleSet.id}?${params}`, { method: 'DELETE' });
  await readResponse<{ deleted: true; id: number }>(response);
}
