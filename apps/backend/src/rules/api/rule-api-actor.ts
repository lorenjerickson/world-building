import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export interface RuleApiActor {
  auth0Subject: string;
  email?: string;
}

type RuleApiRequest = Request & { ruleApiActor?: RuleApiActor };

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class RuleApiActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RuleApiRequest>();
    const subject = headerValue(request, 'x-auth0-sub')?.trim();
    if (!subject) {
      throw new UnauthorizedException({
        code: 'RULE_AUTH_REQUIRED',
        message: 'An authenticated rule-set actor is required.',
        retryable: false,
      });
    }

    const internalToken = process.env.RULE_API_INTERNAL_TOKEN?.trim();
    if (!internalToken) {
      throw new ServiceUnavailableException({
        code: 'RULE_API_NOT_CONFIGURED',
        message: 'The rule-set API trust boundary is not configured.',
        retryable: false,
      });
    }
    const suppliedToken = headerValue(request, 'x-rule-api-token') ?? '';
    if (!safeEqual(suppliedToken, internalToken)) {
      throw new UnauthorizedException({
        code: 'RULE_TRUST_BOUNDARY_REJECTED',
        message: 'The request did not originate from the trusted application gateway.',
        retryable: false,
      });
    }

    const suppliedEmail = headerValue(request, 'x-auth0-email')?.trim().toLowerCase();
    const email = suppliedEmail && suppliedEmail.length <= 320 ? suppliedEmail : undefined;
    request.ruleApiActor = {
      auth0Subject: subject,
      ...(email ? { email } : {}),
    };
    return true;
  }
}

export const CurrentRuleActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RuleApiActor => {
    const request = context.switchToHttp().getRequest<RuleApiRequest>();
    if (!request.ruleApiActor) {
      throw new UnauthorizedException({
        code: 'RULE_AUTH_REQUIRED',
        message: 'An authenticated rule-set actor is required.',
        retryable: false,
      });
    }
    return request.ruleApiActor;
  },
);
