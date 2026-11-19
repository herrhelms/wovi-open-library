export const id = 'loc';
export const name = 'Library of Congress';
export const homepage = 'https://www.loc.gov';
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
