import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });

await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..'),
  prefix: '/',
  index: 'index.html',
});

const port = Number(process.env.SHELL_PORT) || 5000;
fastify.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`💻 Micro-Frontend Shell running at ${address}`);
});
