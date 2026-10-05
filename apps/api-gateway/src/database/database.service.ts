import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDatabaseConnection } from '@orchestrator/database';
import { sql } from 'drizzle-orm';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly connection: ReturnType<typeof createDatabaseConnection>;
  readonly db;

  constructor(@Inject(GATEWAY_CONFIG) config: GatewayConfig) {
    this.connection = createDatabaseConnection(config.databaseUrl);
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
