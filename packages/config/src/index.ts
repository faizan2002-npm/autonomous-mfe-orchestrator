/** Shared connection defaults, evaluated when configuration is requested. */
export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mfe_orchestrator';
}

export function getServiceEndpoints(): Readonly<Record<string, string>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
    'user-service': process.env.USER_SERVICE_URL || 'http://localhost:3001',
    'order-service': process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
  }));
}
