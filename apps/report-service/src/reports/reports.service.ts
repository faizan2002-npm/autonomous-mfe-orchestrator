import { Injectable, Logger } from '@nestjs/common';
import { GatewayClientService } from '../gateway-client/gateway-client.service.js';

export interface PatchMetrics {
  totalGenerated: number;
  activePatches: number;
  canaryPatches: number;
  failedPatches: number;
  avgConfidenceScore: number;
}

export interface DriftMetrics {
  totalDrifts: number;
  unrepairedDrifts: number;
  recentDriftsPerDay: number;
}

export interface ContractMetrics {
  contractId: string;
  totalPatches: number;
  activePatches: number;
  failedPatches: number;
  successRate: number;
}

export interface OrgReport {
  orgSlug: string;
  generatedAt: string;
  patches: PatchMetrics;
  drift: DriftMetrics;
  recentEvents: Array<{
    type: string;
    contractId: string;
    timestamp: string;
  }>;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private reportCache = new Map<string, { report: OrgReport; timestamp: number }>();
  private readonly cacheTTLMs = 5 * 60 * 1000; // 5-min cache
  private healingEvents: Array<Record<string, unknown>> = [];

  constructor(private readonly gateway: GatewayClientService) {}

  async generateOrgReport(orgSlug: string): Promise<OrgReport> {
    const cached = this.reportCache.get(orgSlug);
    if (cached && Date.now() - cached.timestamp < this.cacheTTLMs) {
      return cached.report;
    }

    this.logger.log(`Generating report for org: ${orgSlug}`);

    const patches = await this.gateway.getPatches(orgSlug);
    const driftEvents = await this.gateway.getDriftEvents(orgSlug, 100);

    // Calculate patch metrics
    const patchMetrics: PatchMetrics = {
      totalGenerated: patches.length,
      activePatches: patches.filter((p) => p.status === 'ACTIVE').length,
      canaryPatches: patches.filter((p) => p.status === 'CANARY').length,
      failedPatches: patches.filter((p) => p.status === 'FAILED').length,
      avgConfidenceScore:
        patches.length > 0
          ? patches.reduce((sum, p) => sum + (p.confidenceScore ?? 0), 0) /
            patches.length
          : 0,
    };

    // Calculate drift metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDrifts = driftEvents.filter((e) => {
      const eventDate = new Date(e.detectedAt);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate.getTime() === today.getTime();
    }).length;

    const driftMetrics: DriftMetrics = {
      totalDrifts: driftEvents.length,
      unrepairedDrifts: driftEvents.filter((e) => e.isBreaking).length,
      recentDriftsPerDay: todayDrifts,
    };

    // Collect recent events (both patches and drifts)
    const recentEvents = [
      ...patches.slice(0, 5).map((p) => ({
        type: p.status === 'ACTIVE' ? 'patch.promoted' : 'patch.deployed',
        contractId: p.contractId,
        timestamp: p.createdAt,
      })),
      ...driftEvents.slice(0, 5).map((d) => ({
        type: 'drift.detected',
        contractId: d.contractId,
        timestamp: d.detectedAt,
      })),
    ].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const report = {
      orgSlug,
      generatedAt: new Date().toISOString(),
      patches: patchMetrics,
      drift: driftMetrics,
      recentEvents: recentEvents.slice(0, 10),
    };

    this.reportCache.set(orgSlug, { report, timestamp: Date.now() });
    return report;
  }

  async getContractHealingMetrics(orgSlug: string): Promise<ContractMetrics[]> {
    this.logger.log(`Fetching contract healing metrics for org: ${orgSlug}`);
    const patches = await this.gateway.getPatches(orgSlug);

    const metrics = patches.reduce(
      (acc: Record<string, ContractMetrics>, p) => {
        if (!acc[p.contractId]) {
          acc[p.contractId] = {
            contractId: p.contractId,
            totalPatches: 0,
            activePatches: 0,
            failedPatches: 0,
            successRate: 0,
          };
        }
        const metric = acc[p.contractId];
        metric.totalPatches += 1;
        if (p.status === 'ACTIVE') metric.activePatches += 1;
        if (p.status === 'FAILED') metric.failedPatches += 1;
        metric.successRate =
          metric.totalPatches > 0
            ? metric.activePatches / metric.totalPatches
            : 0;
        return acc;
      },
      {} as Record<string, ContractMetrics>,
    );

    return Object.values(metrics);
  }

  recordHealingEvent(event: Record<string, unknown>) {
    this.logger.log(`Recording healing event: ${JSON.stringify(event)}`);
    this.healingEvents.push(event);
    if (this.healingEvents.length > 1000) {
      this.healingEvents.shift();
    }
  }

  async checkHealth(): Promise<void> {
    try {
      await this.gateway.getPatches('demo');
      this.logger.log('Health check passed');
    } catch (error) {
      this.logger.error(`Health check failed: ${String(error)}`);
      throw error;
    }
  }
}
