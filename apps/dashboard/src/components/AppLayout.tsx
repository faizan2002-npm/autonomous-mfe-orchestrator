import {
  Activity,
  ExternalLink,
  FlaskConical,
  GitPullRequestArrow,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingRows } from '@/components/common';
import { env } from '@/lib/env';
import { useLiveEvents, type LiveStatus } from '@/lib/events';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/services', label: 'Services', icon: Server },
  { to: '/drift', label: 'Drift Events', icon: Activity },
  { to: '/patches', label: 'Patches', icon: GitPullRequestArrow },
  { to: '/audits', label: 'Audit Log', icon: ScrollText },
  { to: '/demo', label: 'Demo Lab', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3 py-4">
      <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <ShieldCheck className="size-4.5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold">MFE Orchestrator</p>
        <p className="text-xs text-muted-foreground">Governance</p>
      </div>
    </div>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
      <a
        href={env.shellUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-4" />
        Open MFE shell
      </a>
    </nav>
  );
}

const LIVE_STYLES: Record<LiveStatus, { dot: string; label: string }> = {
  live: { dot: 'bg-success', label: 'Live' },
  connecting: { dot: 'bg-warning animate-pulse', label: 'Connecting' },
  offline: { dot: 'bg-destructive', label: 'Offline' },
};

function LiveIndicator() {
  const { status } = useLiveEvents();
  const style = LIVE_STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium"
      title="Real-time event stream from the gateway"
    >
      <span className={cn('size-2 rounded-full', style.dot)} />
      {style.label}
    </span>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`Theme: ${theme}`}>
      <Icon />
    </Button>
  );
}

function UserMenu() {
  const { session } = useAuth();
  const email = session?.user.email ?? 'Reviewer';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {email[0]?.toUpperCase()}
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void supabase.auth.signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <Brand />
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <Nav onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <LiveIndicator />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">
          <Suspense fallback={<LoadingRows />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
