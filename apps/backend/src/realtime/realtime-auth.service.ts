import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type RealtimePrincipal = {
  sub: string;
  scope?: string;
};

@Injectable()
export class RealtimeAuthService {
  private readonly issuer = (process.env.AUTH0_ISSUER_BASE_URL || '').replace(/\/$/, '');
  private readonly audience = process.env.AUTH0_AUDIENCE || '';
  private readonly jwks = this.issuer
    ? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`))
    : null;

  async verifyBearerToken(token: string): Promise<RealtimePrincipal> {
    if (!token?.trim()) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    if (!this.issuer || !this.audience || !this.jwks) {
      throw new UnauthorizedException('Realtime Auth0 verifier is not configured.');
    }

    const verified = await jwtVerify(token, this.jwks, {
      audience: this.audience,
      issuer: this.issuer,
    }).catch(() => {
      throw new UnauthorizedException('Invalid bearer token.');
    });

    const sub = String(verified.payload.sub || '').trim();
    if (!sub) throw new UnauthorizedException('Bearer token subject is missing.');
    return {
      sub,
      ...(typeof verified.payload.scope === 'string' ? { scope: verified.payload.scope } : {}),
    };
  }
}