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
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { validated } from '../common/validation.js';
import {
  CreateConsumerDto,
  IssueKeyDto,
  UpdateConsumerDto,
} from './consumers.dto.js';
import { ConsumersService } from './consumers.service.js';

@Controller('api/orgs/:orgSlug/consumers')
export class ConsumersController {
  constructor(
    @Inject(ConsumersService) private readonly consumers: ConsumersService,
  ) {}

  @Get()
  @OrgScoped()
  list(@CurrentOrg() org: OrgAccess) {
    return this.consumers.list(org.id);
  }

  @Post()
  @OrgScoped('admin')
  create(
    @CurrentOrg() org: OrgAccess,
    @Body(validated(CreateConsumerDto)) dto: CreateConsumerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consumers.create(org, dto, user);
  }

  @Patch(':consumerId')
  @OrgScoped('admin')
  update(
    @CurrentOrg() org: OrgAccess,
    @Param('consumerId', new ParseUUIDPipe()) consumerId: string,
    @Body(validated(UpdateConsumerDto)) dto: UpdateConsumerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consumers.update(org, consumerId, dto, user);
  }

  @Delete(':consumerId')
  @OrgScoped('admin')
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgAccess,
    @Param('consumerId', new ParseUUIDPipe()) consumerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consumers.remove(org, consumerId, user);
  }

  @Post(':consumerId/keys')
  @OrgScoped('admin')
  issueKey(
    @CurrentOrg() org: OrgAccess,
    @Param('consumerId', new ParseUUIDPipe()) consumerId: string,
    @Body(validated(IssueKeyDto)) dto: IssueKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consumers.issueKey(org, consumerId, dto, user);
  }

  @Delete(':consumerId/keys/:keyId')
  @OrgScoped('admin')
  @HttpCode(204)
  revokeKey(
    @CurrentOrg() org: OrgAccess,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consumers.revokeKey(org, keyId, user);
  }
}
