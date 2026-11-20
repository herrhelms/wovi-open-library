import { loadAdapters } from '../adapters.js';

const { groups, adapters } = await loadAdapters();

export const GROUPS = groups;
export const sources = adapters;

export function getSource(id) {
  return sources.find((source) => source.id === id) ?? null;
}
