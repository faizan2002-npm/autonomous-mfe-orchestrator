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
import { ServiceRegistryService } from './service-registry.service.js';
import { CreateServiceDto, UpdateServiceDto } from './services.dto.js';

@Controller('api/orgs/:orgSlug/services')
export class ServicesController {
  constructor(
    @Inject(ServiceRegistryService)
    private readonly services: ServiceRegistryService,
  ) {}

  @Get()
  @OrgScoped()
  list(@CurrentOrg() org: OrgAccess) {
    return this.services.list(org.id);
  }

  @Post()
  @OrgScoped('admin')
  create(
    @CurrentOrg() org: OrgAccess,
    @Body(validated(CreateServiceDto)) dto: CreateServiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.services.create(org, dto, user);
  }

  @Patch(':serviceId')
  @OrgScoped('admin')
  update(
    @CurrentOrg() org: OrgAccess,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body(validated(UpdateServiceDto)) dto: UpdateServiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.services.update(org, serviceId, dto, user);
  }

  @Delete(':serviceId')
  @OrgScoped('admin')
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgAccess,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.services.remove(org, serviceId, user);
  }

  @Post(':serviceId/test')
  @OrgScoped('reviewer')
  @HttpCode(200)
  test(
    @CurrentOrg() org: OrgAccess,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
  ) {
    return this.services.testConnection(org.id, serviceId);
  }
}
