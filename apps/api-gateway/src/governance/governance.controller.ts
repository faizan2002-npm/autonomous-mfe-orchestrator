import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser } from '../auth/auth.guard.js';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { validated } from '../common/validation.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { ContractService } from '../observation/contract.service.js';
import { GovernanceQueryService } from './governance-query.service.js';
import {
  AuditsQuery,
  ContractPinsDto,
  DriftEventsQuery,
  PatchesQuery,
} from './governance-queries.dto.js';
import { GovernanceService } from './governance.service.js';
import { PatchDecisionDto } from './patch-decision.dto.js';

const HEARTBEAT_MS = 25_000;
/** Events that carry secrets (e.g. invitation links) and must never reach browsers. */
const INTERNAL_EVENTS = new Set(['member.invited']);

@Controller('api/orgs/:orgSlug/governance')
@OrgScoped()
export class GovernanceController {
  constructor(
    @Inject(GovernanceService)
    private readonly governanceService: GovernanceService,
    @Inject(GovernanceQueryService)
    private readonly queries: GovernanceQueryService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  @Get('stats')
  getStats(@CurrentOrg() org: OrgAccess) {
    return this.queries.getStats(org.id);
  }

  @Get('config')
  getConfig(@CurrentOrg() org: OrgAccess) {
    return this.queries.getPublicConfig(org.id);
  }

  @Get('services')
  listServices(@CurrentOrg() org: OrgAccess) {
    return this.queries.listServices(org.id);
  }

  @Get('services/:name')
  getService(@CurrentOrg() org: OrgAccess, @Param('name') name: string) {
    return this.queries.getService(org.id, name);
  }

  @Put('contracts/:contractId/pins')
  @OrgScoped('reviewer')
  async pinContract(
    @CurrentOrg() org: OrgAccess,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body(validated(ContractPinsDto)) pins: ContractPinsDto,
  ) {
    const empty = !pins.required.length && !pins.ignored.length;
    await this.contracts.updatePins(org.id, contractId, empty ? null : pins);
    return { pinnedFields: empty ? null : pins };
  }

  @Get('drift-events')
  listDriftEvents(
    @CurrentOrg() org: OrgAccess,
    @Query(validated(DriftEventsQuery)) query: DriftEventsQuery,
  ) {
    return this.queries.listDriftEvents(org.id, {
      ...query,
      limit: query.limit ?? 25,
    });
  }

  @Get('drift-events/:id')
  getDriftEvent(
    @CurrentOrg() org: OrgAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.queries.getDriftEvent(org.id, id);
  }

  @Get('patches')
  listPatches(
    @CurrentOrg() org: OrgAccess,
    @Query(validated(PatchesQuery)) query: PatchesQuery,
  ) {
    return this.queries.listPatches(org.id, query);
  }

  @Get('patches/:patchId')
  getPatch(
    @CurrentOrg() org: OrgAccess,
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
  ) {
    return this.queries.getPatch(org.id, patchId);
  }

  @Post('patches/:patchId/preview')
  @OrgScoped('reviewer')
  @HttpCode(200)
  previewPatch(
    @CurrentOrg() org: OrgAccess,
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
  ) {
    return this.queries.previewPatch(org.id, patchId);
  }

  @Get('audits')
  listAudits(
    @CurrentOrg() org: OrgAccess,
    @Query(validated(AuditsQuery)) query: AuditsQuery,
  ) {
    return this.queries.listAudits(org.id, query.limit ?? 50);
  }

  /** Live pipeline events for this organization only (Server-Sent Events). */
  @Sse('events')
  streamEvents(@CurrentOrg() org: OrgAccess): Observable<MessageEvent> {
    return merge(
      this.events.stream().pipe(
        filter(
          (event) => event.orgId === org.id && !INTERNAL_EVENTS.has(event.type),
        ),
        map((event) => ({ data: event })),
      ),
      interval(HEARTBEAT_MS).pipe(map(() => ({ data: { type: 'heartbeat' } }))),
    );
  }

  @Post('patches/:patchId/promote')
  @OrgScoped('reviewer')
  async promotePatch(
    @CurrentOrg() org: OrgAccess,
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
    @Body(validated(PatchDecisionDto)) decision: PatchDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.governanceService.promotePatch(org.id, patchId, decision, user);
    return {
      message: `Patch ${patchId} successfully promoted to 100% production.`,
    };
  }

  @Post('patches/:patchId/rollback')
  @OrgScoped('reviewer')
  async rollbackPatch(
    @CurrentOrg() org: OrgAccess,
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
    @Body(validated(PatchDecisionDto)) decision: PatchDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.governanceService.rollbackPatch(org.id, patchId, decision, user);
    return { message: `Patch ${patchId} rolled back.` };
  }
}
