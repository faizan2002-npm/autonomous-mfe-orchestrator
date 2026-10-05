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

  constructor(private readonly gateway: GatewayClientService) {}

  async generateOrgReport(orgSlug: string): Promise<OrgReport> {
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
      unrepairedDrifts: driftEvents.filter((e) => !e.repairedAt).length,
      recentDriftsPerDay: todayDrifts,
    };

    // Collect recent events (both patches and drifts)
    const recentEvents = [
      ...patches.slice(0, 5).map((p) => ({
        type: p.status === 'ACTIVE' ? 'patch.promoted' : 'patch.deployed',
        contractId: p.contractId,
        timestamp: p.generatedAt,
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

    return {
      orgSlug,
      generatedAt: new Date().toISOString(),
      patches: patchMetrics,
      drift: driftMetrics,
      recentEvents: recentEvents.slice(0, 10),
    };
  }
}
