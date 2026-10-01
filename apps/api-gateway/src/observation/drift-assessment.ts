import {
  analyzeSchemaDiff,
  computeDriftCoefficient,
  flattenPayload,
  type DetailedDiff,
} from '@orchestrator/core';
import type { DriftType, Severity } from '@orchestrator/shared-types';

export interface DriftAssessment {
  coefficient: number;
  diff: DetailedDiff;
  type: DriftType;
  severity: Severity;
  isBreaking: boolean;
}

export function assessDrift(
  expectedTokens: string[],
  payload: unknown,
  threshold: number,
): DriftAssessment | null {
  const expected = new Set(expectedTokens);
  const observed = flattenPayload(payload);
  const coefficient = computeDriftCoefficient(expected, observed);
  if (coefficient <= threshold) return null;

  const diff = analyzeSchemaDiff(expected, observed);
  const isBreaking =
    diff.missingFields.length > 0 || diff.typeMismatches.length > 0;
  const severity = getSeverity(isBreaking, coefficient);
  return { coefficient, diff, type: classifyDrift(diff), severity, isBreaking };
}

function classifyDrift(diff: DetailedDiff): DriftType {
  if (diff.missingFields.length && diff.addedFields.length)
    return 'FIELD_RENAMED';
  if (diff.missingFields.length) return 'FIELD_DELETED';
  if (diff.typeMismatches.length) return 'TYPE_CHANGED';
  if (diff.addedFields.length) return 'FIELD_ADDED';
  return 'STRUCTURE_MUTATION';
}

function getSeverity(isBreaking: boolean, coefficient: number): Severity {
  if (!isBreaking) return 'LOW';
  return coefficient > 0.4 ? 'CRITICAL' : 'HIGH';
}
