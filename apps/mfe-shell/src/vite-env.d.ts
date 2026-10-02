/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_MFE_CONSUMER_KEY?: string;
  readonly VITE_DASHBOARD_URL?: string;
  readonly VITE_MFE_USER_ENTRY?: string;
  readonly VITE_MFE_ORDER_ENTRY?: string;
}
