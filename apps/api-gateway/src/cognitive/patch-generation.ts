import type { DetailedDiff } from '@orchestrator/core';

export interface PatchGenerationTask {
  driftEventId: string;
  contractId: string;
  serviceName: string;
  endpointPath: string;
  expectedSchema: string[];
  diffDetails: DetailedDiff;
  samplePayload: unknown;
}

export interface GeneratedAdapter {
  adapterCode: string;
  reasoningTrace: string;
}

export interface SavedPatch {
  patchId: string;
  adapterCode: string;
}
