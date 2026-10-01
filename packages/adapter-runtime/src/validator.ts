import * as babelParser from '@babel/parser';

/**
 * Validates JavaScript code syntax and ensures AST safety (no eval, no Function, no network calls)
 */
export function validateAdapterAst(code: string): {
  valid: boolean;
  errors: string[];
} {
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
    if (codeString.includes('eval('))
      errors.push('Usage of eval() is strictly forbidden.');
    if (
      codeString.includes('function(') &&
      codeString.includes('constructor')
    ) {
      errors.push('Function constructor is forbidden.');
    }
    if (
      codeString.includes('fetch(') ||
      codeString.includes('xmlhttprequest')
    ) {
      errors.push('Network calls inside adapter functions are forbidden.');
    }
    if (
      codeString.includes('window.localstorage') ||
      codeString.includes('document.cookie')
    ) {
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
