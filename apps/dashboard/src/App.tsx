import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import {
  ForgotPasswordPage,
  LoginPage,
  SignupPage,
  UpdatePasswordPage,
} from '@/auth/AuthPages';
import { AuthProvider } from '@/auth/AuthProvider';
import { InvitePage } from '@/auth/InvitePage';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppLayout } from '@/components/AppLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LiveEventsProvider } from '@/lib/events';
import { OrgProvider, OrgRedirect } from '@/lib/org';
import { ThemeProvider, useTheme } from '@/lib/theme';

/** Route-level code splitting: each page loads on first visit. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}
const OverviewPage = page(() => import('@/pages/OverviewPage'), 'OverviewPage');
const ServicesPage = page(() => import('@/pages/ServicesPage'), 'ServicesPage');
const ServiceDetailPage = page(() => import('@/pages/ServicesPage'), 'ServiceDetailPage');
const ConsumersPage = page(() => import('@/pages/ConsumersPage'), 'ConsumersPage');
const DriftPage = page(() => import('@/pages/DriftPage'), 'DriftPage');
const DriftDetailPage = page(() => import('@/pages/DriftPage'), 'DriftDetailPage');
const PatchesPage = page(() => import('@/pages/PatchesPage'), 'PatchesPage');
const PatchDetailPage = page(() => import('@/pages/PatchesPage'), 'PatchDetailPage');
const AuditsPage = page(() => import('@/pages/AuditsPage'), 'AuditsPage');
const DemoLabPage = page(() => import('@/pages/DemoLabPage'), 'DemoLabPage');
const NotificationsPage = page(() => import('@/pages/NotificationsPage'), 'NotificationsPage');
const MembersPage = page(() => import('@/pages/MembersPage'), 'MembersPage');
const ActivityPage = page(() => import('@/pages/ActivityPage'), 'ActivityPage');
const SettingsPage = page(() => import('@/pages/SettingsPage'), 'SettingsPage');
const OnboardingPage = page(() => import('@/pages/OnboardingPage'), 'OnboardingPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live events invalidate what changed; this is only a safety net.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => count < 2 && !('status' in error && [401, 403, 404].includes(error.status as number)),
    },
  },
});

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} richColors position="bottom-right" />;
}

/** Everything under /o/:orgSlug shares the org context and its live event stream. */
function OrgRoutes() {
  return (
    <OrgProvider>
      <LiveEventsProvider>
        <AppLayout />
      </LiveEventsProvider>
    </OrgProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/update-password" element={<UpdatePasswordPage />} />
                <Route path="/invite/:token" element={<InvitePage />} />
                <Route element={<RequireAuth />}>
                  <Route index element={<OrgRedirect />} />
                  <Route path="onboarding" element={<OnboardingPage />} />
                  <Route path="o/:orgSlug" element={<OrgRoutes />}>
                    <Route index element={<OverviewPage />} />
                    <Route path="services" element={<ServicesPage />} />
                    <Route path="services/:name" element={<ServiceDetailPage />} />
                    <Route path="consumers" element={<ConsumersPage />} />
                    <Route path="drift" element={<DriftPage />} />
                    <Route path="drift/:id" element={<DriftDetailPage />} />
                    <Route path="patches" element={<PatchesPage />} />
                    <Route path="patches/:id" element={<PatchDetailPage />} />
                    <Route path="audits" element={<AuditsPage />} />
                    <Route path="demo" element={<DemoLabPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="members" element={<MembersPage />} />
                    <Route path="activity" element={<ActivityPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="." replace />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
            <ThemedToaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

// Re-exported so lazy route modules share one router instance in tests.
export { Outlet };
