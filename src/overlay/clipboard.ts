/**
 * Index of the first image item in a clipboard's item list, or null if
 * there is none. Takes a plain `{ type }[]` rather than a real
 * `DataTransferItemList` so the decision is testable without a DOM.
 */
export function findImageClipboardItem(items: { type: string }[]): number | null {
  const index = items.findIndex((item) => item.type.startsWith("image/"));
  return index === -1 ? null : index;
}
