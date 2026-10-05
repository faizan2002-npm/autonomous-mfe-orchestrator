/**
 * Turns OpenAPI 3.x / Swagger 2.0 response schemas into the same `path:type` tokens that
 * `flattenPayload` produces from real responses, so a spec can serve as a contract baseline.
 */

type Json = Record<string, unknown>;

export interface SchemaTokenOptions {
  /** When an object lists `required` properties, only those form the contract. */
  requiredOnly?: boolean;
}

export interface OpenApiOperation {
  method: string;
  /** Full path template as the upstream receives it, e.g. /api/v1/users/{id}. */
  path: string;
  operationId: string | null;
  summary: string | null;
  /** The 2xx status whose JSON schema produced the tokens. */
  status: string;
  tokens: string[];
}

export interface ParsedOpenApi {
  title: string;
  version: string;
  operations: OpenApiOperation[];
  /** Operations skipped (no JSON 2xx response schema), as "METHOD /path". */
  skipped: string[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;
const MAX_DEPTH = 24;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export class OpenApiError extends Error {}

/** Follows a local `#/...` JSON pointer. */
function resolveRef(root: Json, ref: string): Json {
  if (!ref.startsWith('#/')) throw new OpenApiError(`Only local $refs are supported (${ref})`);
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = isObject(node) ? node[key] : undefined;
  }
  if (!isObject(node)) throw new OpenApiError(`Unresolvable $ref ${ref}`);
  return node;
}

/** The JSON type a value of this schema has at runtime (as `typeof` reports it). */
function primitiveType(schema: Json): string | null {
  let type = schema.type;
  // OpenAPI 3.1: type: ['string', 'null'] — the non-null member describes real values.
  if (Array.isArray(type)) type = type.find((t) => t !== 'null') ?? 'null';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'string' || type === 'boolean' || type === 'null') return type;
  if (type === undefined && Array.isArray(schema.enum) && schema.enum.length) {
    const sample = schema.enum.find((value) => value !== null);
    return sample === undefined ? 'null' : typeof sample;
  }
  return null;
}

function kindOf(schema: Json): 'object' | 'array' | 'primitive' | 'unknown' {
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'array' || schema.items !== undefined) return 'array';
  if (type === 'object' || schema.properties !== undefined || schema.allOf !== undefined) return 'object';
  if (primitiveType(schema)) return 'primitive';
  return 'unknown';
}

/** Merges allOf members and picks the first oneOf/anyOf variant, resolving $refs. */
function normalize(root: Json, schema: Json, depth: number): Json {
  if (depth > MAX_DEPTH) throw new OpenApiError('Schema nesting too deep (recursive $ref?)');
  if (typeof schema.$ref === 'string') return normalize(root, resolveRef(root, schema.$ref), depth + 1);
  const variant = (schema.oneOf ?? schema.anyOf) as unknown;
  if (Array.isArray(variant) && variant.length) {
    // A nullable union (oneOf: [X, {type: null}]) describes X.
    const chosen = variant.map((v) => normalize(root, v as Json, depth + 1)).find((v) => primitiveType(v) !== 'null');
    return chosen ?? normalize(root, variant[0] as Json, depth + 1);
  }
  if (Array.isArray(schema.allOf)) {
    const merged: Json = { type: 'object', properties: {}, required: [] as string[] };
    let requiredDeclared = false;
    for (const part of schema.allOf) {
      const resolved = normalize(root, part as Json, depth + 1);
      Object.assign(merged.properties as Json, resolved.properties ?? {});
      if (Array.isArray(resolved.required)) {
        requiredDeclared = true;
        (merged.required as string[]).push(...(resolved.required as string[]));
      }
    }
    Object.assign(merged.properties as Json, schema.properties ?? {});
    if (Array.isArray(schema.required)) {
      requiredDeclared = true;
      (merged.required as string[]).push(...(schema.required as string[]));
    }
    if (!requiredDeclared) delete merged.required;
    return merged;
  }
  return schema;
}

function collect(root: Json, schema: Json, prefix: string, tokens: Set<string>, options: SchemaTokenOptions, depth: number): void {
  const resolved = normalize(root, schema, depth);
  switch (kindOf(resolved)) {
    case 'array': {
      const items = isObject(resolved.items) ? resolved.items : {};
      collect(root, items, prefix ? `${prefix}[]` : '[]', tokens, options, depth + 1);
      return;
    }
    case 'object': {
      const properties = isObject(resolved.properties) ? resolved.properties : {};
      const required = Array.isArray(resolved.required) ? new Set(resolved.required as string[]) : null;
      for (const [key, value] of Object.entries(properties)) {
        if (options.requiredOnly && required && !required.has(key)) continue;
        if (!isObject(value)) continue;
        collect(root, value, prefix ? `${prefix}.${key}` : key, tokens, options, depth + 1);
      }
      return;
    }
    case 'primitive':
      if (prefix) tokens.add(`${prefix}:${primitiveType(resolved)}`);
      return;
    default:
      // Free-form values ({} or unknown types) have no fixed shape to compare.
      return;
  }
}

/** `path:type` tokens for a JSON schema, matching what `flattenPayload` yields for conforming data. */
export function tokensFromJsonSchema(schema: Json, root: Json = schema, options: SchemaTokenOptions = {}): string[] {
  const tokens = new Set<string>();
  collect(root, schema, '', tokens, options, 0);
  return [...tokens].sort();
}

function joinPaths(base: string, path: string): string {
  const joined = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/** Path prefix from servers[0].url (OpenAPI 3) or basePath (Swagger 2). */
function basePathOf(doc: Json): string {
  if (typeof doc.basePath === 'string') return doc.basePath;
  const server = Array.isArray(doc.servers) && isObject(doc.servers[0]) ? doc.servers[0] : null;
  if (!server || typeof server.url !== 'string') return '';
  // Server variables ({version}) take their defaults.
  const variables = isObject(server.variables) ? server.variables : {};
  const url = server.url.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const variable = variables[name];
    return isObject(variable) && typeof variable.default === 'string' ? variable.default : '';
  });
  try {
    return new URL(url, 'http://relative.invalid').pathname;
  } catch {
    return '';
  }
}

function successSchema(operation: Json, doc: Json): { status: string; schema: Json } | null {
  const responses = isObject(operation.responses) ? operation.responses : {};
  const statuses = Object.keys(responses)
    .filter((code) => /^2(\d\d|XX)$/i.test(code))
    .sort();
  for (const status of statuses) {
    let response = responses[status];
    if (isObject(response) && typeof response.$ref === 'string') response = resolveRef(doc, response.$ref);
    if (!isObject(response)) continue;
    // Swagger 2.0
    if (isObject(response.schema)) return { status, schema: response.schema };
    // OpenAPI 3.x: the first JSON media type
    const content = isObject(response.content) ? response.content : {};
    const media = Object.entries(content).find(([type]) => /^application\/(.+\+)?json\b/i.test(type) || type === '*/*');
    if (media && isObject(media[1]) && isObject(media[1].schema)) return { status, schema: media[1].schema };
  }
  return null;
}

/** Every operation with a JSON 2xx response, as contract tokens. */
export function parseOpenApi(doc: unknown, options: SchemaTokenOptions = {}): ParsedOpenApi {
  if (!isObject(doc) || (typeof doc.openapi !== 'string' && typeof doc.swagger !== 'string'))
    throw new OpenApiError('Not an OpenAPI 3.x or Swagger 2.0 document (missing "openapi"/"swagger")');
  if (!isObject(doc.paths)) throw new OpenApiError('The document has no paths');
  const info = isObject(doc.info) ? doc.info : {};
  const base = basePathOf(doc);
  const operations: OpenApiOperation[] = [];
  const skipped: string[] = [];

  for (const [path, rawItem] of Object.entries(doc.paths)) {
    const item = isObject(rawItem) && typeof rawItem.$ref === 'string' ? resolveRef(doc, rawItem.$ref) : rawItem;
    if (!isObject(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;
      const label = `${method.toUpperCase()} ${joinPaths(base, path)}`;
      const success = successSchema(operation, doc);
      if (!success) {
        skipped.push(label);
        continue;
      }
      const tokens = tokensFromJsonSchema(success.schema, doc, options);
      if (!tokens.length) {
        skipped.push(label);
        continue;
      }
      operations.push({
        method: method.toUpperCase(),
        path: joinPaths(base, path),
        operationId: typeof operation.operationId === 'string' ? operation.operationId : null,
        summary: typeof operation.summary === 'string' ? operation.summary : null,
        status: success.status,
        tokens,
      });
    }
  }
  return {
    title: typeof info.title === 'string' ? info.title : 'Untitled API',
    version: typeof info.version === 'string' ? info.version : '',
    operations,
    skipped,
  };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a request path (or a normalized one, with :id segments) fits a {param} template. */
export function pathMatchesTemplate(template: string, path: string): boolean {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => (/^\{[^}]+\}$/.test(part) ? '[^/]+' : escapeRegex(part)))
    .join('');
  return new RegExp(`^${pattern}/?$`).test(path);
}

/** The operation for this request; literal paths beat templates with more parameters. */
export function findOperation<T extends Pick<OpenApiOperation, 'method' | 'path'>>(
  operations: T[],
  method: string,
  path: string,
): T | null {
  const params = (template: string) => (template.match(/\{[^}]+\}/g) ?? []).length;
  return (
    operations
      .filter((op) => op.method === method.toUpperCase() && pathMatchesTemplate(op.path, path))
      .sort((a, b) => params(a.path) - params(b.path))[0] ?? null
  );
}
