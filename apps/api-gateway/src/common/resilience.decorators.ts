/**
 * Decorator to add a timeout to an async method.
 * Throws TimeoutError if the promise doesn't resolve within the specified time.
 */
export function WithTimeout(timeoutMs: number) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      return Promise.race([
        originalMethod.apply(this, args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new TimeoutError()), timeoutMs),
        ),
      ]);
    };
    return descriptor;
  };
}

export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
