import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });

// Register CORS
await fastify.register(cors, { origin: true });

interface UserState {
  isMutated: boolean;
}

const state: UserState = {
  isMutated: false,
};

// Stable initial schema
const stableUser = {
  id: 101,
  firstName: 'Faizan',
  lastName: 'Hussain',
  email: 'faizan@example.com',
  role: 'MFE_ADMIN',
  profile: {
    avatarUrl: 'https://avatars.githubusercontent.com/u/1000',
    bio: 'Decoupled Cloud Native Architect',
  },
};

// Drifted schema (field rename + flattened profile)
const driftedUser = {
  id: 101,
  first_name: 'Faizan',
  last_name: 'Hussain',
  email: 'faizan@example.com',
  role: 'MFE_ADMIN',
  avatar_url: 'https://avatars.githubusercontent.com/u/1000',
  bio: 'Decoupled Cloud Native Architect',
};

// User details API
fastify.get('/api/v1/users/:id', async (_req, reply) => {
  if (state.isMutated) {
    return reply.status(200).send(driftedUser);
  }
  return reply.status(200).send(stableUser);
});

// Chaos drift trigger endpoint
fastify.post('/chaos/mutate', async (_req, reply) => {
  state.isMutated = !state.isMutated;
  return reply.status(200).send({
    message: state.isMutated
      ? 'Chaos injected: User service payload has drifted (firstName -> first_name, profile flattened).'
      : 'Chaos reverted: User service payload restored to stable contract.',
    isMutated: state.isMutated,
  });
});

fastify.get('/health', async () => ({ status: 'UP', service: 'user-service' }));

const port = Number(process.env.USER_SERVICE_PORT) || 3001;
fastify.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 User Service running at ${address}`);
});
