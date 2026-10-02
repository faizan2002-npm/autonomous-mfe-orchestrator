import { DRIFT_TYPES, type DriftEventView, type DriftType } from '@orchestrator/shared-types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ContractLabel, EmptyState, ErrorState, JsonView, LoadingRows, PageHeader, Stat } from '@/components/common';
import { SchemaDiff } from '@/components/SchemaDiff';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, keys } from '@/lib/api';
import { absoluteTime, humanize, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const ALL = 'all';

export function DriftTable({ events }: { events: DriftEventView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Contract</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead className="text-right">Coefficient</TableHead>
          <TableHead className="hidden lg:table-cell">Patch</TableHead>
          <TableHead className="pr-6 text-right">Detected</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="max-w-72 pl-6">
              <Link to={`/drift/${event.id}`} className="hover:underline">
                <ContractLabel contract={event.contract} />
              </Link>
            </TableCell>
            <TableCell className="text-sm">{humanize(event.driftType)}</TableCell>
            <TableCell><StatusBadge value={event.severity} /></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{event.driftCoefficient.toFixed(2)}</TableCell>
            <TableCell className="hidden lg:table-cell">
              {event.patchId && event.patchStatus ? (
                <Link to={`/patches/${event.patchId}`}><StatusBadge value={event.patchStatus} /></Link>
              ) : (
                <span className="text-xs text-muted-foreground">{event.isBreaking ? 'Pending' : 'Not needed'}</span>
              )}
            </TableCell>
            <TableCell className="pr-6 text-right text-muted-foreground">{relativeTime(event.detectedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DriftPage() {
  const [params, setParams] = useSearchParams();
  const service = params.get('service') ?? undefined;
  const type = (params.get('type') as DriftType | null) ?? undefined;
  const services = useQuery({ queryKey: keys.services, queryFn: api.services });
  const drift = useInfiniteQuery({
    queryKey: keys.driftEvents({ service, type }),
    queryFn: ({ pageParam }) => api.driftEvents({ service, type, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const events = drift.data?.pages.flatMap((page) => page.items) ?? [];

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Drift events"
        description="Every time an upstream response stopped matching its learned contract."
        actions={
          <>
            <Select value={service ?? ALL} onValueChange={(value) => setFilter('service', value)}>
              <SelectTrigger className="w-40" aria-label="Filter by service"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All services</SelectItem>
                {services.data?.map((s) => (
                  <SelectItem key={s.id} value={s.serviceName}>{s.serviceName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={type ?? ALL} onValueChange={(value) => setFilter('type', value)}>
              <SelectTrigger className="w-44" aria-label="Filter by drift type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {DRIFT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      <Card className="py-0">
        {drift.error ? (
          <CardContent className="py-6"><ErrorState error={drift.error} /></CardContent>
        ) : drift.isPending ? (
          <CardContent className="py-6"><LoadingRows /></CardContent>
        ) : !events.length ? (
          <CardContent className="py-6">
            <EmptyState title="No drift events match">Trigger chaos in the Demo Lab to see one.</EmptyState>
          </CardContent>
        ) : (
          <DriftTable events={events} />
        )}
      </Card>
      {drift.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => void drift.fetchNextPage()} disabled={drift.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function CoefficientGauge({ value }: { value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-semibold tabular-nums">{value.toFixed(2)}</span>
        <span className="text-xs text-muted-foreground">0 = identical · 1 = nothing shared</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', value > 0.4 ? 'bg-destructive' : value > 0.15 ? 'bg-warning' : 'bg-success')}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function DriftDetailPage() {
  const { id = '' } = useParams();
  const event = useQuery({ queryKey: keys.driftEvent(id), queryFn: () => api.driftEvent(id) });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/drift"><ChevronLeft />Drift events</Link>
      </Button>
      {event.error ? (
        <ErrorState error={event.error} />
      ) : !event.data ? (
        <LoadingRows />
      ) : (
        <>
          <PageHeader
            title={humanize(event.data.driftType)}
            description={<ContractLabel contract={event.data.contract} />}
            actions={
              <>
                <StatusBadge value={event.data.severity} />
                {event.data.patchId && (
                  <Button asChild size="sm">
                    <Link to={`/patches/${event.data.patchId}`}>View patch</Link>
                  </Button>
                )}
              </>
            }
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Drift coefficient</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <CoefficientGauge value={event.data.driftCoefficient} />
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Breaking" value={event.data.isBreaking ? 'Yes' : 'No'} />
                  <Stat label="Detected" value={relativeTime(event.data.detectedAt)} hint={absoluteTime(event.data.detectedAt)} />
                  <Stat label="Missing fields" value={event.data.diff.missingFields.length} />
                  <Stat label="Added fields" value={event.data.diff.addedFields.length} />
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Schema diff</CardTitle>
                <CardDescription>Learned contract compared with the drifted response</CardDescription>
              </CardHeader>
              <CardContent>
                <SchemaDiff expectedSchema={event.data.expectedSchema} diff={event.data.diff} />
              </CardContent>
            </Card>
          </div>
          <Card className="mt-6">
            <CardHeader><CardTitle>Observed payload</CardTitle></CardHeader>
            <CardContent><JsonView value={event.data.observedPayload} /></CardContent>
          </Card>
        </>
      )}
    </>
  );
}
