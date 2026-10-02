import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Stat } from '@/components/common';
import { DriftTable } from '@/pages/DriftPage';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, keys } from '@/lib/api';
import { relativeTime } from '@/lib/format';

export function ServicesPage() {
  const services = useQuery({ queryKey: keys.services, queryFn: api.services });
  return (
    <>
      <PageHeader title="Services" description="Upstream services the gateway has observed." />
      <Card className="py-0">
        {services.error ? (
          <CardContent className="py-6"><ErrorState error={services.error} /></CardContent>
        ) : !services.data ? (
          <CardContent className="py-6"><LoadingRows /></CardContent>
        ) : !services.data.length ? (
          <CardContent className="py-6">
            <EmptyState title="No services observed yet">
              Send a request through the gateway (or use the Demo Lab) to register one.
            </EmptyState>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Upstream</TableHead>
                <TableHead className="text-right">Contracts</TableHead>
                <TableHead className="pr-6 text-right">Last drift</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.data.map((service) => (
                <TableRow key={service.id} className="cursor-pointer">
                  <TableCell className="pl-6 font-medium">
                    <Link to={`/services/${encodeURIComponent(service.serviceName)}`} className="hover:underline">
                      {service.serviceName}
                    </Link>
                  </TableCell>
                  <TableCell><StatusBadge value={service.status} /></TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {service.endpointUrl}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{service.contractCount}</TableCell>
                  <TableCell className="pr-6 text-right text-muted-foreground">{relativeTime(service.lastDriftAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

export function ServiceDetailPage() {
  const { name = '' } = useParams();
  const service = useQuery({ queryKey: keys.service(name), queryFn: () => api.service(name) });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/services"><ChevronLeft />Services</Link>
      </Button>
      <PageHeader
        title={name}
        description={service.data?.endpointUrl}
        actions={service.data && <StatusBadge value={service.data.status} />}
      />
      {service.error ? (
        <ErrorState error={service.error} />
      ) : !service.data ? (
        <LoadingRows />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label="Contracts" value={service.data.contractCount} />
              <Stat label="Last drift" value={relativeTime(service.data.lastDriftAt)} />
              <Stat label="Updated" value={relativeTime(service.data.updatedAt)} />
              <Stat label="Recent drift events" value={service.data.recentDrift.length} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Contract baselines</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {service.data.contracts.map((contract) => (
                <div key={contract.id} className="rounded-lg border p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <code className="font-mono text-sm">
                      <span className="font-semibold">{contract.httpMethod}</span> {contract.endpointPath}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      v{contract.version} · {contract.fieldCount} fields · learned {relativeTime(contract.createdAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {contract.schemaTokens.map((token) => (
                      <code key={token} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{token}</code>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="pb-0">
            <CardHeader><CardTitle>Recent drift</CardTitle></CardHeader>
            {service.data.recentDrift.length ? (
              <DriftTable events={service.data.recentDrift} />
            ) : (
              <CardContent className="pb-6"><EmptyState title="No drift recorded for this service" /></CardContent>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
