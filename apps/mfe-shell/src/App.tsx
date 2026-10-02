import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { RemoteBoundary } from './RemoteBoundary';

type CanaryMode = 'on' | 'off' | 'sampled';
type RemoteProps = { gatewayUrl: string; canary?: CanaryMode; refreshKey?: number };

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:4000';
const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5100';
const AUTO_REFRESH_MS = 3_000;

const CANARY_OPTIONS: Array<{ value: CanaryMode; label: string; hint: string }> = [
  { value: 'on', label: 'Canary', hint: 'Send x-mfe-canary: true (receives new patches first)' },
  { value: 'sampled', label: 'Sampled', hint: 'Let the gateway sample by its canary percentage' },
  { value: 'off', label: 'Baseline', hint: 'Send x-mfe-canary: false (only promoted patches)' },
];

function CrashPanel({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const loadFailure = /remote|fetch dynamically imported|Failed to fetch/i.test(error.message);
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-semibold text-red-700">
        {loadFailure ? 'Micro-frontend unavailable' : 'Micro-frontend crashed'}
      </p>
      <code className="mt-1 block break-words font-mono text-xs text-red-600">
        {error.name}: {error.message}
      </code>
      <p className="mt-2 text-xs text-red-700/80">
        {loadFailure
          ? 'Its remoteEntry.js could not be loaded. Is the remote dev server running?'
          : 'The upstream API no longer matches the contract this UI was built for. The gateway heals canary traffic first, then everyone once a reviewer promotes the patch.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        Retry now
      </button>
    </div>
  );
}

function RemotePanel({
  title,
  owner,
  load,
  canary,
  refreshKey,
  onRetry,
}: {
  title: string;
  owner: string;
  load: () => Promise<{ default: ComponentType<RemoteProps> }>;
  canary: CanaryMode;
  refreshKey: number;
  onRetry: () => void;
}) {
  // A new lazy component per refresh so a failed remoteEntry load is retried, not cached.
  const Remote = useMemo(() => lazy(load), [load, refreshKey]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">{owner}</span>
      </header>
      <RemoteBoundary resetKey={refreshKey} fallback={(error) => <CrashPanel error={error} onRetry={onRetry} />}>
        <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-slate-100" />}>
          <Remote gatewayUrl={GATEWAY_URL} canary={canary} refreshKey={refreshKey} />
        </Suspense>
      </RemoteBoundary>
    </section>
  );
}

const loadProfile = () => import('mfe_user/ProfileCard');
const loadOrder = () => import('mfe_order/OrderCard');

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        className="size-4 accent-indigo-600"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
  );
}

export function App() {
  const [canary, setCanary] = useState<CanaryMode>('on');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((key) => key + 1);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  return (
    <div className="min-h-svh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">A</div>
            <div className="leading-tight">
              <p className="font-semibold text-slate-900">Acme Portal</p>
              <p className="text-xs text-slate-500">Host shell · Module Federation</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="Canary routing">
              {CANARY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={canary === option.value}
                  title={option.hint}
                  onClick={() => {
                    setCanary(option.value);
                    refresh();
                  }}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                    canary === option.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Toggle checked={autoRefresh} onChange={setAutoRefresh}>Auto-refresh</Toggle>
            <button
              type="button"
              onClick={refresh}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
            <a
              href={`${DASHBOARD_URL}/demo`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Governance dashboard
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="mb-6 max-w-3xl text-sm text-slate-600">
          Each card below is an independently deployed micro-frontend, loaded at runtime from its own
          <code className="mx-1 rounded bg-slate-100 px-1 font-mono text-xs">remoteEntry.js</code>
          and calling its backend through the orchestrating gateway. Inject drift from the dashboard's Demo Lab
          and watch a card crash, then heal.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <RemotePanel title="My profile" owner="mfe-user" load={loadProfile} canary={canary} refreshKey={refreshKey} onRetry={refresh} />
          <RemotePanel title="Latest order" owner="mfe-order" load={loadOrder} canary={canary} refreshKey={refreshKey} onRetry={refresh} />
        </div>
      </main>
    </div>
  );
}
