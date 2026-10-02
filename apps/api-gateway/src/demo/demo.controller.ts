import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentOrg, OrgScoped, type OrgAccess } from '../auth/org.guard.js';
import { validated } from '../common/validation.js';
import { ChaosStateDto } from './chaos-state.dto.js';
import { DemoService } from './demo.service.js';

/** Drives the mock upstream services for live demos; browsers never call them directly. */
@Controller('api/orgs/:orgSlug/demo')
@OrgScoped()
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  @Get('services')
  listServices(@CurrentOrg() org: OrgAccess) {
    return this.demo.listServices(org.id);
  }

  @Post('services/:name/chaos')
  @OrgScoped('reviewer')
  @HttpCode(200)
  setChaos(
    @CurrentOrg() org: OrgAccess,
    @Param('name') name: string,
    @Body(validated(ChaosStateDto)) body: ChaosStateDto,
  ) {
    return this.demo.setChaos(org.id, name, body.mutated);
  }
}
