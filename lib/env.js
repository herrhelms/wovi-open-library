import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function loadEnv(file = join(PROJECT_ROOT, '.env')) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 0;
  }

  let count = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (key === '') continue;

    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
    count += 1;
  }

  return count;
}
