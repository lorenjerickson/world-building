import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RuleApiActor } from '../api/rule-api-actor';
import {
  CloneRuleDefinitionDto,
  CreateRuleDefinitionDto,
  CreateRuleModuleDto,
  CreateRuleSetDto,
  ListRuleDefinitionsQueryDto,
  ListRuleSetsQueryDto,
  MigrateTraitDefinitionDto,
  PublishRuleSetDto,
  UpdateRuleDefinitionDto,
  UpdateRuleModuleDto,
  UpdateRuleSetDto,
} from '../api/rule-set.dto';
import { RuleCatalogRepository } from './rule-catalog.repository';
import {
  Page,
  RuleDefinitionResource,
  RuleDefinitionSnapshotResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetExportBundle,
  RuleSetImportResult,
  RuleSetResource,
} from './rule-catalog.types';
import { RuleDefinitionSnapshotService } from './rule-definition-snapshot.service';
import { compileTraitCompositions } from '../traits/trait-composition.compiler';
import type { TraitCompositionSourceDefinition } from '../traits/trait-composition.types';
import { previewTraitDefinitionMigration } from '../traits/trait-migration';
import { compileRuleRelease } from '../releases/rule-release.compiler';
import { selectTraitDefinitionScope } from '@world-building/common';

@Injectable()
export class RuleSetCatalogService {
  constructor(
    private readonly repository: RuleCatalogRepository,
    private readonly snapshots: RuleDefinitionSnapshotService,
  ) {}

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
    await this.validateTraitDefinitionChange(
      resolvedActor,
      ruleSetId,
      dto.definitionType,
      {
        externalId: 'trait:draft-new',
        name: dto.name.trim(),
        body: dto.body,
        tags: this.uniqueTags(dto.tags),
      },
    );
    return this.repository.createDefinition(resolvedActor, ruleSetId, {
      body: dto.body,
      definitionType: dto.definitionType,
      description: dto.description,
      moduleId: dto.moduleId,
      name: dto.name.trim(),
      presentation: dto.presentation,
      schemaVersion: dto.schemaVersion
        ?? (dto.definitionType === 'trait' && dto.body.metamodelVersion === 'trait/2' ? 2 : 1),
      tags: this.uniqueTags(dto.tags),
      visibility: dto.visibility ?? 'exported',
    });
  }

  async getDefinitionById(actor: RuleApiActor, ruleSetId: number, definitionId: number): Promise<RuleDefinitionResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const definition = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(definition.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    return definition;
  }

  async updateDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
    dto: UpdateRuleDefinitionDto,
    snapshotReason: 'autosave' | 'manual' | 'restore' | 'import' = 'autosave',
  ): Promise<RuleDefinitionResource> {
    const { expectedUpdatedAt, ...changes } = dto;
    this.requireChanges(changes);
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const definition = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(definition.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    this.requireRevision(definition.updatedAt, expectedUpdatedAt);
    if (changes.body !== undefined || changes.name !== undefined || changes.tags !== undefined) {
      await this.validateTraitDefinitionChange(
        resolvedActor,
        ruleSetId,
        definition.definitionType,
        {
          externalId: definition.externalId,
          name: changes.name?.trim() || definition.name,
          body: changes.body ?? definition.body,
          tags: changes.tags ? this.uniqueTags(changes.tags) : definition.tags,
        },
        definition.id,
      );
    }
    // Capture snapshot of current state before overwriting
    await this.snapshots.capture({
      actorId: actor.auth0Subject,
      body: definition.body,
      definitionExternalId: definition.externalId,
      definitionId,
      name: definition.name,
      reason: snapshotReason,
      ruleSetId,
    });
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

  async previewTraitMigration(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
  ) {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const source = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(source.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    if (source.definitionType !== 'trait') {
      throw new BadRequestException({
        code: 'RULE_TRAIT_MIGRATION_TYPE_INVALID',
        message: 'Only trait definitions can be migrated.',
        retryable: false,
      });
    }
    const catalog = await this.repository.listDefinitions(resolvedActor, ruleSetId, { type: 'trait' });
    return previewTraitDefinitionMigration(
      { externalId: source.externalId, name: source.name, body: source.body },
      catalog
        .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
        .map((definition) => ({
          externalId: definition.externalId,
          name: definition.name,
          body: definition.body,
        })),
    );
  }

  async migrateTraitDefinition(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
    dto: MigrateTraitDefinitionDto,
  ): Promise<RuleDefinitionResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const source = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(source.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    this.requireRevision(source.updatedAt, dto.expectedUpdatedAt);
    const preview = await this.previewTraitMigration(actor, ruleSetId, definitionId);
    if (!preview.valid || !preview.migratedBody) {
      throw new BadRequestException({
        code: 'RULE_TRAIT_MIGRATION_INVALID',
        message: 'The trait cannot be migrated until its compatibility diagnostics are resolved.',
        diagnostics: preview.diagnostics,
        retryable: false,
      });
    }
    return this.updateDefinition(
      actor,
      ruleSetId,
      definitionId,
      {
        expectedUpdatedAt: dto.expectedUpdatedAt,
        body: preview.migratedBody,
        schemaVersion: 2,
        ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
      },
      'manual',
    );
  }

  async exportRuleSet(actor: RuleApiActor, ruleSetId: number): Promise<RuleSetExportBundle> {
    const resolvedActor = await this.repository.resolveActor(actor);
    const ruleSet = await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const modules = await this.repository.listModules(resolvedActor, ruleSetId);
    const definitions = await this.repository.listDefinitions(resolvedActor, ruleSetId, {});
    const moduleById = new Map(modules.map((m) => [m.id, m]));
    return {
      formatVersion: '1',
      schemaId: 'rule-set-export',
      exportedAt: new Date().toISOString(),
      ruleSetName: ruleSet.name,
      engineFeatureLevel: ruleSet.engineFeatureLevel,
      modules: modules.map((m) => ({
        namespace: m.namespace,
        name: m.name,
        description: m.description,
        sortOrder: m.sortOrder,
        requiredEngineFeatureLevel: m.requiredEngineFeatureLevel,
        dependencies: m.dependencies,
        exports: m.exports,
      })),
      definitions: definitions.map((d) => ({
        externalId: d.externalId,
        moduleNamespace: moduleById.get(d.moduleId)?.namespace ?? 'unknown',
        definitionType: d.definitionType,
        name: d.name,
        description: d.description,
        schemaVersion: d.schemaVersion,
        visibility: d.visibility,
        body: d.body,
        presentation: d.presentation,
        tags: d.tags,
      })),
    };
  }

  async importRuleSet(
    actor: RuleApiActor,
    ruleSetId: number,
    bundle: RuleSetExportBundle,
  ): Promise<RuleSetImportResult> {
    this.validateImportBundle(bundle);
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    await this.validateImportedTraitDefinitions(resolvedActor, ruleSetId, bundle);
    const existingModules = await this.repository.listModules(resolvedActor, ruleSetId);
    const moduleByNamespace = new Map(existingModules.map((m) => [m.namespace, m]));

    let modulesCreated = 0;
    let modulesExisting = 0;
    for (const mod of bundle.modules) {
      if (moduleByNamespace.has(mod.namespace)) {
        modulesExisting++;
      } else {
        const created = await this.repository.createModule(resolvedActor, ruleSetId, {
          namespace: mod.namespace,
          name: mod.name,
          description: mod.description,
          sortOrder: mod.sortOrder,
          requiredEngineFeatureLevel: mod.requiredEngineFeatureLevel || bundle.engineFeatureLevel,
          dependencies: mod.dependencies,
          exports: mod.exports,
        });
        moduleByNamespace.set(created.namespace, created);
        modulesCreated++;
      }
    }

    let definitionsCreated = 0;
    const definitionsFailed: Array<{ name: string; reason: string }> = [];

    // Phase 1: create all definitions and build an old→new externalId remapping table.
    // Each definition gets a fresh externalId (randomUUID) on creation; if the bundle
    // carries the original externalId we record the mapping so cross-references in
    // definition bodies (e.g. trait grant `ref` fields) can be rewritten in phase 2.
    const externalIdRemap = new Map<string, string>(); // oldExternalId → newExternalId
    const createdIds: Array<{ id: number; originalBody: Record<string, unknown> }> = [];

    for (const def of bundle.definitions) {
      const module = moduleByNamespace.get(def.moduleNamespace);
      if (!module) {
        definitionsFailed.push({ name: def.name, reason: `Module namespace '${def.moduleNamespace}' not found.` });
        continue;
      }
      try {
        const created = await this.repository.createDefinition(resolvedActor, ruleSetId, {
          body: def.body,
          definitionType: def.definitionType as any,
          description: def.description,
          moduleId: module.id,
          name: def.name,
          presentation: def.presentation,
          provenance: { importedAt: new Date().toISOString(), sourceRuleSetName: bundle.ruleSetName },
          schemaVersion: def.schemaVersion ?? 1,
          tags: def.tags ?? [],
          visibility: def.visibility ?? 'exported',
        });
        definitionsCreated++;
        if (def.externalId && def.externalId !== created.externalId) {
          externalIdRemap.set(def.externalId, created.externalId);
        }
        createdIds.push({ id: created.id, originalBody: def.body });
      } catch (cause) {
        definitionsFailed.push({ name: def.name, reason: cause instanceof Error ? cause.message : 'Create failed.' });
      }
    }

    // Phase 2: rewrite cross-references in definition bodies.
    // Any body that referenced another definition by its old externalId (e.g. a trait
    // grant's `ref` field) will now contain a stale UUID. We do a JSON string-replace
    // for every old→new pair and update the body when something changed.
    if (externalIdRemap.size > 0) {
      for (const { id, originalBody } of createdIds) {
        let bodyJson = JSON.stringify(originalBody);
        let changed = false;
        for (const [oldId, newId] of externalIdRemap) {
          if (bodyJson.includes(oldId)) {
            bodyJson = bodyJson.split(oldId).join(newId);
            changed = true;
          }
        }
        if (changed) {
          await this.repository.updateDefinition(resolvedActor, id, { body: JSON.parse(bodyJson) });
        }
      }
    }

    return { modulesCreated, modulesExisting, definitionsCreated, definitionsFailed };
  }

  async listDefinitionSnapshots(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
  ): Promise<RuleDefinitionSnapshotResource[]> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const definition = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(definition.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    return this.snapshots.list(ruleSetId, definitionId);
  }

  async restoreDefinitionSnapshot(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionId: number,
    snapshotId: string,
  ): Promise<RuleDefinitionResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const definition = await this.repository.getDefinition(resolvedActor, definitionId);
    this.requireRuleSetRelation(definition.ruleSetId, ruleSetId, 'RULE_DEFINITION_NOT_FOUND');
    const snapshot = await this.snapshots.getWithBody(snapshotId);
    if (!snapshot || snapshot.resource.definitionId !== definitionId) {
      throw new NotFoundException({
        code: 'RULE_SNAPSHOT_NOT_FOUND',
        message: 'The requested snapshot was not found for this definition.',
        retryable: false,
      });
    }
    await this.validateTraitDefinitionChange(
      resolvedActor,
      ruleSetId,
      definition.definitionType,
      {
        externalId: definition.externalId,
        name: snapshot.name,
        body: snapshot.body,
        tags: definition.tags,
      },
      definition.id,
    );
    // Capture the current state before restoring (so user can undo the restore itself)
    await this.snapshots.capture({
      actorId: actor.auth0Subject,
      body: definition.body,
      definitionExternalId: definition.externalId,
      definitionId,
      name: definition.name,
      reason: 'restore',
      ruleSetId,
    });
    return this.repository.updateDefinition(resolvedActor, definitionId, {
      body: snapshot.body,
      name: snapshot.name,
    });
  }

  async listReleases(actor: RuleApiActor, ruleSetId: number): Promise<RuleReleaseResource[]> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    return this.repository.listReleases(resolvedActor, ruleSetId);
  }

  async publish(
    actor: RuleApiActor,
    ruleSetId: number,
    dto: PublishRuleSetDto,
  ): Promise<RuleReleaseResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    const ruleSet = await this.repository.getRuleSet(resolvedActor, ruleSetId);
    this.requireRevision(ruleSet.updatedAt, dto.expectedUpdatedAt);
    const [modules, definitions] = await Promise.all([
      this.repository.listModules(resolvedActor, ruleSetId),
      this.repository.listDefinitions(resolvedActor, ruleSetId, {}),
    ]);
    const initialRevision = this.catalogRevision(ruleSet, modules, definitions);
    const compilation = compileRuleRelease(ruleSet, modules, definitions);
    if (!compilation.valid) {
      throw new BadRequestException({
        code: 'RULE_RELEASE_INVALID',
        message: 'The rule-set draft is not ready to publish.',
        diagnostics: compilation.diagnostics,
        retryable: false,
      });
    }

    const [confirmedRuleSet, confirmedModules, confirmedDefinitions, releases] = await Promise.all([
      this.repository.getRuleSet(resolvedActor, ruleSetId),
      this.repository.listModules(resolvedActor, ruleSetId),
      this.repository.listDefinitions(resolvedActor, ruleSetId, {}),
      this.repository.listReleases(resolvedActor, ruleSetId),
    ]);
    if (this.catalogRevision(confirmedRuleSet, confirmedModules, confirmedDefinitions) !== initialRevision) {
      throw new ConflictException({
        code: 'RULE_PUBLISH_STALE',
        message: 'The rule-set draft changed while it was being compiled. Review the latest draft and publish again.',
        retryable: true,
      });
    }
    const existingVersion = releases.find((release) => release.version === dto.version);
    if (existingVersion) {
      if (existingVersion.contentHash === compilation.release.contentHash) return existingVersion;
      throw new ConflictException({
        code: 'RULE_RELEASE_VERSION_EXISTS',
        message: `Release version '${dto.version}' already identifies different content.`,
        retryable: false,
      });
    }
    const published = await this.repository.createRelease(resolvedActor, ruleSetId, {
      version: dto.version,
      contentHash: compilation.release.contentHash,
      dependencyLock: compilation.release.dependencyLock,
      engineCompatibility: compilation.release.engineCompatibility,
      manifest: compilation.release.manifest,
      sourceSnapshot: compilation.release.sourceSnapshot,
      publishedById: resolvedActor.userId,
      publishedAt: new Date().toISOString(),
      releaseNotes: dto.releaseNotes?.trim() || undefined,
    });
    if (published.contentHash !== compilation.release.contentHash) {
      throw new ConflictException({
        code: 'RULE_RELEASE_HASH_MISMATCH',
        message: 'The persisted release hash does not match the compiled release.',
        retryable: false,
      });
    }
    return published;
  }

  async getRelease(actor: RuleApiActor, ruleSetId: number, releaseId: number): Promise<RuleReleaseResource> {
    const resolvedActor = await this.repository.resolveActor(actor);
    await this.repository.getRuleSet(resolvedActor, ruleSetId);
    const release = await this.repository.getRelease(resolvedActor, releaseId);
    this.requireRuleSetRelation(release.ruleSetId, ruleSetId, 'RULE_RELEASE_NOT_FOUND');
    return release;
  }

  private validateImportBundle(bundle: unknown): asserts bundle is RuleSetExportBundle {
    if (!bundle || typeof bundle !== 'object' || (bundle as any).schemaId !== 'rule-set-export' || (bundle as any).formatVersion !== '1') {
      throw new BadRequestException({
        code: 'RULE_IMPORT_INVALID',
        message: 'The uploaded file is not a valid rule-set export bundle (expected schemaId=rule-set-export, formatVersion=1).',
        retryable: false,
      });
    }
    const b = bundle as any;
    if (!Array.isArray(b.modules) || !Array.isArray(b.definitions)) {
      throw new BadRequestException({
        code: 'RULE_IMPORT_INVALID',
        message: 'The export bundle must contain modules and definitions arrays.',
        retryable: false,
      });
    }
  }

  private async validateTraitDefinitionChange(
    actor: RuleApiActor,
    ruleSetId: number,
    definitionType: string,
    candidate: TraitCompositionSourceDefinition,
    replacedDefinitionId?: number,
  ): Promise<void> {
    if (!['trait/1', 'trait/2'].includes(String(candidate.body.metamodelVersion))) return;
    if (definitionType !== 'trait') {
      throw new BadRequestException({
        code: 'RULE_TRAIT_DEFINITION_TYPE_INVALID',
        message: "Bodies using a trait metamodelVersion must be stored as trait definitions.",
        retryable: false,
      });
    }
    const existing = await this.repository.listDefinitions(actor, ruleSetId, { type: 'trait' });
    const existingTraits = existing
      .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)));
    const sourceFromResource = (definition: RuleDefinitionResource): TraitCompositionSourceDefinition => ({
        externalId: definition.externalId,
        name: definition.name,
        body: definition.body,
        tags: definition.tags,
      });
    const existingSources = existingTraits.map(sourceFromResource);
    const sources = existingTraits
      .filter((definition) => definition.id !== replacedDefinitionId)
      .map(sourceFromResource);
    sources.push(candidate);
    const scopedSources = selectTraitDefinitionScope(
      sources,
      [candidate.externalId],
      replacedDefinitionId !== undefined,
    );
    const result = compileTraitCompositions(scopedSources);
    if (!result.valid) {
      const baselineErrors = replacedDefinitionId === undefined
        ? new Set<string>()
        : new Set(
          compileTraitCompositions(selectTraitDefinitionScope(
            existingSources,
            [candidate.externalId],
            true,
          )).diagnostics
            .filter((item) => item.severity === 'error')
            .map((item) => this.traitDiagnosticIdentity(item)),
        );
      const blockingDiagnostics = result.diagnostics.filter((item) =>
        item.severity !== 'error'
        || !baselineErrors.has(this.traitDiagnosticIdentity(item)));
      if (!blockingDiagnostics.some((item) => item.severity === 'error')) return;
      throw new BadRequestException({
        code: 'RULE_TRAIT_COMPOSITION_INVALID',
        message: 'The trait contract is invalid.',
        diagnostics: blockingDiagnostics,
        retryable: false,
      });
    }
  }

  private traitDiagnosticIdentity(diagnostic: {
    code: string;
    definitionExternalId?: string;
    grantIndex?: number;
    message: string;
    path: string;
  }): string {
    const relativePath = diagnostic.path.includes('].')
      ? diagnostic.path.slice(diagnostic.path.indexOf('].') + 2)
      : diagnostic.path;
    return [
      diagnostic.definitionExternalId ?? '',
      diagnostic.code,
      diagnostic.grantIndex ?? '',
      relativePath,
      diagnostic.message,
    ].join('\0');
  }

  private async validateImportedTraitDefinitions(
    actor: RuleApiActor,
    ruleSetId: number,
    bundle: RuleSetExportBundle,
  ): Promise<void> {
    const existing = await this.repository.listDefinitions(actor, ruleSetId, { type: 'trait' });
    const traits: TraitCompositionSourceDefinition[] = existing
      .filter((definition) => ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
      .map((definition) => ({
        externalId: definition.externalId,
        name: definition.name,
        body: definition.body,
        tags: definition.tags,
      }));
    traits.push(...bundle.definitions
      .filter((definition) =>
        definition.definitionType === 'trait'
        && ['trait/1', 'trait/2'].includes(String(definition.body.metamodelVersion)))
      .map((definition, index) => ({
        externalId: definition.externalId || `trait:import-${index}`,
        name: definition.name,
        body: definition.body,
        tags: definition.tags,
      })));
    if (!traits.length) return;
    const result = compileTraitCompositions(traits);
    if (!result.valid) {
      throw new BadRequestException({
        code: 'RULE_TRAIT_COMPOSITION_INVALID',
        message: 'The imported trait contracts are invalid.',
        diagnostics: result.diagnostics,
        retryable: false,
      });
    }
  }

  private catalogRevision(
    ruleSet: RuleSetResource,
    modules: RuleModuleResource[],
    definitions: RuleDefinitionResource[],
  ): string {
    return JSON.stringify({
      ruleSet: [ruleSet.id, ruleSet.updatedAt],
      modules: modules
        .map((module) => [module.id, module.updatedAt])
        .sort(([left], [right]) => Number(left) - Number(right)),
      definitions: definitions
        .map((definition) => [definition.id, definition.updatedAt])
        .sort(([left], [right]) => Number(left) - Number(right)),
    });
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
