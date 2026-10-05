import type { AuditView, PatchDetail, PatchStatus } from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, ChevronLeft, FlaskConical, Loader2, Sparkles, Undo2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  CodeBlock,
  ContractLabel,
  EmptyState,
  ErrorState,
  JsonView,
  LoadingRows,
  PageHeader,
  Stat,
} from '@/components/common';
import { SchemaDiff } from '@/components/SchemaDiff';
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
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { keys } from '@/lib/api';
import { useOrg, useOrgPath } from '@/lib/org';
import { absoluteTime, percent, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const TABS: Array<{ value: PatchStatus | 'ALL'; label: string }> = [
  { value: 'CANARY', label: 'Canary' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'FAILED', label: 'Rejected' },
  { value: 'ROLLED_BACK', label: 'Rolled back' },
  { value: 'SUPERSEDED', label: 'Superseded' },
  { value: 'ALL', label: 'All' },
];

function GeneratorBadge({ generator }: { generator: PatchDetail['generator'] }) {
  if (generator === 'gemini')
    return (
      <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
        <Sparkles className="size-3" />Gemini
      </Badge>
    );
  if (generator === 'fallback')
    return (
      <Badge variant="outline" className="gap-1">
        <Wand2 className="size-3" />Fallback
      </Badge>
    );
  return <Badge variant="outline">Unknown</Badge>;
}

export function PatchesPage() {
  const { slug, api } = useOrg();
  const p = useOrgPath();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as PatchStatus | 'ALL' | null) ?? 'CANARY';
  const status = tab === 'ALL' ? undefined : tab;
  const patches = useQuery({ queryKey: keys.patches(slug, { status }), queryFn: () => api.patches({ status }) });

  return (
    <>
      <PageHeader title="Patches" description="Adapters generated to heal drift, and where they are in their rollout." />
      <Tabs value={tab} onValueChange={(value) => setParams({ status: value }, { replace: true })} className="mb-4">
        <TabsList className="flex-wrap">
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card className="py-0">
        {patches.error ? (
          <CardContent className="py-6"><ErrorState error={patches.error} /></CardContent>
        ) : !patches.data ? (
          <CardContent className="py-6"><LoadingRows /></CardContent>
        ) : !patches.data.length ? (
          <CardContent className="py-6"><EmptyState title="No patches in this state" /></CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Contract</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Generator</TableHead>
                <TableHead className="text-right">Traffic</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead className="pr-6 text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patches.data.map((patch) => (
                <TableRow key={patch.id}>
                  <TableCell className="max-w-72 pl-6">
                    <Link to={p(`/patches/${patch.id}`)} className="hover:underline">
                      <ContractLabel contract={patch.contract} />
                    </Link>
                  </TableCell>
                  <TableCell><StatusBadge value={patch.status} /></TableCell>
                  <TableCell className="hidden sm:table-cell"><GeneratorBadge generator={patch.generator} /></TableCell>
                  <TableCell className="text-right tabular-nums">{patch.canaryPercent}%</TableCell>
                  <TableCell className="text-right tabular-nums">{percent(patch.confidenceScore)}</TableCell>
                  <TableCell className="pr-6 text-right text-muted-foreground">{relativeTime(patch.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

type DecisionKind = 'promote' | 'rollback';

function DecisionDialog({
  patch,
  kind,
  onClose,
}: {
  patch: PatchDetail;
  kind: DecisionKind | null;
  onClose: () => void;
}) {
  const { api } = useOrg();
  const queries = useQueryClient();
  const [notes, setNotes] = useState('');
  const decide = useMutation({
    mutationFn: () => {
      const decision = { serviceName: patch.contract.serviceName, notes: notes.trim() || undefined };
      return kind === 'promote' ? api.promotePatch(patch.id, decision) : api.rollbackPatch(patch.id, decision);
    },
    onSuccess: (result) => {
      toast.success(result.message);
      void queries.invalidateQueries();
      setNotes('');
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const promote = kind === 'promote';
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{promote ? 'Promote to all traffic?' : 'Roll back this patch?'}</DialogTitle>
          <DialogDescription>
            {promote
              ? 'Every request to this contract will be transformed by the adapter. Your email is recorded in the audit log.'
              : 'Responses will pass through unpatched again and the service returns to DRIFTING. Your email is recorded in the audit log.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="decision-notes">Review notes (optional)</Label>
          <Textarea
            id="decision-notes"
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={promote ? 'e.g. Canary looked clean for 200 requests' : 'e.g. Upstream team shipped a proper fix'}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={promote ? 'default' : 'destructive'}
            disabled={decide.isPending}
            onClick={() => decide.mutate()}
          >
            {decide.isPending && <Loader2 className="animate-spin" />}
            {promote ? 'Promote' : 'Roll back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Timeline({ patch }: { patch: PatchDetail }) {
  const steps = [
    { label: 'Drift detected', at: patch.driftEvent.detectedAt, done: true },
    { label: patch.status === 'FAILED' ? 'Rejected by verification' : 'Generated & verified', at: patch.createdAt, done: true },
    {
      label: 'Canary deployed',
      at: null,
      done: ['CANARY', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'].includes(patch.status),
    },
    { label: 'Promoted to 100%', at: patch.deployedAt, done: patch.deployedAt !== null },
    ...(patch.rolledBackAt ? [{ label: 'Rolled back', at: patch.rolledBackAt, done: true }] : []),
  ];
  return (
    <ol className="space-y-4">
      {steps.map((step) => (
        <li key={step.label} className="flex gap-3">
          <span
            className={cn(
              'mt-1 size-2.5 shrink-0 rounded-full',
              step.done ? 'bg-primary' : 'border-2 border-muted-foreground/40',
            )}
          />
          <div>
            <p className={cn('text-sm font-medium', !step.done && 'text-muted-foreground')}>{step.label}</p>
            {step.at && <p className="text-xs text-muted-foreground">{absoluteTime(step.at)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TrafficBar({ patch }: { patch: PatchDetail }) {
  const { patchedRequests, adapterFailures, baselineRequests } = patch.traffic;
  const total = patchedRequests + adapterFailures + baselineRequests;
  const share = (value: number) => (total ? `${(value / total) * 100}%` : '0%');
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-success" style={{ width: share(patchedRequests) }} />
        <div className="bg-destructive" style={{ width: share(adapterFailures) }} />
        <div className="bg-muted-foreground/30" style={{ width: share(baselineRequests) }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Healed" value={patchedRequests} />
        <Stat label="Adapter errors" value={adapterFailures} />
        <Stat label="Unpatched" value={baselineRequests} />
      </div>
      <p className="text-xs text-muted-foreground">Requests since deployment (last 7 days).</p>
    </div>
  );
}

function AuditList({ audits }: { audits: AuditView[] }) {
  return (
    <ul className="space-y-3">
      {audits.map((audit) => (
        <li key={audit.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge value={audit.status} />
            <span className="text-xs text-muted-foreground">{absoluteTime(audit.createdAt)}</span>
          </div>
          <p className="mt-2 text-sm">{audit.reasoningTrace}</p>
          {audit.reviewNotes && <p className="mt-1 text-sm text-muted-foreground">“{audit.reviewNotes}”</p>}
          <p className="mt-2 text-xs text-muted-foreground">by {audit.reviewer ?? 'unknown'}</p>
        </li>
      ))}
    </ul>
  );
}

export function PatchDetailPage() {
  const { slug, api } = useOrg();
  const p = useOrgPath();
  const { id = '' } = useParams();
  const patch = useQuery({ queryKey: keys.patch(slug, id), queryFn: () => api.patch(id) });
  const preview = useMutation({ mutationFn: () => api.previewPatch(id) });
  const [decision, setDecision] = useState<DecisionKind | null>(null);

  if (patch.error) return <ErrorState error={patch.error} />;
  if (!patch.data) return <LoadingRows />;
  const data = patch.data;
  const live = data.status === 'CANARY' || data.status === 'ACTIVE';

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to={p('/patches')}><ChevronLeft />Patches</Link>
      </Button>
      <PageHeader
        title="Patch"
        description={<ContractLabel contract={data.contract} />}
        actions={
          <>
            {data.status === 'CANARY' && (
              <Button onClick={() => setDecision('promote')}><ArrowUpCircle />Promote</Button>
            )}
            {live && (
              <Button variant="outline" onClick={() => setDecision('rollback')}><Undo2 />Roll back</Button>
            )}
          </>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-5">
          <Stat label="Status" value={<StatusBadge value={data.status} />} />
          <Stat label="Generator" value={<GeneratorBadge generator={data.generator} />} />
          <Stat label="Traffic" value={`${data.canaryPercent}%`} />
          <Stat label="Confidence" value={percent(data.confidenceScore)} />
          <Stat label="Created" value={relativeTime(data.createdAt)} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Adapter</CardTitle>
              <CardDescription>Runs in a sandbox on every routed response</CardDescription>
            </CardHeader>
            <CardContent><CodeBlock code={data.adapterCode} /></CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Sandbox preview</CardTitle>
                <CardDescription>Run the adapter on the drifted payload that triggered it</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => preview.mutate()} disabled={preview.isPending}>
                {preview.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                Run preview
              </Button>
            </CardHeader>
            <CardContent>
              {preview.error ? (
                <ErrorState error={preview.error} />
              ) : preview.data ? (
                <div className="space-y-3">
                  <p className={cn('text-sm font-medium', preview.data.stillBreaking ? 'text-destructive' : 'text-success')}>
                    {preview.data.success
                      ? preview.data.stillBreaking
                        ? 'Output still breaks the contract'
                        : `Contract restored in ${preview.data.executionTimeMs.toFixed(2)} ms`
                      : `Adapter failed: ${preview.data.error}`}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Before (upstream)</p>
                      <JsonView value={preview.data.input} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">After (sent to frontend)</p>
                      <JsonView value={preview.data.output} />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Read-only: live traffic is not affected.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Drift this patch repairs</CardTitle>
              <CardDescription>
                <Link to={p(`/drift/${data.driftEvent.id}`)} className="hover:underline">Open drift event →</Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SchemaDiff expectedSchema={data.driftEvent.expectedSchema} diff={data.driftEvent.diff} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {live && (
            <Card>
              <CardHeader><CardTitle>Canary traffic</CardTitle></CardHeader>
              <CardContent><TrafficBar patch={data} /></CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Lifecycle</CardTitle></CardHeader>
            <CardContent><Timeline patch={data} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
            <CardContent><AuditList audits={data.audits} /></CardContent>
          </Card>
        </div>
      </div>

      <DecisionDialog patch={data} kind={decision} onClose={() => setDecision(null)} />
    </>
  );
}
