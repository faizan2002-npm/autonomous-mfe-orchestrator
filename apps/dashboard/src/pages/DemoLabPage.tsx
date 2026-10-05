import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, CircleSlash, ExternalLink, Loader2, Send, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ActivityFeed } from '@/components/ActivityFeed';
import { ErrorState, JsonView, LoadingRows, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { keys } from '@/lib/api';
import { useOrg, useOrgPath } from '@/lib/org';
import { env } from '@/lib/env';
import { useLiveEvents, type PipelineEvent } from '@/lib/events';
import { cn } from '@/lib/utils';

/** Sample paths of the demo services; other services start at their root. */
const SAMPLE_PATHS: Record<string, string> = {
  'user-service': 'users/101',
  'order-service': 'orders/9821',
};
const endpointFor = (service: string, path: string) => `/api/v1/${service}/${path.replace(/^\/+/, '')}`;

type CanaryMode = 'on' | 'off' | 'sampled';

interface ProxyResult {
  status: number;
  healed: boolean;
  durationMs: number;
  body: unknown;
}

async function sendThroughGateway(path: string, apiKey: string, canary: CanaryMode): Promise<ProxyResult> {
  const started = performance.now();
  const response = await fetch(`${env.gatewayUrl}${path}`, {
    headers: {
      'x-orchestrator-key': apiKey,
      ...(canary === 'sampled' ? {} : { 'x-mfe-canary': canary === 'on' ? 'true' : 'false' }),
    },
  });
  return {
    status: response.status,
    healed: response.headers.get('x-orchestrator-healed') === 'true',
    durationMs: performance.now() - started,
    body: await response.json().catch(() => null),
  };
}

type StepState = 'done' | 'failed' | 'pending';

/** The latest healing run for a service, reconstructed from the live event stream. */
function pipelineFor(serviceName: string, events: PipelineEvent[]) {
  const drift = events.find((event) => event.type === 'drift.detected' && event.contract.serviceName === serviceName);
  const after = drift
    ? events.filter(
        (event) =>
          event.at >= drift.at &&
          event.contract.serviceName === serviceName &&
          event.contract.endpointPath === drift.contract.endpointPath,
      )
    : [];
  const has = (type: PipelineEvent['type']) => after.find((event) => event.type === type);
  const rejected = has('patch.rejected');
  const patch = has('patch.generated') ?? rejected;
  const steps: Array<{ label: string; state: StepState; detail?: string }> = [
    { label: 'Drift detected', state: drift ? 'done' : 'pending' },
    {
      label: rejected ? 'Patch rejected' : 'Patch generated & verified',
      state: rejected ? 'failed' : has('patch.generated') ? 'done' : 'pending',
      detail: rejected?.type === 'patch.rejected' ? rejected.reason : undefined,
    },
    { label: 'Canary deployed', state: has('patch.deployed') ? 'done' : 'pending' },
    { label: 'Promoted to 100%', state: has('patch.promoted') ? 'done' : 'pending' },
  ];
  return { steps, patchId: patch && 'patchId' in patch ? patch.patchId : undefined };
}

function Pipeline({ serviceName }: { serviceName: string }) {
  const p = useOrgPath();
  const { events } = useLiveEvents();
  const { steps, patchId } = pipelineFor(serviceName, events);
  const Icon = { done: CheckCircle2, failed: CircleSlash, pending: CircleDashed };
  return (
    <div>
      <ol className="grid gap-3 sm:grid-cols-4">
        {steps.map((step, index) => {
          const StepIcon = Icon[step.state];
          return (
            <li
              key={step.label}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                step.state === 'done' && 'border-success/40 bg-success/5',
                step.state === 'failed' && 'border-destructive/40 bg-destructive/5',
              )}
            >
              <div className="flex items-center gap-2">
                <StepIcon
                  className={cn(
                    'size-4',
                    step.state === 'done' && 'text-success',
                    step.state === 'failed' && 'text-destructive',
                    step.state === 'pending' && 'text-muted-foreground',
                  )}
                />
                <span className="text-xs text-muted-foreground">Step {index + 1}</span>
              </div>
              <p className="mt-1 text-sm font-medium">{step.label}</p>
              {step.detail && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{step.detail}</p>}
            </li>
          );
        })}
      </ol>
      {patchId && (
        <Button asChild variant="link" className="mt-2 px-0">
          <Link to={p(`/patches/${patchId}`)}>Review this patch →</Link>
        </Button>
      )}
    </div>
  );
}

export function DemoLabPage() {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const services = useQuery({ queryKey: keys.demoServices(slug), queryFn: api.demoServices });
  const [target, setTarget] = useState('user-service');
  const [path, setPath] = useState(SAMPLE_PATHS['user-service']);
  // Kept in memory only; defaults to the demo frontend's publishable key.
  const [apiKey, setApiKey] = useState(env.demoConsumerKey);
  const registry = useQuery({ queryKey: keys.registry(slug), queryFn: api.registry });
  const [canary, setCanary] = useState<CanaryMode>('on');

  const chaos = useMutation({
    mutationFn: ({ serviceName, mutated }: { serviceName: string; mutated: boolean }) =>
      api.setChaos(serviceName, mutated),
    onSuccess: (state) => {
      queries.setQueryData(keys.demoServices(slug), (current: typeof services.data) =>
        current?.map((item) => (item.serviceName === state.serviceName ? state : item)),
      );
      toast.success(`${state.serviceName}: ${state.mutated ? 'schema drift injected' : 'stable contract restored'}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const send = useMutation({
    mutationFn: () => sendThroughGateway(endpointFor(target, path), apiKey, canary),
    onError: (error) => toast.error(`Gateway unreachable: ${error.message}`),
  });

  return (
    <>
      <PageHeader
        title="Demo Lab"
        description="Break an upstream contract and watch the gateway detect, patch and heal it live."
        actions={
          <Button asChild variant="outline">
            <a href={env.shellUrl} target="_blank" rel="noreferrer"><ExternalLink />Open MFE shell</a>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1 · Upstream chaos</CardTitle>
            <CardDescription>Switch a mock service to its drifted schema</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {services.error ? (
              <ErrorState error={services.error} />
            ) : !services.data ? (
              <LoadingRows rows={2} />
            ) : (
              services.data.map((service) => (
                <div key={service.serviceName} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{service.serviceName}</p>
                    <p className="text-xs text-muted-foreground">
                      {!service.reachable ? 'Unreachable — is it running?' : service.mutated ? 'Serving drifted schema' : 'Serving stable contract'}
                    </p>
                  </div>
                  <Switch
                    checked={service.mutated === true}
                    disabled={!service.reachable || chaos.isPending}
                    onCheckedChange={(mutated) => chaos.mutate({ serviceName: service.serviceName, mutated })}
                    aria-label={`Inject drift into ${service.serviceName}`}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>2 · Send traffic through the gateway</CardTitle>
            <CardDescription>The first drifted response triggers detection and patch generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Service</Label>
                <Select
                  value={target}
                  onValueChange={(next) => {
                    setTarget(next);
                    setPath(SAMPLE_PATHS[next] ?? '');
                  }}
                >
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(registry.data?.map((service) => service.serviceName) ?? Object.keys(SAMPLE_PATHS)).map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Canary routing</Label>
                <Select value={canary} onValueChange={(value) => setCanary(value as CanaryMode)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">Force canary</SelectItem>
                    <SelectItem value="off">Force baseline</SelectItem>
                    <SelectItem value="sampled">Sample by %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-40 flex-1 space-y-1.5">
                <Label htmlFor="demo-path">Path</Label>
                <Input id="demo-path" value={path} onChange={(event) => setPath(event.target.value)} />
              </div>
              <Button onClick={() => send.mutate()} disabled={send.isPending || !apiKey}>
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                Send request
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-key">Consumer API key</Label>
              <Input
                id="demo-key"
                type="password"
                autoComplete="off"
                placeholder="pk_… or sk_… (Consumers & keys)"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Sent as x-orchestrator-key. Requests count toward that consumer's contracts.
              </p>
            </div>
            <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              GET {env.gatewayUrl}{endpointFor(target, path)}
            </code>
            {send.data && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">HTTP {send.data.status}</Badge>
                  <Badge variant="outline">{send.data.durationMs.toFixed(0)} ms</Badge>
                  {send.data.healed ? (
                    <Badge className="gap-1 bg-success text-white"><Zap className="size-3" />x-orchestrator-healed</Badge>
                  ) : (
                    <Badge variant="outline">unpatched</Badge>
                  )}
                </div>
                <JsonView value={send.data.body} className="max-h-72" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>3 · Healing pipeline — {target}</CardTitle>
          <CardDescription>Driven by the gateway's live event stream</CardDescription>
        </CardHeader>
        <CardContent><Pipeline serviceName={target} /></CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Event stream</CardTitle>
          <CardDescription>Including proxied requests (sampled to one per second per endpoint)</CardDescription>
        </CardHeader>
        <CardContent className="max-h-96 overflow-auto px-4">
          <ActivityFeed limit={40} includeRequests />
        </CardContent>
      </Card>
    </>
  );
}
