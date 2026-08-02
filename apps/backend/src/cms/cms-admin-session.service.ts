import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';

import type { RuleApiActor } from '../rules/api/rule-api-actor';

interface AdminSsoTicketClaims {
  aud: 'payload-admin';
  email?: string;
  exp: number;
  iat: number;
  iss: 'wanderlust-api';
  jti: string;
  sub: string;
}

@Injectable()
export class CmsAdminSessionService {
  createTicket(actor: RuleApiActor): string {
    const secret = process.env.CMS_INTERNAL_TOKEN?.trim();
    if (!secret) {
      throw new ServiceUnavailableException({
        code: 'CMS_ADMIN_NOT_CONFIGURED',
        message: 'Content-management sign-in is not configured.',
        retryable: false,
      });
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const claims: AdminSsoTicketClaims = {
      aud: 'payload-admin',
      ...(actor.email ? { email: actor.email } : {}),
      exp: issuedAt + 30,
      iat: issuedAt,
      iss: 'wanderlust-api',
      jti: randomUUID(),
      sub: actor.auth0Subject,
    };
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', secret).update(encodedClaims).digest('base64url');
    return `${encodedClaims}.${signature}`;
  }
}
