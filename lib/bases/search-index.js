// Shared by the NGA and Library of Congress adaptors.
export function searchIndex(index, q, page, pageSize = 24) {
  const words = String(q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

  if (words.length === 0) return { total: 0, hasMore: false, items: [] };

  const { items, texts, titles } = index;
  const titleMatches = [];
  const otherMatches = [];

  for (let i = 0; i < items.length; i += 1) {
    const text = texts[i] ?? '';
    if (!words.every((word) => text.includes(word))) continue;

    const title = titles[i] ?? '';
    if (words.every((word) => title.includes(word))) titleMatches.push(i);
    else otherMatches.push(i);
  }

  const matches = titleMatches.concat(otherMatches);
  const total = matches.length;

  const currentPage = Math.max(1, Math.floor(Number(page)) || 1);
  const start = (currentPage - 1) * pageSize;
  const selected = matches
    .slice(start, start + pageSize)
    .map((indexOfItem) => items[indexOfItem]);

  return {
    total,
    hasMore: currentPage * pageSize < total,
    items: selected,
  };
}
