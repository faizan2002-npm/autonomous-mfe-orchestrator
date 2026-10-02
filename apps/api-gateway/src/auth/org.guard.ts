import {
  applyDecorators,
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  orgMembers,
  organizations,
  type DrizzleDb,
} from '@orchestrator/database';
import { ORG_ROLES, type OrgRole } from '@orchestrator/shared-types';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedUser } from './token-verifier.js';

export interface OrgAccess {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

type OrgRequest = FastifyRequest & {
  user?: AuthenticatedUser;
  org?: OrgAccess;
};

const MIN_ROLE = 'orchestrator:minRole';

/** True when `role` grants at least the privileges of `minimum` (owner > admin > reviewer > viewer). */
export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ORG_ROLES.indexOf(role) <= ORG_ROLES.indexOf(minimum);
}

/** Resolves `:orgSlug` to the caller's membership; non-members get 404 so org names don't leak. */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrgRequest>();
    if (!request.user) throw new UnauthorizedException();
    const slug = (request.params as { orgSlug?: string }).orgSlug;
    if (!slug) throw new NotFoundException('Organization not found');
    const [membership] = await this.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(
          eq(organizations.slug, slug),
          eq(orgMembers.userId, request.user.id),
        ),
      )
      .limit(1);
    if (!membership) throw new NotFoundException('Organization not found');
    const minimum =
      this.reflector.getAllAndOverride<OrgRole | undefined>(MIN_ROLE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'viewer';
    if (!roleAtLeast(membership.role, minimum))
      throw new ForbiddenException(
        `This action requires the ${minimum} role or higher`,
      );
    request.org = membership;
    return true;
  }
}

/** Minimum org role for a route (default: viewer). */
export const RequireRole = (role: OrgRole) => SetMetadata(MIN_ROLE, role);

/** Signed-in member of the `:orgSlug` organization, optionally with a minimum role. */
export const OrgScoped = (minimum?: OrgRole) =>
  applyDecorators(
    UseGuards(AuthGuard, OrgGuard),
    ...(minimum ? [RequireRole(minimum)] : []),
  );

export const CurrentOrg = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrgAccess =>
    context.switchToHttp().getRequest<OrgRequest>().org!,
);
