import { ConfigService } from '@nestjs/config';
import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDatabaseConnection } from '@orchestrator/database';
import { sql } from 'drizzle-orm';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly connection: ReturnType<typeof createDatabaseConnection>;
  readonly db;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.connection = createDatabaseConnection(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    this.db = this.connection.db;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.db.execute(sql`select 1`);
    } catch (error) {
      await this.connection.close();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
