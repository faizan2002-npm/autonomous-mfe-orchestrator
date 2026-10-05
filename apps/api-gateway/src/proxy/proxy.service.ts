import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { requestUpstream } from '@orchestrator/upstream-client';
import { CanaryService } from '../canary/canary.service.js';
import {
  contractKey,
  contractView,
  type ContractRef,
} from '../common/contract-ref.js';
import type { ResolvedConsumer } from '../consumers/consumers.service.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { ObservationService } from '../observation/observation.service.js';
import { ServiceRegistryService } from '../services/service-registry.service.js';

/** At most one live-feed event per contract per window, so load tests don't flood dashboards. */
const PROXY_EVENT_WINDOW_MS = 1_000;

/** Client headers worth passing upstream (end-user auth, content negotiation, tracing). */
const FORWARDED_HEADERS = [
  'authorization',
  'accept',
  'accept-language',
  'idempotency-key',
  'x-request-id',
  'x-correlation-id',
  'traceparent',
  'tracestate',
];

export interface ProxyRequest {
  consumer: ResolvedConsumer;
  service: string;
  subPath: string;
  method: string;
  query: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
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
    @Inject(ServiceRegistryService)
    private readonly services: ServiceRegistryService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    const { consumer, subPath, method, query, body, canary } = request;
    const service = await this.services.resolve(
      consumer.orgId,
      request.service,
    );
    if (!service)
      throw new NotFoundException(
        `Service '${request.service}' is not registered in this organization`,
      );
    if (!consumer.serviceIds.includes(service.id))
      throw new ForbiddenException(
        `Consumer '${consumer.consumerName}' may not call '${service.serviceName}'`,
      );

    const contract: ContractRef = {
      orgId: consumer.orgId,
      consumerId: consumer.consumerId,
      consumerName: consumer.consumerName,
      serviceName: service.serviceName,
      httpMethod: method,
      endpointPath: `/api/v1/${subPath}`,
    };
    const response = await requestUpstream({
      baseUrl: service.baseUrl,
      path: contract.endpointPath,
      method,
      query,
      body,
      timeoutMs: service.timeoutMs,
      // Org-configured service credentials win over anything the client sent.
      headers: { ...pickForwarded(request.headers), ...service.headers },
      fetch: this.services.guardedFetch,
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

    // Fire-and-forget observation with 100ms timeout to not block response
    void Promise.race([
      this.observationService.observe({
        ...contract,
        serviceId: service.id,
        observedPayload: response.payload,
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Observation timeout')), 100);
      }),
    ]).catch((error: unknown) =>
      this.logger.error(`Observation error: ${String(error)}`, {
        contractId: contract.contractId,
      }),
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
    const view = contractView(contract);
    const key = contractKey({ ...contract, ...view });
    const now = Date.now();
    if (now - (this.lastEventAt.get(key) ?? 0) < PROXY_EVENT_WINDOW_MS) return;
    this.lastEventAt.set(key, now);
    this.events.publish({
      type: 'request.proxied',
      orgId: contract.orgId,
      contract: view,
      status,
      isPatched,
    });
  }
}

function pickForwarded(
  headers: ProxyRequest['headers'],
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string') picked[name] = value;
  }
  return picked;
}
