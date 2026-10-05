import { Injectable, Logger } from '@nestjs/common';
import type {
  GatewayEvent,
  PatchRegistry,
  DriftEvent,
} from '@orchestrator/shared-types';

/**
 * Client for communicating with the Autonomous MFE Orchestrator gateway.
 * Fetches contracts, drift, and patch status information.
 */
@Injectable()
export class GatewayClientService {
  private readonly logger = new Logger(GatewayClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env['GATEWAY_URL'] || 'http://localhost:3000/api';
    this.apiKey = process.env['GATEWAY_API_KEY'] || 'demo-key';
  }

  /**
   * Fetches all patches for an organization.
   */
  async getPatches(orgSlug: string): Promise<PatchRegistry[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/orgs/${orgSlug}/patches`,
        {
          headers: { 'x-api-key': this.apiKey },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Gateway error: ${response.status} ${response.statusText}`,
        );
      }
      return response.json() as Promise<PatchRegistry[]>;
    } catch (error) {
      this.logger.error(
        `Failed to fetch patches from gateway: ${String(error)}`,
      );
      return [];
    }
  }

  /**
   * Fetches recent drift events for an organization.
   */
  async getDriftEvents(
    orgSlug: string,
    limit: number = 20,
  ): Promise<DriftEvent[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/orgs/${orgSlug}/drift?limit=${limit}`,
        {
          headers: { 'x-api-key': this.apiKey },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Gateway error: ${response.status} ${response.statusText}`,
        );
      }
      return response.json() as Promise<DriftEvent[]>;
    } catch (error) {
      this.logger.error(
        `Failed to fetch drift events from gateway: ${String(error)}`,
      );
      return [];
    }
  }

  /**
   * Watches for events from the gateway via SSE.
   * Yields GatewayEvents as they arrive.
   */
  async *watchEvents(
    orgSlug: string,
  ): AsyncGenerator<GatewayEvent, void, unknown> {
    try {
      const response = await fetch(
        `${this.baseUrl}/orgs/${orgSlug}/governance/events`,
        {
          headers: { 'x-api-key': this.apiKey },
        },
      );
      if (!response.ok || !response.body) {
        throw new Error(
          `SSE connection failed: ${response.status} ${response.statusText}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try {
              const data = JSON.parse(line.slice(5)) as GatewayEvent;
              yield data;
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      this.logger.error(`SSE watch failed: ${String(error)}`);
    }
  }
}
