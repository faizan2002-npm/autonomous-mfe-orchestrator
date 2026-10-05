import type { CanaryTraffic, PatchGenerator, PolicyDecision, PolicyProgress } from '@orchestrator/shared-types';

export interface PolicyRules {
  name: string;
  minCanaryRequests: number;
  minCanaryMinutes: number;
  maxFailureRate: number;
  rollbackFailureRate: number | null;
  rollbackMinRequests: number;
  allowedGenerators: readonly string[];
}

export interface PolicyScope {
  serviceId: string | null;
  consumerId: string | null;
  enabled: boolean;
}

/** Most specific first: service + consumer, then service, then consumer, then org default. */
export function specificity(policy: PolicyScope): number {
  return (policy.serviceId ? 2 : 0) + (policy.consumerId ? 1 : 0);
}

/** The enabled policy that governs a patch for this service and consumer, if any. */
export function matchPolicy<P extends PolicyScope>(policies: P[], serviceId: string, consumerId: string): P | null {
  return (
    policies
      .filter(
        (policy) =>
          policy.enabled &&
          (policy.serviceId === null || policy.serviceId === serviceId) &&
          (policy.consumerId === null || policy.consumerId === consumerId),
      )
      .sort((a, b) => specificity(b) - specificity(a))[0] ?? null
  );
}

export const scopeKey = (serviceId: string | null, consumerId: string | null) =>
  `${serviceId ?? '*'}:${consumerId ?? '*'}`;

const pct = (rate: number) => `${(rate * 100).toFixed(rate > 0 && rate < 0.01 ? 2 : 1)}%`;

/**
 * Decides what to do with one canary patch. Rollback is checked first: a patch that is
 * failing should be withdrawn even before it is old enough to promote.
 */
export function decide(
  rules: PolicyRules,
  traffic: CanaryTraffic,
  deployedAt: Date | null,
  generator: PatchGenerator,
  now: Date = new Date(),
): PolicyDecision {
  const canaryRequests = traffic.patchedRequests + traffic.adapterFailures;
  const failureRate = canaryRequests ? traffic.adapterFailures / canaryRequests : 0;
  const minutesInCanary = deployedAt ? Math.max(0, (now.getTime() - deployedAt.getTime()) / 60_000) : 0;
  const progress: PolicyProgress = {
    canaryRequests,
    adapterFailures: traffic.adapterFailures,
    failureRate,
    minutesInCanary,
  };
  const result = (action: PolicyDecision['action'], reason: string): PolicyDecision => ({ action, reason, progress });

  if (
    rules.rollbackFailureRate !== null &&
    canaryRequests >= rules.rollbackMinRequests &&
    failureRate >= rules.rollbackFailureRate
  )
    return result(
      'rollback',
      `Policy "${rules.name}": adapter failure rate ${pct(failureRate)} over ${canaryRequests} canary requests ` +
        `reached the rollback threshold of ${pct(rules.rollbackFailureRate)}.`,
    );

  if (!rules.allowedGenerators.includes(generator))
    return result('blocked', `Policy "${rules.name}" does not auto-promote ${generator} patches; a reviewer must decide.`);

  const waiting: string[] = [];
  if (canaryRequests < rules.minCanaryRequests)
    waiting.push(`${canaryRequests}/${rules.minCanaryRequests} canary requests`);
  if (minutesInCanary < rules.minCanaryMinutes)
    waiting.push(`${Math.floor(minutesInCanary)}/${rules.minCanaryMinutes} minutes in canary`);
  if (waiting.length) return result('wait', `Waiting for ${waiting.join(' and ')}.`);

  if (failureRate > rules.maxFailureRate)
    return result(
      'blocked',
      `Adapter failure rate ${pct(failureRate)} is above the policy's ${pct(rules.maxFailureRate)} limit; a reviewer must decide.`,
    );

  return result(
    'promote',
    `Policy "${rules.name}": ${canaryRequests} canary requests over ${Math.floor(minutesInCanary)} minutes ` +
      `with a ${pct(failureRate)} adapter failure rate (limit ${pct(rules.maxFailureRate)}).`,
  );
}
