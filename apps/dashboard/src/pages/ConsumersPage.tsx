import type { ConsumerKind, ConsumerView, IssuedKey, KeyType } from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, KeyRound, Loader2, Plus, Server, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, KeyReveal, Pill } from '@/components/admin';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { keys } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useOrg } from '@/lib/org';

function useRegistry() {
  const { slug, api } = useOrg();
  return useQuery({ queryKey: keys.registry(slug), queryFn: api.registry });
}

function ServicePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const registry = useRegistry();
  if (!registry.data?.length) return <p className="text-sm text-muted-foreground">No services registered yet.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {registry.data.map((service) => (
        <label key={service.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={selected.includes(service.id)}
            onChange={(event) =>
              onChange(event.target.checked ? [...selected, service.id] : selected.filter((id) => id !== service.id))
            }
          />
          {service.serviceName}
        </label>
      ))}
    </div>
  );
}

function CreateConsumerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ConsumerKind>('frontend');
  const [description, setDescription] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api.createConsumer({ name, kind, description: description || undefined, serviceIds }),
    onSuccess: (consumer) => {
      void queries.invalidateQueries({ queryKey: keys.consumers(slug) });
      toast.success(`Consumer ${consumer.name} created; issue it a key next`);
      setName('');
      setDescription('');
      setServiceIds([]);
      onClose();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>New consumer</DialogTitle>
            <DialogDescription>An application that calls your services through the gateway.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="consumer-name">Name</Label>
            <Input
              id="consumer-name"
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              placeholder="checkout-web"
              value={name}
              onChange={(event) => setName(event.target.value.toLowerCase())}
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ConsumerKind)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="frontend">Frontend (browser, publishable keys)</SelectItem>
                <SelectItem value="backend">Backend (server-to-server, secret keys)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="consumer-description">Description (optional)</Label>
            <Textarea id="consumer-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>May call</Label>
            <ServicePicker selected={serviceIds} onChange={setServiceIds} />
          </div>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueKeyDialog({ consumer, onClose }: { consumer: ConsumerView | null; onClose: () => void }) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const registry = useRegistry();
  const [origins, setOrigins] = useState('');
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const type: KeyType = consumer?.kind === 'frontend' ? 'publishable' : 'secret';
  const issue = useMutation({
    mutationFn: () =>
      api.issueKey(consumer!.id, {
        type,
        allowedOrigins: type === 'publishable' ? origins.split(/[\s,]+/).filter(Boolean) : undefined,
      }),
    onSuccess: (key) => {
      setIssued(key);
      void queries.invalidateQueries({ queryKey: keys.consumers(slug) });
    },
  });
  const close = () => {
    setIssued(null);
    setOrigins('');
    issue.reset();
    onClose();
  };
  const firstService = registry.data?.find((service) => consumer?.serviceIds.includes(service.id))?.serviceName;
  return (
    <Dialog open={consumer !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{issued ? 'Your new key' : `New ${type} key for ${consumer?.name}`}</DialogTitle>
          <DialogDescription>
            {type === 'publishable'
              ? 'Safe in browser code; only accepted from the origins you list.'
              : 'Server-side only. Anyone holding it can call the granted services as this consumer.'}
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <>
            <KeyReveal apiKey={issued.key} serviceName={firstService} />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              issue.mutate();
            }}
            className="space-y-4"
          >
            {type === 'publishable' && (
              <div className="space-y-2">
                <Label htmlFor="origins">Allowed origins</Label>
                <Input
                  id="origins"
                  required
                  placeholder="https://app.example.com, http://localhost:3000"
                  value={origins}
                  onChange={(event) => setOrigins(event.target.value)}
                />
              </div>
            )}
            {issue.error && <p className="text-sm text-destructive">{issue.error.message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={issue.isPending}>
                {issue.isPending && <Loader2 className="animate-spin" />}
                Issue key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConsumerCard({ consumer, onIssueKey }: { consumer: ConsumerView; onIssueKey: () => void }) {
  const { slug, api, can } = useOrg();
  const queries = useQueryClient();
  const registry = useRegistry();
  const [editingServices, setEditingServices] = useState<string[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => void queries.invalidateQueries({ queryKey: keys.consumers(slug) });
  const saveServices = useMutation({
    mutationFn: (serviceIds: string[]) => api.updateConsumer(consumer.id, { serviceIds }),
    onSuccess: () => {
      refresh();
      setEditingServices(null);
      toast.success('Access updated');
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => api.revokeKey(consumer.id, keyId),
    onSuccess: () => {
      refresh();
      setRevoking(null);
      toast.success('Key revoked; it stops working immediately');
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteConsumer(consumer.id),
    onSuccess: () => {
      refresh();
      toast.success(`${consumer.name} deleted`);
    },
    onError: (error) => toast.error(error.message),
  });
  const admin = can('admin');
  const names = (ids: string[]) =>
    ids.map((id) => registry.data?.find((service) => service.id === id)?.serviceName ?? 'unknown');
  const activeKeys = consumer.keys.filter((key) => !key.revokedAt);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            {consumer.name}
            <Badge variant="outline">{consumer.kind}</Badge>
          </CardTitle>
          {consumer.description && <CardDescription>{consumer.description}</CardDescription>}
        </div>
        {admin && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={onIssueKey}><KeyRound />New key</Button>
            <Button size="icon" variant="ghost" aria-label={`Delete ${consumer.name}`} onClick={() => setDeleting(true)}>
              <Trash2 />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Server className="size-3.5" />May call
            </p>
            {admin && !editingServices && (
              <Button size="sm" variant="ghost" onClick={() => setEditingServices(consumer.serviceIds)}>Edit</Button>
            )}
          </div>
          {editingServices ? (
            <div className="space-y-3">
              <ServicePicker selected={editingServices} onChange={setEditingServices} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingServices(null)}>Cancel</Button>
                <Button size="sm" disabled={saveServices.isPending} onClick={() => saveServices.mutate(editingServices)}>
                  Save
                </Button>
              </div>
            </div>
          ) : consumer.serviceIds.length ? (
            <div className="flex flex-wrap gap-1.5">
              {names(consumer.serviceIds).map((name) => <Pill key={name}>{name}</Pill>)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No services yet: requests from this consumer are refused.</p>
          )}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <KeyRound className="size-3.5" />Keys ({activeKeys.length} active)
          </p>
          {consumer.keys.length ? (
            <ul className="divide-y rounded-lg border">
              {consumer.keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs">{key.display}</code>
                      <Badge variant="outline">{key.type}</Badge>
                      {key.revokedAt && <Badge variant="outline" className="text-destructive">revoked</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      by {key.createdBy} · created {relativeTime(key.createdAt)} · last used{' '}
                      {key.lastUsedAt ? relativeTime(key.lastUsedAt) : 'never'}
                    </p>
                    {key.allowedOrigins.length > 0 && (
                      <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="size-3" />
                        {key.allowedOrigins.join(', ')}
                      </p>
                    )}
                  </div>
                  {admin && !key.revokedAt && (
                    <Button size="sm" variant="outline" onClick={() => setRevoking(key.id)}>Revoke</Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No keys issued.</p>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this key?"
        description="Requests using it are rejected immediately. This can't be undone; issue a new key instead."
        confirmLabel="Revoke key"
        destructive
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        onClose={() => setRevoking(null)}
      />
      <ConfirmDialog
        open={deleting}
        title={`Delete ${consumer.name}?`}
        description="Its keys stop working and its contracts, drift history and patches are deleted."
        confirmLabel="Delete consumer"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </Card>
  );
}

export function ConsumersPage() {
  const { slug, api, can } = useOrg();
  const consumers = useQuery({ queryKey: keys.consumers(slug), queryFn: api.consumers });
  const [creating, setCreating] = useState(false);
  const [issuingFor, setIssuingFor] = useState<ConsumerView | null>(null);
  return (
    <>
      <PageHeader
        title="Consumers & keys"
        description="Applications that call your services through the gateway, frontend or backend. Each has its own contracts and keys."
        actions={can('admin') && <Button onClick={() => setCreating(true)}><Plus />New consumer</Button>}
      />
      {consumers.error ? (
        <ErrorState error={consumers.error} />
      ) : !consumers.data ? (
        <LoadingRows />
      ) : !consumers.data.length ? (
        <EmptyState title="No consumers yet">
          Create one per app (e.g. checkout-web, billing-worker) and send its key in the x-orchestrator-key header.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {consumers.data.map((consumer) => (
            <ConsumerCard key={consumer.id} consumer={consumer} onIssueKey={() => setIssuingFor(consumer)} />
          ))}
        </div>
      )}
      <CreateConsumerDialog open={creating} onClose={() => setCreating(false)} />
      <IssueKeyDialog consumer={issuingFor} onClose={() => setIssuingFor(null)} />
    </>
  );
}
