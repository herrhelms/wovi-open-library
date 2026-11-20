import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT } from './env.js';

export const ADAPTER_ID_PATTERN = /^[a-z0-9-]+$/;

const DEFAULT_DIR = join(PROJECT_ROOT, 'adapters');
const DEFAULT_BASES_DIR = join(PROJECT_ROOT, 'lib', 'bases');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// Validate one adapter.json. Returns { ok: true, config } or { ok: false, error }.
export function validateAdapterConfig(config, { folder, groupIds }) {
  if (!isPlainObject(config)) return { ok: false, error: 'adapter.json must be an object' };

  if (config.schema !== 1) return { ok: false, error: 'schema must be 1' };

  if (!nonEmptyString(config.id)) return { ok: false, error: 'id is missing' };
  if (config.id !== folder) return { ok: false, error: `id "${config.id}" is not the folder name` };

  for (const field of ['name', 'homepage', 'group', 'description']) {
    if (!nonEmptyString(config[field])) return { ok: false, error: `${field} is missing` };
  }

  if (!groupIds.includes(config.group)) {
    return { ok: false, error: `unknown group "${config.group}"` };
  }

  if (config.order !== undefined) {
    if (typeof config.order !== 'number' || !Number.isFinite(config.order)) {
      return { ok: false, error: 'order must be a number' };
    }
  }

  for (const field of ['defaultEnabled', 'openLicenses', 'trustResolvedUrl']) {
    if (config[field] !== undefined && typeof config[field] !== 'boolean') {
      return { ok: false, error: `${field} must be a boolean` };
    }
  }

  if (config.key !== undefined && config.key !== null) {
    if (!isPlainObject(config.key)) return { ok: false, error: 'key must be an object or null' };
    if (!nonEmptyString(config.key.env)) return { ok: false, error: 'key.env is missing' };
    if (config.key.required !== undefined && typeof config.key.required !== 'boolean') {
      return { ok: false, error: 'key.required must be a boolean' };
    }
    if (config.key.default !== undefined && config.key.default !== null
      && typeof config.key.default !== 'string') {
      return { ok: false, error: 'key.default must be a string or null' };
    }
    if (config.key.steps !== undefined && config.key.steps !== null) {
      if (!Array.isArray(config.key.steps) || config.key.steps.some((step) => typeof step !== 'string')) {
        return { ok: false, error: 'key.steps must be an array of strings' };
      }
    }
  }

  if (config.docsUrl !== undefined && config.docsUrl !== null && typeof config.docsUrl !== 'string') {
    return { ok: false, error: 'docsUrl must be a string or null' };
  }

  if (config.notes !== undefined && config.notes !== null) {
    if (!Array.isArray(config.notes) || config.notes.some((note) => typeof note !== 'string')) {
      return { ok: false, error: 'notes must be an array of strings' };
    }
  }

  if (config.base !== undefined && config.base !== null) {
    if (!nonEmptyString(config.base) || !ADAPTER_ID_PATTERN.test(config.base)) {
      return { ok: false, error: 'base is not a valid module name' };
    }
  }

  if (config.options !== undefined && config.options !== null) {
    if (!isPlainObject(config.options)) return { ok: false, error: 'options must be an object' };
    if (config.base === undefined || config.base === null) {
      return { ok: false, error: 'options without base' };
    }
  }

  return { ok: true, config: withDefaults(config) };
}

function withDefaults(config) {
  return {
    ...config,
    defaultEnabled: config.defaultEnabled ?? true,
    openLicenses: config.openLicenses ?? true,
    trustResolvedUrl: config.trustResolvedUrl ?? false,
    key: config.key ?? null,
    docsUrl: config.docsUrl ?? null,
    notes: config.notes ?? [],
    base: config.base ?? null,
  };
}

async function readGroups(dir) {
  const file = join(dir, 'groups.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }

  if (!Array.isArray(json)) throw new Error(`${file} must contain an array`);

  const groups = [];
  const ids = new Set();
  for (const entry of json) {
    if (!isPlainObject(entry) || !nonEmptyString(entry.id) || !nonEmptyString(entry.label)) {
      throw new Error(`${file} has an entry without id or label`);
    }
    if (ids.has(entry.id)) throw new Error(`${file} has the group "${entry.id}" two times`);
    ids.add(entry.id);
    groups.push({ id: entry.id, label: entry.label });
  }
  return groups;
}

function toSource(config, code) {
  return {
    ...code,
    id: config.id,
    name: config.name,
    homepage: config.homepage,
    group: config.group,
    keyEnv: config.key === null ? null : config.key.env,
    keyOptional: config.key !== null && config.key.required === false,
    openLicenses: config.openLicenses,
    trustResolvedUrl: config.trustResolvedUrl,
    config,
  };
}

function orderKey(source, groupIndex) {
  const order = source.config.order;
  return {
    group: groupIndex.has(source.group) ? groupIndex.get(source.group) : Number.MAX_SAFE_INTEGER,
    order: typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER,
    hasOrder: typeof order === 'number' ? 0 : 1,
    name: source.name,
    id: source.id,
  };
}

function sortAdapters(adapters, groups) {
  const groupIndex = new Map(groups.map((group, index) => [group.id, index]));
  return [...adapters].sort((a, b) => {
    const ka = orderKey(a, groupIndex);
    const kb = orderKey(b, groupIndex);
    if (ka.group !== kb.group) return ka.group - kb.group;
    if (ka.hasOrder !== kb.hasOrder) return ka.hasOrder - kb.hasOrder;
    if (ka.order !== kb.order) return ka.order - kb.order;
    const byName = ka.name.localeCompare(kb.name);
    if (byName !== 0) return byName;
    return ka.id.localeCompare(kb.id);
  });
}

async function createSource(config, { dir, basesDir }) {
  if (config.base !== null) {
    const baseUrl = pathToFileURL(join(basesDir, `${config.base}.js`)).href;
    let base;
    try {
      base = await import(baseUrl);
    } catch (err) {
      throw new Error(`cannot import base "${config.base}": ${err.message}`);
    }
    if (typeof base.create !== 'function') {
      throw new Error(`base "${config.base}" has no create function`);
    }
    const created = base.create({
      id: config.id,
      name: config.name,
      homepage: config.homepage,
      group: config.group,
      ...(config.options ?? {}),
    });
    if (!isPlainObject(created)) throw new Error(`base "${config.base}" did not return an object`);
    return { ...created };
  }

  const codeUrl = pathToFileURL(join(dir, config.id, 'index.js')).href;
  let code;
  try {
    code = await import(codeUrl);
  } catch (err) {
    throw new Error(`cannot import index.js: ${err.message}`);
  }
  return Object.fromEntries(Object.entries(code));
}

export async function loadAdapters({
  dir = DEFAULT_DIR,
  basesDir = DEFAULT_BASES_DIR,
  log = (line) => process.stderr.write(line),
} = {}) {
  const groups = await readGroups(dir);
  const groupIds = groups.map((group) => group.id);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read ${dir}: ${err.message}`);
  }

  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .sort();

  const invalid = [];
  const candidates = [];

  for (const folder of folders) {
    const fail = (error) => {
      invalid.push({ folder, error });
      log(`[adapters] ${folder}: ${error}\n`);
    };

    if (!ADAPTER_ID_PATTERN.test(folder)) {
      fail('folder name must match /^[a-z0-9-]+$/');
      continue;
    }

    let text;
    try {
      text = await readFile(join(dir, folder, 'adapter.json'), 'utf8');
    } catch (err) {
      fail(`cannot read adapter.json: ${err.message}`);
      continue;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      fail(`bad JSON: ${err.message}`);
      continue;
    }

    const result = validateAdapterConfig(json, { folder, groupIds });
    if (!result.ok) {
      fail(result.error);
      continue;
    }

    let code;
    try {
      code = await createSource(result.config, { dir, basesDir });
    } catch (err) {
      fail(err.message);
      continue;
    }

    if (typeof code.search !== 'function') {
      fail('the code has no search function');
      continue;
    }

    if (typeof code.id === 'string' && code.id !== result.config.id) {
      fail(`code id "${code.id}" is not equal to adapter.json id "${result.config.id}"`);
      continue;
    }

    candidates.push({ config: result.config, code });
  }

  const counts = new Map();
  for (const candidate of candidates) {
    counts.set(candidate.config.id, (counts.get(candidate.config.id) ?? 0) + 1);
  }

  const adapters = [];
  for (const candidate of candidates) {
    if (counts.get(candidate.config.id) > 1) {
      const error = `id "${candidate.config.id}" is used more than one time`;
      invalid.push({ folder: candidate.config.id, error });
      log(`[adapters] ${candidate.config.id}: ${error}\n`);
      continue;
    }
    adapters.push(toSource(candidate.config, candidate.code));
  }

  return { groups, adapters: sortAdapters(adapters, groups), invalid };
}
