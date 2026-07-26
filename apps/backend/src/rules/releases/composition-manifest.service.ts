import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type CompositionMemberInput = {
  ruleSetId: number;
  releaseId: number;
  releaseHash: string;
  namespaceAlias: string;
  sortOrder: number;
  policy?: Record<string, unknown>;
};

export type CreateCompositionManifestInput = {
  workspaceExternalId: string;
  gameplayProfileName: string;
  members: CompositionMemberInput[];
  createdBy: string;
};

@Injectable()
export class CompositionManifestService {
  constructor(private readonly prisma: PrismaService) {}

  computeCompositionHash(members: CompositionMemberInput[]): string {
    const sorted = [...members].sort((a, b) => a.sortOrder - b.sortOrder);
    const payload = JSON.stringify(
      sorted.map((m) => ({
        ruleSetId: m.ruleSetId,
        releaseId: m.releaseId,
        releaseHash: m.releaseHash,
        namespaceAlias: m.namespaceAlias,
        sortOrder: m.sortOrder,
        policy: m.policy ?? {},
      })),
    );
    return createHash('sha256').update(payload).digest('hex');
  }

  async createComposition(input: CreateCompositionManifestInput) {
    if (!input.members.length) {
      throw new BadRequestException({
        code: 'COMPOSITION_MEMBERS_EMPTY',
        message: 'A composition manifest must include at least one rule-set release member.',
        retryable: false,
      });
    }

    // Verify unique namespace aliases and sort orders
    const aliases = new Set<string>();
    const sortOrders = new Set<number>();
    for (const member of input.members) {
      if (aliases.has(member.namespaceAlias)) {
        throw new BadRequestException({
          code: 'COMPOSITION_ALIAS_DUPLICATE',
          message: `Duplicate namespace alias '${member.namespaceAlias}' in composition manifest.`,
          retryable: false,
        });
      }
      if (sortOrders.has(member.sortOrder)) {
        throw new BadRequestException({
          code: 'COMPOSITION_SORT_ORDER_DUPLICATE',
          message: `Duplicate sort order '${member.sortOrder}' in composition manifest.`,
          retryable: false,
        });
      }
      aliases.add(member.namespaceAlias);
      sortOrders.add(member.sortOrder);
    }

    const orderedMembers = [...input.members].sort((a, b) => a.sortOrder - b.sortOrder);
    const compositionHash = this.computeCompositionHash(orderedMembers);
    const compositionKey = {
      workspaceExternalId_compositionHash: {
        workspaceExternalId: input.workspaceExternalId,
        compositionHash,
      },
    };
    const manifest = {
      profileName: input.gameplayProfileName,
      members: orderedMembers,
    };

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.ruleSetComposition.findUnique({
          where: compositionKey,
        });
        if (existing) {
          return existing;
        }

        return transaction.ruleSetComposition.create({
          data: {
            workspaceExternalId: input.workspaceExternalId,
            compositionHash,
            manifest: manifest as any,
            engineVersion: '1.0.0',
            compilerVersion: '1.0.0',
            validationSummary: { status: 'valid', memberCount: orderedMembers.length },
            createdBy: input.createdBy,
            members: {
              create: orderedMembers.map((member) => ({
                ruleSetId: member.ruleSetId,
                releaseId: member.releaseId,
                releaseHash: member.releaseHash,
                namespaceAlias: member.namespaceAlias,
                sortOrder: member.sortOrder,
                policy: (member.policy ?? {}) as any,
              })),
            },
          },
        });
      });
    } catch (error) {
      // Concurrent identical requests can both miss the first lookup. The
      // database uniqueness constraint selects the winner; return it so this
      // content-addressed operation remains idempotent.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.ruleSetComposition.findUnique({
          where: compositionKey,
        });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async bindCompositionToScope(input: {
    workspaceExternalId: string;
    scopeType: 'world' | 'campaign' | 'session';
    scopeId: string;
    gameplayProfileName: string;
    compositionId: string;
  }) {
    const composition = await this.prisma.ruleSetComposition.findUnique({
      where: { id: input.compositionId },
    });
    if (!composition) {
      throw new BadRequestException({
        code: 'COMPOSITION_NOT_FOUND',
        message: `Composition '${input.compositionId}' not found.`,
        retryable: false,
      });
    }

    return this.prisma.ruleSetBinding.upsert({
      where: {
        scopeType_scopeId_gameplayProfileName: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          gameplayProfileName: input.gameplayProfileName,
        },
      },
      create: {
        workspaceExternalId: input.workspaceExternalId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        gameplayProfileName: input.gameplayProfileName,
        compositionId: composition.id,
        compositionHash: composition.compositionHash,
        active: true,
        status: 'active',
      },
      update: {
        compositionId: composition.id,
        compositionHash: composition.compositionHash,
        active: true,
        status: 'active',
      },
    });
  }
}
