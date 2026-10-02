import type { ContractRefView } from '@orchestrator/shared-types';

/**
 * Identifies one API contract: the unit drift is detected and patched at. Contracts are
 * per consumer, so two applications calling the same endpoint heal independently.
 */
export interface ContractRef {
  orgId: string;
  consumerId: string;
  /** Display only; not part of the identity. */
  consumerName: string;
  serviceName: string;
  httpMethod: string;
  endpointPath: string;
}

/** Collapses numeric path segments so `/users/1` and `/users/2` share a contract. */
export function normalizeEndpointPath(path: string): string {
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function contractKey(
  contract: Omit<ContractRef, 'consumerName'>,
): string {
  return [
    contract.orgId,
    contract.consumerId,
    contract.serviceName,
    contract.httpMethod.toUpperCase(),
    normalizeEndpointPath(contract.endpointPath),
  ].join(':');
}

/** The browser-safe description of a contract used in events and API responses. */
export function contractView(contract: ContractRef): ContractRefView {
  return {
    serviceName: contract.serviceName,
    httpMethod: contract.httpMethod.toUpperCase(),
    endpointPath: normalizeEndpointPath(contract.endpointPath),
    consumerId: contract.consumerId,
    consumerName: contract.consumerName,
  };
}
