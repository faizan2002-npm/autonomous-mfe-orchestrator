import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountApi, keys } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useAuth } from './AuthProvider';

export function InvitePage() {
  const { token = '' } = useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const invitation = useQuery({
    queryKey: keys.invitation(token),
    queryFn: () => accountApi.previewInvitation(token),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => accountApi.acceptInvitation(token),
    onSuccess: async (org) => {
      await queries.invalidateQueries({ queryKey: keys.myOrgs });
      navigate(`/o/${org.slug}`, { replace: true });
    },
  });
  const here = `/invite/${token}`;

  return (
    <div className="grid min-h-svh place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <UserPlus className="size-6" />
          </div>
          {invitation.data ? (
            <>
              <CardTitle className="text-xl">
                <h1>Join {invitation.data.orgName}</h1>
              </CardTitle>
              <CardDescription>
                You're invited as <strong>{humanize(invitation.data.role)}</strong> ({invitation.data.email}).
              </CardDescription>
            </>
          ) : (
            <CardTitle className="text-xl">
              <h1>Invitation</h1>
            </CardTitle>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {invitation.isPending || loading ? (
            <div className="flex justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : invitation.error ? (
            <p className="text-center text-sm text-destructive">{invitation.error.message}</p>
          ) : session ? (
            <>
              {accept.error && <p className="text-sm text-destructive">{accept.error.message}</p>}
              <Button className="w-full" disabled={accept.isPending} onClick={() => accept.mutate()}>
                {accept.isPending && <Loader2 className="animate-spin" />}
                Accept and join
              </Button>
              <p className="text-center text-xs text-muted-foreground">Signed in as {session.user.email}</p>
            </>
          ) : (
            <>
              <Button asChild className="w-full">
                <Link to={`/signup?next=${encodeURIComponent(here)}`} state={{ email: invitation.data.email }}>
                  Create an account
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to={`/login?next=${encodeURIComponent(here)}`}>I already have an account</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
