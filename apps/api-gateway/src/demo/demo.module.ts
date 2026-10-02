import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
