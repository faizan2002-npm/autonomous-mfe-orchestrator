import { parseExpression } from '@babel/parser';

export interface AdapterValidationResult {
  valid: boolean;
  errors: string[];
}

// Globals an adapter has no reason to touch: code execution, I/O, timers and host objects.
const FORBIDDEN_IDENTIFIERS = new Set([
  'eval',
  'Function',
  'AsyncFunction',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'require',
  'process',
  'module',
  'exports',
  'globalThis',
  'global',
  'window',
  'self',
  'document',
  'localStorage',
  'sessionStorage',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'Reflect',
  'Proxy',
]);

// Property names that reach constructors or prototypes, the usual sandbox escape route.
const FORBIDDEN_PROPERTIES = new Set(['constructor', '__proto__', 'prototype']);

const FORBIDDEN_NODES: Record<string, string> = {
  Import: 'Dynamic import() is forbidden.',
  ImportExpression: 'Dynamic import() is forbidden.',
  AwaitExpression: 'Adapters must be synchronous.',
  YieldExpression: 'Adapters must not be generators.',
  WithStatement: 'with statements are forbidden.',
  ThisExpression: 'Adapters must not use this.',
};

interface AstNode {
  type: string;
  [key: string]: unknown;
}

/**
 * Checks that the adapter is a single function expression (the shape the sandbox evaluates)
 * and that its AST references no forbidden globals or prototype-reaching properties.
 */
export function validateAdapterAst(code: string): AdapterValidationResult {
  let root: AstNode;
  try {
    root = parseExpression(code, {
      sourceType: 'script',
    }) as unknown as AstNode;
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [`AST Parse Error: ${(err as Error).message}`],
    };
  }

  const errors = new Set<string>();
  if (
    root.type !== 'ArrowFunctionExpression' &&
    root.type !== 'FunctionExpression'
  ) {
    errors.add('Adapter must be a single function expression.');
  } else if (root.async || root.generator) {
    errors.add('Adapter must be a synchronous, non-generator function.');
  }

  walk(root, (node) => {
    if (node.type in FORBIDDEN_NODES) errors.add(FORBIDDEN_NODES[node.type]);
    if (isForbiddenIdentifier(node)) {
      errors.add(`Reference to '${node.name}' is forbidden.`);
    }
    if (
      (node.type === 'MemberExpression' ||
        node.type === 'OptionalMemberExpression') &&
      FORBIDDEN_PROPERTIES.has(propertyName(node) ?? '')
    ) {
      errors.add(`Access to '${propertyName(node)}' is forbidden.`);
    }
  });

  return { valid: errors.size === 0, errors: [...errors] };
}

function isForbiddenIdentifier(
  node: AstNode,
): node is AstNode & { name: string } {
  return (
    node.type === 'Identifier' && FORBIDDEN_IDENTIFIERS.has(node.name as string)
  );
}

function propertyName(member: AstNode): string | undefined {
  const property = member.property as AstNode;
  if (!member.computed && property.type === 'Identifier')
    return property.name as string;
  if (property.type === 'StringLiteral') return property.value as string;
  return undefined;
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    // Object keys like `{ fetch: 1 }` and non-computed `a.fetch` are names, not references.
    if (key === 'key' && !node.computed && node.type === 'ObjectProperty')
      continue;
    if (
      key === 'property' &&
      !node.computed &&
      (node.type === 'MemberExpression' ||
        node.type === 'OptionalMemberExpression')
    )
      continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (
        child &&
        typeof child === 'object' &&
        typeof (child as AstNode).type === 'string'
      ) {
        walk(child as AstNode, visit);
      }
    }
  }
}
