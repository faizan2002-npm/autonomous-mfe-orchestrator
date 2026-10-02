import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { ErrorState, LoadingRows, PageHeader, Stat } from '@/components/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/AuthProvider';
import { api, keys } from '@/lib/api';
import { env } from '@/lib/env';
import { percent } from '@/lib/format';

export function SettingsPage() {
  const { session } = useAuth();
  const config = useQuery({ queryKey: keys.config, queryFn: api.config });
  return (
    <>
      <PageHeader title="Settings" description="Gateway configuration (read-only; change it in the server .env)." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Healing pipeline</CardTitle>
            <CardDescription>{env.gatewayUrl}</CardDescription>
          </CardHeader>
          <CardContent>
            {config.error ? (
              <ErrorState error={config.error} />
            ) : !config.data ? (
              <LoadingRows rows={3} />
            ) : (
              <div className="grid grid-cols-2 gap-6">
                <Stat
                  label="Drift threshold"
                  value={config.data.driftThreshold.toFixed(2)}
                  hint={`Responses sharing under ${percent(1 - config.data.driftThreshold)} of their schema count as drifted`}
                />
                <Stat label="Canary traffic" value={`${config.data.canaryPercent}%`} hint="Share a new patch serves before promotion" />
                <Stat label="Gemini model" value={config.data.geminiModel} />
                <Stat
                  label="Gemini API key"
                  value={
                    config.data.geminiConfigured ? (
                      <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" />Configured</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warning"><XCircle className="size-4" />Not set</span>
                    )
                  }
                  hint={config.data.geminiConfigured ? undefined : 'Adapters come from the deterministic fallback'}
                />
                <Stat label="Proxied services" value={config.data.services.join(', ')} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Signed in as</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-6">
            <Stat label="Email" value={session?.user.email ?? '—'} />
            <Stat label="User ID" value={<span className="font-mono text-xs">{session?.user.id}</span>} />
            <Stat
              label="Session expires"
              value={session?.expires_at ? new Date(session.expires_at * 1000).toLocaleTimeString() : '—'}
              hint="Refreshed automatically"
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
