import { loadEnv } from '../lib/env.js';
import { sources } from '../lib/sources/index.js';

loadEnv();

const QUERY = 'moon';
const PAGE = 1;
const ID_WIDTH = 12;
const NGA_POLL_MS = 10_000;
const MAX_WAIT_MS = 5 * 60_000;
const POLL_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(id) {
  return String(id).padEnd(ID_WIDTH, ' ');
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTotal(total) {
  if (total === null || total === undefined) return '?';
  const number = Number(total);
  return Number.isFinite(number) ? String(number) : '?';
}

function errorMessage(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

function itemCount(result) {
  return Array.isArray(result?.items) ? result.items.length : 0;
}

function okOrNoItems(source, result, elapsed) {
  const count = itemCount(result);
  if (count === 0) {
    return { status: 'FAIL', message: 'no items', elapsed };
  }
  return { status: 'OK', count, total: result?.total ?? null, elapsed };
}

async function runSource(source) {
  const started = performance.now();
  try {
    const result = await source.search(QUERY, PAGE);
    return okOrNoItems(source, result, performance.now() - started);
  } catch (err) {
    const elapsed = performance.now() - started;
    if (source.id === 'loc' && err?.code === 'BLOCKED') {
      return { status: 'WARN', message: errorMessage(err), elapsed };
    }
    return { status: 'FAIL', message: errorMessage(err), elapsed };
  }
}

async function runPrepared(source) {
  const started = performance.now();
  const deadline = started + MAX_WAIT_MS;
  let announced = false;

  for (;;) {
    try {
      const result = await source.search(QUERY, PAGE);
      const elapsed = performance.now() - started;
      if (announced) process.stdout.write('\n');
      return okOrNoItems(source, result, elapsed);
    } catch (err) {
      const elapsed = performance.now() - started;

      if (err?.code !== 'PREPARING') {
        if (announced) process.stdout.write('\n');
        if (source.id === 'loc' && err?.code === 'BLOCKED') {
          return { status: 'WARN', message: errorMessage(err), elapsed };
        }
        return { status: 'FAIL', message: errorMessage(err), elapsed };
      }

      if (performance.now() >= deadline) {
        if (announced) process.stdout.write('\n');
        return {
          status: 'FAIL',
          message: `timed out waiting for ${source.id} data (5 min)`,
          elapsed,
        };
      }

      if (!announced) {
        process.stdout.write(
          `…  ${source.id}: preparing data, waiting (poll every 10 s, max 5 min)`,
        );
        announced = true;
      } else {
        process.stdout.write('.');
      }

      const wait = Math.min(POLL_MS, deadline - performance.now());
      if (wait > 0) await sleep(wait);
    }
  }
}

function formatResult(result) {
  const id = pad(result.id);

  if (result.status === 'OK') {
    return `OK    ${id}  ${result.count} items  total ${formatTotal(result.total)}  ${seconds(result.elapsed)}`;
  }
  if (result.status === 'WARN') {
    return `WARN  ${id}  ${result.message}`;
  }
  return `FAIL  ${id}  ${result.message}  ${seconds(result.elapsed)}`;
}

const results = new Map();

const preparedIds = new Set(['loc', 'nga']);
const parallelSources = sources.filter((source) => !preparedIds.has(source.id));
const locSource = sources.find((source) => source.id === 'loc');
const ngaSource = sources.find((source) => source.id === 'nga');

const parallelResults = await Promise.all(
  parallelSources.map(async (source) => ({ source, result: await runSource(source) })),
);
for (const { source, result } of parallelResults) {
  results.set(source.id, result);
}

if (locSource) {
  results.set(locSource.id, await runPrepared(locSource));
}

if (ngaSource) {
  results.set(ngaSource.id, await runPrepared(ngaSource));
}

const summary = { OK: 0, WARN: 0, FAIL: 0 };
for (const source of sources) {
  const result = results.get(source.id);
  if (!result) continue;
  summary[result.status] += 1;
  console.log(formatResult({ id: source.id, ...result }));
}

console.log(
  `Summary: ${summary.OK} OK, ${summary.WARN} WARN, ${summary.FAIL} FAIL`,
);

process.exitCode = summary.FAIL > 0 ? 1 : 0;
