import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface SearchDocumentInput {
  recordType: string;
  recordId: string;
  title: string;
  summary: string;
  href: string;
  searchableText: string;
}

export interface SearchResult {
  recordType: string;
  recordId: string;
  title: string;
  summary: string;
  href: string;
  rank: number;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async replaceActorIndex(actorId: string, input: unknown): Promise<{ indexed: number }> {
    if (!Array.isArray(input) || input.length > 5_000) {
      throw new BadRequestException('The search index request is too large.');
    }

    const documents = input.map((candidate, index) => this.parseDocument(candidate, index));
    const unique = new Map(documents.map((document) => [
      `${document.recordType}:${document.recordId}`,
      document,
    ]));

    await this.prisma.$transaction([
      this.prisma.searchDocument.deleteMany({ where: { actorId } }),
      this.prisma.searchDocument.createMany({
        data: [...unique.values()].map((document) => ({ actorId, ...document })),
      }),
    ]);
    return { indexed: unique.size };
  }

  async search(actorId: string, rawQuery: string): Promise<SearchResult[]> {
    const query = rawQuery.trim().slice(0, 120);
    if (query.length < 2) return [];

    return this.prisma.$queryRaw<SearchResult[]>(Prisma.sql`
      WITH search_query AS (
        SELECT websearch_to_tsquery('english', ${query}) AS query
      )
      SELECT
        document."recordType",
        document."recordId",
        document."title",
        document."summary",
        document."href",
        ts_rank_cd(document."searchVector", search_query.query)::float AS rank
      FROM "search_documents" AS document
      CROSS JOIN search_query
      WHERE document."actorId" = ${actorId}
        AND document."searchVector" @@ search_query.query
      ORDER BY rank DESC, document."title" ASC
      LIMIT 30
    `);
  }

  private parseDocument(candidate: unknown, index: number): SearchDocumentInput {
    if (!candidate || typeof candidate !== 'object') {
      throw new BadRequestException(`Search document ${index + 1} is invalid.`);
    }
    const value = candidate as Record<string, unknown>;
    const recordType = this.requiredText(value.recordType, 80);
    const recordId = this.requiredText(value.recordId, 180);
    const title = this.requiredText(value.title, 500);
    const href = this.requiredText(value.href, 1_000);
    if (!href.startsWith('/')) {
      throw new BadRequestException(`Search document ${index + 1} has an invalid destination.`);
    }
    return {
      recordType,
      recordId,
      title,
      href,
      summary: this.optionalText(value.summary, 4_000),
      searchableText: this.optionalText(value.searchableText, 20_000),
    };
  }

  private requiredText(value: unknown, maximum: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
      throw new BadRequestException('A search document contains an invalid required field.');
    }
    return value.trim();
  }

  private optionalText(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.slice(0, maximum).trim() : '';
  }
}
