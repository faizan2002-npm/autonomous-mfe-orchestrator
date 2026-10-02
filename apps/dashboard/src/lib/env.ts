function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

export const env = {
  gatewayUrl: (import.meta.env.VITE_GATEWAY_URL || 'http://localhost:4000').replace(/\/$/, ''),
  shellUrl: import.meta.env.VITE_SHELL_URL || 'http://localhost:5000',
  /** Demo frontend key (pnpm db:seed --write-env); only a convenience for the Demo Lab. */
  demoConsumerKey: import.meta.env.VITE_MFE_CONSUMER_KEY ?? '',
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseKey: required(
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  ),
};
