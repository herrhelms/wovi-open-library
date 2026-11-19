export const id = 'nasa';
export const name = 'NASA Image Library';
export const homepage = 'https://images.nasa.gov';
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
