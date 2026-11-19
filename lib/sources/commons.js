export const id = 'commons';
export const name = 'Wikimedia Commons';
export const homepage = 'https://commons.wikimedia.org';
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
