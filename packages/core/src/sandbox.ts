import vm from 'node:vm';

export interface SandboxExecutionResult {
  success: boolean;
  transformedOutput?: unknown;
  error?: string;
  executionTimeMs: number;
}

/**
 * Executes an AI-generated JavaScript adapter inside a restricted Node.js VM context.
 * Strictly enforces memory isolation, strips all I/O globals, and enforces a 50ms timeout.
 */
export function executeInSandbox(
  adapterCode: string,
  inputPayload: unknown,
  timeoutMs = 50
): SandboxExecutionResult {
  const startTime = performance.now();

  try {
    // 1. Establish an ultra-isolated sandbox context
    const sandboxContext: Record<string, unknown> = {
      // Pass pure JSON clone of the payload
      __inputPayload: JSON.parse(JSON.stringify(inputPayload)),
      __transformedOutput: null,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
      // Deny standard NodeJS / Browser globals
      process: undefined,
      require: undefined,
      module: undefined,
      exports: undefined,
      fetch: undefined,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
    };

    const vmContext = vm.createContext(sandboxContext);

    // 2. Wrap user code as an immediately invoked execution assigning output
    const wrappedScript = `
      "use strict";
      const adapterFn = (${adapterCode.trim()});
      if (typeof adapterFn !== "function") {
        throw new Error("Provided adapter code does not evaluate to a function.");
      }
      __transformedOutput = adapterFn(__inputPayload);
    `;

    const script = new vm.Script(wrappedScript);

    // 3. Execute with strict time ceiling
    script.runInContext(vmContext, {
      timeout: timeoutMs,
      displayErrors: true,
    });

    const executionTimeMs = performance.now() - startTime;

    return {
      success: true,
      transformedOutput:
        sandboxContext.__transformedOutput !== undefined
          ? JSON.parse(JSON.stringify(sandboxContext.__transformedOutput))
          : undefined,
      executionTimeMs,
    };
  } catch (err: unknown) {
    const executionTimeMs = performance.now() - startTime;
    return {
      success: false,
      error: (err as Error).message || 'Sandbox execution error',
      executionTimeMs,
    };
  }
}
