import { useEffect, useState } from 'react';

/** The order contract this micro-frontend was built against (see ProfileCard for why it is strict). */
interface Order {
  orderId: string;
  totalAmount: number;
  currency: string;
  status: string;
  shippingAddress: { street: string; city: string; zipCode: string };
  items: Array<{ sku: string; quantity: number; price: number }>;
}

export type CanaryMode = 'on' | 'off' | 'sampled';

export interface OrderCardProps {
  gatewayUrl: string;
  /** Publishable consumer key for this app (x-orchestrator-key). */
  apiKey: string;
  canary?: CanaryMode;
  refreshKey?: number;
  orderId?: number;
}

interface Loaded {
  order: Order;
  healed: boolean;
}

export default function OrderCard({ gatewayUrl, apiKey, canary = 'sampled', refreshKey = 0, orderId = 9821 }: OrderCardProps) {
  const [state, setState] = useState<Loaded | Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${gatewayUrl}/api/v1/order-service/orders/${orderId}`, {
      signal: controller.signal,
      headers: {
        'x-orchestrator-key': apiKey,
        ...(canary === 'sampled' ? {} : { 'x-mfe-canary': canary === 'on' ? 'true' : 'false' }),
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Gateway responded ${response.status}`);
        setState({
          order: (await response.json()) as Order,
          healed: response.headers.get('x-orchestrator-healed') === 'true',
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState(error instanceof Error ? error : new Error(String(error)));
      });
    return () => controller.abort();
  }, [gatewayUrl, apiKey, canary, refreshKey, orderId]);

  if (state instanceof Error) throw state;
  if (!state) return <div className="h-40 animate-pulse rounded-xl bg-slate-100" />;

  const { order, healed } = state;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency });
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">{order.orderId}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {order.status.toLowerCase()}
          </span>
          {healed && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Self-healed by gateway
            </span>
          )}
        </div>
        <p className="text-lg font-semibold text-slate-900">{money.format(order.totalAmount)}</p>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Ship to {order.shippingAddress.street}, {order.shippingAddress.city} {order.shippingAddress.zipCode}
      </p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-1 font-medium">SKU</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Price</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.sku} className="border-t border-slate-100">
              <td className="py-1.5 font-mono text-xs text-slate-800">{item.sku}</td>
              <td className="py-1.5 text-right text-slate-800">{item.quantity}</td>
              <td className="py-1.5 text-right text-slate-800">{money.format(item.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
