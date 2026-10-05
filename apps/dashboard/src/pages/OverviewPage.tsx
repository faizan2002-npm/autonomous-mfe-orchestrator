import type { DriftEventView } from '@orchestrator/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Activity, GitPullRequestArrow, Rocket, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ActivityFeed } from '@/components/ActivityFeed';
import { ContractLabel, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { keys } from '@/lib/api';
import { useOrg, useOrgPath } from '@/lib/org';
import { percent, relativeTime } from '@/lib/format';

function Kpi({ label, value, hint, icon }: { label: string; value: ReactNode; hint: ReactNode; icon: ReactNode }) {
  return (
    <Card className="gap-2 py-5">
      <CardContent className="flex items-start justify-between gap-4 px-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      </CardContent>
    </Card>
  );
}

function driftPerHour(events: DriftEventView[]) {
  const now = Date.now();
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const start = new Date(now - (23 - index) * 3_600_000);
    return { hour: `${start.getHours().toString().padStart(2, '0')}:00`, breaking: 0, other: 0 };
  });
  for (const event of events) {
    const age = Math.floor((now - Date.parse(event.detectedAt)) / 3_600_000);
    if (age < 0 || age > 23) continue;
    const bucket = buckets[23 - age];
    if (event.isBreaking) bucket.breaking++;
    else bucket.other++;
  }
  return buckets;
}

export function OverviewPage() {
  const { slug, api } = useOrg();
  const p = useOrgPath();
  const stats = useQuery({ queryKey: keys.stats(slug), queryFn: api.stats });
  const services = useQuery({ queryKey: keys.services(slug), queryFn: api.services });
  const drift = useQuery({ queryKey: keys.driftEvents(slug, { limit: 100 }), queryFn: () => api.driftEvents({ limit: 100 }) });
  const canary = useQuery({ queryKey: keys.patches(slug, { status: 'CANARY' }), queryFn: () => api.patches({ status: 'CANARY' }) });

  const totalServices = stats.data ? Object.values(stats.data.services).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Contract drift across your upstream services and the patches healing it."
      />

      {stats.error ? (
        <ErrorState error={stats.error} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.data ? (
            <>
              <Kpi
                label="Healthy services"
                value={`${stats.data.services.HEALTHY}/${totalServices}`}
                hint={`${stats.data.services.DRIFTING} drifting`}
                icon={<Server className="size-4.5" />}
              />
              <Kpi
                label="Drift events (24h)"
                value={stats.data.driftEvents24h}
                hint={`${stats.data.breakingDriftEvents24h} breaking`}
                icon={<Activity className="size-4.5" />}
              />
              <Kpi
                label="Awaiting promotion"
                value={stats.data.patches.CANARY}
                hint="Patches serving canary traffic"
                icon={<GitPullRequestArrow className="size-4.5" />}
              />
              <Kpi
                label="Active patches"
                value={stats.data.patches.ACTIVE}
                hint={`${stats.data.patches.FAILED} rejected by verification`}
                icon={<Rocket className="size-4.5" />}
              />
            </>
          ) : (
            Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32" />)
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Drift events per hour</CardTitle>
            <CardDescription>Last 24 hours, breaking vs non-breaking</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {drift.data ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={driftPerHour(drift.data.items)} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={3} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="breaking" name="Breaking" stackId="d" fill="var(--chart-4)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="other" name="Non-breaking" stackId="d" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : drift.error ? (
              <ErrorState error={drift.error} />
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Live activity</CardTitle>
            <CardDescription>Pipeline events as they happen</CardDescription>
          </CardHeader>
          <CardContent className="max-h-64 overflow-auto px-4">
            <ActivityFeed limit={10} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Service health</CardTitle>
          </CardHeader>
          <CardContent>
            {services.error ? (
              <ErrorState error={services.error} />
            ) : !services.data ? (
              <LoadingRows rows={3} />
            ) : !services.data.length ? (
              <EmptyState title="No services observed yet">
                Services register automatically on their first proxied request.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {services.data.map((service) => (
                  <li key={service.id}>
                    <Link
                      to={p(`/services/${encodeURIComponent(service.serviceName)}`)}
                      className="flex items-center justify-between gap-4 py-3 hover:opacity-80"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{service.serviceName}</p>
                        <p className="text-xs text-muted-foreground">
                          {service.contractCount} contract{service.contractCount === 1 ? '' : 's'} · last drift{' '}
                          {relativeTime(service.lastDriftAt)}
                        </p>
                      </div>
                      <StatusBadge value={service.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting promotion</CardTitle>
            <CardDescription>Verified patches serving canary traffic</CardDescription>
          </CardHeader>
          <CardContent>
            {canary.error ? (
              <ErrorState error={canary.error} />
            ) : !canary.data ? (
              <LoadingRows rows={3} />
            ) : !canary.data.length ? (
              <EmptyState title="Nothing to review">New patches appear here after a breaking drift.</EmptyState>
            ) : (
              <ul className="divide-y">
                {canary.data.map((patch) => (
                  <li key={patch.id}>
                    <Link to={p(`/patches/${patch.id}`)} className="flex items-center justify-between gap-4 py-3 hover:opacity-80">
                      <div className="min-w-0">
                        <ContractLabel contract={patch.contract} />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {patch.canaryPercent}% traffic · confidence {percent(patch.confidenceScore)} ·{' '}
                          {relativeTime(patch.createdAt)}
                        </p>
                      </div>
                      <StatusBadge value={patch.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
