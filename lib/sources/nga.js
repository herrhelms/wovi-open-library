export const id = 'nga';
export const name = 'National Gallery of Art';
export const homepage = 'https://www.nga.gov';
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
