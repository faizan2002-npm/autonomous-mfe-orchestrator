import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ActivityService } from './activity.service.js';
import { OrgSettingsService } from './org-settings.service.js';
import { InvitationsController, OrgsController } from './orgs.controller.js';
import { OrgsService } from './orgs.service.js';

/** Tenancy core: organizations, members and invitations. Settings and activity are used everywhere. */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [OrgsController, InvitationsController],
  providers: [OrgsService, OrgSettingsService, ActivityService],
  exports: [OrgSettingsService, ActivityService],
})
export class OrgsModule {}
