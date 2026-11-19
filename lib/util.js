export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  const max = Math.max(1, Math.floor(limit) || 1);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = [];
  const count = Math.min(max, items.length);
  for (let i = 0; i < count; i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: '\u00a0',
};

function decodeEntity(entity) {
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    const code = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : null;
  }
  if (entity.startsWith('#')) {
    const code = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : null;
  }
  return NAMED_ENTITIES[entity] ?? null;
}

export function stripHtml(s) {
  if (s === null || s === undefined) return '';
  let text = String(s).replace(/<[^>]*>/g, '');
  text = text.replace(/&([^;\s]+);/g, (match, entity) => decodeEntity(entity) ?? match);
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(s, max = 600) {
  const text = s === null || s === undefined ? '' : String(s);
  if (text.length <= max) return text;
  if (max <= 0) return '';
  return text.slice(0, max - 1) + '…';
}

export function cleanText(s, max = 600) {
  let value = s;
  if (Array.isArray(value)) {
    value = value.find((entry) => typeof entry === 'string' && entry.trim() !== '') ?? '';
  }
  const text = truncate(stripHtml(value), max);
  return text === '' ? null : text;
}

export function cacheSet(map, key, value, max = 2000) {
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

export function firstString(v) {
  if (Array.isArray(v)) {
    const found = v.find((entry) => typeof entry === 'string' && entry !== '');
    return found ?? null;
  }
  if (typeof v === 'string' && v !== '') return v;
  return null;
}
