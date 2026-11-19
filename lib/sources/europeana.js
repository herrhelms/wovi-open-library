export const id = 'europeana';
export const name = 'Europeana';
export const homepage = 'https://www.europeana.eu';
export const keyEnv = 'EUROPEANA_KEY';

function notImplemented() {
  return new Error(`${name}: not implemented yet`);
}

export async function search(q, page) {
  throw notImplemented();
}

export function normalize(raw) {
  throw notImplemented();
}

export async function resolveDownload(itemId) {
  throw notImplemented();
}
