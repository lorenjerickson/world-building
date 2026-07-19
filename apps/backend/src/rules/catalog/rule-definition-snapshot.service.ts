import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RuleDefinitionSnapshot } from '../persistence/rule-set.entities';
import type { RuleDefinitionSnapshotResource } from './rule-catalog.types';

const MAX_SNAPSHOTS_PER_DEFINITION = 50;

@Injectable()
export class RuleDefinitionSnapshotService {
  private readonly repo: Repository<RuleDefinitionSnapshot>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(RuleDefinitionSnapshot);
  }

  async capture(input: {
    ruleSetId: number;
    definitionId: number;
    definitionExternalId: string;
    name: string;
    body: Record<string, unknown>;
    actorId: string;
    reason: RuleDefinitionSnapshot['reason'];
  }): Promise<void> {
    await this.repo.insert({
      actorId: input.actorId,
      body: input.body,
      definitionExternalId: input.definitionExternalId,
      definitionId: input.definitionId,
      name: input.name,
      reason: input.reason,
      ruleSetId: input.ruleSetId,
    });

    // Prune to keep at most MAX_SNAPSHOTS_PER_DEFINITION per definition
    const oldest = await this.repo.find({
      where: { definitionId: input.definitionId },
      order: { createdAt: 'DESC' },
      skip: MAX_SNAPSHOTS_PER_DEFINITION,
      take: 1000,
      select: ['id'],
    });
    if (oldest.length > 0) {
      await this.repo.delete(oldest.map((s) => s.id));
    }
  }

  async list(ruleSetId: number, definitionId: number): Promise<RuleDefinitionSnapshotResource[]> {
    const snapshots = await this.repo.find({
      where: { ruleSetId, definitionId },
      order: { createdAt: 'DESC' },
      take: MAX_SNAPSHOTS_PER_DEFINITION,
    });
    return snapshots.map((s) => this.map(s));
  }

  async getWithBody(snapshotId: string): Promise<{ resource: RuleDefinitionSnapshotResource; body: Record<string, unknown>; name: string } | null> {
    const snapshot = await this.repo.findOne({ where: { id: snapshotId } });
    if (!snapshot) return null;
    return { resource: this.map(snapshot), body: snapshot.body, name: snapshot.name };
  }

  private map(s: RuleDefinitionSnapshot): RuleDefinitionSnapshotResource {
    return {
      id: s.id,
      definitionId: s.definitionId,
      name: s.name,
      reason: s.reason,
      actorId: s.actorId,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
