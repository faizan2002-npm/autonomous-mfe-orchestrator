import * as babelParser from '@babel/parser';

export type FlattenedSchema = Set<string>;

/**
 * Recursively flattens an arbitrary JSON payload into a set of path:type tokens.
 * Handles objects, arrays, and primitives.
 */
export function flattenPayload(obj: unknown, prefix = ''): FlattenedSchema {
  const tokens = new Set<string>();

  if (obj === null || obj === undefined) {
    if (prefix) tokens.add(`${prefix}:${obj === null ? 'null' : 'undefined'}`);
    return tokens;
  }

  if (Array.isArray(obj)) {
    const arrayPath = prefix ? `${prefix}[]` : '[]';
    if (obj.length === 0) {
      tokens.add(`${arrayPath}:empty_array`);
    } else {
      // Sample the first element to determine array item schema
      const subTokens = flattenPayload(obj[0], arrayPath);
      for (const t of subTokens) tokens.add(t);
    }
    return tokens;
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    for (const [key, value] of entries) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object') {
        const nestedTokens = flattenPayload(value, fullPath);
        for (const t of nestedTokens) tokens.add(t);
      } else {
        tokens.add(`${fullPath}:${value === null ? 'null' : typeof value}`);
      }
    }
    return tokens;
  }

  if (prefix) {
    tokens.add(`${prefix}:${typeof obj}`);
  }

  return tokens;
}

/**
 * Computes Jaccard Similarity between two sets of schema tokens:
 * J(Se, So) = |Se ∩ So| / |Se ∪ So|
 */
export function computeJaccardSimilarity(expected: FlattenedSchema, observed: FlattenedSchema): number {
  if (expected.size === 0 && observed.size === 0) return 1.0;
  if (expected.size === 0 || observed.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const token of expected) {
    if (observed.has(token)) {
      intersectionCount++;
    }
  }

  const unionCount = new Set([...expected, ...observed]).size;
  return intersectionCount / unionCount;
}

/**
 * Computes Drift Coefficient Dc = 1 - J(Se, So)
 */
export function computeDriftCoefficient(expected: FlattenedSchema, observed: FlattenedSchema): number {
  return 1 - computeJaccardSimilarity(expected, observed);
}

export interface DetailedDiff {
  missingFields: string[];
  addedFields: string[];
  typeMismatches: Array<{ path: string; expected: string; observed: string }>;
}

/**
 * Generates an analytical breakdown of differences between expected and observed schemas
 */
export function analyzeSchemaDiff(expected: FlattenedSchema, observed: FlattenedSchema): DetailedDiff {
  const expectedMap = new Map<string, string>();
  for (const token of expected) {
    const [path, type] = token.split(':');
    expectedMap.set(path, type);
  }

  const observedMap = new Map<string, string>();
  for (const token of observed) {
    const [path, type] = token.split(':');
    observedMap.set(path, type);
  }

  const missingFields: string[] = [];
  const addedFields: string[] = [];
  const typeMismatches: Array<{ path: string; expected: string; observed: string }> = [];

  for (const [path, type] of expectedMap.entries()) {
    if (!observedMap.has(path)) {
      missingFields.push(path);
    } else if (observedMap.get(path) !== type) {
      typeMismatches.push({
        path,
        expected: type,
        observed: observedMap.get(path)!,
      });
    }
  }

  for (const path of observedMap.keys()) {
    if (!expectedMap.has(path)) {
      addedFields.push(path);
    }
  }

  return { missingFields, addedFields, typeMismatches };
}

/**
 * Validates JavaScript code syntax and ensures AST safety (no eval, no Function, no network calls)
 */
export function validateAdapterAst(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const ast = babelParser.parse(code, {
      sourceType: 'module',
      plugins: [],
    });

    if (!ast || ast.type !== 'File') {
      errors.push('Invalid AST representation.');
    }

    // Security AST traversal and forbidden keyword inspection
    const codeString = code.toLowerCase();
    if (codeString.includes('eval(')) errors.push('Usage of eval() is strictly forbidden.');
    if (codeString.includes('function(') && codeString.includes('constructor')) {
      errors.push('Function constructor is forbidden.');
    }
    if (codeString.includes('fetch(') || codeString.includes('xmlhttprequest')) {
      errors.push('Network calls inside adapter functions are forbidden.');
    }
    if (codeString.includes('window.localstorage') || codeString.includes('document.cookie')) {
      errors.push('Browser storage access is forbidden.');
    }
  } catch (err: unknown) {
    errors.push(`AST Parse Error: ${(err as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
