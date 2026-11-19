async function* chunksOf(input) {
  if (typeof input === 'string') {
    yield input;
    return;
  }
  for await (const chunk of input) yield chunk;
}

export async function* parseCsv(input) {
  const decoder = new TextDecoder('utf-8');
  let field = '';
  let fieldStarted = false;
  let row = [];
  let state = 'start';
  let skipLF = false;

  function finishRecord() {
    row.push(field);
    const record = row;
    field = '';
    fieldStarted = false;
    row = [];
    state = 'start';
    return record;
  }

  function* feed(text) {
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];

      if (skipLF) {
        skipLF = false;
        if (c === '\n') continue;
      }

      if (state === 'quoted') {
        if (c === '"') state = 'afterquote';
        else field += c;
        continue;
      }

      if (state === 'afterquote') {
        if (c === '"') {
          field += '"';
          state = 'quoted';
        } else if (c === ',') {
          row.push(field);
          field = '';
          fieldStarted = false;
          state = 'start';
        } else if (c === '\n') {
          yield finishRecord();
        } else if (c === '\r') {
          skipLF = true;
          yield finishRecord();
        } else {
          field += c;
          fieldStarted = true;
          state = 'unquoted';
        }
        continue;
      }

      // start or unquoted
      if (c === '"') {
        state = 'quoted';
        fieldStarted = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
        fieldStarted = false;
        state = 'start';
      } else if (c === '\n') {
        if (fieldStarted || row.length > 0 || field !== '') {
          yield finishRecord();
        } else {
          state = 'start';
        }
      } else if (c === '\r') {
        if (fieldStarted || row.length > 0 || field !== '') {
          yield finishRecord();
        } else {
          state = 'start';
        }
        skipLF = true;
      } else {
        field += c;
        fieldStarted = true;
        state = 'unquoted';
      }
    }
  }

  for await (const chunk of chunksOf(input)) {
    const text =
      typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true });
    yield* feed(text);
  }

  const tail = decoder.decode();
  if (tail !== '') yield* feed(tail);

  if (fieldStarted || row.length > 0 || field !== '' || state === 'quoted' || state === 'afterquote') {
    yield finishRecord();
  }
}

export async function* parseCsvObjects(input) {
  let headers = null;
  for await (const record of parseCsv(input)) {
    if (headers === null) {
      headers = record;
      continue;
    }
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = record[i] ?? '';
    }
    yield obj;
  }
}
