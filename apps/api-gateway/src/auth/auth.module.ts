import { Global, Logger, Module } from '@nestjs/common';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { AuthGuard } from './auth.guard.js';
import {
  DisabledTokenVerifier,
  SupabaseJwtVerifier,
  TOKEN_VERIFIER,
} from './token-verifier.js';

@Global()
@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [GATEWAY_CONFIG],
      useFactory: ({ supabaseUrl }: GatewayConfig) => {
        if (supabaseUrl) return new SupabaseJwtVerifier(supabaseUrl);
        Logger.warn(
          'SUPABASE_URL is not set: governance and demo APIs will reject every request.',
          'AuthModule',
        );
        return new DisabledTokenVerifier();
      },
    },
    AuthGuard,
  ],
  exports: [TOKEN_VERIFIER, AuthGuard],
})
export class AuthModule {}
