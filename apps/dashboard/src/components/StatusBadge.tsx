import type {
  DriftType,
  GovernanceStatus,
  PatchStatus,
  ServiceStatus,
  Severity,
} from '@orchestrator/shared-types';
import { Badge } from '@/components/ui/badge';
import { humanize } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-primary/30 bg-primary/10 text-primary',
  neutral: 'border-border bg-muted text-muted-foreground',
};

const TONE_BY_VALUE: Record<string, Tone> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  DRIFTING: 'warning',
  FAILING: 'danger',
  ACTIVE: 'success',
  CANARY: 'info',
  VALIDATED: 'info',
  GENERATING: 'neutral',
  FAILED: 'danger',
  SUPERSEDED: 'neutral',
  ROLLED_BACK: 'danger',
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'warning',
  CRITICAL: 'danger',
  AUTO_APPROVED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  PENDING_REVIEW: 'warning',
  ESCALATED: 'warning',
};

export type StatusValue = ServiceStatus | PatchStatus | Severity | GovernanceStatus | DriftType;

export function StatusBadge({ value, className }: { value: StatusValue; className?: string }) {
  const tone = TONE_BY_VALUE[value] ?? 'neutral';
  return (
    <Badge variant="outline" className={cn('font-medium', TONES[tone], className)}>
      {value === 'FAILED' ? 'Rejected' : humanize(value)}
    </Badge>
  );
}
