export const id = 'smithsonian';
export const name = 'Smithsonian Open Access';
export const homepage = 'https://www.si.edu/openaccess';
export const keyEnv = 'SMITHSONIAN_KEY';

function notImplemented() {
  return new Error(`${name}: not implemented yet`);
}

export async function search(q, page) {
  throw notImplemented();
}

export function normalize(raw) {
  throw notImplemented();
}
