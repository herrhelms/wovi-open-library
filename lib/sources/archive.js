export const id = 'archive';
export const name = 'Internet Archive';
export const homepage = 'https://archive.org';
export const keyEnv = null;

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
