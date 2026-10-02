import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { DemoService } from './demo.service.js';
import { ChaosStateDto } from './chaos-state.dto.js';

/** Drives the mock upstream services for live demos; browsers never call them directly. */
@Controller('api/demo')
@UseGuards(AuthGuard)
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  @Get('services')
  listServices() {
    return this.demo.listServices();
  }

  @Post('services/:name/chaos')
  @HttpCode(200)
  setChaos(
    @Param('name') name: string,
    @Body(
      new ValidationPipe({
        expectedType: ChaosStateDto,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: ChaosStateDto,
  ) {
    return this.demo.setChaos(name, body.mutated);
  }
}
