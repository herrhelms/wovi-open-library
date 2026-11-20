import { fetchCommonsJson } from '../wikimedia.js';
import {
  buildSearchUrl as commonsBuildSearchUrl,
  normalize as commonsNormalize,
  parseSearch as commonsParseSearch,
} from './commons.js';

export function subsetQuery(q, filter) {
  return `${(q ?? '').trim()} ${filter}`;
}

export function createCommonsSubset({ id, name, homepage, group, filter }) {
  const sourceName = `${name} (via Wikimedia Commons)`;

  function buildSearchUrl(q, page) {
    return commonsBuildSearchUrl(subsetQuery(q, filter), page);
  }

  function normalize(raw) {
    const item = commonsNormalize(raw);
    if (item === null) return null;
    return { ...item, source: id, provider: name };
  }

  function parseSearch(json, page) {
    const result = commonsParseSearch(json, page);
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, source: id, provider: name })),
    };
  }

  async function search(q, page, deps = {}) {
    const json = await fetchCommonsJson(buildSearchUrl(q, page), deps);
    return parseSearch(json, page);
  }

  return {
    id,
    name: sourceName,
    homepage,
    group,
    keyEnv: null,
    filter,
    buildSearchUrl,
    normalize,
    parseSearch,
    search,
  };
}
