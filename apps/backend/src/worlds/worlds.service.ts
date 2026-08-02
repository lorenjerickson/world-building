import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { RuleApiActor } from '../rules/api/rule-api-actor';
import { RuleCatalogRepository } from '../rules/catalog/rule-catalog.repository';
import type { RuleReleaseResource } from '../rules/catalog/rule-catalog.types';
import { CompositionManifestService } from '../rules/releases/composition-manifest.service';
import {
  buildWorldEntitySchema,
  listCreateableTraits,
  normalizeAndValidateValues,
  releaseTraitDefinitions,
  schemaCollections,
  traitClosure,
  type WorldEntitySchema,
} from './world-entity-domain';
import type {
  AddWorldEntityReferenceDto,
  CreateWorldDto,
  CreateWorldEntityDto,
  UpdateWorldEntityDto,
} from './worlds.dto';

type EntityRecord = Awaited<ReturnType<PrismaService['ruleInstance']['findFirst']>>;

function fail(code: string, message: string, details?: unknown): never {
  throw new BadRequestException({ code, message, details, retryable: false });
}

function stateValues(state: Prisma.JsonValue): Record<string, unknown> {
  if (!state || Array.isArray(state) || typeof state !== 'object') return {};
  const values = (state as Record<string, unknown>).values;
  return values && !Array.isArray(values) && typeof values === 'object'
    ? values as Record<string, unknown>
    : {};
}

@Injectable()
export class WorldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: RuleCatalogRepository,
    private readonly compositions: CompositionManifestService,
  ) {}

  async listAvailableRuleSets(actor: RuleApiActor) {
    const resolved = await this.catalog.resolveActor(actor);
    const page = await this.catalog.listRuleSets(resolved, {
      lifecycle: 'active', page: 1, limit: 500,
    });
    const items = await Promise.all(page.items.map(async (ruleSet) => {
      const release = (await this.catalog.listReleases(resolved, ruleSet.id))
        .find((candidate) => candidate.lifecycle === 'published');
      return release ? {
        id: ruleSet.id,
        name: ruleSet.name,
        summary: ruleSet.summary,
        release: { id: release.id, version: release.version, publishedAt: release.publishedAt },
      } : null;
    }));
    return items.filter(Boolean);
  }

  async createWorld(actor: RuleApiActor, dto: CreateWorldDto) {
    const resolved = await this.catalog.resolveActor(actor);
    const ruleSet = await this.catalog.getRuleSet(resolved, dto.ruleSetId);
    const release = (await this.catalog.listReleases(resolved, ruleSet.id))
      .find((candidate) => candidate.lifecycle === 'published');
    if (!release || release.lifecycle !== 'published') {
      fail('WORLD_RULE_SET_RELEASE_REQUIRED', 'New worlds require the latest published ruleset release.');
    }
    const composition = await this.compositions.createComposition({
      workspaceExternalId: resolved.workspaceExternalId,
      gameplayProfileName: 'default',
      createdBy: actor.auth0Subject,
      members: [{
        ruleSetId: ruleSet.id,
        releaseId: release.id,
        releaseHash: release.contentHash,
        namespaceAlias: ruleSet.slug,
        sortOrder: 0,
      }],
    });
    const world = await this.prisma.world.create({
      data: {
        workspaceExternalId: resolved.workspaceExternalId,
        ownerSubject: actor.auth0Subject,
        name: dto.name.trim(),
        description: dto.description.trim(),
        ruleSetId: ruleSet.id,
        releaseId: release.id,
        releaseHash: release.contentHash,
      },
    });
    await this.compositions.bindCompositionToScope({
      workspaceExternalId: resolved.workspaceExternalId,
      scopeType: 'world',
      scopeId: world.id,
      gameplayProfileName: 'default',
      compositionId: composition.id,
    });
    return this.worldResource(world, ruleSet.name, release.version);
  }

  async listWorlds(actor: RuleApiActor) {
    const resolved = await this.catalog.resolveActor(actor);
    const worlds = await this.prisma.world.findMany({
      where: { workspaceExternalId: resolved.workspaceExternalId, ownerSubject: actor.auth0Subject },
      orderBy: { updatedAt: 'desc' },
    });
    return worlds.map((world) => this.worldResource(world));
  }

  async getWorld(actor: RuleApiActor, worldId: string) {
    const { world, release } = await this.worldContext(actor, worldId);
    const ruleSet = await this.catalog.getRuleSet(actor, world.ruleSetId!);
    const definitions = releaseTraitDefinitions(release);
    return {
      ...this.worldResource(world, ruleSet.name, release.version),
      createableTraits: listCreateableTraits(definitions),
      traitFilters: definitions
        .filter((definition) => definition.visibility === 'exported')
        .map((definition) => ({ id: definition.externalId, name: definition.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  async listCreateableTraits(actor: RuleApiActor, worldId: string) {
    const { release } = await this.worldContext(actor, worldId);
    return listCreateableTraits(releaseTraitDefinitions(release));
  }

  async schema(actor: RuleApiActor, worldId: string, rootTraitIds: string[], selections = {}) {
    const { release } = await this.worldContext(actor, worldId);
    return this.checkedSchema(release, rootTraitIds, selections, rootTraitIds.length === 1);
  }

  async listEntities(actor: RuleApiActor, worldId: string, query: { search?: string; traitId?: string }) {
    const { binding } = await this.worldContext(actor, worldId);
    const entities = await this.prisma.ruleInstance.findMany({
      where: {
        bindingId: binding.id,
        ...(query.traitId ? { satisfiedTraitIds: { has: query.traitId } } : {}),
      },
      include: { outgoingReferences: true, incomingReferences: true },
      orderBy: { updatedAt: 'desc' },
    });
    const search = query.search?.trim().toLocaleLowerCase();
    return entities.map((entity) => this.entityResource(entity)).filter((entity) =>
      !search || String(entity.values.name ?? '').toLocaleLowerCase().includes(search)
      || String(entity.values.description ?? '').toLocaleLowerCase().includes(search));
  }

  async getEntity(actor: RuleApiActor, worldId: string, entityId: string) {
    const { release, binding } = await this.worldContext(actor, worldId);
    const entity = await this.prisma.ruleInstance.findFirst({
      where: { id: entityId, bindingId: binding.id },
      include: {
        outgoingReferences: { include: { childEntity: true }, orderBy: { sortOrder: 'asc' } },
        incomingReferences: { include: { parentEntity: true } },
      },
    });
    if (!entity) throw new NotFoundException({ code: 'WORLD_ENTITY_NOT_FOUND', message: 'World Entity not found.' });
    const schema = buildWorldEntitySchema(
      entity.rootTraitIds,
      releaseTraitDefinitions(release),
      entity.prerequisiteSelections as Record<string, string[]>,
    );
    return { ...this.entityResource(entity), schema };
  }

  async createEntity(actor: RuleApiActor, worldId: string, dto: CreateWorldEntityDto) {
    const context = await this.worldContext(actor, worldId);
    const schema = this.checkedSchema(context.release, dto.rootTraitIds, dto.prerequisiteSelections ?? {}, true);
    return this.persistEntity(context.binding.id, actor.auth0Subject, schema, dto.values);
  }

  async updateEntity(actor: RuleApiActor, worldId: string, entityId: string, dto: UpdateWorldEntityDto) {
    const context = await this.worldContext(actor, worldId);
    const current = await this.entity(context.binding.id, entityId);
    const schema = this.checkedSchema(
      context.release,
      current.rootTraitIds,
      dto.prerequisiteSelections ?? current.prerequisiteSelections as Record<string, string[]>,
      current.rootTraitIds.length === 1,
    );
    const normalized = normalizeAndValidateValues(schema, dto.values);
    if (normalized.diagnostics.length) {
      fail('WORLD_ENTITY_INVALID', 'The World Entity does not satisfy its trait schema.', normalized.diagnostics);
    }
    const entity = await this.prisma.ruleInstance.update({
      where: { id: current.id },
      data: {
        state: { values: normalized.values },
        prerequisiteSelections: schema.prerequisiteSelections,
        satisfiedTraitIds: schema.satisfiedTraitIds,
        migrationStatus: 'current',
        migrationDiagnostics: [],
        retainedValues: {},
        stateVersion: { increment: 1 },
      },
    });
    return this.entityResource(entity);
  }

  async deleteEntity(actor: RuleApiActor, worldId: string, entityId: string) {
    const { binding } = await this.worldContext(actor, worldId);
    await this.entity(binding.id, entityId);
    const referenced = await this.prisma.worldEntityReference.count({ where: { childEntityId: entityId } });
    if (referenced) {
      throw new ConflictException({
        code: 'WORLD_ENTITY_REFERENCED',
        message: `Remove ${referenced} reference${referenced === 1 ? '' : 's'} before deleting this World Entity.`,
        retryable: false,
      });
    }
    await this.prisma.ruleInstance.delete({ where: { id: entityId } });
    return { deleted: true, id: entityId };
  }

  async addReference(
    actor: RuleApiActor,
    worldId: string,
    parentId: string,
    collectionPath: string,
    dto: AddWorldEntityReferenceDto,
  ) {
    const context = await this.worldContext(actor, worldId);
    const [parent, child] = await Promise.all([
      this.entity(context.binding.id, parentId),
      this.entity(context.binding.id, dto.childEntityId),
    ]);
    const parentSchema = buildWorldEntitySchema(
      parent.rootTraitIds,
      releaseTraitDefinitions(context.release),
      parent.prerequisiteSelections as Record<string, string[]>,
    );
    const collection = schemaCollections(parentSchema).find((node) => node.path.join('.') === collectionPath);
    if (!collection) fail('WORLD_ENTITY_COLLECTION_NOT_FOUND', `Collection '${collectionPath}' is not in the parent schema.`);
    const count = await this.prisma.worldEntityReference.count({
      where: { parentEntityId: parent.id, collectionPath },
    });
    if (collection.capacity !== undefined && count >= collection.capacity) {
      fail('WORLD_ENTITY_COLLECTION_FULL', `${collection.label} has reached its capacity.`);
    }
    const map = dto.implementationMap ?? {};
    this.validateCollectionImplementation(
      collection,
      child.rootTraitIds,
      releaseTraitDefinitions(context.release),
      map,
    );
    const reference = await this.prisma.worldEntityReference.create({
      data: {
        bindingId: context.binding.id,
        parentEntityId: parent.id,
        childEntityId: child.id,
        collectionPath,
        sortOrder: count,
        implementationMap: map,
      },
    });
    return reference;
  }

  async collectionOptions(
    actor: RuleApiActor,
    worldId: string,
    parentId: string,
    collectionPath: string,
  ) {
    const context = await this.worldContext(actor, worldId);
    const parent = await this.entity(context.binding.id, parentId);
    const definitions = releaseTraitDefinitions(context.release);
    const parentSchema = buildWorldEntitySchema(
      parent.rootTraitIds,
      definitions,
      parent.prerequisiteSelections as Record<string, string[]>,
    );
    const collection = schemaCollections(parentSchema).find((node) => node.path.join('.') === collectionPath);
    if (!collection) fail('WORLD_ENTITY_COLLECTION_NOT_FOUND', `Collection '${collectionPath}' is not in the parent schema.`);
    const createable = listCreateableTraits(definitions);
    const optionsFor = (acceptedTraitId: string) => createable.filter((candidate) =>
      traitClosure([candidate.id], definitions).includes(acceptedTraitId));
    return collection.acceptsMode === 'all'
      ? {
        collection,
        groups: collection.acceptedTraitIds.map((acceptedTraitId) => ({
          acceptedTraitId,
          options: optionsFor(acceptedTraitId),
        })),
      }
      : {
        collection,
        options: createable.filter((candidate) => collection.acceptedTraitIds.some((acceptedTraitId) =>
          traitClosure([candidate.id], definitions).includes(acceptedTraitId))),
      };
  }

  async createCollectionEntity(
    actor: RuleApiActor,
    worldId: string,
    parentId: string,
    collectionPath: string,
    dto: CreateWorldEntityDto & { implementationMap?: Record<string, string> },
  ) {
    const context = await this.worldContext(actor, worldId);
    const parent = await this.entity(context.binding.id, parentId);
    const definitions = releaseTraitDefinitions(context.release);
    const parentSchema = buildWorldEntitySchema(
      parent.rootTraitIds,
      definitions,
      parent.prerequisiteSelections as Record<string, string[]>,
    );
    const collection = schemaCollections(parentSchema).find((node) => node.path.join('.') === collectionPath);
    if (!collection) fail('WORLD_ENTITY_COLLECTION_NOT_FOUND', `Collection '${collectionPath}' is not in the parent schema.`);
    const schema = this.checkedSchema(
      context.release,
      dto.rootTraitIds,
      dto.prerequisiteSelections ?? {},
      collection.acceptsMode !== 'all',
    );
    const implementationMap = dto.implementationMap ?? {};
    this.validateCollectionImplementation(collection, schema.rootTraitIds, definitions, implementationMap);
    const normalized = normalizeAndValidateValues(schema, dto.values);
    if (normalized.diagnostics.length) fail('WORLD_ENTITY_INVALID', 'The World Entity does not satisfy its trait schema.', normalized.diagnostics);
    const count = await this.prisma.worldEntityReference.count({
      where: { parentEntityId: parent.id, collectionPath },
    });
    if (collection.capacity !== undefined && count >= collection.capacity) {
      fail('WORLD_ENTITY_COLLECTION_FULL', `${collection.label} has reached its capacity.`);
    }
    const result = await this.prisma.$transaction(async (transaction) => {
      const entity = await transaction.ruleInstance.create({
        data: {
          bindingId: context.binding.id,
          typeId: schema.rootTraitIds[0],
          rootTraitIds: schema.rootTraitIds,
          satisfiedTraitIds: schema.satisfiedTraitIds,
          prerequisiteSelections: schema.prerequisiteSelections,
          state: { values: normalized.values },
          createdBy: actor.auth0Subject,
        },
      });
      const reference = await transaction.worldEntityReference.create({
        data: {
          bindingId: context.binding.id,
          parentEntityId: parent.id,
          childEntityId: entity.id,
          collectionPath,
          sortOrder: count,
          implementationMap,
        },
      });
      return { entity, reference };
    });
    return { entity: this.entityResource(result.entity), reference: result.reference };
  }

  async removeReference(actor: RuleApiActor, worldId: string, parentId: string, referenceId: string) {
    const { binding } = await this.worldContext(actor, worldId);
    await this.entity(binding.id, parentId);
    const reference = await this.prisma.worldEntityReference.findFirst({
      where: { id: referenceId, bindingId: binding.id, parentEntityId: parentId },
    });
    if (!reference) throw new NotFoundException({ code: 'WORLD_ENTITY_REFERENCE_NOT_FOUND' });
    await this.prisma.worldEntityReference.delete({ where: { id: reference.id } });
    return { deleted: true, id: reference.id, childEntityId: reference.childEntityId };
  }

  async upgrade(actor: RuleApiActor, worldId: string) {
    const context = await this.worldContext(actor, worldId);
    const releases = await this.catalog.listReleases(actor, context.world.ruleSetId!);
    const latest = releases.find((candidate) => candidate.lifecycle === 'published');
    if (!latest || latest.id === context.release.id) return { upgraded: false, world: this.worldResource(context.world) };
    const ruleSet = await this.catalog.getRuleSet(actor, context.world.ruleSetId!);
    const resolved = await this.catalog.resolveActor(actor);
    const composition = await this.compositions.createComposition({
      workspaceExternalId: resolved.workspaceExternalId,
      gameplayProfileName: 'default',
      createdBy: actor.auth0Subject,
      members: [{
        ruleSetId: ruleSet.id,
        releaseId: latest.id,
        releaseHash: latest.contentHash,
        namespaceAlias: ruleSet.slug,
        sortOrder: 0,
      }],
    });
    // The binding changes first: all subsequent reads use the new schema even
    // if an individual entity needs manual repair.
    await this.compositions.bindCompositionToScope({
      workspaceExternalId: resolved.workspaceExternalId,
      scopeType: 'world', scopeId: worldId, gameplayProfileName: 'default', compositionId: composition.id,
    });
    await this.prisma.world.update({
      where: { id: worldId },
      data: { releaseId: latest.id, releaseHash: latest.contentHash },
    });
    const definitions = releaseTraitDefinitions(latest);
    const entities = await this.prisma.ruleInstance.findMany({ where: { bindingId: context.binding.id } });
    const results = [];
    for (const entity of entities) {
      const selections = entity.prerequisiteSelections as Record<string, string[]>;
      const schema = buildWorldEntitySchema(entity.rootTraitIds, definitions, selections);
      const priorValues = stateValues(entity.state);
      const normalized = normalizeAndValidateValues(schema, priorValues);
      const rootMissing = entity.rootTraitIds.filter((id) => !definitions.some((definition) => definition.externalId === id));
      const diagnostics = [
        ...rootMissing.map((id) => ({ code: 'ROOT_TRAIT_REMOVED', message: `Trait '${id}' is not in the new release.` })),
        ...normalized.diagnostics,
      ];
      const updated = await this.prisma.ruleInstance.update({
        where: { id: entity.id },
        data: {
          state: { values: normalized.values },
          satisfiedTraitIds: schema.satisfiedTraitIds,
          migrationStatus: diagnostics.length ? 'needs_attention' : 'current',
          migrationDiagnostics: diagnostics,
          retainedValues: normalized.retainedValues as Prisma.InputJsonValue,
          stateVersion: { increment: 1 },
        },
      });
      results.push(this.entityResource(updated));
    }
    const references = await this.prisma.worldEntityReference.findMany({
      where: { bindingId: context.binding.id },
      include: { parentEntity: true, childEntity: true },
      orderBy: [{ parentEntityId: 'asc' }, { collectionPath: 'asc' }, { sortOrder: 'asc' }],
    });
    const referenceDiagnostics = new Map<string, Array<{ code: string; path: string; message: string }>>();
    const groupedReferences = new Map<string, typeof references>();
    for (const reference of references) {
      const key = `${reference.parentEntityId}\u0000${reference.collectionPath}`;
      groupedReferences.set(key, [...(groupedReferences.get(key) ?? []), reference]);
    }
    for (const group of groupedReferences.values()) {
      const first = group[0];
      const parentSchema = buildWorldEntitySchema(
        first.parentEntity.rootTraitIds,
        definitions,
        first.parentEntity.prerequisiteSelections as Record<string, string[]>,
      );
      const collection = schemaCollections(parentSchema).find((node) =>
        node.path.join('.') === first.collectionPath);
      const diagnostics = referenceDiagnostics.get(first.parentEntityId) ?? [];
      if (!collection) {
        diagnostics.push({
          code: 'COLLECTION_REMOVED',
          path: first.collectionPath,
          message: `Referenced collection '${first.collectionPath}' is not present in the new release.`,
        });
      } else {
        if (collection.capacity !== undefined && group.length > collection.capacity) {
          diagnostics.push({
            code: 'COLLECTION_CAPACITY_EXCEEDED',
            path: first.collectionPath,
            message: `${collection.label} contains ${group.length} references but now allows ${collection.capacity}.`,
          });
        }
        for (const reference of group) {
          try {
            this.validateCollectionImplementation(
              collection,
              reference.childEntity.rootTraitIds,
              definitions,
              reference.implementationMap as Record<string, string>,
            );
          } catch (error) {
            const response = error instanceof BadRequestException ? error.getResponse() : undefined;
            diagnostics.push({
              code: 'COLLECTION_REFERENCE_INVALID',
              path: first.collectionPath,
              message: typeof response === 'object' && response && 'message' in response
                ? String(response.message)
                : 'A referenced World Entity no longer satisfies this collection.',
            });
          }
        }
      }
      if (diagnostics.length) referenceDiagnostics.set(first.parentEntityId, diagnostics);
    }
    for (const [parentEntityId, diagnostics] of referenceDiagnostics) {
      const current = await this.prisma.ruleInstance.findUnique({ where: { id: parentEntityId } });
      if (!current) continue;
      const existing = Array.isArray(current.migrationDiagnostics)
        ? current.migrationDiagnostics as Array<Record<string, unknown>>
        : [];
      const updated = await this.prisma.ruleInstance.update({
        where: { id: parentEntityId },
        data: {
          migrationStatus: 'needs_attention',
          migrationDiagnostics: [...existing, ...diagnostics] as Prisma.InputJsonValue,
        },
      });
      const index = results.findIndex((entity) => entity.id === parentEntityId);
      if (index >= 0) results[index] = this.entityResource(updated);
    }
    return {
      upgraded: true,
      release: { id: latest.id, version: latest.version },
      migrated: results.filter((entity) => entity.migrationStatus === 'current').length,
      needsAttention: results.filter((entity) => entity.migrationStatus === 'needs_attention').length,
    };
  }

  private async worldContext(actor: RuleApiActor, worldId: string) {
    const resolved = await this.catalog.resolveActor(actor);
    const world = await this.prisma.world.findFirst({
      where: { id: worldId, workspaceExternalId: resolved.workspaceExternalId, ownerSubject: actor.auth0Subject },
    });
    if (!world || !world.ruleSetId || !world.releaseId) {
      throw new NotFoundException({ code: 'WORLD_NOT_FOUND', message: 'World not found.' });
    }
    const binding = await this.prisma.ruleSetBinding.findUnique({
      where: { scopeType_scopeId_gameplayProfileName: { scopeType: 'world', scopeId: world.id, gameplayProfileName: 'default' } },
    });
    if (!binding) throw new NotFoundException({ code: 'WORLD_RULE_BINDING_NOT_FOUND' });
    const release = await this.catalog.getRelease(resolved, world.releaseId);
    if (release.ruleSetId !== world.ruleSetId) fail('WORLD_RELEASE_INVALID', 'The bound release does not belong to this ruleset.');
    return { resolved, world, binding, release };
  }

  private checkedSchema(
    release: RuleReleaseResource,
    rootTraitIds: string[],
    selections: Record<string, string[]>,
    requireSingleRoot: boolean,
  ): WorldEntitySchema {
    if (!rootTraitIds.length || (requireSingleRoot && rootTraitIds.length !== 1)) {
      fail('WORLD_ENTITY_ROOT_TRAIT_INVALID', 'Top-level World Entities require exactly one createable trait.');
    }
    const definitions = releaseTraitDefinitions(release);
    const createable = new Set(listCreateableTraits(definitions).map((trait) => trait.id));
    const invalidRoots = rootTraitIds.filter((id) => !createable.has(id));
    if (invalidRoots.length) fail('WORLD_ENTITY_TRAIT_NOT_CREATEABLE', 'Every root must be an exported createable trait.', invalidRoots);
    const schema = buildWorldEntitySchema(rootTraitIds, definitions, selections);
    const unselected = rootTraitIds.flatMap((root) => {
      const trait = listCreateableTraits(definitions).find((candidate) => candidate.id === root);
      return (trait?.prerequisiteChoices ?? []).filter((choice) => !selections[choice.traitId]?.length);
    });
    if (unselected.length) fail('WORLD_ENTITY_PREREQUISITE_SELECTION_REQUIRED', 'Choose each any-prerequisite before creating the entity.', unselected);
    return schema;
  }

  private async persistEntity(bindingId: string, actorId: string, schema: WorldEntitySchema, input: Record<string, unknown>) {
    const normalized = normalizeAndValidateValues(schema, input);
    if (normalized.diagnostics.length) fail('WORLD_ENTITY_INVALID', 'The World Entity does not satisfy its trait schema.', normalized.diagnostics);
    const entity = await this.prisma.ruleInstance.create({
      data: {
        bindingId,
        typeId: schema.rootTraitIds[0],
        rootTraitIds: schema.rootTraitIds,
        satisfiedTraitIds: schema.satisfiedTraitIds,
        prerequisiteSelections: schema.prerequisiteSelections,
        state: { values: normalized.values },
        createdBy: actorId,
      },
    });
    return this.entityResource(entity);
  }

  private async entity(bindingId: string, entityId: string): Promise<NonNullable<EntityRecord>> {
    const entity = await this.prisma.ruleInstance.findFirst({ where: { id: entityId, bindingId } });
    if (!entity) throw new NotFoundException({ code: 'WORLD_ENTITY_NOT_FOUND', message: 'World Entity not found.' });
    return entity;
  }

  private validateCollectionImplementation(
    collection: ReturnType<typeof schemaCollections>[number],
    roots: string[],
    definitions: ReturnType<typeof releaseTraitDefinitions>,
    implementationMap: Record<string, string>,
  ): void {
    if (collection.acceptsMode === 'any') {
      if (!collection.acceptedTraitIds.some((id) =>
        roots.some((root) => traitClosure([root], definitions).includes(id)))) {
        fail('WORLD_ENTITY_COLLECTION_CONSTRAINT', 'The child does not satisfy an accepted trait.');
      }
      return;
    }
    const keys = Object.keys(implementationMap).sort();
    const accepted = [...collection.acceptedTraitIds].sort();
    const mappedRoots = Object.values(implementationMap);
    if (JSON.stringify(keys) !== JSON.stringify(accepted)
      || new Set(mappedRoots).size !== mappedRoots.length
      || mappedRoots.some((root) => !roots.includes(root))
      || JSON.stringify([...mappedRoots].sort()) !== JSON.stringify([...roots].sort())) {
      fail('WORLD_ENTITY_IMPLEMENTATION_MAP_INVALID', 'Each required trait must map to a different explicit root implementation.');
    }
    for (const [acceptedTrait, root] of Object.entries(implementationMap)) {
      if (!traitClosure([root], definitions).includes(acceptedTrait)) {
        fail('WORLD_ENTITY_IMPLEMENTATION_MAP_INVALID', `Root '${root}' does not implement '${acceptedTrait}'.`);
      }
    }
  }

  private worldResource(world: any, ruleSetName?: string, releaseVersion?: string) {
    return {
      id: world.id,
      name: world.name,
      description: world.description,
      ruleSetId: world.ruleSetId,
      releaseId: world.releaseId,
      releaseHash: world.releaseHash,
      ...(ruleSetName ? { ruleSetName } : {}),
      ...(releaseVersion ? { releaseVersion } : {}),
      createdAt: world.createdAt,
      updatedAt: world.updatedAt,
    };
  }

  private entityResource(entity: any) {
    const outgoingReferences = entity.outgoingReferences?.map((reference: any) => ({
      id: reference.id,
      parentEntityId: reference.parentEntityId,
      childEntityId: reference.childEntityId,
      collectionPath: reference.collectionPath,
      sortOrder: reference.sortOrder,
      implementationMap: reference.implementationMap,
      ...(reference.childEntity ? { childEntity: this.entityResource(reference.childEntity) } : {}),
    }));
    const incomingReferences = entity.incomingReferences?.map((reference: any) => ({
      id: reference.id,
      parentEntityId: reference.parentEntityId,
      childEntityId: reference.childEntityId,
      collectionPath: reference.collectionPath,
      implementationMap: reference.implementationMap,
      ...(reference.parentEntity ? { parentEntity: this.entityResource(reference.parentEntity) } : {}),
    }));
    return {
      id: entity.id,
      rootTraitIds: entity.rootTraitIds,
      satisfiedTraitIds: entity.satisfiedTraitIds,
      prerequisiteSelections: entity.prerequisiteSelections,
      values: stateValues(entity.state),
      migrationStatus: entity.migrationStatus,
      migrationDiagnostics: entity.migrationDiagnostics,
      retainedValues: entity.retainedValues,
      ...(outgoingReferences ? { outgoingReferences } : {}),
      ...(incomingReferences ? { incomingReferences } : {}),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
