export const id = 'rijksmuseum';
export const name = 'Rijksmuseum';
export const homepage = 'https://www.rijksmuseum.nl';
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
