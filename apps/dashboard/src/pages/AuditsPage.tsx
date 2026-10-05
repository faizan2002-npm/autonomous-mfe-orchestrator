import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { keys } from '@/lib/api';
import { useOrg, useOrgPath } from '@/lib/org';
import { absoluteTime, shortId } from '@/lib/format';

export function AuditsPage() {
  const { slug, api } = useOrg();
  const p = useOrgPath();
  const audits = useQuery({ queryKey: keys.audits(slug), queryFn: () => api.audits(200) });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every automatic and human decision about a patch, newest first."
      />
      <Card className="py-0">
        {audits.error ? (
          <CardContent className="py-6"><ErrorState error={audits.error} /></CardContent>
        ) : !audits.data ? (
          <CardContent className="py-6"><LoadingRows /></CardContent>
        ) : !audits.data.length ? (
          <CardContent className="py-6"><EmptyState title="No decisions recorded yet" /></CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">When</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="pr-6 text-right">Patch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.data.map((audit) => (
                <TableRow key={audit.id}>
                  <TableCell className="whitespace-nowrap pl-6 text-muted-foreground">{absoluteTime(audit.createdAt)}</TableCell>
                  <TableCell><StatusBadge value={audit.status} /></TableCell>
                  <TableCell className="max-w-48 truncate">{audit.reviewer ?? '—'}</TableCell>
                  <TableCell className="max-w-md">
                    <p className="truncate text-sm">{audit.reasoningTrace}</p>
                    {audit.reviewNotes && (
                      <p className="truncate text-xs text-muted-foreground">{audit.reviewNotes}</p>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {audit.patchId ? (
                      <Link to={p(`/patches/${audit.patchId}`)} className="font-mono text-xs hover:underline">
                        {shortId(audit.patchId)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
