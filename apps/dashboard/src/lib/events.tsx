import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { GatewayEvent } from '@orchestrator/shared-types';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { keys } from './api';
import { env } from './env';
import { accessToken } from './supabase';

export type LiveStatus = 'connecting' | 'live' | 'offline';

interface LiveEvents {
  status: LiveStatus;
  /** Newest first. */
  events: GatewayEvent[];
}

const MAX_EVENTS = 100;
const LiveEventsContext = createContext<LiveEvents>({ status: 'offline', events: [] });

/** Keeps cached queries fresh by invalidating exactly what an event changed. */
export function invalidateFor(event: GatewayEvent, queries: QueryClient): void {
  const invalidate = (queryKey: readonly unknown[]) =>
    void queries.invalidateQueries({ queryKey });
  switch (event.type) {
    case 'drift.detected':
      invalidate(keys.stats);
      invalidate(keys.services);
      invalidate(['drift-events']);
      return;
    case 'patch.generated':
    case 'patch.rejected':
    case 'patch.deployed':
    case 'patch.promoted':
    case 'patch.rolledBack':
      invalidate(keys.stats);
      invalidate(keys.services);
      invalidate(['patches']);
      invalidate(keys.patch(event.patchId));
      invalidate(['drift-events']);
      invalidate(['drift-event']);
      invalidate(keys.audits);
      return;
    case 'request.proxied':
      // Canary traffic counters live on the patch detail.
      invalidate(['patch']);
      return;
  }
}

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient();
  const [state, setState] = useState<LiveEvents>({ status: 'connecting', events: [] });

  useEffect(() => {
    const controller = new AbortController();
    void fetchEventSource(`${env.gatewayUrl}/api/governance/events`, {
      signal: controller.signal,
      openWhenHidden: true,
      // A fresh token on every (re)connect, since access tokens expire.
      fetch: async (input, init) => {
        const token = await accessToken();
        return fetch(input, {
          ...init,
          headers: { ...init?.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        });
      },
      onopen: async (response) => {
        if (!response.ok) throw new Error(`Event stream refused (${response.status})`);
        setState((current) => ({ ...current, status: 'live' }));
      },
      onmessage: (message) => {
        // Keep-alive lines arrive as empty messages.
        if (!message.data) return;
        const event = JSON.parse(message.data) as GatewayEvent | { type: 'heartbeat' };
        if (event.type === 'heartbeat') return;
        invalidateFor(event, queries);
        setState((current) => ({
          status: 'live',
          events: [event, ...current.events].slice(0, MAX_EVENTS),
        }));
      },
      onerror: () => {
        setState((current) => ({ ...current, status: 'offline' }));
        return 5_000; // retry after 5 s
      },
    });
    return () => controller.abort();
  }, [queries]);

  return <LiveEventsContext.Provider value={state}>{children}</LiveEventsContext.Provider>;
}

export const useLiveEvents = () => useContext(LiveEventsContext);
