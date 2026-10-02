import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  type CreatedEndpoint,
  type DeliveryStatus,
  type EndpointType,
  type NotificationChannel,
  type NotificationEndpointView,
  type NotificationEvent,
  type NotificationPreferences,
} from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, CheckCheck, Loader2, RotateCw, Send, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog, CopyButton, Pill } from '@/components/admin';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { accountApi, keys } from '@/lib/api';
import { absoluteTime, relativeTime } from '@/lib/format';
import { useOrg } from '@/lib/org';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { cn } from '@/lib/utils';

export const EVENT_LABELS: Record<NotificationEvent, { label: string; help: string }> = {
  'drift.breaking': { label: 'Breaking drift', help: 'An upstream response broke a consumer contract' },
  'patch.awaiting_review': { label: 'Patch awaiting review', help: 'A canary patch is healing traffic and needs a decision' },
  'patch.rejected': { label: 'Patch rejected', help: 'The generated adapter failed validation' },
  'patch.promoted': { label: 'Patch promoted', help: 'A patch now serves all traffic' },
  'patch.rolled_back': { label: 'Patch rolled back', help: 'A patch was withdrawn' },
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = { email: 'Email', push: 'Push' };

const STATUS_STYLES: Record<DeliveryStatus, string> = {
  pending: 'border-warning/40 text-warning',
  sending: 'border-primary/40 text-primary',
  sent: 'border-success/40 text-success',
  dead: 'border-destructive/40 text-destructive',
};

// ---- Inbox --------------------------------------------------------------------------------

function InboxTab() {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const inbox = useQuery({ queryKey: keys.inbox(slug), queryFn: () => api.inbox(100) });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.markRead(ids),
    onSuccess: () => void queries.invalidateQueries({ queryKey: keys.inbox(slug) }),
  });

  if (inbox.isPending) return <LoadingRows />;
  if (inbox.isError) return <ErrorState error={inbox.error} />;
  const { items, unreadCount } = inbox.data;
  if (!items.length)
    return (
      <EmptyState title="No notifications yet">
        Breaking drift and patches that need your review show up here, as email and as push on devices you enable.
      </EmptyState>
    );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={!unreadCount || markRead.isPending} onClick={() => markRead.mutate(undefined)}>
          <CheckCheck />
          Mark all read
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y" aria-label="Notifications">
          {items.map((item) => {
            const content = (
              <>
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.readAt ? 'bg-transparent' : 'bg-primary')}
                  aria-label={item.readAt ? undefined : 'Unread'}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn('text-sm', !item.readAt && 'font-semibold')}>{item.title}</p>
                    <Pill>{EVENT_LABELS[item.event]?.label ?? item.event}</Pill>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" title={absoluteTime(item.createdAt)}>
                  {relativeTime(item.createdAt)}
                </time>
              </>
            );
            const className = 'flex items-start gap-3 px-6 py-4 transition-colors hover:bg-muted/40';
            const onOpen = () => !item.readAt && markRead.mutate([item.id]);
            return (
              <li key={item.id}>
                {item.link ? (
                  <Link to={item.link} className={className} onClick={onOpen}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" className={cn(className, 'w-full text-left')} onClick={onOpen}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---- Personal preferences and push ---------------------------------------------------------

function PushCard() {
  const config = useQuery({ queryKey: keys.pushConfig, queryFn: accountApi.pushConfig, staleTime: Infinity });
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const publicKey = config.data?.publicKey ?? null;

  useEffect(() => {
    if (config.data) void pushState(publicKey).then(setState);
  }, [config.data, publicKey]);

  const toggle = async () => {
    setBusy(true);
    try {
      const next = state === 'on' ? await disablePush() : await enablePush(publicKey!);
      setState(next);
      if (next === 'on') toast.success('Push enabled on this device');
      if (next === 'denied') toast.error('Notifications are blocked for this site in the browser settings');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change push settings');
    } finally {
      setBusy(false);
    }
  };

  const message: Record<PushState, string> = {
    unsupported: 'This browser does not support web push.',
    unconfigured: 'Web push is not configured on this gateway (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY).',
    denied: 'Notifications are blocked for this site. Allow them in the browser’s site settings, then reload.',
    off: 'Get alerts on this device even when the dashboard is closed.',
    on: 'This device receives push notifications for the events you choose below.',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            {state === 'on' ? <BellRing className="size-4 text-success" /> : <BellOff className="size-4" />}
            Push on this device
          </CardTitle>
          <CardDescription>{state ? message[state] : 'Checking…'}</CardDescription>
        </div>
        {(state === 'on' || state === 'off') && (
          <Button variant={state === 'on' ? 'outline' : 'default'} disabled={busy} onClick={() => void toggle()}>
            {busy && <Loader2 className="animate-spin" />}
            {state === 'on' ? 'Disable push' : 'Enable push'}
          </Button>
        )}
      </CardHeader>
    </Card>
  );
}

function PreferencesTab() {
  const { slug, api, can } = useOrg();
  const queries = useQueryClient();
  const preferences = useQuery({ queryKey: keys.preferences(slug), queryFn: api.preferences });
  const update = useMutation({
    mutationFn: (next: Partial<NotificationPreferences>) => api.updatePreferences(next),
    onSuccess: (data) => queries.setQueryData(keys.preferences(slug), data),
    onError: (error) => toast.error(error.message),
  });
  const test = useMutation({
    mutationFn: api.testNotification,
    onSuccess: ({ email, pushDevices }) => {
      const parts = [email && 'a test email', pushDevices && `push to ${pushDevices} device${pushDevices === 1 ? '' : 's'}`];
      const sending = parts.filter(Boolean).join(' and ');
      toast.success(sending ? `Sending ${sending}` : 'Nothing to send: add an email or enable push');
    },
    onError: (error) => toast.error(error.message),
  });

  const toggle = (event: NotificationEvent, channel: NotificationChannel, on: boolean) => {
    const current = preferences.data?.[event] ?? [];
    const channels = on ? [...new Set([...current, channel])] : current.filter((c) => c !== channel);
    update.mutate({ [event]: channels });
  };

  return (
    <div className="space-y-6">
      <PushCard />
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>What reaches you</CardTitle>
            <CardDescription>
              Your choices for this organization. Every event also lands in your inbox.
              {!can('reviewer') && ' Viewers are not notified about review work.'}
            </CardDescription>
          </div>
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Send me a test
          </Button>
        </CardHeader>
        <CardContent>
          {preferences.isPending ? (
            <LoadingRows rows={5} />
          ) : preferences.isError ? (
            <ErrorState error={preferences.error} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <TableHead key={channel} className="w-24 text-center">
                      {CHANNEL_LABELS[channel]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {NOTIFICATION_EVENTS.map((event) => (
                  <TableRow key={event}>
                    <TableCell>
                      <p className="font-medium">{EVENT_LABELS[event].label}</p>
                      <p className="text-xs text-muted-foreground">{EVENT_LABELS[event].help}</p>
                    </TableCell>
                    {NOTIFICATION_CHANNELS.map((channel) => (
                      <TableCell key={channel} className="text-center">
                        <Switch
                          aria-label={`${CHANNEL_LABELS[channel]} for ${EVENT_LABELS[event].label}`}
                          checked={preferences.data[event]?.includes(channel) ?? false}
                          disabled={update.isPending}
                          onCheckedChange={(on) => toggle(event, channel, on)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Org integrations: Slack and webhooks (admins) ------------------------------------------

function EventPicker({ value, onChange }: { value: NotificationEvent[]; onChange: (next: NotificationEvent[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {NOTIFICATION_EVENTS.map((event) => (
        <label key={event} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.includes(event)}
            onChange={(e) => onChange(e.target.checked ? [...value, event] : value.filter((v) => v !== event))}
          />
          {EVENT_LABELS[event].label}
        </label>
      ))}
    </div>
  );
}

function CreateEndpointDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const [type, setType] = useState<EndpointType>('slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<NotificationEvent[]>(['drift.breaking', 'patch.awaiting_review']);
  const [created, setCreated] = useState<CreatedEndpoint | null>(null);

  const create = useMutation({
    mutationFn: () => api.createEndpoint({ type, name, url, events }),
    onSuccess: (endpoint) => {
      void queries.invalidateQueries({ queryKey: keys.endpoints(slug) });
      if (endpoint.signingSecret) setCreated(endpoint);
      else {
        toast.success(`${endpoint.name} added`);
        close();
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const close = () => {
    setName('');
    setUrl('');
    setCreated(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Save the signing secret</DialogTitle>
              <DialogDescription>
                Verify every delivery with it. It is shown only once; delete and recreate the endpoint to rotate it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
              <code className="flex-1 break-all font-mono text-sm" data-testid="signing-secret">
                {created.signingSecret}
              </code>
              <CopyButton value={created.signingSecret!} />
            </div>
            <p className="text-xs text-muted-foreground">
              Header <code>x-orchestrator-signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code> where v1 is HMAC-SHA256 of{' '}
              <code>{'`${t}.${rawBody}`'}</code> with this secret. Reject timestamps older than five minutes.
            </p>
            <DialogFooter>
              <Button onClick={close}>I&apos;ve saved the secret</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add an integration</DialogTitle>
              <DialogDescription>Post organization events to Slack or to your own HTTPS endpoint.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="endpoint-type">Type</Label>
                <Select value={type} onValueChange={(value) => setType(value as EndpointType)}>
                  <SelectTrigger id="endpoint-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endpoint-name">Name</Label>
                <Input
                  id="endpoint-name"
                  required
                  maxLength={128}
                  placeholder={type === 'slack' ? '#api-alerts' : 'Incident bot'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="endpoint-url">{type === 'slack' ? 'Slack incoming webhook URL' : 'Endpoint URL'}</Label>
              <Input
                id="endpoint-url"
                required
                type="url"
                placeholder={type === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://example.com/hooks/mfe'}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Stored encrypted. Only the host is shown afterwards.</p>
            </div>
            <div className="space-y-2">
              <Label>Events</Label>
              <EventPicker value={events} onChange={setEvents} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !events.length}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Add integration
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EndpointRow({ endpoint }: { endpoint: NotificationEndpointView }) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: keys.endpoints(slug) });
    void queries.invalidateQueries({ queryKey: ['org', slug, 'deliveries'] });
  };
  const update = useMutation({
    mutationFn: (enabled: boolean) => api.updateEndpoint(endpoint.id, { enabled }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const test = useMutation({
    mutationFn: () => api.testEndpoint(endpoint.id),
    onSuccess: () => {
      toast.success(`Test queued for ${endpoint.name}`);
      setTimeout(refresh, 3_000);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEndpoint(endpoint.id),
    onSuccess: () => {
      setConfirm(false);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <p className="font-medium">{endpoint.name}</p>
          <Badge variant="outline">{endpoint.type === 'slack' ? 'Slack' : 'Webhook'}</Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{endpoint.urlHost}</p>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {endpoint.events.map((event) => (
            <Pill key={event}>{EVENT_LABELS[event].label}</Pill>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <Switch
          aria-label={`Enable ${endpoint.name}`}
          checked={endpoint.enabled}
          disabled={update.isPending}
          onCheckedChange={(on) => update.mutate(on)}
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            <Send />
            Test
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete ${endpoint.name}`} onClick={() => setConfirm(true)}>
            <Trash2 />
          </Button>
        </div>
        <ConfirmDialog
          open={confirm}
          title={`Delete ${endpoint.name}?`}
          description="Events stop being sent to this integration. Its delivery history is removed."
          confirmLabel="Delete"
          destructive
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirm(false)}
        />
      </TableCell>
    </TableRow>
  );
}

function DeliveryLog() {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const deliveries = useQuery({ queryKey: keys.deliveries(slug), queryFn: () => api.deliveries(), refetchInterval: 10_000 });
  const redeliver = useMutation({
    mutationFn: (id: string) => api.redeliver(id),
    onSuccess: () => {
      toast.success('Queued for redelivery');
      void queries.invalidateQueries({ queryKey: ['org', slug, 'deliveries'] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery log</CardTitle>
        <CardDescription>
          Every email, push, Slack and webhook delivery for this organization. Failures retry with exponential backoff.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {deliveries.isPending ? (
          <LoadingRows />
        ) : deliveries.isError ? (
          <ErrorState error={deliveries.error} />
        ) : !deliveries.data.length ? (
          <EmptyState title="Nothing delivered yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.data.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={absoluteTime(delivery.createdAt)}>
                    {relativeTime(delivery.createdAt)}
                  </TableCell>
                  <TableCell className="capitalize">{delivery.channel}</TableCell>
                  <TableCell>
                    {delivery.event in EVENT_LABELS
                      ? EVENT_LABELS[delivery.event as NotificationEvent].label
                      : delivery.event === 'member.invited'
                        ? 'Invitation'
                        : 'Test'}
                  </TableCell>
                  <TableCell className="max-w-48 truncate" title={delivery.target}>
                    {delivery.target}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_STYLES[delivery.status]}>
                      {delivery.status}
                      {delivery.attempts > 1 && ` · ${delivery.attempts} attempts`}
                    </Badge>
                    {delivery.lastError && delivery.status !== 'sent' && (
                      <p className="mt-1 max-w-64 truncate text-xs text-destructive" title={delivery.lastError}>
                        {delivery.lastError}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {delivery.status !== 'sending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={redeliver.isPending}
                        onClick={() => redeliver.mutate(delivery.id)}
                      >
                        <RotateCw />
                        Redeliver
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsTab() {
  const { slug, api } = useOrg();
  const endpoints = useQuery({ queryKey: keys.endpoints(slug), queryFn: api.endpoints });
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Webhook className="size-4" />
              Slack and webhooks
            </CardTitle>
            <CardDescription>Organization-wide channels, in addition to each member’s email and push.</CardDescription>
          </div>
          <Button onClick={() => setAdding(true)}>Add integration</Button>
        </CardHeader>
        <CardContent>
          {endpoints.isPending ? (
            <LoadingRows rows={2} />
          ) : endpoints.isError ? (
            <ErrorState error={endpoints.error} />
          ) : !endpoints.data.length ? (
            <EmptyState title="No integrations">
              Send breaking drift and patches awaiting review to a Slack channel, or to your incident tooling via a
              signed webhook.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Integration</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.data.map((endpoint) => (
                  <EndpointRow key={endpoint.id} endpoint={endpoint} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <DeliveryLog />
      <CreateEndpointDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const TABS = ['inbox', 'preferences', 'integrations'] as const;
type Tab = (typeof TABS)[number];

export function NotificationsPage() {
  const { can } = useOrg();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== 'integrations' || can('admin')) ? requested : 'inbox';

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Your inbox, how alerts reach you, and where the organization sends them."
      />
      <Tabs value={tab} onValueChange={(value) => setParams(value === 'inbox' ? {} : { tab: value }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          {can('admin') && <TabsTrigger value="integrations">Integrations</TabsTrigger>}
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          <InboxTab />
        </TabsContent>
        <TabsContent value="preferences" className="mt-4">
          <PreferencesTab />
        </TabsContent>
        {can('admin') && (
          <TabsContent value="integrations" className="mt-4">
            <IntegrationsTab />
          </TabsContent>
        )}
      </Tabs>
      {tab === 'inbox' && !can('reviewer') && (
        <Alert className="mt-6">
          <AlertTitle>Viewer access</AlertTitle>
          <AlertDescription>Ask an admin for the reviewer role to be notified about patches.</AlertDescription>
        </Alert>
      )}
    </>
  );
}
