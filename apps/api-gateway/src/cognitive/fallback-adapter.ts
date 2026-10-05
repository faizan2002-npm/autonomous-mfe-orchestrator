import type { DetailedDiff } from '@orchestrator/core';

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deterministic adapter used when the LLM is unavailable: maps each missing expected
 * field to an added field with the same leaf name, ignoring case and separators
 * (`profile.avatarUrl` <- `avatar_url`). Array paths are left for the LLM.
 */
export function buildRenameAdapter(diff: DetailedDiff): string {
  const mappings: Array<[target: string, source: string]> = [];
  const available = diff.addedFields.filter(isMappablePath);
  for (const expected of diff.missingFields.filter(isMappablePath)) {
    const source = available.find(
      (added) => normalizeLeaf(added) === normalizeLeaf(expected),
    );
    if (source) mappings.push([expected, source]);
  }

  const assignments = mappings
    .map(
      ([target, source]) =>
        `set(${JSON.stringify(target.split('.'))}, get(${JSON.stringify(source.split('.'))}));`,
    )
    .join(' ');
  return `(data) => {
  const out = JSON.parse(JSON.stringify(data));
  const get = (path) => path.reduce((node, key) => node?.[key], data);
  const set = (path, value) => {
    if (value === undefined) return;
    let node = out;
    for (const key of path.slice(0, -1)) {
      if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    }
    node[path[path.length - 1]] = value;
  };
  ${assignments}
  return out;
}`;
}

function isMappablePath(path: string): boolean {
  return (
    !path.includes('[]') &&
    path.split('.').every((segment) => segment && !UNSAFE_SEGMENTS.has(segment))
  );
}

function normalizeLeaf(path: string): string {
  return path
    .slice(path.lastIndexOf('.') + 1)
    .replace(/[_-]/g, '')
    .toLowerCase();
}
