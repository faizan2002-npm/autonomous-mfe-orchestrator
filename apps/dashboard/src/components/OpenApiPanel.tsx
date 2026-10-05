import type { ContractComparison, OpenApiState, RegisteredService } from '@orchestrator/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCode2, Loader2, Trash2, Upload } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { keys } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useOrg } from '@/lib/org';

const MAX_UPLOAD_BYTES = 900 * 1024;

function ImportDialog({ service, open, onClose }: { service: RegisteredService; open: boolean; onClose: () => void }) {
  const { slug, api } = useOrg();
  const queries = useQueryClient();
  const [mode, setMode] = useState<'url' | 'paste'>('url');
  const [url, setUrl] = useState(service.openapi?.sourceUrl ?? `${service.baseUrl.replace(/\/$/, '')}/openapi.json`);
  const [document, setDocument] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(service.openapi?.requiredOnly ?? false);

  const save = useMutation({
    mutationFn: () =>
      api.importOpenApi(service.id, mode === 'url' ? { url, requiredOnly } : { document, requiredOnly }),
    onSuccess: (state) => {
      queries.setQueryData(keys.openapi(slug, service.id), state);
      void queries.invalidateQueries({ queryKey: keys.registry(slug) });
      toast.success(`Imported ${state.import?.operations} operations from ${state.import?.title}`);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('That file is too large to upload here; import it from a URL instead (up to 5 MB).');
      return;
    }
    setDocument(await file.text());
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Import OpenAPI for {service.serviceName}</DialogTitle>
            <DialogDescription>
              OpenAPI 3.x or Swagger 2.0, as JSON or YAML. Each JSON 2xx response becomes the starting contract for every
              consumer, so drift is caught from the very first request.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'url' | 'paste')}>
            <TabsList>
              <TabsTrigger value="url">From URL</TabsTrigger>
              <TabsTrigger value="paste">Upload or paste</TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="mt-3 space-y-2">
              <Label htmlFor="openapi-url">Spec URL</Label>
              <Input id="openapi-url" type="url" required={mode === 'url'} value={url} onChange={(e) => setUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground">Fetched by the gateway, with the same network protections as upstream calls.</p>
            </TabsContent>
            <TabsContent value="paste" className="mt-3 space-y-2">
              <Label htmlFor="openapi-file">File</Label>
              <Input id="openapi-file" type="file" accept=".json,.yaml,.yml,application/json,application/yaml" onChange={(e) => void readFile(e)} />
              <Label htmlFor="openapi-document">Document</Label>
              <Textarea
                id="openapi-document"
                required={mode === 'paste'}
                rows={8}
                className="font-mono text-xs"
                placeholder="openapi: 3.0.3"
                value={document}
                onChange={(e) => setDocument(e.target.value)}
              />
            </TabsContent>
          </Tabs>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={requiredOnly}
              onChange={(e) => setRequiredOnly(e.target.checked)}
            />
            <span>
              Only required properties form the contract
              <span className="block text-xs text-muted-foreground">
                Use this when responses legitimately omit optional fields.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TokenList({ tokens, tone }: { tokens: string[]; tone: 'missing' | 'extra' }) {
  if (!tokens.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tokens.map((token) => (
        <code
          key={token}
          className={tone === 'missing' ? 'rounded bg-success/10 px-1.5 py-0.5 font-mono text-xs text-success' : 'rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive'}
        >
          {tone === 'missing' ? '+' : '−'} {token}
        </code>
      ))}
    </div>
  );
}

function Comparison({ service, comparison }: { service: RegisteredService; comparison: ContractComparison }) {
  const { slug, api, can } = useOrg();
  const queries = useQueryClient();
  const matches = !comparison.missingFromContract.length && !comparison.notInSpec.length;
  const adopt = useMutation({
    mutationFn: () => api.adoptOpenApi(service.id, comparison.contractId),
    onSuccess: (state) => {
      queries.setQueryData(keys.openapi(slug, service.id), state);
      void queries.invalidateQueries({ queryKey: keys.service(slug, service.serviceName) });
      toast.success(`${comparison.consumerName} now uses the spec as its contract`);
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{comparison.consumerName}</span>
          <code className="font-mono text-xs text-muted-foreground">
            {comparison.httpMethod} {comparison.endpointPath}
          </code>
          <Badge variant="outline">{comparison.source === 'openapi' ? 'From spec' : 'Learned from traffic'}</Badge>
          {matches && <Badge variant="outline" className="border-success/40 text-success">Matches spec</Badge>}
        </div>
        {!matches && can('reviewer') && (
          <Button size="sm" variant="outline" disabled={adopt.isPending} onClick={() => adopt.mutate()}>
            {adopt.isPending && <Loader2 className="animate-spin" />}
            Use spec as contract
          </Button>
        )}
      </div>
      <TokenList tokens={comparison.missingFromContract} tone="missing" />
      <TokenList tokens={comparison.notInSpec} tone="extra" />
    </li>
  );
}

function OpenApiBody({ service, state }: { service: RegisteredService; state: OpenApiState }) {
  if (!state.import)
    return (
      <EmptyState title="No spec imported">
        Contracts are learned from each consumer's first response. Import the service's OpenAPI document to start from
        what the API promises instead.
      </EmptyState>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="font-medium">{state.import.title}</span>
          {state.import.version && <span className="text-muted-foreground"> v{state.import.version}</span>}
        </span>
        <span className="text-muted-foreground">
          {state.import.operations} operations · imported {relativeTime(state.import.importedAt)} by {state.import.importedBy}
          {state.import.requiredOnly && ' · required properties only'}
        </span>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Declared responses</p>
        <ul className="divide-y rounded-lg border">
          {state.operations.map((operation) => (
            <li key={operation.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-sm">
                  <span className="font-semibold">{operation.httpMethod}</span> {operation.pathTemplate}
                </code>
                <span className="text-xs text-muted-foreground">
                  {operation.responseStatus}
                  {operation.operationId && ` · ${operation.operationId}`}
                  {` · ${operation.schemaTokens.length} fields`}
                </span>
              </div>
              {operation.summary && <p className="text-xs text-muted-foreground">{operation.summary}</p>}
            </li>
          ))}
        </ul>
        {state.import.skipped.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Not used (no JSON 2xx response): {state.import.skipped.join(', ')}
          </p>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold">Consumer contracts vs. spec</p>
        <p className="text-xs text-muted-foreground">
          <span className="text-success">+</span> declared but not in the contract ·{' '}
          <span className="text-destructive">−</span> in the contract but not declared
        </p>
        {state.comparisons.length ? (
          <ul className="divide-y">
            {state.comparisons.map((comparison) => (
              <Comparison key={comparison.contractId} service={service} comparison={comparison} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No consumer has called a declared endpoint yet.</p>
        )}
      </div>
    </div>
  );
}

export function OpenApiPanel({ service }: { service: RegisteredService }) {
  const { slug, api, can } = useOrg();
  const queries = useQueryClient();
  const state = useQuery({ queryKey: keys.openapi(slug, service.id), queryFn: () => api.openapi(service.id) });
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.removeOpenApi(service.id),
    onSuccess: () => {
      setRemoving(false);
      void queries.invalidateQueries({ queryKey: keys.openapi(slug, service.id) });
      void queries.invalidateQueries({ queryKey: keys.registry(slug) });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="size-4" />
            OpenAPI
          </CardTitle>
          <CardDescription>Declared response contracts, compared with what each consumer actually receives.</CardDescription>
        </div>
        {can('admin') && (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setImporting(true)}>
              <Upload />
              {service.openapi ? 'Re-import' : 'Import spec'}
            </Button>
            {service.openapi && (
              <Button size="icon" variant="ghost" aria-label="Remove spec" onClick={() => setRemoving(true)}>
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {state.isPending ? (
          <LoadingRows rows={2} />
        ) : state.isError ? (
          <ErrorState error={state.error} />
        ) : (
          <OpenApiBody service={service} state={state.data} />
        )}
      </CardContent>
      {importing && <ImportDialog service={service} open onClose={() => setImporting(false)} />}
      <ConfirmDialog
        open={removing}
        title="Remove the OpenAPI spec?"
        description="New contracts are learned from traffic again. Existing contracts keep their current baselines."
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setRemoving(false)}
      />
    </Card>
  );
}
