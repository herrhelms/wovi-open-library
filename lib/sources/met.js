export const id = 'met';
export const name = 'The Met';
export const homepage = 'https://www.metmuseum.org';
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
