import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { keys } from '@/lib/api';
import { absoluteTime } from '@/lib/format';
import { useOrg } from '@/lib/org';

const describe = (details: unknown) => {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ');
};

export function ActivityPage() {
  const { slug, api } = useOrg();
  const activity = useQuery({ queryKey: keys.activity(slug), queryFn: () => api.activity(200) });
  return (
    <>
      <PageHeader
        title="Activity"
        description="Administrative changes: members, invitations, services, consumers, keys and settings."
      />
      <Card className="py-0">
        {activity.error ? (
          <CardContent className="py-6"><ErrorState error={activity.error} /></CardContent>
        ) : !activity.data ? (
          <CardContent className="py-6"><LoadingRows /></CardContent>
        ) : !activity.data.length ? (
          <CardContent className="py-6"><EmptyState title="Nothing recorded yet" /></CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="pr-6">Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.data.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap pl-6 text-muted-foreground">{absoluteTime(entry.createdAt)}</TableCell>
                  <TableCell className="max-w-48 truncate">{entry.actor}</TableCell>
                  <TableCell><code className="text-xs">{entry.action}</code></TableCell>
                  <TableCell className="max-w-md pr-6">
                    <p className="truncate text-sm">{entry.targetId ?? entry.targetType}</p>
                    {describe(entry.details) && (
                      <p className="truncate text-xs text-muted-foreground">{describe(entry.details)}</p>
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
