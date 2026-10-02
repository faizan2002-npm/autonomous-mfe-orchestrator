import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { validated } from '../common/validation.js';
import { CreatePolicyDto, UpdatePolicyDto } from './policies.dto.js';
import { PoliciesService } from './policies.service.js';

@Controller('api/orgs/:orgSlug/policies')
@OrgScoped()
export class PoliciesController {
  constructor(@Inject(PoliciesService) private readonly policies: PoliciesService) {}

  @Get()
  list(@CurrentOrg() org: OrgAccess) {
    return this.policies.list(org.id);
  }

  /** What each enabled policy will do to each canary patch right now. */
  @Get('outlook')
  outlook(@CurrentOrg() org: OrgAccess) {
    return this.policies.outlook(org.id);
  }

  @Post()
  @OrgScoped('admin')
  create(
    @CurrentOrg() org: OrgAccess,
    @Body(validated(CreatePolicyDto)) dto: CreatePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.create(org, dto, user);
  }

  @Patch(':id')
  @OrgScoped('admin')
  update(
    @CurrentOrg() org: OrgAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validated(UpdatePolicyDto)) dto: UpdatePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.update(org, id, dto, user);
  }

  @Delete(':id')
  @OrgScoped('admin')
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.remove(org, id, user);
  }
}
