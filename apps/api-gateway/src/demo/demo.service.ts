import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DemoServiceState } from '@orchestrator/shared-types';
import { requestUpstream } from '@orchestrator/upstream-client';
import { ServiceRegistryService } from '../services/service-registry.service.js';

const CHAOS_TIMEOUT_MS = 3_000;

/**
 * Drives the chaos switch of demo upstreams (GET/POST /chaos/state). Services without one
 * are reported as unreachable for chaos; they still proxy normally.
 */
@Injectable()
export class DemoService {
  constructor(
    @Inject(ServiceRegistryService)
    private readonly services: ServiceRegistryService,
  ) {}

  async listServices(orgId: string): Promise<DemoServiceState[]> {
    const registered = await this.services.list(orgId);
    return Promise.all(
      registered.map(async ({ serviceName }) => {
        try {
          const { status, payload } = await this.call(
            orgId,
            serviceName,
            'GET',
          );
          const mutated = (payload as { isMutated?: unknown } | undefined)
            ?.isMutated;
          return {
            serviceName,
            reachable: status === 200,
            mutated: typeof mutated === 'boolean' ? mutated : null,
          };
        } catch {
          return { serviceName, reachable: false, mutated: null };
        }
      }),
    );
  }

  async setChaos(
    orgId: string,
    serviceName: string,
    mutated: boolean,
  ): Promise<DemoServiceState> {
    try {
      const { status, payload } = await this.call(orgId, serviceName, 'POST', {
        mutated,
      });
      if (status !== 200) throw new Error(`status ${status}`);
      return {
        serviceName,
        reachable: true,
        mutated: (payload as { isMutated: boolean }).isMutated,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadGatewayException(`Could not reach ${serviceName}`, {
        description: String(error),
      });
    }
  }

  private async call(
    orgId: string,
    serviceName: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ) {
    const service = await this.services.resolve(orgId, serviceName);
    if (!service)
      throw new NotFoundException(`Unknown service '${serviceName}'`);
    return requestUpstream({
      baseUrl: service.baseUrl,
      path: '/chaos/state',
      method,
      body,
      headers: service.headers,
      timeoutMs: CHAOS_TIMEOUT_MS,
      fetch: this.services.guardedFetch,
    });
  }
}
