export function create({ id, name, homepage, group, prefix }) {
  return {
    id,
    name,
    homepage,
    group,
    prefix,
    async search(q, page) {
      return { items: [{ id: `${prefix}-${q}-${page}` }], total: 1, hasMore: false };
    },
  };
}

export function alias({ id, name, homepage, group, aliasId }) {
  return {
    id: aliasId,
    name,
    homepage,
    group,
    async search() {
      return { items: [], total: 0, hasMore: false };
    },
  };
}
