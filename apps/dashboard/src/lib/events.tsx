import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { StreamedEvent } from '@orchestrator/shared-types';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { keys } from './api';
import { useOrg } from './org';
import { accessToken } from './supabase';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/** Events about the healing pipeline; personal notifications only refresh the inbox. */
export type PipelineEvent = Exclude<StreamedEvent, { type: 'notification.created' }>;

interface LiveEvents {
  status: LiveStatus;
  /** Newest first. */
  events: PipelineEvent[];
}

const MAX_EVENTS = 100;
const LiveEventsContext = createContext<LiveEvents>({ status: 'offline', events: [] });

/** Keeps cached queries fresh by invalidating exactly what an event changed. */
export function invalidateFor(event: StreamedEvent, queries: QueryClient, slug: string): void {
  const invalidate = (queryKey: readonly unknown[]) =>
    void queries.invalidateQueries({ queryKey });
  const org = keys.org(slug);
  switch (event.type) {
    case 'drift.detected':
      invalidate(keys.stats(slug));
      invalidate(keys.services(slug));
      invalidate([...org, 'drift-events']);
      return;
    case 'patch.generated':
    case 'patch.rejected':
    case 'patch.deployed':
    case 'patch.promoted':
    case 'patch.rolledBack':
      invalidate(keys.stats(slug));
      invalidate(keys.services(slug));
      invalidate([...org, 'patches']);
      invalidate(keys.patch(slug, event.patchId));
      invalidate([...org, 'drift-events']);
      invalidate([...org, 'drift-event']);
      invalidate(keys.audits(slug));
      return;
    case 'notification.created':
      // The gateway only streams a member their own notifications.
      invalidate(keys.inbox(slug));
      return;
    case 'request.proxied':
      // Canary traffic counters live on the patch detail.
      invalidate([...org, 'patch']);
      return;
  }
}

/** Streams this organization's pipeline events; remounts (reconnects) when the org changes. */
export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient();
  const { slug, api } = useOrg();
  const [state, setState] = useState<LiveEvents>({ status: 'connecting', events: [] });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'connecting', events: [] });
    void fetchEventSource(api.eventsUrl, {
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
        const event = JSON.parse(message.data) as StreamedEvent | { type: 'heartbeat' };
        if (event.type === 'heartbeat') return;
        invalidateFor(event, queries, slug);
        if (event.type === 'notification.created') return;
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
  }, [queries, slug, api.eventsUrl]);

  return <LiveEventsContext.Provider value={state}>{children}</LiveEventsContext.Provider>;
}

export const useLiveEvents = () => useContext(LiveEventsContext);
