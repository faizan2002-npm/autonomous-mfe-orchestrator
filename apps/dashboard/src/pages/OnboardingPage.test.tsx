import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, accessToken: vi.fn() }));
const { slugify } = await import('./OnboardingPage');
const { KeyReveal } = await import('@/components/admin');

test('organization names become URL-safe slugs', () => {
  expect(slugify('Acme Corp')).toBe('acme-corp');
  expect(slugify('  Café & Co. — Payments ')).toBe('cafe-co-payments');
  expect(slugify('x'.repeat(80))).toHaveLength(48);
});

test('a new key is shown once, with snippets that keep secret keys out of source', () => {
  render(<KeyReveal apiKey="sk_test123" serviceName="user-service" />);
  expect(screen.getByTestId('issued-key')).toHaveTextContent('sk_test123');
  expect(screen.getByText(/can't be shown again/)).toBeInTheDocument();
  expect(screen.getByText(/process\.env\.ORCHESTRATOR_KEY/)).toBeInTheDocument();
  // Secret keys get no browser snippet.
  expect(screen.queryByRole('tab', { name: 'Browser' })).not.toBeInTheDocument();
});
