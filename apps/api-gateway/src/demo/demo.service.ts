import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DemoServiceState } from '@orchestrator/shared-types';
import { requestUpstream } from '@orchestrator/upstream-client';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';

const CHAOS_TIMEOUT_MS = 3_000;

@Injectable()
export class DemoService {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  listServices(): Promise<DemoServiceState[]> {
    return Promise.all(
      Object.entries(this.config.serviceEndpoints).map(
        async ([serviceName, baseUrl]) => {
          try {
            const { status, payload } = await requestUpstream({
              baseUrl,
              path: '/chaos/state',
              method: 'GET',
              timeoutMs: CHAOS_TIMEOUT_MS,
            });
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
        },
      ),
    );
  }

  async setChaos(
    serviceName: string,
    mutated: boolean,
  ): Promise<DemoServiceState> {
    const baseUrl = this.config.serviceEndpoints[serviceName];
    if (!baseUrl)
      throw new NotFoundException(`Unknown service '${serviceName}'`);
    try {
      const { status, payload } = await requestUpstream({
        baseUrl,
        path: '/chaos/state',
        method: 'POST',
        body: { mutated },
        timeoutMs: CHAOS_TIMEOUT_MS,
      });
      if (status !== 200) throw new Error(`status ${status}`);
      return {
        serviceName,
        reachable: true,
        mutated: (payload as { isMutated: boolean }).isMutated,
      };
    } catch (error) {
      throw new BadGatewayException(`Could not reach ${serviceName}`, {
        description: String(error),
      });
    }
  }
}
