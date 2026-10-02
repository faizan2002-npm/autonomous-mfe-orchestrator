import type { SchemaDiff as Diff } from '@orchestrator/shared-types';
import { cn } from '@/lib/utils';

type RowState = 'unchanged' | 'missing' | 'typeChanged' | 'added';

interface Row {
  path: string;
  expected?: string;
  observed?: string;
  state: RowState;
}

const STYLES: Record<RowState, { row: string; label: string }> = {
  unchanged: { row: '', label: '' },
  missing: { row: 'bg-destructive/8 text-destructive', label: 'missing' },
  typeChanged: { row: 'bg-warning/10 text-warning', label: 'type changed' },
  added: { row: 'bg-success/10 text-success', label: 'added' },
};

/** Splits on the last ':' like the drift engine, so field names may contain colons. */
function splitToken(token: string): [string, string] {
  const index = token.lastIndexOf(':');
  return [token.slice(0, index), token.slice(index + 1)];
}

export function buildRows(expectedSchema: string[], diff: Diff): Row[] {
  const missing = new Set(diff.missingFields);
  const mismatches = new Map(diff.typeMismatches.map((m) => [m.path, m.observed]));
  const rows: Row[] = expectedSchema.map((token) => {
    const [path, type] = splitToken(token);
    if (missing.has(path)) return { path, expected: type, state: 'missing' };
    if (mismatches.has(path))
      return { path, expected: type, observed: mismatches.get(path), state: 'typeChanged' };
    return { path, expected: type, observed: type, state: 'unchanged' };
  });
  for (const path of diff.addedFields) rows.push({ path, state: 'added' });
  return rows;
}

export function SchemaDiff({ expectedSchema, diff }: { expectedSchema: string[]; diff: Diff }) {
  const rows = buildRows(expectedSchema, diff);
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Field path</span>
        <span>Expected</span>
        <span className="w-24 text-right">Change</span>
      </div>
      <ul className="divide-y font-mono text-xs">
        {rows.map((row) => (
          <li
            key={`${row.state}:${row.path}`}
            data-state={row.state}
            className={cn('grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-2', STYLES[row.state].row)}
          >
            <span className={cn('truncate', row.state === 'missing' && 'line-through')}>{row.path}</span>
            <span className="text-muted-foreground">
              {row.state === 'added' ? '—' : row.expected}
              {row.state === 'typeChanged' && <span className="text-warning"> → {row.observed}</span>}
            </span>
            <span className="w-24 text-right font-sans font-medium">{STYLES[row.state].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
