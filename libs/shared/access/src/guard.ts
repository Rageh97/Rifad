import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { bindVerifiedIdentity } from '@rifad/request-context';
import type { AccessGrant, AccessPipeline } from './pipeline';

const PERMISSION_KEY = 'rifad.permission';
const PUBLIC_KEY = 'rifad.public';
/** Request headers that select the tenant and branch; the pipeline verifies both against membership and roles. */
export const ORGANIZATION_HEADER = 'x-rifad-organization';
export const BRANCH_HEADER = 'x-rifad-branch';

/** Declares the permission a route requires. Routes without it are rejected by `AccessGuard` (default deny). */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);
/** Marks a route that needs no authentication (liveness and similar). Everything else must declare a permission. */
export const PublicRoute = () => SetMetadata(PUBLIC_KEY, true);

const grants = new WeakMap<object, AccessGrant>();

/** The grant for the current request, set by `AccessGuard`. */
export function accessGrant(request: object): AccessGrant | undefined {
  return grants.get(request);
}

const header = (request: FastifyRequest, name: string) => {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Nest guard running the security pipeline for every route it protects. A route must declare its
 * permission; the verified user, tenant and branch are then bound into the request context so logs,
 * traces and RLS-scoped work use them.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly pipeline: AccessPipeline, private readonly reflector: Reflector = new Reflector()) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets) === true) return true;
    const permission = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, targets);
    if (!permission) return false;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const grant = await this.pipeline.authorize({
      authorization: header(request, 'authorization'), organizationId: header(request, ORGANIZATION_HEADER),
      branchId: header(request, BRANCH_HEADER), permission,
    });
    grants.set(request, grant);
    bindVerifiedIdentity({
      userId: grant.userId, organizationId: grant.organizationId,
      ...(grant.sessionId ? { sessionId: grant.sessionId } : {}), ...(grant.branchId ? { branchId: grant.branchId } : {}),
    });
    return true;
  }
}
