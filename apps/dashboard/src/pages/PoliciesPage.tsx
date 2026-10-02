import {
  PATCH_GENERATORS,
  type PatchGenerator,
  type PolicyAction,
  type PolicyOutlook,
  type PromotionPolicyView,
} from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin';
import { ContractLabel, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { keys, type PolicyInput } from '@/lib/api';
import { percent } from '@/lib/format';
import { useOrg, useOrgPath } from '@/lib/org';
import { cn } from '@/lib/utils';

const ACTION_STYLES: Record<PolicyAction, { label: string; className: string }> = {
  promote: { label: 'Will promote', className: 'border-success/40 text-success' },
  rollback: { label: 'Will roll back', className: 'border-destructive/40 text-destructive' },
  wait: { label: 'Gathering evidence', className: 'border-primary/40 text-primary' },
  blocked: { label: 'Needs a reviewer', className: 'border-warning/40 text-warning' },
};

const GENERATOR_LABELS: Record<PatchGenerator, string> = {
  gemini: 'Gemini',
  fallback: 'Rule-based fallback',
  unknown: 'Unknown',
};

const ALL = '__all__';

function Meter({ label, value, target, format = String }: { label: string; value: number; target: number; format?: (n: number) => string }) {
  const share = target <= 0 ? 1 : Math.min(1, value / target);
  return (
    <div className="min-w-28 space-y-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {format(value)}/{format(target)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={Math.round(share * 100)}>
        <div className={cn('h-full rounded-full', share >= 1 ? 'bg-success' : 'bg-primary')} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function OutlookRow({ item }: { item: PolicyOutlook }) {
  const p = useOrgPath();
  const style = item.decision ? ACTION_STYLES[item.decision.action] : null;
  return (
    <TableRow>
      <TableCell>
        <Link to={p(`/patches/${item.patchId}`)} className="hover:underline">
          <ContractLabel contract={item.contract} />
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">{GENERATOR_LABELS[item.generator]}</p>
      </TableCell>
      <TableCell>{item.policy?.name ?? <span className="text-muted-foreground">None: reviewers decide</span>}</TableCell>
      <TableCell>
        {item.policy && item.decision ? (
          <div className="flex flex-wrap gap-4">
            <Meter label="Requests" value={item.decision.progress.canaryRequests} target={item.policy.minCanaryRequests} />
            <Meter
              label="Minutes"
              value={Math.floor(item.decision.progress.minutesInCanary)}
              target={item.policy.minCanaryMinutes}
            />
            <div className="space-y-1 text-xs">
              <span className="text-muted-foreground">Failures</span>
              <p className={cn('tabular-nums', item.decision.progress.failureRate > item.policy.maxFailureRate && 'text-destructive')}>
                {percent(item.decision.progress.failureRate, 1)} (max {percent(item.policy.maxFailureRate, 1)})
              </p>
            </div>
          </div>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="max-w-80">
        {style && item.decision ? (
          <>
            <Badge variant="outline" className={style.className}>
              {style.label}
            </Badge>
            <p className="mt-1 text-xs text-muted-foreground">{item.decision.reason}</p>
          </>
        ) : (
          <Badge variant="outline">Manual</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function Outlook() {
  const { slug, api } = useOrg();
  const outlook = useQuery({ queryKey: keys.policyOutlook(slug), queryFn: api.policyOutlook, refetchInterval: 15_000 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Canary patches</CardTitle>
        <CardDescription>
          What each policy will do on its next pass. The evaluator runs every 30 seconds on one gateway instance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {outlook.isPending ? (
          <LoadingRows rows={2} />
        ) : outlook.isError ? (
          <ErrorState error={outlook.error} />
        ) : !outlook.data.length ? (
          <EmptyState title="No patches in canary">New patches appear here while they heal a share of traffic.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patch</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Next step</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlook.data.map((item) => (
                <OutlookRow key={item.patchId} item={item} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface FormState {
  name: string;
  serviceId: string;
  consumerId: string;
  minCanaryRequests: string;
  minCanaryMinutes: string;
  maxFailurePercent: string;
  rollback: boolean;
  rollbackPercent: string;
  rollbackMinRequests: string;
  allowedGenerators: PatchGenerator[];
}

const toForm = (policy?: PromotionPolicyView): FormState => ({
  name: policy?.name ?? '',
  serviceId: policy?.serviceId ?? ALL,
  consumerId: policy?.consumerId ?? ALL,
  minCanaryRequests: String(policy?.minCanaryRequests ?? 50),
  minCanaryMinutes: String(policy?.minCanaryMinutes ?? 30),
  maxFailurePercent: String((policy?.maxFailureRate ?? 0) * 100),
  rollback: policy ? policy.rollbackFailureRate !== null : true,
  rollbackPercent: String((policy?.rollbackFailureRate ?? 0.25) * 100),
  rollbackMinRequests: String(policy?.rollbackMinRequests ?? 20),
  allowedGenerators: policy?.allowedGenerators ?? ['gemini', 'fallback'],
});

export function PolicyDialog({
  policy,
  open,
  onClose,
}: {
  policy?: PromotionPolicyView;
  open: boolean;
  onClose: () => void;
}) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const registry = useQuery({ queryKey: keys.registry(slug), queryFn: api.registry, enabled: open && !policy });
  const consumers = useQuery({ queryKey: keys.consumers(slug), queryFn: api.consumers, enabled: open && !policy });
  const [form, setForm] = useState<FormState>(() => toForm(policy));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const input: PolicyInput = {
        name: form.name,
        minCanaryRequests: Number(form.minCanaryRequests),
        minCanaryMinutes: Number(form.minCanaryMinutes),
        maxFailureRate: Number(form.maxFailurePercent) / 100,
        rollbackFailureRate: form.rollback ? Number(form.rollbackPercent) / 100 : null,
        rollbackMinRequests: Number(form.rollbackMinRequests),
        allowedGenerators: form.allowedGenerators,
      };
      if (policy) return api.updatePolicy(policy.id, input);
      if (form.serviceId !== ALL) input.serviceId = form.serviceId;
      if (form.consumerId !== ALL) input.consumerId = form.consumerId;
      return api.createPolicy(input);
    },
    onSuccess: (saved) => {
      void queries.invalidateQueries({ queryKey: keys.policies(slug) });
      toast.success(`Policy "${saved.name}" saved`);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const number = (id: keyof FormState, label: string, props: { min: number; max: number; step?: number }, help?: string) => (
    <div className="space-y-2">
      <Label htmlFor={`policy-${id}`}>{label}</Label>
      <Input
        id={`policy-${id}`}
        type="number"
        required
        {...props}
        value={form[id] as string}
        onChange={(event) => set(id, event.target.value as never)}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{policy ? `Edit ${policy.name}` : 'New promotion policy'}</DialogTitle>
            <DialogDescription>
              Patches that meet every promotion rule go to 100% automatically. The most specific policy wins.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="policy-name">Name</Label>
            <Input id="policy-name" required maxLength={128} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          {!policy && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="policy-service">Service</Label>
                <Select value={form.serviceId} onValueChange={(value) => set('serviceId', value)}>
                  <SelectTrigger id="policy-service" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All services</SelectItem>
                    {registry.data?.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.serviceName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy-consumer">Consumer</Label>
                <Select value={form.consumerId} onValueChange={(value) => set('consumerId', value)}>
                  <SelectTrigger id="policy-consumer" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All consumers</SelectItem>
                    {consumers.data?.map((consumer) => (
                      <SelectItem key={consumer.id} value={consumer.id}>
                        {consumer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Promote when</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              {number('minCanaryRequests', 'Canary requests ≥', { min: 0, max: 1_000_000 })}
              {number('minCanaryMinutes', 'Minutes in canary ≥', { min: 0, max: 10_080 })}
              {number('maxFailurePercent', 'Adapter failures ≤ (%)', { min: 0, max: 100, step: 0.1 })}
            </div>
            <div className="space-y-2">
              <Label>Generators allowed to auto-promote</Label>
              <div className="flex flex-wrap gap-2">
                {PATCH_GENERATORS.map((generator) => (
                  <label key={generator} className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={form.allowedGenerators.includes(generator)}
                      onChange={(e) =>
                        set(
                          'allowedGenerators',
                          e.target.checked
                            ? [...form.allowedGenerators, generator]
                            : form.allowedGenerators.filter((g) => g !== generator),
                        )
                      }
                    />
                    {GENERATOR_LABELS[generator]}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
          <fieldset className="space-y-3" aria-label="Roll back automatically">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Roll back automatically</span>
              <Switch aria-label="Roll back automatically" checked={form.rollback} onCheckedChange={(on) => set('rollback', on)} />
            </div>
            {form.rollback && (
              <div className="grid gap-4 sm:grid-cols-2">
                {number('rollbackPercent', 'When adapter failures ≥ (%)', { min: 0.1, max: 100, step: 0.1 })}
                {number('rollbackMinRequests', 'After at least (requests)', { min: 1, max: 1_000_000 }, 'So a single early failure can’t withdraw a patch.')}
              </div>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {policy ? 'Save policy' : 'Create policy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyRow({ policy }: { policy: PromotionPolicyView }) {
  const { slug, api, can } = useOrg();
  const queries = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => void queries.invalidateQueries({ queryKey: keys.policies(slug) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updatePolicy(policy.id, { enabled }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePolicy(policy.id),
    onSuccess: () => {
      setDeleting(false);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const scope = [policy.serviceName ?? 'All services', policy.consumerName ?? 'all consumers'].join(' · ');

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{policy.name}</p>
        <p className="text-xs text-muted-foreground">{scope}</p>
      </TableCell>
      <TableCell className="text-sm">
        ≥ {policy.minCanaryRequests} requests, ≥ {policy.minCanaryMinutes} min, ≤ {percent(policy.maxFailureRate, 1)} failures
        <p className="text-xs text-muted-foreground">
          {policy.allowedGenerators.map((g) => GENERATOR_LABELS[g]).join(', ') || 'No generator'}
        </p>
      </TableCell>
      <TableCell className="text-sm">
        {policy.rollbackFailureRate === null
          ? 'Never'
          : `≥ ${percent(policy.rollbackFailureRate, 1)} after ${policy.rollbackMinRequests} requests`}
      </TableCell>
      <TableCell>
        <Switch
          aria-label={`Enable ${policy.name}`}
          checked={policy.enabled}
          disabled={!can('admin') || toggle.isPending}
          onCheckedChange={(on) => toggle.mutate(on)}
        />
      </TableCell>
      <TableCell className="text-right">
        {can('admin') && (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={`Edit ${policy.name}`} onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon" aria-label={`Delete ${policy.name}`} onClick={() => setDeleting(true)}>
              <Trash2 />
            </Button>
          </div>
        )}
        {editing && <PolicyDialog policy={policy} open onClose={() => setEditing(false)} />}
        <ConfirmDialog
          open={deleting}
          title={`Delete ${policy.name}?`}
          description="Patches it covers fall back to a broader policy, or to reviewers."
          confirmLabel="Delete"
          destructive
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        />
      </TableCell>
    </TableRow>
  );
}

export function PoliciesPage() {
  const { slug, api, can } = useOrg();
  const policies = useQuery({ queryKey: keys.policies(slug), queryFn: api.policies });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Promotion policies"
        description="Let well-behaved patches promote themselves and failing ones roll back, with every decision audited."
        actions={
          can('admin') && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New policy
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <Outlook />
        <Card>
          <CardHeader>
            <CardTitle>Policies</CardTitle>
            <CardDescription>
              Scope a policy to the organization, a service, a consumer, or both. Without a policy, reviewers promote by hand.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {policies.isPending ? (
              <LoadingRows rows={2} />
            ) : policies.isError ? (
              <ErrorState error={policies.error} />
            ) : !policies.data.length ? (
              <EmptyState title="No policies">Every patch waits for a reviewer.</EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Policy</TableHead>
                    <TableHead>Promotes</TableHead>
                    <TableHead>Rolls back</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.data.map((policy) => (
                    <PolicyRow key={policy.id} policy={policy} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      {creating && <PolicyDialog open onClose={() => setCreating(false)} />}
    </>
  );
}
