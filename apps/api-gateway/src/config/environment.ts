export function validateEnvironment(environment: Record<string, unknown>) {
  const port = Number(environment.GATEWAY_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('GATEWAY_PORT must be an integer between 1 and 65535');
  }
  const databaseUrl = String(
    environment.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/mfe_orchestrator',
  );
  const redisUrl = String(environment.REDIS_URL || 'redis://localhost:6379');
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  return {
    ...environment,
    GATEWAY_PORT: port,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  };
}
