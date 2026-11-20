/**
 * An item's own details beyond the standard fields: a parts list's "Value / Rating", "Mounting
 * type" and any other column, kept as label and value. Also decides whether two items with the
 * same name are different parts (a 110 ohm and a 180K ohm resistor). Client-safe and pure.
 */

export type ItemAttribute = { label: string; value: string };

export const MAX_ATTRIBUTES = 30;
export const ATTRIBUTE_LABEL_MAX = 60;
export const ATTRIBUTE_VALUE_MAX = 1000;
export const SUBCATEGORY_MAX = 80;

/** "Value / Rating", "value-rating" and "VALUE RATING" are the same label. */
export function attributeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Values compared without case, spaces or unit spelling: "110 Ohm", "110ohm", "110Ω" and "110R"
 * are the same value, as are "5 V" and "5v".
 */
function valueKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/Ω|ω|ohms?\b|ohms?(?=[^a-z]|$)/g, "ohm")
    .replace(/(\d)r(?=$|[^a-z])/g, "$1ohm")
    .replace(/(\d)(k|m)(?=$|[^a-z])/g, "$1$2ohm")
    .replace(/volts?\b/g, "v")
    .replace(/amps?\b/g, "a");
}

/**
 * Details that tell one part from another of the same name: its value or rating, size, model or
 * part number. Descriptive details (mounting, package, colour) and free notes such as remarks,
 * invoice numbers or dates never split an item in two.
 */
const IDENTITY_LABEL =
  /value|rating|size|dimension|model|part\s*(no|num)|mpn|volt|watt|capacit|resist|inductan|toleran|variant|grade|length|width|height|thick|diameter|gauge|frequen|pitch/;

export function isIdentityLabel(label: string): boolean {
  return IDENTITY_LABEL.test(attributeKey(label));
}

export type PartTraits = { subcategory?: string | null; attributes?: ItemAttribute[] | null };

/**
 * The first detail on which two items with the same name differ (both filled in, different
 * values), or null when nothing tells them apart. An item without details (every item added
 * before details existed) never differs, so it still counts as the same item.
 */
export function partDifference(a: PartTraits, b: PartTraits): string | null {
  const sa = valueKey(a.subcategory ?? "");
  const sb = valueKey(b.subcategory ?? "");
  if (sa && sb && sa !== sb) return "Subcategory";
  const bValues = new Map<string, string>();
  for (const attr of b.attributes ?? []) {
    if (isIdentityLabel(attr.label) && attr.value.trim()) bValues.set(attributeKey(attr.label), valueKey(attr.value));
  }
  for (const attr of a.attributes ?? []) {
    if (!isIdentityLabel(attr.label) || !attr.value.trim()) continue;
    const other = bValues.get(attributeKey(attr.label));
    if (other !== undefined && other !== valueKey(attr.value)) return attr.label;
  }
  return null;
}

/**
 * Whether an item matched by name alone can be trusted to be this part: true when the row has no
 * identity details to compare, or when the item shares at least one of them (with the same value,
 * as partDifference already checked). An item with no details at all is not confirmed by a row
 * that has some: "Metal film resistor" in stock may be any value.
 */
export function nameMatchConfirmed(row: PartTraits, item: PartTraits): boolean {
  const rowKeys = identityKeys(row);
  if (!rowKeys.size) return true;
  const itemKeys = identityKeys(item);
  return [...rowKeys].some((k) => itemKeys.has(k));
}

function identityKeys(t: PartTraits): Set<string> {
  const keys = new Set<string>();
  if (t.subcategory?.trim()) keys.add("subcategory");
  for (const a of t.attributes ?? []) if (isIdentityLabel(a.label) && a.value.trim()) keys.add(attributeKey(a.label));
  return keys;
}

/** A short hint for pickers and lists: the part's value or rating, else its subcategory. */
export function variantHint(traits: PartTraits, max = 40): string | null {
  const value = (traits.attributes ?? []).find((a) => /value|rating/.test(attributeKey(a.label)) && a.value.trim());
  const text = (value?.value ?? traits.subcategory ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Trimmed, blank rows dropped, one entry per label (the first wins), at most MAX_ATTRIBUTES. */
export function cleanAttributes(list: { label?: string | null; value?: string | null }[] | null | undefined): ItemAttribute[] {
  const out: ItemAttribute[] = [];
  const seen = new Set<string>();
  for (const a of list ?? []) {
    const label = (a.label ?? "").replace(/\s+/g, " ").trim();
    const value = (a.value ?? "").replace(/[ \t]+/g, " ").trim();
    const key = attributeKey(label);
    if (!label || !value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label.slice(0, ATTRIBUTE_LABEL_MAX), value: value.slice(0, ATTRIBUTE_VALUE_MAX) });
    if (out.length >= MAX_ATTRIBUTES) break;
  }
  return out;
}
