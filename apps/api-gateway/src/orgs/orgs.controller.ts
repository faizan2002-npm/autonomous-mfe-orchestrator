import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { validated } from '../common/validation.js';
import { ActivityService } from './activity.service.js';
import {
  CreateOrgDto,
  InviteMemberDto,
  UpdateMemberDto,
  UpdateOrgSettingsDto,
} from './orgs.dto.js';
import { OrgsService } from './orgs.service.js';

@Controller('api/orgs')
export class OrgsController {
  constructor(
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.orgs.listForUser(user);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(
    @Body(validated(CreateOrgDto)) dto: CreateOrgDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.create(user, dto);
  }

  @Get(':orgSlug')
  @OrgScoped()
  getSettings(@CurrentOrg() org: OrgAccess) {
    return this.orgs.getSettings(org);
  }

  @Patch(':orgSlug')
  @OrgScoped('admin')
  updateSettings(
    @CurrentOrg() org: OrgAccess,
    @Body(validated(UpdateOrgSettingsDto)) dto: UpdateOrgSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.updateSettings(org, dto, user);
  }

  @Get(':orgSlug/members')
  @OrgScoped()
  listMembers(@CurrentOrg() org: OrgAccess) {
    return this.orgs.listMembers(org);
  }

  @Patch(':orgSlug/members/:memberId')
  @OrgScoped('admin')
  updateMember(
    @CurrentOrg() org: OrgAccess,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body(validated(UpdateMemberDto)) dto: UpdateMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.updateMember(org, memberId, dto, user);
  }

  /** Viewers may remove themselves (leave); removing others is checked in the service. */
  @Delete(':orgSlug/members/:memberId')
  @OrgScoped()
  @HttpCode(204)
  removeMember(
    @CurrentOrg() org: OrgAccess,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.removeMember(org, memberId, user);
  }

  @Get(':orgSlug/invitations')
  @OrgScoped('admin')
  listInvitations(@CurrentOrg() org: OrgAccess) {
    return this.orgs.listInvitations(org);
  }

  @Post(':orgSlug/invitations')
  @OrgScoped('admin')
  invite(
    @CurrentOrg() org: OrgAccess,
    @Body(validated(InviteMemberDto)) dto: InviteMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.invite(org, dto, user);
  }

  @Delete(':orgSlug/invitations/:invitationId')
  @OrgScoped('admin')
  @HttpCode(204)
  revokeInvitation(
    @CurrentOrg() org: OrgAccess,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.revokeInvitation(org, invitationId, user);
  }

  @Get(':orgSlug/activity')
  @OrgScoped('admin')
  listActivity(@CurrentOrg() org: OrgAccess, @Query('limit') limit?: string) {
    return this.activity.list(
      org.id,
      Math.min(Math.max(Number(limit) || 100, 1), 500),
    );
  }
}

/** Invitation links work before the invitee belongs to the organization. */
@Controller('api/invitations')
export class InvitationsController {
  constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.orgs.previewInvitation(token);
  }

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  accept(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgs.acceptInvitation(token, user);
  }
}
