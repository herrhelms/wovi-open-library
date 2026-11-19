/**
 * Viewer stub. A later package replaces this with the full-screen dialog.
 * @param {object[]} list visible items in display order
 * @param {number} index index of the requested item
 */
export function openViewer(list, index) {
  const item = list[index];
  if (!item?.pageUrl) return;
  window.open(item.pageUrl, '_blank', 'noopener');
}
