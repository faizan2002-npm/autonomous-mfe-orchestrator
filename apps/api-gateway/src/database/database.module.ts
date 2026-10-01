import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { DRIZZLE_DB } from './database.tokens.js';

@Module({
  providers: [
    DatabaseService,
    {
      provide: DRIZZLE_DB,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => database.db,
    },
  ],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
