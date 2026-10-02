import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UseGuards,
  ValidationPipe,
  type MessageEvent,
  type Type,
} from '@nestjs/common';
import { interval, map, merge, type Observable } from 'rxjs';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { GovernanceQueryService } from './governance-query.service.js';
import {
  AuditsQuery,
  DriftEventsQuery,
  PatchesQuery,
} from './governance-queries.dto.js';
import { GovernanceService } from './governance.service.js';
import { PatchDecisionDto } from './patch-decision.dto.js';

const HEARTBEAT_MS = 25_000;

// tsx (esbuild) emits no decorator metadata, so the global pipe cannot infer DTOs in dev.
const validated = (expectedType: Type) =>
  new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
const DecisionBody = () => Body(validated(PatchDecisionDto));

@Controller('api/governance')
@UseGuards(AuthGuard)
export class GovernanceController {
  constructor(
    @Inject(GovernanceService)
    private readonly governanceService: GovernanceService,
    @Inject(GovernanceQueryService)
    private readonly queries: GovernanceQueryService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  @Get('overview')
  getOverview() {
    return this.governanceService.getOverview();
  }

  @Get('stats')
  getStats() {
    return this.queries.getStats();
  }

  @Get('config')
  getConfig() {
    return this.queries.getPublicConfig();
  }

  @Get('services')
  listServices() {
    return this.queries.listServices();
  }

  @Get('services/:name')
  getService(@Param('name') name: string) {
    return this.queries.getService(name);
  }

  @Get('drift-events')
  listDriftEvents(@Query(validated(DriftEventsQuery)) query: DriftEventsQuery) {
    return this.queries.listDriftEvents({ ...query, limit: query.limit ?? 25 });
  }

  @Get('drift-events/:id')
  getDriftEvent(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.queries.getDriftEvent(id);
  }

  @Get('patches')
  listPatches(@Query(validated(PatchesQuery)) query: PatchesQuery) {
    return this.queries.listPatches(query);
  }

  @Get('patches/:patchId')
  getPatch(@Param('patchId', new ParseUUIDPipe()) patchId: string) {
    return this.queries.getPatch(patchId);
  }

  @Post('patches/:patchId/preview')
  @HttpCode(200)
  previewPatch(@Param('patchId', new ParseUUIDPipe()) patchId: string) {
    return this.queries.previewPatch(patchId);
  }

  @Get('audits')
  listAudits(@Query(validated(AuditsQuery)) query: AuditsQuery) {
    return this.queries.listAudits(query.limit ?? 50);
  }

  /** Live pipeline events for the dashboard (Server-Sent Events). */
  @Sse('events')
  streamEvents(): Observable<MessageEvent> {
    return merge(
      this.events.stream().pipe(map((event) => ({ data: event }))),
      interval(HEARTBEAT_MS).pipe(map(() => ({ data: { type: 'heartbeat' } }))),
    );
  }

  @Post('patches/:patchId/promote')
  async promotePatch(
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
    @DecisionBody() decision: PatchDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.governanceService.promotePatch(patchId, decision, user);
    return {
      message: `Patch ${patchId} successfully promoted to 100% production.`,
    };
  }

  @Post('patches/:patchId/rollback')
  async rollbackPatch(
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
    @DecisionBody() decision: PatchDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.governanceService.rollbackPatch(patchId, decision, user);
    return { message: `Patch ${patchId} rolled back.` };
  }
}
