// Types for modules loaded at runtime via Module Federation.
declare module 'mfe_user/ProfileCard' {
  import type { ComponentType } from 'react';
  const ProfileCard: ComponentType<{
    gatewayUrl: string;
    canary?: 'on' | 'off' | 'sampled';
    refreshKey?: number;
  }>;
  export default ProfileCard;
}

declare module 'mfe_order/OrderCard' {
  import type { ComponentType } from 'react';
  const OrderCard: ComponentType<{
    gatewayUrl: string;
    canary?: 'on' | 'off' | 'sampled';
    refreshKey?: number;
  }>;
  export default OrderCard;
}
