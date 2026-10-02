import { formatDistanceToNowStrict } from 'date-fns';
import type { ContractRefView } from '@orchestrator/shared-types';

export const relativeTime = (iso: string | null | undefined) =>
  iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : '—';

export const absoluteTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : '—';

export const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;

export const contractLabel = (contract: ContractRefView) =>
  `${contract.httpMethod} ${contract.endpointPath}`;

export const shortId = (id: string) => id.slice(0, 8);

export const humanize = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
