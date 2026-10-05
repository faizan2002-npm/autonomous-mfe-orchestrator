import type {
  ConnectionTestResult,
  ConsumerKind,
  IssuedKey,
  OrgRole,
  OrgSummary,
  RegisteredService,
} from '@orchestrator/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, KeyRound, Loader2, PartyPopper, Server, Users } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CopyButton, KeyReveal } from '@/components/admin';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { accountApi, keys, orgApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const STEPS = [
  { title: 'Organization', icon: Building2 },
  { title: 'First service', icon: Server },
  { title: 'Consumer & key', icon: KeyRound },
  { title: 'Invite reviewers', icon: Users },
  { title: 'Done', icon: PartyPopper },
];

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

function StepFooter({ busy, error, onSkip, submitLabel }: { busy: boolean; error: string | null; onSkip?: () => void; submitLabel: string }) {
  return (
    <div className="space-y-3 pt-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function LabeledInput({ label, hint, ...props }: { label: string; hint?: ReactNode } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{label}</Label>
      <Input {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [service, setService] = useState<RegisteredService | null>(null);
  const action = useAction();

  // Step 1
  const [orgName, setOrgName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  // Step 2
  const [serviceName, setServiceName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [healthPath, setHealthPath] = useState('/health');
  const [connection, setConnection] = useState<ConnectionTestResult | null>(null);
  // Step 3
  const [consumerName, setConsumerName] = useState('');
  const [kind, setKind] = useState<ConsumerKind>('frontend');
  const [origins, setOrigins] = useState('');
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  // Step 4
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('reviewer');
  const [invites, setInvites] = useState<Array<{ email: string; acceptUrl: string }>>([]);

  const api = org ? orgApi(org.slug) : null;

  const createOrg = async (event: FormEvent) => {
    event.preventDefault();
    const created = await action.run(() => accountApi.createOrg({ name: orgName, slug }));
    if (!created) return;
    await queries.invalidateQueries({ queryKey: keys.myOrgs });
    setOrg(created);
    setStep(1);
  };

  const createService = async (event: FormEvent) => {
    event.preventDefault();
    const created = await action.run(() => api!.createService({ serviceName, baseUrl, healthPath: healthPath || undefined }));
    if (!created) return;
    setService(created);
    setConnection(await api!.testService(created.id).catch(() => null));
  };

  const createConsumer = async (event: FormEvent) => {
    event.preventDefault();
    const key = await action.run(async () => {
      const consumer = await api!.createConsumer({
        name: consumerName,
        kind,
        serviceIds: service ? [service.id] : [],
      });
      const allowedOrigins = origins.split(/[\s,]+/).filter(Boolean);
      return api!.issueKey(consumer.id, {
        type: kind === 'frontend' ? 'publishable' : 'secret',
        allowedOrigins: kind === 'frontend' ? allowedOrigins : undefined,
      });
    });
    if (key) setIssued(key);
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const created = await action.run(() => api!.invite(inviteEmail, inviteRole));
    if (!created) return;
    setInvites((current) => [...current, { email: created.email, acceptUrl: created.acceptUrl }]);
    setInviteEmail('');
  };

  return (
    <div className="min-h-svh bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register the APIs your apps depend on; the gateway learns their contracts and heals drift.
        </p>

        <ol className="my-6 flex flex-wrap gap-2">
          {STEPS.map(({ title, icon: Icon }, index) => (
            <li
              key={title}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
                index === step && 'border-primary bg-primary/10 text-primary',
                index < step && 'text-success',
                index > step && 'text-muted-foreground',
              )}
            >
              {index < step ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              {title}
            </li>
          ))}
        </ol>

        <Card>
          {step === 0 && (
            <>
              <CardHeader>
                <CardTitle>Create your organization</CardTitle>
                <CardDescription>You'll be its owner. You can invite reviewers next.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={createOrg} className="space-y-4">
                  <LabeledInput
                    id="org-name"
                    label="Organization name"
                    required
                    minLength={2}
                    value={orgName}
                    onChange={(event) => {
                      setOrgName(event.target.value);
                      if (!slugEdited) setSlug(slugify(event.target.value));
                    }}
                  />
                  <LabeledInput
                    id="org-slug"
                    label="URL"
                    required
                    pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"
                    value={slug}
                    hint={<>Your dashboard will live at /o/{slug || 'your-org'}</>}
                    onChange={(event) => {
                      setSlugEdited(true);
                      setSlug(slugify(event.target.value));
                    }}
                  />
                  <StepFooter busy={action.busy} error={action.error} submitLabel="Create organization" />
                </form>
              </CardContent>
            </>
          )}

          {step === 1 && (
            <>
              <CardHeader>
                <CardTitle>Register your first service</CardTitle>
                <CardDescription>
                  An upstream API your frontends or backends call. Requests to{' '}
                  <code className="text-xs">/api/v1/{serviceName || '<name>'}/…</code> are forwarded to its base URL.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {service ? (
                  <div className="space-y-4">
                    <p className="text-sm">
                      <strong>{service.serviceName}</strong> → <code className="text-xs">{service.baseUrl}</code>
                    </p>
                    <p
                      className={cn(
                        'text-sm',
                        connection?.ok ? 'text-success' : 'text-warning',
                      )}
                    >
                      {connection?.ok
                        ? `Reachable (HTTP ${connection.status}, ${connection.latencyMs} ms)`
                        : `Not reachable yet${connection?.error ? `: ${connection.error}` : ''}. You can fix the URL later.`}
                    </p>
                    <div className="flex justify-end">
                      <Button onClick={() => setStep(2)}>Continue</Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={createService} className="space-y-4">
                    <LabeledInput
                      id="service-name"
                      label="Service name"
                      required
                      pattern="[a-z0-9][a-z0-9-]{0,62}"
                      placeholder="user-service"
                      value={serviceName}
                      onChange={(event) => setServiceName(slugify(event.target.value))}
                    />
                    <LabeledInput
                      id="base-url"
                      label="Base URL"
                      type="url"
                      required
                      placeholder="https://users.internal.example.com"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                    />
                    <LabeledInput
                      id="health-path"
                      label="Health check path (optional)"
                      placeholder="/health"
                      value={healthPath}
                      onChange={(event) => setHealthPath(event.target.value)}
                    />
                    <StepFooter
                      busy={action.busy}
                      error={action.error}
                      submitLabel="Add service"
                      onSkip={() => setStep(2)}
                    />
                  </form>
                )}
              </CardContent>
            </>
          )}

          {step === 2 && (
            <>
              <CardHeader>
                <CardTitle>Create a consumer and its API key</CardTitle>
                <CardDescription>
                  A consumer is an app that calls services through the gateway. Each consumer gets its own contracts,
                  so a frontend and a backend reading the same API heal independently.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {issued ? (
                  <div className="space-y-4">
                    <KeyReveal apiKey={issued.key} serviceName={service?.serviceName} />
                    <div className="flex justify-end">
                      <Button onClick={() => setStep(3)}>I've saved the key</Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={createConsumer} className="space-y-4">
                    <LabeledInput
                      id="consumer-name"
                      label="Consumer name"
                      required
                      pattern="[a-z0-9][a-z0-9-]{0,62}"
                      placeholder={kind === 'frontend' ? 'checkout-web' : 'billing-worker'}
                      value={consumerName}
                      onChange={(event) => setConsumerName(slugify(event.target.value))}
                    />
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select value={kind} onValueChange={(value) => setKind(value as ConsumerKind)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="frontend">Frontend: browser app (publishable key)</SelectItem>
                          <SelectItem value="backend">Backend: server-to-server (secret key)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {kind === 'frontend' && (
                      <LabeledInput
                        id="origins"
                        label="Allowed origins"
                        required
                        placeholder="https://app.example.com, http://localhost:3000"
                        hint="The publishable key only works from these browser origins."
                        value={origins}
                        onChange={(event) => setOrigins(event.target.value)}
                      />
                    )}
                    <StepFooter
                      busy={action.busy}
                      error={action.error}
                      submitLabel="Create consumer and key"
                      onSkip={() => setStep(3)}
                    />
                  </form>
                )}
              </CardContent>
            </>
          )}

          {step === 3 && (
            <>
              <CardHeader>
                <CardTitle>Invite reviewers</CardTitle>
                <CardDescription>
                  Reviewers approve or roll back patches; viewers can only watch. Each invitation link works once.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1 space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                    />
                  </div>
                  <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as OrgRole)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="reviewer">Reviewer</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={action.busy}>
                    {action.busy && <Loader2 className="animate-spin" />}
                    Invite
                  </Button>
                </form>
                {action.error && <p className="text-sm text-destructive">{action.error}</p>}
                {invites.map((sent) => (
                  <div key={sent.acceptUrl} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                    <span className="truncate">{sent.email}</span>
                    <CopyButton value={sent.acceptUrl} label="Copy link" />
                  </div>
                ))}
                <div className="flex justify-end gap-2">
                  <Button variant={invites.length ? 'default' : 'ghost'} onClick={() => setStep(4)}>
                    {invites.length ? 'Continue' : 'Skip for now'}
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {step === 4 && org && (
            <>
              <CardHeader className="items-center text-center">
                <PartyPopper className="size-10 text-primary" />
                <CardTitle>{org.name} is ready</CardTitle>
                <CardDescription>
                  Send traffic through the gateway with your consumer key. The first response of each endpoint becomes
                  its contract; drift is detected and healed from then on.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Button onClick={() => navigate(`/o/${org.slug}`, { replace: true })}>Open dashboard</Button>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
