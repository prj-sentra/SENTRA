import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_ROUTE_KEY, PublicRoute } from './public-route.decorator';
import { readSessionCookie, SessionService } from './session.service';

const PUBLIC_ENDPOINTS: Record<PublicRoute, readonly [string, string]> = {
  [PublicRoute.HEALTH]: ['GET', '/health'], [PublicRoute.SIGNUP]: ['POST', '/auth/signup'], [PublicRoute.LOGIN]: ['POST', '/auth/login'],
};

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const expected = process.env.WEB_ORIGIN;
    if (!expected || request.headers.origin !== expected) throw new ForbiddenException('Forbidden origin');
    return true;
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: SessionService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown; sessionId?: string }>();
    const publicRoute = this.reflector.getAllAndOverride<PublicRoute | undefined>(PUBLIC_ROUTE_KEY, [context.getHandler(), context.getClass()]);
    if (publicRoute) {
      const endpoint = PUBLIC_ENDPOINTS[publicRoute];
      if (!endpoint || request.method !== endpoint[0] || request.path !== endpoint[1]) throw new Error('Invalid public route declaration');
      return true;
    }
    const token = readSessionCookie(request.headers.cookie);
    const authenticated = token && await this.sessions.authenticate(token);
    if (!authenticated) throw new UnauthorizedException('Authentication required');
    request.user = authenticated.user; request.sessionId = authenticated.sessionId;
    return true;
  }
}
