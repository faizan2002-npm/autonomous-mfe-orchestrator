import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PushConfig } from '@orchestrator/shared-types';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { validated } from '../common/validation.js';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway-config.js';
import {
  CreateEndpointDto,
  MarkReadDto,
  PushSubscriptionDto,
  PushUnsubscribeDto,
  UpdateEndpointDto,
  UpdatePreferencesDto,
} from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller('api/orgs/:orgSlug/notifications')
@OrgScoped()
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  inbox(@CurrentOrg() org: OrgAccess, @CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.notifications.inbox(org.id, user.id, Math.min(Math.max(Number(limit) || 50, 1), 200));
  }

  @Post('read')
  @HttpCode(204)
  markRead(
    @CurrentOrg() org: OrgAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body(validated(MarkReadDto)) dto: MarkReadDto,
  ) {
    return this.notifications.markRead(org.id, user.id, dto.ids);
  }

  @Get('preferences')
  preferences(@CurrentOrg() org: OrgAccess, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.preferences(org, user.id);
  }

  @Put('preferences')
  updatePreferences(
    @CurrentOrg() org: OrgAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body(validated(UpdatePreferencesDto)) dto: UpdatePreferencesDto,
  ) {
    return this.notifications.updatePreferences(
      org,
      user.id,
      Object.fromEntries(dto.preferences.map((p) => [p.event, p.channels])),
    );
  }

  @Post('test')
  @HttpCode(200)
  testPersonal(@CurrentOrg() org: OrgAccess, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.testPersonal(org, user);
  }

  @Get('endpoints')
  @OrgScoped('admin')
  listEndpoints(@CurrentOrg() org: OrgAccess) {
    return this.notifications.listEndpoints(org.id);
  }

  @Post('endpoints')
  @OrgScoped('admin')
  createEndpoint(
    @CurrentOrg() org: OrgAccess,
    @Body(validated(CreateEndpointDto)) dto: CreateEndpointDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.createEndpoint(org, dto, user);
  }

  @Patch('endpoints/:id')
  @OrgScoped('admin')
  updateEndpoint(
    @CurrentOrg() org: OrgAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validated(UpdateEndpointDto)) dto: UpdateEndpointDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.updateEndpoint(org, id, dto, user);
  }

  @Delete('endpoints/:id')
  @OrgScoped('admin')
  @HttpCode(204)
  deleteEndpoint(
    @CurrentOrg() org: OrgAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.deleteEndpoint(org, id, user);
  }

  @Post('endpoints/:id/test')
  @OrgScoped('admin')
  @HttpCode(202)
  testEndpoint(@CurrentOrg() org: OrgAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.testEndpoint(org, id);
  }

  @Get('deliveries')
  @OrgScoped('admin')
  deliveries(@CurrentOrg() org: OrgAccess, @Query('endpointId') endpointId?: string) {
    return this.notifications.deliveries(org.id, endpointId || undefined);
  }

  @Post('deliveries/:id/redeliver')
  @OrgScoped('admin')
  @HttpCode(202)
  redeliver(@CurrentOrg() org: OrgAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.redeliver(org.id, id);
  }
}

/** Browser push subscriptions belong to the user, across organizations. */
@Controller('api/push')
export class PushController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  @Get('config')
  config_(): PushConfig {
    return { enabled: Boolean(this.config.push), publicKey: this.config.push?.publicKey ?? null };
  }

  @Post('subscriptions')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validated(PushSubscriptionDto)) dto: PushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.notifications.subscribePush(user, { endpoint: dto.endpoint, ...dto.keys }, userAgent);
  }

  @Delete('subscriptions')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body(validated(PushUnsubscribeDto)) dto: PushUnsubscribeDto) {
    return this.notifications.unsubscribePush(user, dto.endpoint);
  }
}
