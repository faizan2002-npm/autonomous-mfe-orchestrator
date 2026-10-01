import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CanaryService } from './canary.service.js';

@Controller('patches')
export class CanaryController {
  constructor(private readonly canaryService: CanaryService) {}

  @Get(':serviceName/remoteEntry.js')
  getRemoteEntry(
    @Param('serviceName') serviceName: string,
    @Res() res: FastifyReply
  ) {
    const script = this.canaryService.getModuleFederationScript(serviceName);
    return res.type('application/javascript').send(script);
  }
}
