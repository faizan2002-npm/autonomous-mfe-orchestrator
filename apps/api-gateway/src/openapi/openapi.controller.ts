import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { validated } from '../common/validation.js';
import { AdoptContractDto, ImportOpenApiDto } from './openapi.dto.js';
import { OpenApiService } from './openapi.service.js';

@Controller('api/orgs/:orgSlug/services/:serviceId/openapi')
@OrgScoped()
export class OpenApiController {
  constructor(@Inject(OpenApiService) private readonly openapi: OpenApiService) {}

  @Get()
  state(@CurrentOrg() org: OrgAccess, @Param('serviceId', new ParseUUIDPipe()) serviceId: string) {
    return this.openapi.state(org.id, serviceId);
  }

  @Put()
  @OrgScoped('admin')
  import(
    @CurrentOrg() org: OrgAccess,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body(validated(ImportOpenApiDto)) dto: ImportOpenApiDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openapi.import(org, serviceId, dto, user);
  }

  @Delete()
  @OrgScoped('admin')
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgAccess,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openapi.remove(org, serviceId, user);
  }

  /** Re-baseline one consumer contract on the spec. */
  @Post('adopt')
  @OrgScoped('reviewer')
  @HttpCode(200)
  adopt(
    @CurrentOrg() org: OrgAccess,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body(validated(AdoptContractDto)) dto: AdoptContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openapi.adopt(org, serviceId, dto.contractId, user);
  }
}
