import { Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

/** Only same-app paths are honored, so `?next=` cannot become an open redirect. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="text-xl">
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const run = async (action: () => Promise<{ error: { message: string } | null }>) => {
    setSubmitting(true);
    setError(null);
    const { error: failure } = await action();
    setSubmitting(false);
    if (failure) setError(failure.message);
    return !failure;
  };
  return { error, submitting, run };
}

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, submitting, run } = useSubmit();

  if (session) return <Navigate to={next} replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => supabase.auth.signInWithPassword({ email, password }));
  };

  return (
    <AuthShell title="Sign in" description="Review API drift and approve self-healing patches.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field id="email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="text-muted-foreground hover:underline">
            Forgot password?
          </Link>
          <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-primary hover:underline">
            Create account
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  // Prefilled from an invitation via router state (kept out of the URL).
  const invitedEmail = (useLocation().state as { email?: string } | null)?.email;
  const [email, setEmail] = useState(invitedEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState(false);
  const { error, submitting, run } = useSubmit();

  if (session) return <Navigate to={next} replace />;
  if (confirmEmail)
    return (
      <AuthShell title="Check your inbox" description={`We sent a confirmation link to ${email}.`}>
        <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
          <MailCheck className="size-10 text-primary" />
          <p>Open the link to activate your account, then sign in to continue.</p>
          <Button asChild variant="outline" className="w-full">
            <Link to={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    let needsConfirmation = false;
    const ok = await run(async () => {
      const result = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${next}` },
      });
      needsConfirmation = !result.data.session;
      return result;
    });
    if (ok && needsConfirmation) setConfirmEmail(true);
  };

  return (
    <AuthShell title="Create your account" description="Then create an organization or accept an invitation.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field id="email" label="Work email" type="email" autoComplete="email" value={email} onChange={setEmail} />
        <Field
          id="password"
          label="Password (8+ characters)"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Create account
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { error, submitting, run } = useSubmit();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(() =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      }),
    );
    if (ok) setSent(true);
  };

  return (
    <AuthShell title="Reset your password" description="We'll email you a link to choose a new one.">
      {sent ? (
        <p className="text-center text-sm text-muted-foreground">
          If an account exists for {email}, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-muted-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

/** Landing page of the reset email; Supabase has already exchanged the link for a session. */
export function UpdatePasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const { error, submitting, run } = useSubmit();

  if (loading) return null;
  if (!session) return <Navigate to="/forgot-password" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => supabase.auth.updateUser({ password }))) navigate('/', { replace: true });
  };

  return (
    <AuthShell title="Choose a new password" description={session.user.email ?? ''}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          id="password"
          label="New password (8+ characters)"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
