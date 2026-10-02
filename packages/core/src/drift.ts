import type { DriftType, Severity } from '@orchestrator/shared-types';
import {
  analyzeSchemaDiff,
  computeDriftCoefficient,
  flattenPayload,
  type DetailedDiff,
} from './comparator.js';

/** Fields a consumer depends on. A pin on `profile` also covers `profile.bio` and `profile.tags[]`. */
export interface FieldPins {
  /** When non-empty, only these fields are compared. */
  required: string[];
  /** Never compared, even if required covers them. */
  ignored: string[];
}

function covers(pin: string, path: string): boolean {
  return (
    path === pin || path.startsWith(`${pin}.`) || path.startsWith(`${pin}[]`)
  );
}

/** Keeps only the schema tokens a consumer has pinned (path:type tokens, as from flattenPayload). */
export function applyPins(
  tokens: Iterable<string>,
  pins?: FieldPins | null,
): Set<string> {
  const all = new Set(tokens);
  if (!pins || (!pins.required.length && !pins.ignored.length)) return all;
  const kept = new Set<string>();
  for (const token of all) {
    const path = token.slice(0, token.lastIndexOf(':'));
    if (pins.ignored.some((pin) => covers(pin, path))) continue;
    if (pins.required.length && !pins.required.some((pin) => covers(pin, path)))
      continue;
    kept.add(token);
  }
  return kept;
}

export interface DriftAssessment {
  coefficient: number;
  diff: DetailedDiff;
  type: DriftType;
  severity: Severity;
  isBreaking: boolean;
}

/** Returns null when the payload stays within `threshold` of the expected schema. */
export function assessDrift(
  expectedTokens: Iterable<string>,
  payload: unknown,
  threshold: number,
  pins?: FieldPins | null,
): DriftAssessment | null {
  const expected = applyPins(expectedTokens, pins);
  const observed = applyPins(flattenPayload(payload), pins);
  const coefficient = computeDriftCoefficient(expected, observed);
  if (coefficient <= threshold) return null;

  const diff = analyzeSchemaDiff(expected, observed);
  const isBreaking =
    diff.missingFields.length > 0 || diff.typeMismatches.length > 0;
  return {
    coefficient,
    diff,
    type: classifyDrift(diff),
    severity: getSeverity(isBreaking, coefficient),
    isBreaking,
  };
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
