export async function search(q, page) {
  return { items: [{ id: `${q}-${page}` }], total: 1, hasMore: false };
}

export function resolveDownload(id) {
  return { url: `https://example.org/${id}.jpg` };
}
