import { ValidationPipe, type Type } from '@nestjs/common';

/**
 * Explicit DTO validation. tsx (esbuild) emits no decorator metadata, so the global pipe
 * cannot infer DTO classes in development; naming the type here works in both modes.
 */
export const validated = (expectedType: Type) =>
  new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
