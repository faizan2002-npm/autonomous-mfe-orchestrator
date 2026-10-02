import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { requestUpstream } from '@orchestrator/upstream-client';
import { CanaryService } from '../canary/canary.service.js';
import {
  contractKey,
  normalizeEndpointPath,
  type ContractRef,
} from '../common/contract-ref.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { ObservationService } from '../observation/observation.service.js';

/** At most one live-feed event per contract per window, so load tests don't flood dashboards. */
const PROXY_EVENT_WINDOW_MS = 1_000;

export interface ProxyRequest {
  service: string;
  subPath: string;
  method: string;
  query: string;
  body: unknown;
  /** Forces canary routing on or off; undefined samples by the patch's traffic share. */
  canary?: boolean;
}

export interface ProxyResponse {
  status: number;
  payload: unknown;
  isPatched: boolean;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly lastEventAt = new Map<string, number>();

  constructor(
    @Inject(ObservationService)
    private readonly observationService: ObservationService,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    const { service, subPath, method, query, body, canary } = request;
    const baseUrl = this.config.serviceEndpoints[service];
    if (!baseUrl)
      throw new NotFoundException(
        `Service '${service}' not registered in Gateway.`,
      );
    const contract: ContractRef = {
      serviceName: service,
      httpMethod: method,
      endpointPath: `/api/v1/${subPath}`,
    };
    const response = await requestUpstream({
      baseUrl,
      path: contract.endpointPath,
      method,
      query,
      body,
    });
    // Only successful JSON responses represent the endpoint's data contract.
    if (
      response.payload === undefined ||
      response.status < 200 ||
      response.status >= 300
    ) {
      this.announce(contract, response.status, false);
      return { ...response, isPatched: false };
    }

    void this.observationService
      .observe({ ...contract, observedPayload: response.payload })
      .catch((error: unknown) =>
        this.logger.error(`Observation error: ${String(error)}`),
      );
    const result = {
      status: response.status,
      ...this.canaryService.applyPatch(contract, response.payload, canary),
    };
    this.announce(contract, result.status, result.isPatched);
    return result;
  }

  private announce(
    contract: ContractRef,
    status: number,
    isPatched: boolean,
  ): void {
    const view = {
      ...contract,
      httpMethod: contract.httpMethod.toUpperCase(),
      endpointPath: normalizeEndpointPath(contract.endpointPath),
    };
    const key = contractKey(view);
    const now = Date.now();
    if (now - (this.lastEventAt.get(key) ?? 0) < PROXY_EVENT_WINDOW_MS) return;
    this.lastEventAt.set(key, now);
    this.events.publish({
      type: 'request.proxied',
      contract: view,
      status,
      isPatched,
    });
  }
}
