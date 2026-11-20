/**
 * Matching Drive image names to inventory items, for the item photo import. Pure functions, no
 * database: "LED-Strip_5m.jpg" matches the item with SKU "LEDSTRIP5M" or the name "LED strip 5m".
 */

export type PhotoMatchItem = { id: string; name: string; sku: string };

export type PhotoMatch =
  | { itemId: string; by: "sku" | "name"; reason: null }
  | { itemId: null; by: null; reason: string };

/** Lower case, without spaces, dashes and underscores. */
export function photoKey(text: string): string {
  return text.toLowerCase().replace(/[\s_-]+/g, "");
}

/** The file name without its extension ("bolt m8.final.jpg" -> "bolt m8.final"). */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Builds a matcher over the active items. A SKU match wins over a name match; a name shared by several items matches none. */
export function photoMatcher(items: PhotoMatchItem[]): (fileName: string) => PhotoMatch {
  const bySku = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  for (const item of items) {
    add(bySku, photoKey(item.sku), item.id);
    add(byName, photoKey(item.name), item.id);
  }
  return (fileName) => {
    const key = photoKey(baseName(fileName));
    if (!key) return { itemId: null, by: null, reason: "The file has no name to match." };
    const sku = bySku.get(key) ?? [];
    if (sku.length === 1) return { itemId: sku[0]!, by: "sku", reason: null };
    const name = byName.get(key) ?? [];
    if (name.length === 1) return { itemId: name[0]!, by: "name", reason: null };
    if (sku.length > 1 || name.length > 1) return { itemId: null, by: null, reason: "Several items have this SKU or name. Pick one." };
    return { itemId: null, by: null, reason: "No item has this SKU or name." };
  };
}
