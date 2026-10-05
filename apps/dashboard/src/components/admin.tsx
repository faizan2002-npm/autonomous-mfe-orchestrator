import { Check, Copy, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        } catch {
          toast.error('Copy failed; select the text and copy it manually');
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 pr-24 font-mono text-xs leading-relaxed">{code}</pre>
      <CopyButton value={code} className="absolute right-2 top-2" />
    </div>
  );
}

/** Shows a newly issued key exactly once, with usage snippets for browsers and backends. */
export function KeyReveal({ apiKey, serviceName }: { apiKey: string; serviceName?: string }) {
  const service = serviceName ?? '<service>';
  const url = `${env.gatewayUrl}/api/v1/${service}/...`;
  const publishable = apiKey.startsWith('pk_');
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>Copy this key now. It is stored only as a hash and can't be shown again.</span>
      </div>
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs" data-testid="issued-key">
          {apiKey}
        </code>
        <CopyButton value={apiKey} />
      </div>
      <Tabs defaultValue={publishable ? 'browser' : 'node'}>
        <TabsList>
          {publishable && <TabsTrigger value="browser">Browser</TabsTrigger>}
          <TabsTrigger value="node">Node.js</TabsTrigger>
          <TabsTrigger value="curl">curl</TabsTrigger>
        </TabsList>
        {publishable && (
          <TabsContent value="browser">
            <Snippet
              code={`const response = await fetch('${url}', {\n  headers: { 'x-orchestrator-key': '${apiKey}' },\n});`}
            />
          </TabsContent>
        )}
        <TabsContent value="node">
          <Snippet
            code={`// Keep the key in an environment variable, never in source control.\nconst response = await fetch('${url}', {\n  headers: { 'x-orchestrator-key': process.env.ORCHESTRATOR_KEY },\n});`}
          />
        </TabsContent>
        <TabsContent value="curl">
          <Snippet code={`curl -H 'x-orchestrator-key: ${apiKey}' '${url}'`} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground', className)}>
      {children}
    </span>
  );
}
