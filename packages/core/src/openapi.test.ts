import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenPayload } from './comparator.js';
import { findOperation, OpenApiError, parseOpenApi, pathMatchesTemplate, tokensFromJsonSchema } from './openapi.js';

// A Petstore-style OpenAPI 3.0 document exercising $ref, allOf, arrays, enums and nullable.
const petstore = {
  openapi: '3.0.3',
  info: { title: 'Users API', version: '2.1.0' },
  servers: [{ url: 'https://users.example.com/api/{version}', variables: { version: { default: 'v1' } } }],
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        summary: 'One user',
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '404': { description: 'Not found' },
        },
      },
      delete: { responses: { '204': { description: 'Deleted' } } },
    },
    '/users': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json; charset=utf-8': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
      },
    },
    '/users/me': { get: { responses: { '200': { $ref: '#/components/responses/Me' } } } },
  },
  components: {
    responses: {
      Me: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
    },
    schemas: {
      Entity: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      User: {
        allOf: [
          { $ref: '#/components/schemas/Entity' },
          {
            type: 'object',
            required: ['firstName', 'role'],
            properties: {
              firstName: { type: 'string' },
              nickname: { type: 'string', nullable: true },
              role: { type: 'string', enum: ['admin', 'member'] },
              tags: { type: 'array', items: { type: 'string' } },
              address: {
                type: 'object',
                properties: { city: { type: 'string' }, geo: { type: 'object', properties: { lat: { type: 'number' } } } },
              },
              metadata: { type: 'object', additionalProperties: true },
            },
          },
        ],
      },
    },
  },
};

const conformingUser = {
  id: 7,
  firstName: 'Ada',
  nickname: 'ada',
  role: 'admin',
  tags: ['x'],
  address: { city: 'London', geo: { lat: 51.5 } },
};

test('spec tokens equal what flattenPayload yields for a conforming response', () => {
  const parsed = parseOpenApi(petstore);
  const getUser = parsed.operations.find((op) => op.operationId === 'getUser')!;
  assert.deepEqual(getUser.tokens, [...flattenPayload(conformingUser)].sort());
  const list = parsed.operations.find((op) => op.path === '/api/v1/users' && op.method === 'GET')!;
  assert.deepEqual(list.tokens, [...flattenPayload([conformingUser])].sort());
});

test('documents are summarized with the server base path, and unusable operations are skipped', () => {
  const parsed = parseOpenApi(petstore);
  assert.equal(parsed.title, 'Users API');
  assert.equal(parsed.version, '2.1.0');
  assert.deepEqual(
    parsed.operations.map((op) => `${op.method} ${op.path}`).sort(),
    ['GET /api/v1/users', 'GET /api/v1/users/me', 'GET /api/v1/users/{id}'],
  );
  assert.deepEqual(parsed.skipped, ['DELETE /api/v1/users/{id}']);
  assert.equal(parsed.operations[0]!.status, '200');
});

test('requiredOnly keeps the guaranteed fields only', () => {
  const user = parseOpenApi(petstore, { requiredOnly: true }).operations.find((op) => op.operationId === 'getUser')!;
  assert.deepEqual(user.tokens, ['firstName:string', 'id:number', 'role:string']);
});

test('OpenAPI 3.1 type arrays, oneOf nullables and Swagger 2.0 definitions', () => {
  assert.deepEqual(
    tokensFromJsonSchema({
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        score: { oneOf: [{ type: 'null' }, { type: 'number' }] },
        matrix: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
      },
    }),
    ['matrix[][]:number', 'name:string', 'score:number'],
  );
  const swagger = {
    swagger: '2.0',
    info: { title: 'Orders', version: '1' },
    basePath: '/api/v1',
    paths: { '/orders/{id}': { get: { responses: { 200: { schema: { $ref: '#/definitions/Order' } } } } } },
    definitions: { Order: { type: 'object', properties: { total: { type: 'number' }, paid: { type: 'boolean' } } } },
  };
  const [order] = parseOpenApi(swagger).operations;
  assert.equal(order!.path, '/api/v1/orders/{id}');
  assert.deepEqual(order!.tokens, ['paid:boolean', 'total:number']);
});

test('recursive and broken references fail clearly', () => {
  const recursive = {
    openapi: '3.0.0',
    info: {},
    paths: { '/n': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } } } },
    components: { schemas: { Node: { $ref: '#/components/schemas/Node' } } },
  };
  assert.throws(() => parseOpenApi(recursive), OpenApiError);
  assert.throws(() => tokensFromJsonSchema({ $ref: '#/nope' }), /Unresolvable \$ref/);
  assert.throws(() => tokensFromJsonSchema({ $ref: 'https://example.com/s.json' }), /Only local/);
  assert.throws(() => parseOpenApi({ hello: 'world' }), /Not an OpenAPI/);
});

test('request paths match templates; literal paths win over parameters', () => {
  assert.ok(pathMatchesTemplate('/api/v1/users/{id}', '/api/v1/users/42'));
  assert.ok(pathMatchesTemplate('/api/v1/users/{id}', '/api/v1/users/:id'));
  assert.ok(!pathMatchesTemplate('/api/v1/users/{id}', '/api/v1/users/42/orders'));
  assert.ok(pathMatchesTemplate('/api/v1/a.b', '/api/v1/a.b') && !pathMatchesTemplate('/api/v1/a.b', '/api/v1/aXb'));
  const ops = parseOpenApi(petstore).operations;
  assert.equal(findOperation(ops, 'get', '/api/v1/users/me')?.path, '/api/v1/users/me');
  assert.equal(findOperation(ops, 'GET', '/api/v1/users/:id')?.operationId, 'getUser');
  assert.equal(findOperation(ops, 'POST', '/api/v1/users'), null);
});
