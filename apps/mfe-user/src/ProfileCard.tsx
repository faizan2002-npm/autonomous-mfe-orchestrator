import { useEffect, useState } from 'react';

/**
 * The contract this micro-frontend was built against. It reads these fields directly,
 * exactly like production UI code, so an upstream rename makes it crash for real.
 */
interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  profile: { avatarUrl: string; bio: string };
}

export type CanaryMode = 'on' | 'off' | 'sampled';

export interface ProfileCardProps {
  gatewayUrl: string;
  /** Publishable consumer key for this app (x-orchestrator-key). */
  apiKey: string;
  canary?: CanaryMode;
  /** Change to refetch. */
  refreshKey?: number;
  userId?: number;
}

interface Loaded {
  user: User;
  healed: boolean;
}

export default function ProfileCard({ gatewayUrl, apiKey, canary = 'sampled', refreshKey = 0, userId = 101 }: ProfileCardProps) {
  const [state, setState] = useState<Loaded | Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${gatewayUrl}/api/v1/user-service/users/${userId}`, {
      signal: controller.signal,
      headers: {
        'x-orchestrator-key': apiKey,
        ...(canary === 'sampled' ? {} : { 'x-mfe-canary': canary === 'on' ? 'true' : 'false' }),
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Gateway responded ${response.status}`);
        setState({
          user: (await response.json()) as User,
          healed: response.headers.get('x-orchestrator-healed') === 'true',
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState(error instanceof Error ? error : new Error(String(error)));
      });
    return () => controller.abort();
  }, [gatewayUrl, apiKey, canary, refreshKey, userId]);

  if (state instanceof Error) throw state;
  if (!state) return <div className="h-40 animate-pulse rounded-xl bg-slate-100" />;

  const { user, healed } = state;
  // Deliberately strict: no optional chaining, mirroring code written before the drift.
  const initials = user.firstName[0] + user.lastName[0];
  return (
    <div className="flex gap-4">
      <div className="grid size-14 shrink-0 place-items-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">
            {user.firstName} {user.lastName}
          </h3>
          {healed && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Self-healed by gateway
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">{user.email}</p>
        <p className="mt-2 text-sm text-slate-700">{user.profile.bio}</p>
        <dl className="mt-3 flex gap-6 text-xs text-slate-500">
          <div>
            <dt className="font-medium uppercase tracking-wide">Role</dt>
            <dd className="text-slate-800">{user.role}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase tracking-wide">User ID</dt>
            <dd className="text-slate-800">{user.id}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium uppercase tracking-wide">Avatar</dt>
            <dd className="truncate text-slate-800">{user.profile.avatarUrl.replace('https://', '')}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
