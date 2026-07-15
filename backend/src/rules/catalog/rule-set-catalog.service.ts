import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RuleApiActor } from '../api/rule-api-actor';
import {
  CloneRuleDefinitionDto,
  CreateRuleDefinitionDto,
  CreateRuleModuleDto,
  CreateRuleSetDto,
  ListRuleDefinitionsQueryDto,
  ListRuleSetsQueryDto,
  UpdateRuleDefinitionDto,
  UpdateRuleModuleDto,
  UpdateRuleSetDto,
} from '../api/rule-set.dto';
import { RuleCatalogRepository } from './rule-catalog.repository';
import {
  Page,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetResource,
} from './rule-catalog.types';

@Injectable()
export class RuleSetCatalogService {
  constructor(private readonly repository: RuleCatalogRepository) {}

  async list(actor: RuleApiActor, query: ListRuleSetsQueryDto): Promise<Page<RuleSetResource>> {
    const resolvedActor = await this.repository.resolveActor(actor);
    return this.repository.listRuleSets(resolvedActor, {
      search: query.search?.trim() || undefined,
      lifecycle: query.lifecycle,
      status: query.status,
      page: this.boundedInteger(query.page, 1, 1, 100_000),
      limit: this.boundedInteger(query.limit, 25, 1, 100),
    });
  }

  async create(actor: RuleApiActor, dto: CreateRuleSetDto): Promise<RuleSetResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    return this.repository.createRuleSet(resolvedActor, {
      accentColor: dto.accentColor,
      description: dto.description,
      engineFeatureLevel: dto.engineFeatureLevel.trim(),
      featured: dto.featured ?? false,
      name: dto.name.trim(),
      slug: dto.slug,
      summary: dto.summary.trim(),
      tags: this.uniqueTags(dto.tags),
    });
  }

  async get(actor: RuleApiActor, ruleSetId: number): Promise<RuleSetResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    return this.repository.getRuleSet(resolvedActor, ruleSetId);
  }

  async update(actor: RuleApiActor, ruleSetId: number, dto: UpdateRuleSetDto): Promise<RuleSetResource> {
    const { expectedUpdatedAt, ...changes } = dto;
    this.requireChanges(changes);
    const resolvedActor = await this.repository.resolveActor(actor);
    const current = await this.repository.getRuleSet(resolvedActor, ruleSetId);
    this.requireRevision(current.updatedAt, expectedUpdatedAt);
    return this.repository.updateRuleSet(resolvedActor, ruleSetId, {
      ...changes,
      name: changes.name?.trim(),
      summary: changes.summary?.trim(),
      engineFeatureLevel: changes.engineFeatureLevel?.trim(),
      tags: changes.tags ? this.uniqueTags(changes.tags) : undefined,
    });
  }

  async delete(actor: RuleApiActor, ruleSetId: number, expectedUpdatedAt: string): Promise<{ deleted: true; id: number }> {
    if (!expectedUpdatedAt) {
      throw new BadRequestException({
        code: 'RULE_REVISION_REQUIRED',
        message: 'The last observed rule-set revision is required for deletion.',
        retryable: false,
      });
    }
    const resolvedActor = await this.repository.resolveActor(actor);
    const current = await this.repository.getRuleSet(resolvedActor, ruleSetId);
    this.requireRevision(current.updatedAt, expectedUpdatedAt);
    const releases = await this.repository.listReleases(resolvedActor, ruleSetId);
    if (releases.length) {
      throw new ConflictException({
        code: 'RULE_SET_RELEASED',
        message: 'Published rule sets cannot be deleted. Retire this rule set instead.',
        retryable: false,
      });
    }
    await this.repository.deleteRuleSet(resolvedActor, ruleSetId);
    return { deleted: true, id: ruleSetId };
  }

  async listModules(actor: RuleApiActor, ruleSetId: number): Promise<RuleModuleResource[]> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    return this.repository.listModules(resolvedActor, ruleSetId);
  }

  async createModule(actor: RuleApiActor, ruleSetId: number, dto: CreateRuleModuleDto): Promise<RuleModuleResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    const ruleSet = await this.repository.getRuleSet(resolvedActor, ruleSetId);
    return this.repository.createModule(resolvedActor, ruleSetId, {
      dependencies: dto.dependencies ?? [],
      description: dto.description,
      exports: dto.exports ?? [],
      name: dto.name.trim(),
      namespace: dto.namespace,
      requiredEngineFeatureLevel: dto.requiredEngineFeatureLevel?.trim() || ruleSet.engineFeatureLevel,
      sortOrder: dto.sortOrder ?? 0,
    });
  }

  async updateModule(
    actor: RuleApiActor,
    ruleSetId: number,
    moduleId: number,
    dto: UpdateRuleModuleDto,
  ): Promise<RuleModuleResource> {
    const { expectedUpdatedAt, ...changes } = dto;
    this.requireChanges(changes);
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const module = await this.repository.getModule(resolvedActor, moduleId);
    this.requireRuleSetRelation(module.ruleSetId, ruleSetId, 'RULE_MODULE_NOT_FOUND');
    this.requireRevision(module.updatedAt, expectedUpdatedAt);
    return this.repository.updateModule(resolvedActor, moduleId, {
      ...changes,
      name: changes.name?.trim(),
      requiredEngineFeatureLevel: changes.requiredEngineFeatureLevel?.trim(),
    });
  }

  async deleteModule(
    actor: RuleApiActor,
    ruleSetId: number,
    moduleId: number,
    expectedUpdatedAt: string,
  ): Promise<{ deleted: true; id: number }> {
    this.requireDeletionRevision(expectedUpdatedAt);
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const module = await this.repository.getModule(resolvedActor, moduleId);
    this.requireRuleSetRelation(module.ruleSetId, ruleSetId, 'RULE_MODULE_NOT_FOUND');
    this.requireRevision(module.updatedAt, expectedUpdatedAt);
    if (module.status === 'published') {
      throw new ConflictException({
        code: 'RULE_MODULE_PUBLISHED',
        message: 'Published modules cannot be deleted from the authored catalog.',
        retryable: false,
      });
    }
    const definitions = await this.repository.listDefinitions(resolvedActor, ruleSetId, { moduleId });
    if (definitions.length) {
      throw new ConflictException({
        code: 'RULE_MODULE_NOT_EMPTY',
        definitionCount: definitions.length,
        message: `Delete or clone the module's ${definitions.length} definition${definitions.length === 1 ? '' : 's'} before deleting the module.`,
        retryable: false,
      });
    }
    await this.repository.deleteModule(resolvedActor, moduleId);
    return { deleted: true, id: moduleId };
  }

  async listDefinitions(
    actor: RuleApiActor,
    ruleSetId: number,
    query: ListRuleDefinitionsQueryDto,
  ): Promise<RuleDefinitionResource[]> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const moduleId = query.moduleId ? Number(query.moduleId) : undefined;
    if (moduleId) {
      const module = await this.repository.getModule(resolvedActor, moduleId);
      this.requireRuleSetRelation(module.ruleSetId, ruleSetId, 'RULE_MODULE_NOT_FOUND');
    }
    return this.repository.listDefinitions(resolvedActor, ruleSetId, { moduleId, type: query.type });
  }

  async createDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    dto: CreateRuleDefinitionDto,
  ): Promise<RuleDefinitionResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const module = await this.repository.getModule(resolvedActor, dto.moduleId);
    this.requireRuleSetRelation(module.ruleSetId, ruleSetId, 'RULE_MODULE_NOT_FOUND');
    return this.repository.createDefinition(resolvedActor, ruleSetId, {
      body: dto.body,
      definitionType: dto.definitionType,
      description: dto.description,
      moduleId: dto.moduleId,
      name: dto.name.trim(),
      presentation: dto.presentation,
      schemaVersion: dto.schemaVersion ?? 1,
      tags: this.uniqueTags(dto.tags),
      visibility: dto.visibility ?? 'exported',
    });
  }

  async updateDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
    dto: UpdateRuleDefinitionDto,
  ): Promise<RuleDefinitionResource> {
    const { expectedUpdatedAt, ...changes } = dto;
    this.requireChanges(changes);
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const definition = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(definition.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    this.requireRevision(definition.updatedAt, expectedUpdatedAt);
    return this.repository.updateDefinition(resolvedActor, definitionId, {
      ...changes,
      name: changes.name?.trim(),
      tags: changes.tags ? this.uniqueTags(changes.tags) : undefined,
    });
  }

  async deleteDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
    expectedUpdatedAt: string,
  ): Promise<{ deleted: true; id: number }> {
    this.requireDeletionRevision(expectedUpdatedAt);
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const definition = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(definition.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    this.requireRevision(definition.updatedAt, expectedUpdatedAt);
    if (definition.status === 'published') {
      throw new ConflictException({
        code: 'RULE_DEFINITION_PUBLISHED',
        message: 'Published definitions cannot be deleted from the authored catalog.',
        retryable: false,
      });
    }
    await this.repository.deleteDefinition(resolvedActor, definitionId);
    return { deleted: true, id: definitionId };
  }

  async cloneDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
    dto: CloneRuleDefinitionDto,
  ): Promise<RuleDefinitionResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const source = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(source.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');

    const targetModuleId = dto.targetModuleId ?? source.moduleId;
    const targetModule = await this.repository.getModule(resolvedActor, targetModuleId);
    this.requireRuleSetRelation(targetModule.ruleSetId, ruleSetId, 'RULE_MODULE_NOT_FOUND');

    return this.repository.createDefinition(resolvedActor, ruleSetId, {
      body: structuredClone(source.body),
      clonedFromId: source.id,
      definitionType: source.definitionType,
      description: source.description,
      moduleId: targetModuleId,
      name: dto.name?.trim() || `${source.name} Copy`,
      presentation: source.presentation ? structuredClone(source.presentation) : undefined,
      provenance: {
        clonedAt: new Date().toISOString(),
        sourceDefinitionExternalId: source.externalId,
      },
      schemaVersion: source.schemaVersion,
      tags: [...source.tags],
      visibility: source.visibility,
    });
  }

  async listReleases(actor: RuleApiActor, ruleSetId: number): Promise<RuleReleaseResource[]> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    return this.repository.listReleases(resolvedActor, ruleSetId);
  }

  async getRelease(actor: RuleApiActor, ruleSetId: number, releaseId: number): Promise<RuleReleaseResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const release = await this.repository.getRelease(resolvedActor, releaseId);
    this.requireRuleSetRelation(release.ruleSetId, ruleSetId, 'RULE_RELEASE_NOT_FOUND');
    return release;
  }

  private boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
    const parsed = value ? Number(value) : fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private uniqueTags(tags: string[] | undefined): string[] {
    return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  }

  private requireRuleSetRelation(actual: number, expected: number, code: string): void {
    if (actual !== expected) {
      throw new NotFoundException({
        code,
        message: 'The requested rule-set resource was not found.',
        retryable: false,
      });
    }
  }

  private requireChanges(dto: object): void {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException({
        code: 'RULE_CHANGE_REQUIRED',
        message: 'At least one rule-set field must be changed.',
        retryable: false,
      });
    }
  }

  private requireDeletionRevision(expectedUpdatedAt: string): void {
    if (!expectedUpdatedAt) {
      throw new BadRequestException({
        code: 'RULE_REVISION_REQUIRED',
        message: 'The last observed artifact revision is required for deletion.',
        retryable: false,
      });
    }
  }

  private requireRevision(currentUpdatedAt: string, expectedUpdatedAt: string): void {
    if (currentUpdatedAt !== expectedUpdatedAt) {
      throw new ConflictException({
        code: 'RULE_DRAFT_STALE',
        currentUpdatedAt,
        message: 'The rule-set draft changed after it was loaded.',
        retryable: true,
      });
    }
  }
}
