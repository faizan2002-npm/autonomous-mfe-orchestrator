import { ORG_ROLES, type OrgRole } from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog, CopyButton } from '@/components/admin';
import { ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { keys } from '@/lib/api';
import { humanize, relativeTime } from '@/lib/format';
import { useOrg } from '@/lib/org';

const ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Everything, including managing owners and admins',
  admin: 'Services, consumers, keys, members and settings',
  reviewer: 'Preview, promote and roll back patches; pin contracts',
  viewer: 'Read-only',
};

export function MembersPage() {
  const { slug, api, org, can } = useOrg();
  const { session } = useAuth();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const members = useQuery({ queryKey: keys.members(slug), queryFn: api.members });
  const invitations = useQuery({
    queryKey: keys.invitations(slug),
    queryFn: api.invitations,
    enabled: can('admin'),
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('reviewer');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; email: string; self: boolean } | null>(null);

  const refresh = () => {
    void queries.invalidateQueries({ queryKey: keys.members(slug) });
    void queries.invalidateQueries({ queryKey: keys.invitations(slug) });
  };
  const invite = useMutation({
    mutationFn: () => api.invite(email, role),
    onSuccess: (created) => {
      refresh();
      setLastLink(created.acceptUrl);
      setEmail('');
      toast.success(`Invitation created for ${created.email}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const changeRole = useMutation({
    mutationFn: ({ id, next }: { id: string; next: OrgRole }) => api.updateMember(id, next),
    onSuccess: () => {
      refresh();
      void queries.invalidateQueries({ queryKey: keys.myOrgs });
      toast.success('Role updated');
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeMember(id),
    onSuccess: async () => {
      const self = removing?.self;
      setRemoving(null);
      if (self) {
        await queries.invalidateQueries({ queryKey: keys.myOrgs });
        navigate('/', { replace: true });
        return;
      }
      refresh();
      toast.success('Member removed');
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => {
      refresh();
      toast.success('Invitation revoked');
    },
  });

  // Owners manage everyone; admins manage reviewers and viewers (enforced by the API too).
  const assignable = ORG_ROLES.filter((r) => org.role === 'owner' || (r !== 'owner' && r !== 'admin'));

  return (
    <>
      <PageHeader title="Members" description={`People with access to ${org.name}.`} />
      <div className="space-y-6">
        {can('admin') && (
          <Card>
            <CardHeader>
              <CardTitle>Invite someone</CardTitle>
              <CardDescription>The link works once, for that email address, for 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  invite.mutate();
                }}
                className="flex flex-wrap items-end gap-2"
              >
                <Input
                  type="email"
                  required
                  placeholder="teammate@company.com"
                  className="min-w-56 flex-1"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-label="Email to invite"
                />
                <Select value={role} onValueChange={(value) => setRole(value as OrgRole)}>
                  <SelectTrigger className="w-32" aria-label="Role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (
                      <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={invite.isPending}>
                  {invite.isPending && <Loader2 className="animate-spin" />}
                  Send invitation
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
              {lastLink && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{lastLink}</code>
                  <CopyButton value={lastLink} label="Copy link" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="py-0">
          {members.error ? (
            <CardContent className="py-6"><ErrorState error={members.error} /></CardContent>
          ) : !members.data ? (
            <CardContent className="py-6"><LoadingRows rows={3} /></CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="pr-6 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data.map((member) => {
                  const self = member.userId === session?.user.id;
                  const manageable =
                    org.role === 'owner' || (can('admin') && member.role !== 'owner' && member.role !== 'admin');
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="pl-6">
                        {member.email} {self && <Badge variant="outline">you</Badge>}
                      </TableCell>
                      <TableCell>
                        {manageable && !self ? (
                          <Select
                            value={member.role}
                            onValueChange={(next) => changeRole.mutate({ id: member.id, next: next as OrgRole })}
                          >
                            <SelectTrigger className="w-32" aria-label={`Role of ${member.email}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {assignable.map((r) => (
                                <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{humanize(member.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{relativeTime(member.createdAt)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        {(self || manageable) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRemoving({ id: member.id, email: member.email, self })}
                          >
                            <UserMinus />
                            {self ? 'Leave' : 'Remove'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        {can('admin') && (
          <Card>
            <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
            <CardContent>
              {!invitations.data?.length ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <ul className="divide-y">
                  {invitations.data.map((invitation) => (
                    <li key={invitation.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {invitation.email} · {humanize(invitation.role)} · expires {relativeTime(invitation.expiresAt).replace(' ago', '')}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => revoke.mutate(invitation.id)}>Revoke</Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        title={removing?.self ? `Leave ${org.name}?` : `Remove ${removing?.email}?`}
        description={removing?.self ? 'You will lose access until someone invites you again.' : 'They lose access immediately.'}
        confirmLabel={removing?.self ? 'Leave organization' : 'Remove member'}
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
