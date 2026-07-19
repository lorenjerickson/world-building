import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RuleApiActor } from '../api/rule-api-actor';
import {
  CreateRuleDefinitionInput,
  CreateRuleModuleInput,
  CreateRuleSetInput,
  DraftStatus,
  Page,
  RuleCatalogActor,
  RuleDefinitionListOptions,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetListOptions,
  RuleSetResource,
  UpdateRuleDefinitionInput,
  UpdateRuleModuleInput,
  UpdateRuleSetInput,
} from './rule-catalog.types';
import { RuleCatalogRepository } from './rule-catalog.repository';

type JsonRecord = Record<string, any>;
type PayloadPage = {
  docs: JsonRecord[];
  page?: number;
  limit?: number;
  totalDocs?: number;
  totalPages?: number;
};

function relationshipId(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof (value as JsonRecord).id === 'number') {
    return (value as JsonRecord).id;
  }
  throw new BadGatewayException({
    code: 'CMS_CONTRACT_INVALID',
    message: 'CMS returned an invalid relationship identifier.',
    retryable: false,
  });
}

function tagsFromCms(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => tag && typeof tag === 'object' ? (tag as JsonRecord).value : undefined)
    .filter((value): value is string => typeof value === 'string');
}

function tagsToCms(tags: string[]): Array<{ value: string }> {
  return tags.map((value) => ({ value }));
}

function lexicalFromText(text: string | undefined): JsonRecord | undefined {
  if (text === undefined) return undefined;
  return {
    root: {
      type: 'root',
      children: text ? [{
        type: 'paragraph',
        children: [{
          type: 'text',
          detail: 0,
          format: 0,
          mode: 'normal',
          style: '',
          text,
          version: 1,
        }],
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1,
      }] : [],
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
    },
  };
}

function textFromLexical(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as JsonRecord;
    if (typeof record.text === 'string') texts.push(record.text);
    if (record.root && typeof record.root === 'object') visit(record.root);
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child);
      if (record.type === 'paragraph') texts.push('\n');
    }
  };
  visit(value);
  const text = texts.join('').replace(/\n+$/, '').trim();
  return text || undefined;
}

function draftStatus(document: JsonRecord): DraftStatus {
  return document._status === 'published' ? 'published' : 'draft';
}

@Injectable()
export class PayloadRuleCatalogRepository implements RuleCatalogRepository {
  private readonly baseUrl = (process.env.CMS_BASE_URL || 'http://cms:3000').replace(/\/$/, '');
  private readonly internalToken = process.env.CMS_INTERNAL_TOKEN || '';

  async resolveActor(actor: RuleApiActor): Promise<RuleCatalogActor> {
    const response = await this.request<JsonRecord>('/api/users/me?depth=1', actor);
    const user = response.user;
    if (!user) {
      throw new UnauthorizedException({
        code: 'RULE_ACTOR_UNKNOWN',
        message: 'The authenticated user is not provisioned for rule-set access.',
        retryable: false,
      });
    }

    let workspace = user.workspace;
    if (typeof workspace === 'number') {
      workspace = await this.request<JsonRecord>(`/api/workspaces/${workspace}?depth=0`, actor);
    }
    const workspaceExternalId = workspace?.externalId;
    if (typeof workspaceExternalId !== 'string' || !workspaceExternalId) {
      throw new ForbiddenException({
        code: 'RULE_WORKSPACE_REQUIRED',
        message: 'The authenticated user is not assigned to a rule-set workspace.',
        retryable: false,
      });
    }

    return { ...actor, workspaceExternalId };
  }

  async listRuleSets(actor: RuleApiActor, options: RuleSetListOptions): Promise<Page<RuleSetResource>> {
    const params = new URLSearchParams({
      depth: '0',
      draft: 'true',
      limit: String(options.limit),
      page: String(options.page),
      sort: '-updatedAt',
    });
    if (options.search) params.set('where[name][like]', options.search);
    if (options.lifecycle) params.set('where[lifecycle][equals]', options.lifecycle);
    if (options.status) params.set('where[_status][equals]', options.status);

    const page = await this.request<PayloadPage>(`/api/rule-sets?${params}`, actor);
    return {
      items: page.docs.map((document) => this.mapRuleSet(document)),
      page: page.page ?? options.page,
      limit: page.limit ?? options.limit,
      totalItems: page.totalDocs ?? page.docs.length,
      totalPages: page.totalPages ?? 1,
    };
  }

  async createRuleSet(actor: RuleApiActor, input: CreateRuleSetInput): Promise<RuleSetResource> {
    const document = await this.mutate('/api/rule-sets', actor, 'POST', {
      _status: 'draft',
      dashboard: {
        accentColor: input.accentColor,
        featured: input.featured,
      },
      description: lexicalFromText(input.description),
      engineFeatureLevel: input.engineFeatureLevel,
      externalId: randomUUID(),
      lifecycle: 'active',
      name: input.name,
      slug: input.slug,
      summary: input.summary,
      tags: tagsToCms(input.tags),
    });
    return this.mapRuleSet(document);
  }

  async getRuleSet(actor: RuleApiActor, ruleSetId: number): Promise<RuleSetResource> {
    const document = await this.request<JsonRecord>(
      `/api/rule-sets/${ruleSetId}?depth=0&draft=true`,
      actor,
      'RULE_SET_NOT_FOUND',
    );
    return this.mapRuleSet(document);
  }

  async updateRuleSet(actor: RuleApiActor, ruleSetId: number, input: UpdateRuleSetInput): Promise<RuleSetResource> {
    const data: JsonRecord = { _status: 'draft' };
    for (const field of ['name', 'slug', 'summary', 'lifecycle', 'engineFeatureLevel'] as const) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    if (input.description !== undefined) data.description = lexicalFromText(input.description);
    if (input.tags !== undefined) data.tags = tagsToCms(input.tags);
    if (input.accentColor !== undefined || input.featured !== undefined) {
      data.dashboard = {};
      if (input.accentColor !== undefined) data.dashboard.accentColor = input.accentColor;
      if (input.featured !== undefined) data.dashboard.featured = input.featured;
    }
    const document = await this.mutate(
      `/api/rule-sets/${ruleSetId}?depth=0&draft=true`,
      actor,
      'PATCH',
      data,
      'RULE_SET_NOT_FOUND',
    );
    return this.mapRuleSet(document);
  }

  async deleteRuleSet(actor: RuleApiActor, ruleSetId: number): Promise<void> {
    const childCollections = [
      'rule-definitions',
      'rule-documents',
      'rule-generation-policies',
      'rule-migrations',
    ];
    for (const collection of childCollections) {
      await this.deleteChildren(collection, ruleSetId, actor);
    }
    await this.deleteChildren('rule-modules', ruleSetId, actor);
    await this.deleteDocument('/api/rule-sets', ruleSetId, actor, 'RULE_SET_NOT_FOUND');
  }

  async listModules(actor: RuleApiActor, ruleSetId: number): Promise<RuleModuleResource[]> {
    const params = this.childQuery(ruleSetId, 'sortOrder');
    const page = await this.request<PayloadPage>(`/api/rule-modules?${params}`, actor);
    return page.docs.map((document) => this.mapModule(document));
  }

  async createModule(actor: RuleApiActor, ruleSetId: number, input: CreateRuleModuleInput): Promise<RuleModuleResource> {
    const document = await this.mutate('/api/rule-modules', actor, 'POST', {
      _status: 'draft',
      dependencies: input.dependencies,
      description: lexicalFromText(input.description),
      exports: input.exports,
      externalId: randomUUID(),
      name: input.name,
      namespace: input.namespace,
      requiredEngineFeatureLevel: input.requiredEngineFeatureLevel,
      ruleSet: ruleSetId,
      sortOrder: input.sortOrder,
    });
    return this.mapModule(document);
  }

  async getModule(actor: RuleApiActor, moduleId: number): Promise<RuleModuleResource> {
    const document = await this.request<JsonRecord>(
      `/api/rule-modules/${moduleId}?depth=0&draft=true`,
      actor,
      'RULE_MODULE_NOT_FOUND',
    );
    return this.mapModule(document);
  }

  async updateModule(actor: RuleApiActor, moduleId: number, input: UpdateRuleModuleInput): Promise<RuleModuleResource> {
    const data: JsonRecord = { _status: 'draft' };
    for (const field of [
      'namespace',
      'name',
      'sortOrder',
      'requiredEngineFeatureLevel',
      'dependencies',
      'exports',
    ] as const) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    if (input.description !== undefined) data.description = lexicalFromText(input.description);
    const document = await this.mutate(
      `/api/rule-modules/${moduleId}?depth=0&draft=true`,
      actor,
      'PATCH',
      data,
      'RULE_MODULE_NOT_FOUND',
    );
    return this.mapModule(document);
  }

  async deleteModule(actor: RuleApiActor, moduleId: number): Promise<void> {
    await this.deleteDocument('/api/rule-modules', moduleId, actor, 'RULE_MODULE_NOT_FOUND');
  }

  async listDefinitions(
    actor: RuleApiActor,
    ruleSetId: number,
    options: RuleDefinitionListOptions,
  ): Promise<RuleDefinitionResource[]> {
    const params = this.childQuery(ruleSetId, 'name');
    if (options.type) params.set('where[definitionType][equals]', options.type);
    if (options.moduleId) params.set('where[module][equals]', String(options.moduleId));
    const page = await this.request<PayloadPage>(`/api/rule-definitions?${params}`, actor);
    return page.docs.map((document) => this.mapDefinition(document));
  }

  async createDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    input: CreateRuleDefinitionInput,
  ): Promise<RuleDefinitionResource> {
    const document = await this.mutate('/api/rule-definitions', actor, 'POST', {
      _status: 'draft',
      body: input.body,
      clonedFrom: input.clonedFromId,
      definitionType: input.definitionType,
      description: lexicalFromText(input.description),
      externalId: randomUUID(),
      module: input.moduleId,
      name: input.name,
      presentation: input.presentation,
      provenance: input.provenance,
      ruleSet: ruleSetId,
      schemaVersion: input.schemaVersion,
      tags: tagsToCms(input.tags),
      visibility: input.visibility,
    });
    return this.mapDefinition(document);
  }

  async getDefinition(actor: RuleApiActor, definitionId: number): Promise<RuleDefinitionResource> {
    const document = await this.request<JsonRecord>(
      `/api/rule-definitions/${definitionId}?depth=0&draft=true`,
      actor,
      'RULE_DEFINITION_NOT_FOUND',
    );
    return this.mapDefinition(document);
  }

  async updateDefinition(
    actor: RuleApiActor,
    definitionId: number,
    input: UpdateRuleDefinitionInput,
  ): Promise<RuleDefinitionResource> {
    const data: JsonRecord = { _status: 'draft' };
    for (const field of ['name', 'schemaVersion', 'visibility', 'body', 'presentation'] as const) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    if (input.description !== undefined) data.description = lexicalFromText(input.description);
    if (input.tags !== undefined) data.tags = tagsToCms(input.tags);
    if (input.moduleId !== undefined) data.module = input.moduleId;
    const document = await this.mutate(
      `/api/rule-definitions/${definitionId}?depth=0&draft=true`,
      actor,
      'PATCH',
      data,
      'RULE_DEFINITION_NOT_FOUND',
    );
    return this.mapDefinition(document);
  }

  async deleteDefinition(actor: RuleApiActor, definitionId: number): Promise<void> {
    await this.deleteDocument('/api/rule-definitions', definitionId, actor, 'RULE_DEFINITION_NOT_FOUND');
  }

  async listReleases(actor: RuleApiActor, ruleSetId: number): Promise<RuleReleaseResource[]> {
    const params = new URLSearchParams({
      depth: '0',
      limit: '500',
      sort: '-publishedAt',
      'where[ruleSet][equals]': String(ruleSetId),
    });
    const page = await this.request<PayloadPage>(`/api/rule-releases?${params}`, actor);
    return page.docs.map((document) => this.mapRelease(document));
  }

  async getRelease(actor: RuleApiActor, releaseId: number): Promise<RuleReleaseResource> {
    const document = await this.request<JsonRecord>(
      `/api/rule-releases/${releaseId}?depth=0`,
      actor,
      'RULE_RELEASE_NOT_FOUND',
    );
    return this.mapRelease(document);
  }

  private childQuery(ruleSetId: number, sort: string): URLSearchParams {
    return new URLSearchParams({
      depth: '0',
      draft: 'true',
      limit: '500',
      sort,
      'where[ruleSet][equals]': String(ruleSetId),
    });
  }

  private actorHeaders(actor: RuleApiActor, json = false): Record<string, string> {
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(actor.email ? { 'x-auth0-email': actor.email } : {}),
      'x-auth0-sub': actor.auth0Subject,
      'x-cms-internal-token': this.internalToken,
    };
  }

  private async request<T>(
    path: string,
    actor: RuleApiActor,
    notFoundCode = 'RULE_RESOURCE_NOT_FOUND',
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.actorHeaders(actor),
      signal: AbortSignal.timeout(5_000),
    }).catch((error: unknown) => {
      throw new ServiceUnavailableException({
        code: 'RULE_CMS_UNAVAILABLE',
        message: 'Rule-set content storage is unavailable.',
        retryable: true,
      }, { cause: error });
    });
    return this.readResponse<T>(response, notFoundCode);
  }

  private async mutate(
    path: string,
    actor: RuleApiActor,
    method: 'POST' | 'PATCH',
    data: JsonRecord,
    notFoundCode = 'RULE_RESOURCE_NOT_FOUND',
  ): Promise<JsonRecord> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(data),
      headers: this.actorHeaders(actor, true),
      method,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      throw new ServiceUnavailableException({
        code: 'RULE_CMS_UNAVAILABLE',
        message: 'Rule-set content storage is unavailable.',
        retryable: true,
      }, { cause: error });
    });
    const body = await this.readResponse<JsonRecord>(response, notFoundCode);
    return body.doc ?? body;
  }

  private async deleteChildren(collection: string, ruleSetId: number, actor: RuleApiActor): Promise<void> {
    const params = new URLSearchParams({
      depth: '0',
      draft: 'true',
      limit: '500',
      'where[ruleSet][equals]': String(ruleSetId),
    });
    const page = await this.request<PayloadPage>(`/api/${collection}?${params}`, actor);
    for (const document of page.docs) {
      await this.deleteDocument(`/api/${collection}`, relationshipId(document.id), actor);
    }
  }

  private async deleteDocument(
    collectionPath: string,
    documentId: number,
    actor: RuleApiActor,
    notFoundCode = 'RULE_RESOURCE_NOT_FOUND',
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}${collectionPath}/${documentId}`, {
      headers: this.actorHeaders(actor),
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      throw new ServiceUnavailableException({
        code: 'RULE_CMS_UNAVAILABLE',
        message: 'Rule-set content storage is unavailable.',
        retryable: true,
      }, { cause: error });
    });
    await this.readResponse<JsonRecord>(response, notFoundCode);
  }

  private async readResponse<T>(response: Response, notFoundCode: string): Promise<T> {
    if (response.ok) {
      try {
        return await response.json() as T;
      } catch (error) {
        throw new BadGatewayException({
          code: 'CMS_CONTRACT_INVALID',
          message: 'CMS returned an invalid rule-set response.',
          retryable: true,
        }, { cause: error });
      }
    }

    if (response.status === 401) {
      throw new UnauthorizedException({
        code: 'RULE_ACTOR_UNKNOWN',
        message: 'The authenticated user is not provisioned for rule-set access.',
        retryable: false,
      });
    }
    if (response.status === 403) {
      throw new ForbiddenException({
        code: 'RULE_ACCESS_DENIED',
        message: 'The actor cannot access this rule-set resource.',
        retryable: false,
      });
    }
    if (response.status === 404) {
      throw new NotFoundException({
        code: notFoundCode,
        message: 'The requested rule-set resource was not found.',
        retryable: false,
      });
    }
    if (response.status === 409) {
      throw new ConflictException({
        code: 'RULE_CONTENT_CONFLICT',
        message: 'The rule-set change conflicts with existing content.',
        retryable: false,
      });
    }
    if (response.status >= 400 && response.status < 500) {
      throw new BadRequestException({
        code: 'RULE_CONTENT_INVALID',
        message: 'The CMS rejected the rule-set content.',
        retryable: false,
      });
    }
    throw new ServiceUnavailableException({
      code: 'RULE_CMS_UNAVAILABLE',
      message: 'Rule-set content storage is unavailable.',
      retryable: true,
    });
  }

  private mapRuleSet(document: JsonRecord): RuleSetResource {
    return {
      id: document.id,
      externalId: document.externalId,
      name: document.name,
      slug: document.slug,
      summary: document.summary,
      description: textFromLexical(document.description),
      lifecycle: document.lifecycle,
      engineFeatureLevel: document.engineFeatureLevel,
      dashboard: {
        accentColor: document.dashboard?.accentColor ?? undefined,
        featured: document.dashboard?.featured === true,
      },
      tags: tagsFromCms(document.tags),
      status: draftStatus(document),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private mapModule(document: JsonRecord): RuleModuleResource {
    return {
      id: document.id,
      externalId: document.externalId,
      ruleSetId: relationshipId(document.ruleSet),
      namespace: document.namespace,
      name: document.name,
      description: textFromLexical(document.description),
      sortOrder: document.sortOrder,
      requiredEngineFeatureLevel: document.requiredEngineFeatureLevel,
      dependencies: Array.isArray(document.dependencies) ? document.dependencies : [],
      exports: Array.isArray(document.exports) ? document.exports : [],
      status: draftStatus(document),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private mapDefinition(document: JsonRecord): RuleDefinitionResource {
    return {
      id: document.id,
      externalId: document.externalId,
      ruleSetId: relationshipId(document.ruleSet),
      moduleId: relationshipId(document.module),
      definitionType: document.definitionType,
      name: document.name,
      description: textFromLexical(document.description),
      schemaVersion: document.schemaVersion,
      visibility: document.visibility,
      body: document.body,
      presentation: document.presentation ?? undefined,
      clonedFromId: document.clonedFrom ? relationshipId(document.clonedFrom) : undefined,
      provenance: document.provenance ?? undefined,
      tags: tagsFromCms(document.tags),
      status: draftStatus(document),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private mapRelease(document: JsonRecord): RuleReleaseResource {
    return {
      id: document.id,
      externalId: document.externalId,
      ruleSetId: relationshipId(document.ruleSet),
      version: document.version,
      contentHash: document.contentHash,
      engineCompatibility: document.engineCompatibility,
      dependencyLock: document.dependencyLock,
      manifest: document.manifest,
      sourceSnapshot: document.sourceSnapshot,
      publishedAt: document.publishedAt,
      lifecycle: document.lifecycle,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
