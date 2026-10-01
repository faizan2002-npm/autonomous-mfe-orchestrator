import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });

interface OrderState {
  isMutated: boolean;
}

const state: OrderState = {
  isMutated: false,
};

// Stable schema
const stableOrder = {
  orderId: 'ORD-9821',
  totalAmount: 149.99,
  currency: 'USD',
  status: 'DELIVERED',
  shippingAddress: {
    street: '123 Distributed Way',
    city: 'San Francisco',
    zipCode: '94105',
  },
  items: [
    { sku: 'ITEM-1', quantity: 2, price: 49.99 },
    { sku: 'ITEM-2', quantity: 1, price: 50.01 },
  ],
};

// Drifted schema (street & city flattened, currency renamed to curr)
const driftedOrder = {
  order_id: 'ORD-9821',
  total_amount: 149.99,
  curr: 'USD',
  status: 'DELIVERED',
  delivery_street: '123 Distributed Way',
  delivery_city: 'San Francisco',
  delivery_zip: '94105',
  line_items: [
    { sku: 'ITEM-1', qty: 2, unit_price: 49.99 },
    { sku: 'ITEM-2', qty: 1, unit_price: 50.01 },
  ],
};

fastify.get('/api/v1/orders/:id', async (_req, reply) => {
  if (state.isMutated) {
    return reply.status(200).send(driftedOrder);
  }
  return reply.status(200).send(stableOrder);
});

fastify.post('/chaos/mutate', async (_req, reply) => {
  state.isMutated = !state.isMutated;
  return reply.status(200).send({
    message: state.isMutated
      ? 'Chaos injected: Order service payload has drifted.'
      : 'Chaos reverted: Order service restored.',
    isMutated: state.isMutated,
  });
});

fastify.get('/health', async () => ({ status: 'UP', service: 'order-service' }));

const port = Number(process.env.ORDER_SERVICE_PORT) || 3002;
fastify.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Order Service running at ${address}`);
});
