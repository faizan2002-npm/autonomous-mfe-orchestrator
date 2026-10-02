import type {
  GatewayEvent,
  NotificationChannel,
  NotificationEvent,
  OrgRole,
} from '@orchestrator/shared-types';

export interface NotificationMessage {
  event: NotificationEvent;
  title: string;
  body: string;
  /** Dashboard path relative to the org, e.g. /patches/<id>. */
  path: string;
  /** Who is told: reviewers and up, or every member. */
  audience: 'reviewers' | 'members';
}

const where = (contract: { serviceName: string; httpMethod: string; endpointPath: string }) =>
  `${contract.serviceName} ${contract.httpMethod} ${contract.endpointPath}`;

/** Turns a pipeline event into a human notification, or null when nobody needs to know. */
export function toMessage(event: GatewayEvent): NotificationMessage | null {
  switch (event.type) {
    case 'drift.detected':
      if (!event.isBreaking) return null;
      return {
        event: 'drift.breaking',
        title: `Breaking API drift: ${event.contract.serviceName}`,
        body: `${event.contract.consumerName} received a changed response from ${where(event.contract)} (${event.driftType.toLowerCase().replace(/_/g, ' ')}, coefficient ${event.coefficient.toFixed(2)}). A patch is being generated.`,
        path: `/drift/${event.driftEventId}`,
        audience: 'reviewers',
      };
    case 'patch.deployed':
      return {
        event: 'patch.awaiting_review',
        title: `Patch ready for review: ${event.contract.serviceName}`,
        body: `A verified adapter now serves ${event.canaryPercent}% of ${event.contract.consumerName}'s traffic to ${where(event.contract)}. Review it, then promote or roll back.`,
        path: `/patches/${event.patchId}`,
        audience: 'reviewers',
      };
    case 'patch.rejected':
      return {
        event: 'patch.rejected',
        title: `Generated patch rejected: ${event.contract.serviceName}`,
        body: `No adapter could be verified for ${event.contract.consumerName} on ${where(event.contract)}: ${event.reason}`,
        path: `/patches/${event.patchId}`,
        audience: 'reviewers',
      };
    case 'patch.promoted':
      return {
        event: 'patch.promoted',
        title: `Patch promoted: ${event.contract.serviceName}`,
        body: `All of ${event.contract.consumerName}'s traffic to ${where(event.contract)} is now healed.`,
        path: `/patches/${event.patchId}`,
        audience: 'members',
      };
    case 'patch.rolledBack':
      return {
        event: 'patch.rolled_back',
        title: `Patch rolled back: ${event.contract.serviceName}`,
        body: `${event.contract.consumerName}'s traffic to ${where(event.contract)} passes through unpatched again.`,
        path: `/patches/${event.patchId}`,
        audience: 'members',
      };
    default:
      return null;
  }
}

/** Channels used when a member hasn't chosen: reviewers hear about anything needing action. */
export function defaultChannels(role: OrgRole, event: NotificationEvent): NotificationChannel[] {
  if (role === 'viewer') return [];
  switch (event) {
    case 'drift.breaking':
    case 'patch.awaiting_review':
      return ['email', 'push'];
    case 'patch.rejected':
    case 'patch.rolled_back':
      return ['email'];
    case 'patch.promoted':
      return [];
  }
}
