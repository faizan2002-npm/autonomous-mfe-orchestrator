/** Identifies one upstream API contract: the unit drift is detected and patched at. */
export interface ContractRef {
  serviceName: string;
  httpMethod: string;
  endpointPath: string;
}

/** Collapses numeric path segments so `/users/1` and `/users/2` share a contract. */
export function normalizeEndpointPath(path: string): string {
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function contractKey(contract: ContractRef): string {
  return `${contract.serviceName}:${contract.httpMethod.toUpperCase()}:${normalizeEndpointPath(contract.endpointPath)}`;
}
