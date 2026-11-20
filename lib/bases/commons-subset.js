import { fetchCommonsJson } from '../../lib/wikimedia.js';
import {
  buildSearchUrl as commonsBuildSearchUrl,
  normalize as commonsNormalize,
  parseSearch as commonsParseSearch,
} from './commons.js';

export function subsetQuery(q, filter) {
  return `${(q ?? '').trim()} ${filter}`;
}

const SUFFIX = ' (via Wikimedia Commons)';

export function create({ id, name, homepage, group, filter }) {
  const baseName = name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : name;
  const sourceName = `${baseName}${SUFFIX}`;

  function buildSearchUrl(q, page) {
    return commonsBuildSearchUrl(subsetQuery(q, filter), page);
  }

  function normalize(raw) {
    const item = commonsNormalize(raw);
    if (item === null) return null;
    return { ...item, source: id, provider: baseName };
  }

  function parseSearch(json, page) {
    const result = commonsParseSearch(json, page);
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, source: id, provider: baseName })),
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

export const createCommonsSubset = create;
