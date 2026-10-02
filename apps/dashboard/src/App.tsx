import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/auth/AuthProvider';
import { LoginPage } from '@/auth/LoginPage';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppLayout } from '@/components/AppLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LiveEventsProvider } from '@/lib/events';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { lazy, type ComponentType } from 'react';

/** Route-level code splitting: each page loads on first visit. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}
const OverviewPage = page(() => import('@/pages/OverviewPage'), 'OverviewPage');
const ServicesPage = page(() => import('@/pages/ServicesPage'), 'ServicesPage');
const ServiceDetailPage = page(() => import('@/pages/ServicesPage'), 'ServiceDetailPage');
const DriftPage = page(() => import('@/pages/DriftPage'), 'DriftPage');
const DriftDetailPage = page(() => import('@/pages/DriftPage'), 'DriftDetailPage');
const PatchesPage = page(() => import('@/pages/PatchesPage'), 'PatchesPage');
const PatchDetailPage = page(() => import('@/pages/PatchesPage'), 'PatchDetailPage');
const AuditsPage = page(() => import('@/pages/AuditsPage'), 'AuditsPage');
const DemoLabPage = page(() => import('@/pages/DemoLabPage'), 'DemoLabPage');
const SettingsPage = page(() => import('@/pages/SettingsPage'), 'SettingsPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live events invalidate what changed; this is only a safety net.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => count < 2 && !('status' in error && error.status === 401),
    },
  },
});

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} richColors position="bottom-right" />;
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
                <Route element={<RequireAuth />}>
                  <Route
                    element={
                      <LiveEventsProvider>
                        <AppLayout />
                      </LiveEventsProvider>
                    }
                  >
                    <Route index element={<OverviewPage />} />
                    <Route path="services" element={<ServicesPage />} />
                    <Route path="services/:name" element={<ServiceDetailPage />} />
                    <Route path="drift" element={<DriftPage />} />
                    <Route path="drift/:id" element={<DriftDetailPage />} />
                    <Route path="patches" element={<PatchesPage />} />
                    <Route path="patches/:id" element={<PatchDetailPage />} />
                    <Route path="audits" element={<AuditsPage />} />
                    <Route path="demo" element={<DemoLabPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
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
