import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';

import { EXTRA_CA_FILES, installExtraRootCAs } from '../lib/tls.js';

const FINGERPRINTS = {
  'ssl-com-tls-rsa-root-ca-2022.pem':
    '8F:AF:7D:2E:2C:B4:70:9B:B8:E0:B3:36:66:BF:75:A5:DD:45:B5:DE:48:0F:8E:A8:D4:BF:E6:BE:BC:17:F2:ED',
  'harica-tls-rsa-root-ca-2021.pem':
    'D9:5D:0E:8E:DA:79:52:5B:F9:BE:B1:1B:14:D2:10:0D:32:94:98:5F:0C:62:D9:FA:BD:9C:D9:99:EC:CB:7B:1D',
};

const compact = (pem) => pem.replace(/\s+/g, '');

for (const file of EXTRA_CA_FILES) {
  const base = file.split('/').pop();

  test(`${base} exists and is a PEM certificate`, () => {
    const pem = readFileSync(file, 'utf8');
    assert.ok(pem.startsWith('-----BEGIN CERTIFICATE-----'));
    assert.ok(pem.includes('-----END CERTIFICATE-----'));
  });

  test(`${base} has the expected SHA-256 fingerprint`, () => {
    const pem = readFileSync(file, 'utf8');
    assert.equal(new X509Certificate(pem).fingerprint256, FINGERPRINTS[base]);
  });
}

test('importing lib/http.js installs both roots in the default list', async () => {
  await import('../lib/http.js');

  const installed = tls.getCACertificates('default').map(compact);
  for (const file of EXTRA_CA_FILES) {
    const pem = compact(readFileSync(file, 'utf8'));
    assert.ok(installed.includes(pem), `${file} is in the default list`);
  }
});

test('installExtraRootCAs is idempotent and does not grow the list', () => {
  const before = tls.getCACertificates('default').length;
  const first = installExtraRootCAs();
  const second = installExtraRootCAs();

  assert.deepEqual(first, second);
  assert.equal(first.added, 2);
  assert.equal(first.skipped, null);
  assert.equal(tls.getCACertificates('default').length, before);
});
