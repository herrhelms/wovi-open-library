import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseCsv, parseCsvObjects } from '../lib/csv.js';

async function collect(input) {
  const rows = [];
  for await (const row of parseCsv(input)) rows.push(row);
  return rows;
}

async function collectObjects(input) {
  const rows = [];
  for await (const row of parseCsvObjects(input)) rows.push(row);
  return rows;
}

test('simple records', async () => {
  assert.deepEqual(await collect('a,b,c\n1,2,3\n'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('CRLF records', async () => {
  assert.deepEqual(await collect('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('quoted field with comma', async () => {
  assert.deepEqual(await collect('"x, y",z\n'), [['x, y', 'z']]);
});

test('escaped quotes', async () => {
  assert.deepEqual(await collect('"say ""hi""",2\n'), [['say "hi"', '2']]);
});

test('newline inside quotes', async () => {
  assert.deepEqual(await collect('"line1\nline2",b\n'), [['line1\nline2', 'b']]);
});

test('CRLF inside quotes', async () => {
  assert.deepEqual(await collect('"line1\r\nline2",b\r\n'), [['line1\r\nline2', 'b']]);
});

test('empty field', async () => {
  assert.deepEqual(await collect('a,,c\n'), [['a', '', 'c']]);
});

test('final record without line end', async () => {
  assert.deepEqual(await collect('a,b'), [['a', 'b']]);
});

test('single empty quoted field', async () => {
  assert.deepEqual(await collect('""\n'), [['']]);
});

test('chunk boundaries anywhere', async () => {
  const text = '"a""b",c\r\nd,"e\nf"\r\n';
  async function* chunks() {
    for (const char of text) yield char;
  }
  assert.deepEqual(await collect(chunks()), [
    ['a"b', 'c'],
    ['d', 'e\nf'],
  ]);
});

test('buffer chunks split multi-byte UTF-8', async () => {
  const bytes = Buffer.from('"é→",x\n', 'utf8');
  async function* chunks() {
    for (const byte of bytes) yield Buffer.from([byte]);
  }
  assert.deepEqual(await collect(chunks()), [['é→', 'x']]);
});

test('parseCsvObjects uses header', async () => {
  assert.deepEqual(await collectObjects('id,title\n1,"A, B"\n2\n'), [
    { id: '1', title: 'A, B' },
    { id: '2', title: '' },
  ]);
});

test('parseCsv works with a readable stream', async () => {
  const stream = Readable.from([Buffer.from('a,b\n'), Buffer.from('1,2\n')]);
  assert.deepEqual(await collect(stream), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});
