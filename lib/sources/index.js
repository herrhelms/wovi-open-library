import { loadAdapters } from '../adapters.js';

const { groups, adapters, invalid } = await loadAdapters();

export const GROUPS = groups;
export const sources = adapters;
export const INVALID = invalid;

export function getSource(id) {
  return sources.find((source) => source.id === id) ?? null;
}
