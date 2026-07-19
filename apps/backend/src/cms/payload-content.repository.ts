import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ActorContext, ContentRepository, WorldContent } from './content.repository';

@Injectable()
export class PayloadContentRepository implements ContentRepository {
  private readonly baseUrl = process.env.CMS_BASE_URL || 'http://cms:3000';
  private readonly internalToken = process.env.CMS_INTERNAL_TOKEN || '';

  async getWorld(id: number, actor: ActorContext): Promise<WorldContent> {
    const response = await fetch(`${this.baseUrl}/api/worlds/${id}?depth=1`, {
      headers: {
        'x-auth0-sub': actor.auth0Subject,
        'x-cms-internal-token': this.internalToken,
      },
      signal: AbortSignal.timeout(5_000),
    }).catch((error: unknown) => {
      throw new ServiceUnavailableException('CMS request failed', { cause: error });
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(`CMS returned HTTP ${response.status}`);
    }

    const world = await response.json() as WorldContent;
    return {
      body: world.body,
      externalId: world.externalId,
      id: world.id,
      summary: world.summary,
      title: world.title,
    };
  }
}
