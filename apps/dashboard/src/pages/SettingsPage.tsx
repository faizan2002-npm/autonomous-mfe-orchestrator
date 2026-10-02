import type { OrgSettingsView } from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows, PageHeader, Stat } from '@/components/common';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { keys, type OrgSettingsInput } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useOrg } from '@/lib/org';

function OrgSettingsForm({ settings }: { settings: OrgSettingsView }) {
  const { slug, api, can } = useOrg();
  const queries = useQueryClient();
  const editable = can('admin');
  const [name, setName] = useState(settings.name);
  const [threshold, setThreshold] = useState(settings.driftThreshold?.toString() ?? '');
  const [canary, setCanary] = useState(settings.canaryPercent?.toString() ?? '');
  const [model, setModel] = useState(settings.geminiModel ?? '');
  const [geminiKey, setGeminiKey] = useState('');
  useEffect(() => {
    setName(settings.name);
    setThreshold(settings.driftThreshold?.toString() ?? '');
    setCanary(settings.canaryPercent?.toString() ?? '');
    setModel(settings.geminiModel ?? '');
  }, [settings]);

  const save = useMutation({
    mutationFn: (input: OrgSettingsInput) => api.updateSettings(input),
    onSuccess: () => {
      setGeminiKey('');
      void queries.invalidateQueries({ queryKey: keys.settings(slug) });
      void queries.invalidateQueries({ queryKey: keys.config(slug) });
      void queries.invalidateQueries({ queryKey: keys.myOrgs });
      toast.success('Settings saved');
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input: OrgSettingsInput = {
      name,
      driftThreshold: threshold === '' ? null : Number(threshold),
      canaryPercent: canary === '' ? null : Number(canary),
      geminiModel: model,
    };
    if (geminiKey) input.geminiApiKey = geminiKey;
    save.mutate(input);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="org-name">Organization name</Label>
        <Input id="org-name" disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="threshold">Drift threshold (0–1)</Label>
          <Input
            id="threshold"
            type="number"
            min={0}
            max={1}
            step={0.01}
            disabled={!editable}
            placeholder={`Default ${settings.defaults.driftThreshold}`}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Higher tolerates more change before reporting drift.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="canary">Canary traffic (%)</Label>
          <Input
            id="canary"
            type="number"
            min={0}
            max={100}
            step={1}
            disabled={!editable}
            placeholder={`Default ${settings.defaults.canaryPercent}`}
            value={canary}
            onChange={(event) => setCanary(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Share of requests a new patch serves before promotion.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="model">Gemini model</Label>
          <Input
            id="model"
            disabled={!editable}
            placeholder={`Default ${settings.defaults.geminiModel}`}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gemini-key">Organization Gemini API key</Label>
          <Input
            id="gemini-key"
            type="password"
            autoComplete="off"
            disabled={!editable}
            placeholder={settings.geminiKeyConfigured ? '•••••••• (stored; enter to replace)' : 'Uses the platform key when empty'}
            value={geminiKey}
            onChange={(event) => setGeminiKey(event.target.value)}
          />
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {settings.geminiKeyConfigured ? (
              <>
                <CheckCircle2 className="size-3.5 text-success" />Your own key is stored encrypted.
                {editable && (
                  <button
                    type="button"
                    className="ml-1 underline"
                    onClick={() => save.mutate({ geminiApiKey: '' })}
                  >
                    Remove
                  </button>
                )}
              </>
            ) : (
              <>
                <XCircle className="size-3.5" />Not set: the platform default is used.
              </>
            )}
          </p>
        </div>
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

export function SettingsPage() {
  const { slug, api, org } = useOrg();
  const { session } = useAuth();
  const settings = useQuery({ queryKey: keys.settings(slug), queryFn: api.settings });
  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${org.name}.`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Healing pipeline</CardTitle>
            <CardDescription>Empty fields use the gateway defaults.</CardDescription>
          </CardHeader>
          <CardContent>
            {settings.error ? (
              <ErrorState error={settings.error} />
            ) : !settings.data ? (
              <LoadingRows rows={4} />
            ) : (
              <OrgSettingsForm settings={settings.data} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>You</CardTitle></CardHeader>
          <CardContent className="grid gap-6">
            <Stat label="Email" value={session?.user.email ?? '—'} />
            <Stat label="Role in this organization" value={humanize(org.role)} />
            <Stat label="Organization URL" value={<code className="text-xs">/o/{org.slug}</code>} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
