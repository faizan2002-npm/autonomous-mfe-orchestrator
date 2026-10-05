// Test-only stand-ins for the demo upstreams the e2e suite drives: a user and an order
// service, each with a chaos switch (GET/POST /chaos/state) that serves a drifted schema.
//   node fixtures/demo-upstream.mjs user-service 3001
import { createServer } from 'node:http';

const SERVICES = {
  'user-service': {
    route: /^\/api\/v1\/users\/[^/]+$/,
    stable: {
      id: 101,
      firstName: 'Faizan',
      lastName: 'Hussain',
      email: 'faizan@example.com',
      role: 'MFE_ADMIN',
      profile: {
        avatarUrl: 'https://avatars.githubusercontent.com/u/1000',
        bio: 'Decoupled Cloud Native Architect',
      },
    },
    // Field renames and a flattened profile.
    drifted: {
      id: 101,
      first_name: 'Faizan',
      last_name: 'Hussain',
      email: 'faizan@example.com',
      role: 'MFE_ADMIN',
      avatar_url: 'https://avatars.githubusercontent.com/u/1000',
      bio: 'Decoupled Cloud Native Architect',
    },
  },
  'order-service': {
    route: /^\/api\/v1\/orders\/[^/]+$/,
    stable: {
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
    },
    drifted: {
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
    },
  },
};

const [name, port] = process.argv.slice(2);
const service = SERVICES[name];
if (!service || !port) {
  console.error(`Usage: demo-upstream.mjs <${Object.keys(SERVICES).join('|')}> <port>`);
  process.exit(1);
}
let mutated = false;

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && path === '/health')
    return send(res, 200, { status: 'UP', service: name });
  if (req.method === 'GET' && service.route.test(path))
    return send(res, 200, mutated ? service.drifted : service.stable);
  if (path === '/chaos/state' && req.method === 'GET')
    return send(res, 200, { isMutated: mutated });
  if (path === '/chaos/state' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      if (typeof body.mutated !== 'boolean')
        return send(res, 400, { error: 'Body must be { "mutated": boolean }' });
      mutated = body.mutated;
      send(res, 200, { isMutated: mutated });
    });
    return;
  }
  send(res, 404, { error: 'Not found' });
}).listen(Number(port), '127.0.0.1', () => console.log(`${name} fixture on :${port}`));
