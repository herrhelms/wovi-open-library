import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';

import { PROJECT_ROOT } from './env.js';

export const EXTRA_CA_FILES = [
  join(PROJECT_ROOT, 'certs', 'ssl-com-tls-rsa-root-ca-2022.pem'),
  join(PROJECT_ROOT, 'certs', 'harica-tls-rsa-root-ca-2021.pem'),
];

let cachedResult = null;

function skipped(reason) {
  process.stderr.write(`[tls] extra root certificates not installed: ${reason}\n`);
  return { added: 0, skipped: reason };
}

function install() {
  if (typeof tls.setDefaultCACertificates !== 'function') {
    return skipped('tls.setDefaultCACertificates is not available');
  }

  const extra = [];
  for (const file of EXTRA_CA_FILES) {
    let pem;
    try {
      pem = readFileSync(file, 'utf8');
    } catch {
      return skipped(`${file} is missing`);
    }
    if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
      return skipped(`${file} is not a PEM certificate`);
    }
    try {
      new X509Certificate(pem);
    } catch {
      return skipped(`${file} is not a PEM certificate`);
    }
    extra.push(pem);
  }

  try {
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...extra]);
  } catch (err) {
    return skipped(err?.message ?? String(err));
  }

  return { added: extra.length, skipped: null };
}

export function installExtraRootCAs() {
  if (cachedResult === null) cachedResult = install();
  return cachedResult;
}
