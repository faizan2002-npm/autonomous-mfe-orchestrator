import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getServiceEndpoints } from '@orchestrator/config';
import { requestUpstream } from '@orchestrator/upstream-client';
import { ObservationService } from '../observation/observation.service.js';
import { CanaryService } from '../canary/canary.service.js';

export interface ProxyRequest {
  service: string;
  subPath: string;
  method: string;
  query: string;
  body: unknown;
  isCanary: boolean;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly endpoints = getServiceEndpoints();

  constructor(
    @Inject(ObservationService)
    private readonly observationService: ObservationService,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
  ) {}

  async forward(request: ProxyRequest) {
    const { service, subPath, method, query, body, isCanary } = request;
    const baseUrl = this.endpoints[service];
    if (!baseUrl)
      throw new NotFoundException(
        `Service '${service}' not registered in Gateway.`,
      );
    const path = `/api/v1/${subPath}`;
    const response = await requestUpstream({
      baseUrl,
      path,
      method,
      query,
      body,
    });
    if (response.payload === undefined)
      return { ...response, isPatched: false };

    // Only successful upstream responses represent the endpoint's data contract.
    if (response.status < 200 || response.status >= 300)
      return { ...response, isPatched: false };
    void this.observationService
      .observe({
        serviceName: service,
        endpointPath: path,
        httpMethod: method,
        observedPayload: response.payload,
      })
      .catch((error: unknown) =>
        this.logger.error(`Observation error: ${String(error)}`),
      );
    return {
      status: response.status,
      ...this.canaryService.applyPatchIfActive(
        service,
        response.payload,
        isCanary,
      ),
    };
  }
}
