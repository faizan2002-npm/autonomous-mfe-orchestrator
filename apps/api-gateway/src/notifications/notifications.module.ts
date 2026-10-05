import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsController, PushController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxWorker } from './outbox.worker.js';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, OutboxWorker],
  exports: [OutboxWorker],
})
export class NotificationsModule {}
