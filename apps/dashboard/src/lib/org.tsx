import { ORG_ROLES, type OrgRole, type OrgSummary } from '@orchestrator/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { accountApi, keys, orgApi, type OrgApi } from './api';

const LAST_ORG_KEY = 'mfe-dashboard-last-org';

interface OrgContextValue {
  slug: string;
  org: OrgSummary;
  api: OrgApi;
  /** True when the signed-in member has at least `role` (owner > admin > reviewer > viewer). */
  can: (role: OrgRole) => boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useMyOrgs() {
  return useQuery({ queryKey: keys.myOrgs, queryFn: accountApi.myOrgs });
}

export function rememberOrg(slug: string) {
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    // Storage may be unavailable; the dashboard just won't remember the last org.
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

const Spinner = () => (
  <div className="grid min-h-svh place-items-center text-muted-foreground">
    <Loader2 className="size-5 animate-spin" />
  </div>
);

/** Resolves `/o/:orgSlug` against the user's memberships. */
export function OrgProvider({ children }: { children: ReactNode }) {
  const { orgSlug = '' } = useParams();
  const orgs = useMyOrgs();
  const org = orgs.data?.find((candidate) => candidate.slug === orgSlug);
  useEffect(() => {
    if (org) rememberOrg(org.slug);
  }, [org]);
  const value = useMemo<OrgContextValue | null>(
    () =>
      org
        ? {
            slug: org.slug,
            org,
            api: orgApi(org.slug),
            can: (role) => ORG_ROLES.indexOf(org.role) <= ORG_ROLES.indexOf(role),
          }
        : null,
    [org],
  );
  // A just-created or just-joined org may not be in the cached list yet: wait for the refetch.
  if (orgs.isPending || (!value && orgs.isFetching)) return <Spinner />;
  if (!value) return <Navigate to="/" replace />;
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg must be used inside <OrgProvider>');
  return value;
}

/** `/` sends members to their last organization and newcomers to onboarding. */
export function OrgRedirect() {
  const orgs = useMyOrgs();
  if (orgs.isPending || orgs.isFetching) return <Spinner />;
  if (orgs.error) throw orgs.error;
  if (!orgs.data?.length) return <Navigate to="/onboarding" replace />;
  const remembered = lastOrg();
  const target = orgs.data.find((org) => org.slug === remembered) ?? orgs.data[0];
  return <Navigate to={`/o/${target.slug}`} replace />;
}

/** Builds links inside the current organization: p('/patches/1') -> '/o/acme/patches/1'. */
export function useOrgPath() {
  const { slug } = useOrg();
  return (path: string) => `/o/${slug}${path}`;
}
