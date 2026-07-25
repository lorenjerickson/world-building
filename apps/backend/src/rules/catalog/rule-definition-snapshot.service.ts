import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { RuleDefinitionSnapshotResource } from './rule-catalog.types';

const MAX_SNAPSHOTS_PER_DEFINITION = 50;

@Injectable()
export class RuleDefinitionSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async capture(input: {
    ruleSetId: number;
    definitionId: number;
    definitionExternalId: string;
    name: string;
    body: Record<string, unknown>;
    actorId: string;
    reason: 'autosave' | 'manual' | 'restore' | 'import';
  }): Promise<void> {
    await this.prisma.ruleDefinitionSnapshot.create({
      data: {
        actorId: input.actorId,
        body: input.body as any,
        definitionExternalId: input.definitionExternalId,
        definitionId: input.definitionId,
        name: input.name,
        reason: input.reason,
        ruleSetId: input.ruleSetId,
      },
    });

    const oldest = await this.prisma.ruleDefinitionSnapshot.findMany({
      where: { definitionId: input.definitionId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SNAPSHOTS_PER_DEFINITION,
      take: 1000,
      select: { id: true },
    });
    if (oldest.length > 0) {
      await this.prisma.ruleDefinitionSnapshot.deleteMany({
        where: { id: { in: oldest.map((s) => s.id) } },
      });
    }
  }

  async list(ruleSetId: number, definitionId: number): Promise<RuleDefinitionSnapshotResource[]> {
    const snapshots = await this.prisma.ruleDefinitionSnapshot.findMany({
      where: { ruleSetId, definitionId },
      orderBy: { createdAt: 'desc' },
      take: MAX_SNAPSHOTS_PER_DEFINITION,
    });
    return snapshots.map((s) => this.map(s));
  }

  async getWithBody(snapshotId: string): Promise<{ resource: RuleDefinitionSnapshotResource; body: Record<string, unknown>; name: string } | null> {
    const snapshot = await this.prisma.ruleDefinitionSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot) return null;
    return { resource: this.map(snapshot), body: snapshot.body as Record<string, unknown>, name: snapshot.name };
  }

  private map(s: any): RuleDefinitionSnapshotResource {
    return {
      id: s.id,
      definitionId: s.definitionId,
      name: s.name,
      reason: s.reason,
      actorId: s.actorId,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : new Date(s.createdAt).toISOString(),
    };
  }
}
