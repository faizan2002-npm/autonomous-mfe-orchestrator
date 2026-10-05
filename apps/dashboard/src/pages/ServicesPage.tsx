import type { ContractView, FieldPinsView, RegisteredService } from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Pin, Plug, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Stat } from '@/components/common';
import { OpenApiPanel } from '@/components/OpenApiPanel';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { keys, type ServiceInput } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useOrg, useOrgPath } from '@/lib/org';
import { cn } from '@/lib/utils';
import { DriftTable } from '@/pages/DriftPage';

type HeaderRow = { name: string; value: string };

function ServiceForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial?: RegisteredService;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: ServiceInput) => void;
}) {
  const [serviceName, setServiceName] = useState(initial?.serviceName ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [healthPath, setHealthPath] = useState(initial?.healthPath ?? '');
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.timeoutMs ?? 10_000));
  // Header values are write-only: existing ones are never sent back to the browser.
  const [replaceHeaders, setReplaceHeaders] = useState(!initial?.upstreamHeaderNames.length);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input: ServiceInput = {
      baseUrl,
      description,
      healthPath,
      timeoutMs: Number(timeoutMs),
    };
    if (!initial) input.serviceName = serviceName;
    if (replaceHeaders)
      input.upstreamHeaders = Object.fromEntries(
        headers.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.value]),
      );
    onSubmit(input);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial && (
        <div className="space-y-2">
          <Label htmlFor="service-name">Name</Label>
          <Input
            id="service-name"
            required
            pattern="[a-z0-9][a-z0-9-]{0,62}"
            placeholder="user-service"
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value.toLowerCase())}
          />
          <p className="text-xs text-muted-foreground">
            Consumers call <code>/api/v1/{serviceName || '<name>'}/…</code>
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="base-url">Base URL</Label>
        <Input id="base-url" type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="health-path">Health path</Label>
          <Input id="health-path" placeholder="/health" value={healthPath} onChange={(event) => setHealthPath(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="timeout">Timeout (ms)</Label>
          <Input
            id="timeout"
            type="number"
            min={100}
            max={60_000}
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Upstream headers</Label>
        <p className="text-xs text-muted-foreground">
          Sent with every forwarded request (e.g. service credentials). Stored encrypted; values are never shown again.
        </p>
        {initial?.upstreamHeaderNames.length && !replaceHeaders ? (
          <div className="flex flex-wrap items-center gap-2">
            {initial.upstreamHeaderNames.map((name) => (
              <Badge key={name} variant="outline">{name}: ••••</Badge>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setReplaceHeaders(true)}>Replace</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {headers.map((row, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  placeholder="Authorization"
                  aria-label="Header name"
                  value={row.name}
                  onChange={(event) =>
                    setHeaders(headers.map((h, i) => (i === index ? { ...h, name: event.target.value } : h)))
                  }
                />
                <Input
                  placeholder="Bearer …"
                  type="password"
                  autoComplete="off"
                  aria-label="Header value"
                  value={row.value}
                  onChange={(event) =>
                    setHeaders(headers.map((h, i) => (i === index ? { ...h, value: event.target.value } : h)))
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove header"
                  onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setHeaders([...headers, { name: '', value: '' }])}>
              <Plus />Add header
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function ServicesPage() {
  const { slug, api, can } = useOrg();
  const p = useOrgPath();
  const queries = useQueryClient();
  const registry = useQuery({ queryKey: keys.registry(slug), queryFn: api.registry });
  const health = useQuery({ queryKey: keys.services(slug), queryFn: api.services });
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    mutationFn: (input: ServiceInput) => api.createService(input),
    onSuccess: (service) => {
      void queries.invalidateQueries({ queryKey: keys.registry(slug) });
      void queries.invalidateQueries({ queryKey: keys.services(slug) });
      setAdding(false);
      toast.success(`${service.serviceName} registered; grant it to a consumer to start routing`);
    },
  });
  const summary = (name: string) => health.data?.find((service) => service.serviceName === name);

  return (
    <>
      <PageHeader
        title="Services"
        description="Upstream APIs your consumers reach through the gateway."
        actions={can('admin') && <Button onClick={() => setAdding(true)}><Plus />Add service</Button>}
      />
      <Card className="py-0">
        {registry.error ? (
          <CardContent className="py-6"><ErrorState error={registry.error} /></CardContent>
        ) : !registry.data ? (
          <CardContent className="py-6"><LoadingRows /></CardContent>
        ) : !registry.data.length ? (
          <CardContent className="py-6">
            <EmptyState title="No services registered">Add the APIs your frontends and backends depend on.</EmptyState>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Base URL</TableHead>
                <TableHead className="text-right">Contracts</TableHead>
                <TableHead className="pr-6 text-right">Last drift</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registry.data.map((service) => (
                <TableRow key={service.id}>
                  <TableCell className="pl-6 font-medium">
                    <Link to={p(`/services/${encodeURIComponent(service.serviceName)}`)} className="hover:underline">
                      {service.serviceName}
                    </Link>
                  </TableCell>
                  <TableCell><StatusBadge value={service.status} /></TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{service.baseUrl}</TableCell>
                  <TableCell className="text-right tabular-nums">{summary(service.serviceName)?.contractCount ?? 0}</TableCell>
                  <TableCell className="pr-6 text-right text-muted-foreground">
                    {relativeTime(summary(service.serviceName)?.lastDriftAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add service</DialogTitle>
            <DialogDescription>Private and cloud-metadata addresses are refused unless explicitly allowed.</DialogDescription>
          </DialogHeader>
          <ServiceForm
            submitLabel="Add service"
            busy={create.isPending}
            error={create.error?.message ?? null}
            onSubmit={(input) => create.mutate(input)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Field paths of a contract, from its path:type tokens. */
function fieldPaths(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.slice(0, token.lastIndexOf(':'))))].sort();
}

type PinState = 'default' | 'required' | 'ignored';

function PinsDialog({ contract, onClose }: { contract: ContractView | null; onClose: () => void }) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const [states, setStates] = useState<Record<string, PinState>>({});
  const [opened, setOpened] = useState<string | null>(null);
  if (contract && opened !== contract.id) {
    const initial: Record<string, PinState> = {};
    for (const path of contract.pinnedFields?.required ?? []) initial[path] = 'required';
    for (const path of contract.pinnedFields?.ignored ?? []) initial[path] = 'ignored';
    setStates(initial);
    setOpened(contract.id);
  }
  const save = useMutation({
    mutationFn: (pins: FieldPinsView) => api.pinContract(contract!.id, pins),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: keys.service(slug, contract!.serviceName) });
      toast.success('Contract pins saved; they apply from the next request');
      setOpened(null);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const pins = (state: PinState) => Object.entries(states).filter(([, s]) => s === state).map(([path]) => path);
  return (
    <Dialog open={contract !== null} onOpenChange={(next) => !next && (setOpened(null), onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pin fields for {contract?.consumerName}</DialogTitle>
          <DialogDescription>
            Mark the fields this consumer actually reads. When any field is marked "depends on", drift is judged only on
            those; ignored fields never count.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-96 divide-y overflow-auto rounded-lg border">
          {fieldPaths(contract?.schemaTokens ?? []).map((path) => (
            <li key={path} className="flex items-center justify-between gap-2 px-3 py-2">
              <code className="truncate font-mono text-xs">{path}</code>
              <div className="flex shrink-0 rounded-md border p-0.5 text-xs" role="radiogroup" aria-label={path}>
                {(['default', 'required', 'ignored'] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    role="radio"
                    aria-checked={(states[path] ?? 'default') === state}
                    onClick={() => setStates({ ...states, [path]: state })}
                    className={cn(
                      'rounded px-2 py-0.5',
                      (states[path] ?? 'default') === state ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {state === 'required' ? 'depends on' : state}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => (setOpened(null), onClose())}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ required: pins('required'), ignored: pins('ignored') })}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save pins
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceDetailPage() {
  const { slug, api, can } = useOrg();
  const p = useOrgPath();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const { name = '' } = useParams();
  const registry = useQuery({ queryKey: keys.registry(slug), queryFn: api.registry });
  const detail = useQuery({ queryKey: keys.service(slug, name), queryFn: () => api.service(name) });
  const registered = registry.data?.find((service) => service.serviceName === name);
  const [pinning, setPinning] = useState<ContractView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const test = useMutation({ mutationFn: () => api.testService(registered!.id) });
  const update = useMutation({
    mutationFn: (input: ServiceInput) => api.updateService(registered!.id, input),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: keys.registry(slug) });
      toast.success('Service updated');
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteService(registered!.id),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: keys.org(slug) });
      toast.success(`${name} deleted`);
      navigate(p('/services'), { replace: true });
    },
    onError: (error) => toast.error(error.message),
  });

  const contractsByConsumer = new Map<string, ContractView[]>();
  for (const contract of detail.data?.contracts ?? [])
    contractsByConsumer.set(contract.consumerName, [...(contractsByConsumer.get(contract.consumerName) ?? []), contract]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to={p('/services')}><ChevronLeft />Services</Link>
      </Button>
      <PageHeader
        title={name}
        description={registered?.baseUrl}
        actions={
          registered && (
            <>
              <StatusBadge value={registered.status} />
              {can('reviewer') && (
                <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
                  {test.isPending ? <Loader2 className="animate-spin" /> : <Plug />}
                  Test connection
                </Button>
              )}
              {can('admin') && (
                <Button variant="ghost" size="icon" aria-label="Delete service" onClick={() => setDeleting(true)}>
                  <Trash2 />
                </Button>
              )}
            </>
          )
        }
      />
      {test.data && (
        <p className={cn('-mt-3 mb-4 text-sm', test.data.ok ? 'text-success' : 'text-destructive')}>
          {test.data.ok
            ? `Reachable: HTTP ${test.data.status} in ${test.data.latencyMs} ms`
            : `Unreachable: ${test.data.error ?? `HTTP ${test.data.status}`}`}
        </p>
      )}
      {registry.error || detail.error ? (
        <ErrorState error={registry.error ?? detail.error} />
      ) : !registered || !detail.data ? (
        <LoadingRows />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label="Contracts" value={detail.data.contractCount} />
              <Stat label="Consumers observed" value={contractsByConsumer.size} />
              <Stat label="Last drift" value={relativeTime(detail.data.lastDriftAt)} />
              <Stat label="Timeout" value={`${registered.timeoutMs} ms`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contracts by consumer</CardTitle>
              <CardDescription>
                Each consumer's baseline per endpoint comes from the imported OpenAPI spec, or else from its first
                response. Pin the fields a consumer depends on to ignore irrelevant changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!contractsByConsumer.size && (
                <EmptyState title="No traffic yet">Contracts appear after the first request through the gateway.</EmptyState>
              )}
              {[...contractsByConsumer.entries()].map(([consumer, contracts]) => (
                <div key={consumer} className="space-y-3">
                  <p className="text-sm font-semibold">{consumer}</p>
                  {contracts.map((contract) => (
                    <div key={contract.id} className="rounded-lg border p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <code className="font-mono text-sm">
                          <span className="font-semibold">{contract.httpMethod}</span> {contract.endpointPath}
                        </code>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {contract.pinnedFields && (
                            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
                              <Pin className="size-3" />
                              {contract.pinnedFields.required.length} pinned · {contract.pinnedFields.ignored.length} ignored
                            </Badge>
                          )}
                          <span>
                            v{contract.version} · {contract.fieldCount} fields · {contract.source} · {relativeTime(contract.createdAt)}
                          </span>
                          {can('reviewer') && (
                            <Button size="sm" variant="outline" onClick={() => setPinning(contract)}>
                              <Pin />Pins
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {contract.schemaTokens.map((token) => {
                          const path = token.slice(0, token.lastIndexOf(':'));
                          const ignored = contract.pinnedFields?.ignored.some((pin) => path === pin || path.startsWith(`${pin}.`));
                          const required = contract.pinnedFields?.required.some((pin) => path === pin || path.startsWith(`${pin}.`));
                          return (
                            <code
                              key={token}
                              className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-xs',
                                required ? 'bg-primary/15 text-primary' : 'bg-muted',
                                ignored && 'line-through opacity-50',
                              )}
                            >
                              {token}
                            </code>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <OpenApiPanel service={registered} />

          {can('admin') && (
            <Card>
              <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
              <CardContent>
                <ServiceForm
                  key={registered.id}
                  initial={registered}
                  submitLabel="Save changes"
                  busy={update.isPending}
                  error={update.error?.message ?? null}
                  onSubmit={(input) => update.mutate(input)}
                />
              </CardContent>
            </Card>
          )}

          <Card className="pb-0">
            <CardHeader><CardTitle>Recent drift</CardTitle></CardHeader>
            {detail.data.recentDrift.length ? (
              <DriftTable events={detail.data.recentDrift} />
            ) : (
              <CardContent className="pb-6"><EmptyState title="No drift recorded for this service" /></CardContent>
            )}
          </Card>
        </div>
      )}
      <PinsDialog contract={pinning} onClose={() => setPinning(null)} />
      <ConfirmDialog
        open={deleting}
        title={`Delete ${name}?`}
        description="Consumers can no longer call it, and its contracts, drift history and patches are deleted."
        confirmLabel="Delete service"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}
