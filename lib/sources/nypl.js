export const id = 'nypl';
export const name = 'New York Public Library';
export const homepage = 'https://digitalcollections.nypl.org';
export const keyEnv = 'NYPL_TOKEN';

function notImplemented() {
  return new Error(`${name}: not implemented yet`);
}

export async function search(q, page) {
  throw notImplemented();
}

export function normalize(raw) {
  throw notImplemented();
}
