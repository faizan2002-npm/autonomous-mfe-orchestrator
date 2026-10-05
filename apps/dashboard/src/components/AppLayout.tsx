import {
  Activity,
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  ExternalLink,
  History,
  KeyRound,
  Plus,
  Users,
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
import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import type { OrgRole } from '@orchestrator/shared-types';
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
import { keys } from '@/lib/api';
import { env } from '@/lib/env';
import { useLiveEvents, type LiveStatus } from '@/lib/events';
import { humanize, relativeTime } from '@/lib/format';
import { useMyOrgs, useOrg, useOrgPath } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV: Array<{ to: string; label: string; icon: typeof Activity; end?: boolean; role?: OrgRole }> = [
  { to: '', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/services', label: 'Services', icon: Server },
  { to: '/consumers', label: 'Consumers & keys', icon: KeyRound },
  { to: '/drift', label: 'Drift Events', icon: Activity },
  { to: '/patches', label: 'Patches', icon: GitPullRequestArrow },
  { to: '/policies', label: 'Policies', icon: ShieldCheck },
  { to: '/audits', label: 'Audit Log', icon: ScrollText },
  { to: '/demo', label: 'Demo Lab', icon: FlaskConical },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/members', label: 'Members', icon: Users },
  { to: '/activity', label: 'Activity', icon: History, role: 'admin' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function OrgSwitcher() {
  const { org } = useOrg();
  const orgs = useMyOrgs();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mx-2 my-3 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent"
        >
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            {org.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{org.name}</p>
            <p className="text-xs text-muted-foreground">{humanize(org.role)}</p>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
        {orgs.data?.map((candidate) => (
          <DropdownMenuItem key={candidate.id} asChild>
            <Link to={`/o/${candidate.slug}`}>
              <Building2 />
              <span className="flex-1 truncate">{candidate.name}</span>
              {candidate.slug === org.slug && <Check />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/onboarding">
            <Plus />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const p = useOrgPath();
  const { can } = useOrg();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.filter((item) => !item.role || can(item.role)).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={label}
          to={p(to)}
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

/** Unread count stays live: the SSE stream invalidates the inbox on notification.created. */
function NotificationBell() {
  const { slug, api } = useOrg();
  const p = useOrgPath();
  const inbox = useQuery({ queryKey: keys.inbox(slug), queryFn: () => api.inbox(100) });
  const unread = inbox.data?.unreadCount ?? 0;
  const latest = inbox.data?.items.slice(0, 5) ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        >
          <Bell />
          {unread > 0 && (
            <span
              data-testid="unread-count"
              className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread > 0 && <span className="text-xs font-normal text-muted-foreground">{unread} unread</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {latest.length ? (
          latest.map((item) => (
            <DropdownMenuItem key={item.id} asChild>
              <Link to={item.link ?? p('/notifications')} className="flex items-start gap-2">
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.readAt ? 'bg-transparent' : 'bg-primary')}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', !item.readAt && 'font-semibold')}>{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">You&apos;re all caught up</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={p('/notifications')} className="justify-center text-sm font-medium">
            View all notifications
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
        <OrgSwitcher />
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
              <OrgSwitcher />
              <Nav onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <LiveIndicator />
          <NotificationBell />
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
