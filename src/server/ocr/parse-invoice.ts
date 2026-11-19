/**
 * Turns raw invoice text (from OCR or a PDF text layer) into structured GST
 * invoice fields, each with a confidence between 0 and 1.
 *
 * Pure and synchronous: no I/O, so it is easy to test against fixtures.
 * Tuned for Indian GST tax invoices (GSTIN, CGST/SGST/IGST, HSN/SAC, lakh
 * digit grouping, day-first dates).
 */

import { LOW_CONFIDENCE, OCR_FIELD_KEYS, type InvoiceExtraction, type OcrField } from "@/lib/ocr";

export { LOW_CONFIDENCE, OCR_FIELD_KEYS };
export type { InvoiceExtraction, OcrField, OcrFieldKey } from "@/lib/ocr";

/** A line of text plus the engine's confidence in it (0 to 1; 1 for a PDF text layer). */
export type TextLine = { text: string; confidence: number };

const empty = <T,>(): OcrField<T> => ({ value: null, confidence: 0 });

/** A GSTIN, tolerating OCR's O/0 and I/1 confusions in the numeric positions. */
const GSTIN_PATTERN = "[0-9OQDILSBZG]{2}[A-Z0158]{5}[0-9OQDILSBZG]{4}[A-Z0158][0-9A-Z][Z2][0-9A-Z]";
const GSTIN_LOOSE_RE = new RegExp(`\\b${GSTIN_PATTERN}\\b`, "g");
const GSTIN_TEST_RE = new RegExp(`\\b${GSTIN_PATTERN}\\b`);
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Validates the GSTIN check digit (mod 36 weighted sum). */
export function isValidGstin(gstin: string): boolean {
  const value = gstin.toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARS.indexOf(value[i]);
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return check === value[14];
}

/** "1,23,456.78" / "Rs. 1234" / "₹ 99.5" → number. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

const AMOUNT_TOKEN_RE = /(?<![\w.])(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)(?![\w%])/gi;

/** All money-looking numbers on a line, with percentages and long ids removed. */
function amountsOnLine(line: string): number[] {
  const withoutPercents = line
    .replace(/\d+(?:\.\d+)?\s*%/g, " ")
    // Short bracketed marks are column units, not amounts: "(₹)" is often read as "(3)" or "(53)".
    .replace(/\(\s*[^\s()]{1,3}\s*\)/g, " ");
  const out: number[] = [];
  for (const match of withoutPercents.matchAll(AMOUNT_TOKEN_RE)) {
    const digits = match[1].replace(/,/g, "");
    // 4–8 digit integers without separators are usually HSN codes, pin codes or ids.
    if (!match[1].includes(",") && !match[1].includes(".") && digits.length >= 4) continue;
    const value = parseAmount(match[1]);
    if (value !== null) out.push(value);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const DATE_RES: { re: RegExp; build: (m: RegExpMatchArray) => [number, number, number] | null }[] = [
  {
    re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    build: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
  },
  {
    re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/,
    build: (m) => [normalizeYear(Number(m[3])), Number(m[2]), Number(m[1])],
  },
  {
    re: /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})\b/,
    build: (m) => {
      const month = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
      return month ? [normalizeYear(Number(m[3])), month, Number(m[1])] : null;
    },
  },
  {
    re: /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/,
    build: (m) => {
      const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
      return month ? [Number(m[3]), month, Number(m[2])] : null;
    },
  },
];

function normalizeYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function findDate(text: string): string | null {
  for (const { re, build } of DATE_RES) {
    const match = text.match(re);
    if (!match) continue;
    const parts = build(match);
    if (!parts) continue;
    const [y, mo, d] = parts;
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

const HEADER_NOISE =
  /^(tax\s*invoice|invoice|bill\s*of\s*supply|retail\s*invoice|cash\s*memo|original|duplicate|triplicate|receipt|estimate|quotation|page\s*\d)/i;
const COMPANY_HINT =
  /\b(pvt|private|ltd|limited|llp|inc|enterprises?|traders?|trading|solutions?|technologies|tech|industries|corporation|corp|agency|agencies|stores?|mart|electricals?|electronics|hardware|suppliers?|services|&\s*co|company|works|systems)\b/i;
const BUYER_HINT = /\b(bill(ed)?\s*to|buyer|customer|consignee|ship(ped)?\s*to|recipient|sold\s*to)\b/i;

type LabelSpec = { key: "taxableAmount" | "cgst" | "sgst" | "igst" | "cess" | "totalAmount"; patterns: RegExp[]; exclude?: RegExp };

const LABELS: LabelSpec[] = [
  {
    key: "taxableAmount",
    patterns: [/taxable\s*(value|amount|amt)?/i, /assessable\s*value/i, /sub\s*-?\s*total/i, /amount\s*before\s*tax/i],
  },
  { key: "cgst", patterns: [/\bc\.?\s?gst\b/i, /central\s*tax/i] },
  { key: "sgst", patterns: [/\bs\.?\s?gst\b/i, /\butgst\b/i, /state\s*tax/i] },
  { key: "igst", patterns: [/\bi\.?\s?gst\b/i, /integrated\s*tax/i] },
  { key: "cess", patterns: [/\bcess\b/i] },
  {
    key: "totalAmount",
    patterns: [
      /grand\s*total/i,
      /total\s*(invoice\s*)?(amount|value)\s*(payable)?/i,
      /amount\s*payable/i,
      /net\s*(amount|payable|total)/i,
      /invoice\s*total/i,
      /\btotal\b/i,
    ],
    exclude: /\b(sub\s*-?\s*total|total\s*tax|tax\s*total|total\s*gst|total\s*qty|total\s*quantity|in\s*words)\b/i,
  },
];

/**
 * Labels that start another field. Two-column invoices come out of OCR with both columns on one
 * line ("SGST @ 9% 13,590.00 Grand Total 1,78,180.00"), so a value ends where the next label starts.
 */
const FIELD_LABEL_RE =
  /\b(grand\s*total|sub\s*-?\s*total|net\s*(amount|payable|total)|total\s*(gst|tax|amount|value|payable|invoice)|amount\s*payable|taxable|assessable\s*value|c\.?\s?gst|s\.?\s?gst|utgst|i\.?\s?gst|cess|round(ed)?\s*off|amount\s*in\s*words|invoice\s*(no|number|date|#)|due\s*date|balance\s*due)\b/i;

/** The text after a label, up to the next field's label on the same line. */
function valueSegment(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const next = FIELD_LABEL_RE.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function labelledAmount(lines: TextLine[], spec: LabelSpec): OcrField<number> {
  for (let p = 0; p < spec.patterns.length; p++) {
    const pattern = spec.patterns[p];
    // Totals sit at the bottom of the invoice: search bottom-up for them, top-down otherwise.
    const order = spec.key === "totalAmount" ? [...lines.keys()].reverse() : [...lines.keys()];
    for (const i of order) {
      const line = lines[i];
      if (!pattern.test(line.text)) continue;
      if (spec.exclude?.test(line.text)) continue;
      let amounts = amountsOnLine(valueSegment(line.text, pattern) ?? "");
      let confidence = line.confidence;
      // A tax table header row ("CGST Rate Amount") has no amounts; look one line down, unless
      // that line is another field's label or an item row (many amounts).
      const below = lines[i + 1];
      if (amounts.length === 0 && below && !FIELD_LABEL_RE.test(below.text)) {
        const belowAmounts = amountsOnLine(below.text);
        if (belowAmounts.length <= 3) {
          amounts = belowAmounts;
          confidence = Math.min(confidence, below.confidence) * 0.8;
        }
      }
      if (amounts.length === 0) continue;
      const value = amounts[amounts.length - 1];
      // Earlier patterns are more specific, so they earn more trust.
      const specificity = p === spec.patterns.length - 1 && spec.patterns.length > 1 ? 0.75 : 0.9;
      return { value, confidence: round(confidence * specificity) };
    }
  }
  return empty();
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B" };

/** Undoes OCR's usual letter/digit swaps using the GSTIN's fixed layout. */
function fixGstinOcr(token: string) {
  return token
    .toUpperCase()
    .split("")
    .map((c, i) => {
      if ([0, 1, 7, 8, 9, 10].includes(i)) return TO_DIGIT[c] ?? c;
      if ([2, 3, 4, 5, 6, 11].includes(i)) return TO_LETTER[c] ?? c;
      if (i === 13) return c === "2" ? "Z" : c;
      return c;
    })
    .join("");
}

export function parseInvoiceText(input: string | TextLine[]): InvoiceExtraction {
  const lines: TextLine[] = (
    typeof input === "string" ? input.split(/\r?\n/).map((text) => ({ text, confidence: 1 })) : input
  )
    .map((l) => ({ text: l.text.replace(/\s+/g, " ").trim(), confidence: clamp01(l.confidence) }))
    .filter((l) => l.text.length > 0);

  const result: InvoiceExtraction = {
    vendorName: empty(),
    vendorAddress: empty(),
    gstin: empty(),
    invoiceNumber: empty(),
    invoiceDate: empty(),
    taxableAmount: empty(),
    cgst: empty(),
    sgst: empty(),
    igst: empty(),
    cess: empty(),
    hsnSac: empty(),
    totalAmount: empty(),
    paymentMethod: empty(),
  };

  // GSTIN: the supplier's comes first; one printed in a buyer block is only a fallback.
  const gstins: { value: string; confidence: number; buyer: boolean }[] = [];
  let buyerBlock = false;
  lines.forEach((line) => {
    if (BUYER_HINT.test(line.text)) buyerBlock = true;
    const tokens = line.text.toUpperCase().match(GSTIN_LOOSE_RE) ?? [];
    for (const raw of tokens) {
      const value = fixGstinOcr(raw);
      gstins.push({
        value,
        confidence: round(line.confidence * (isValidGstin(value) ? 0.97 : 0.5)),
        buyer: buyerBlock,
      });
    }
  });
  const supplierGstin = gstins.find((g) => !g.buyer) ?? gstins[0];
  if (supplierGstin) {
    result.gstin = {
      value: supplierGstin.value,
      confidence: supplierGstin.buyer ? Math.min(supplierGstin.confidence, 0.5) : supplierGstin.confidence,
    };
  }

  // Invoice number.
  for (const line of lines) {
    const m = line.text.match(
      /\b(?:invoice|inv|bill|receipt)\s*(?:no|number|num|#)\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i,
    );
    if (m && /\d/.test(m[1])) {
      result.invoiceNumber = { value: m[1].replace(/[.:]$/, ""), confidence: round(line.confidence * 0.9) };
      break;
    }
  }

  // Invoice date: a labelled date first, then the first date anywhere.
  for (const line of lines) {
    if (!/\b(invoice\s*date|inv\.?\s*date|bill\s*date|dated|date\s*of\s*(invoice|issue)|date)\b/i.test(line.text)) continue;
    if (/\b(due|delivery|order|po|challan)\s*date\b/i.test(line.text)) continue;
    const date = findDate(line.text);
    if (date) {
      result.invoiceDate = { value: date, confidence: round(line.confidence * 0.9) };
      break;
    }
  }
  if (!result.invoiceDate.value) {
    for (const line of lines) {
      const date = findDate(line.text);
      if (date) {
        result.invoiceDate = { value: date, confidence: round(line.confidence * 0.55) };
        break;
      }
    }
  }

  // Amounts.
  for (const spec of LABELS) result[spec.key] = labelledAmount(lines, spec);

  // HSN/SAC codes: labelled values, or 4–8 digit codes in the rows under an HSN column.
  const codes = new Set<string>();
  let hsnConfidence = 0;
  lines.forEach((line, i) => {
    const labelled = line.text.match(/\b(?:hsn|sac)(?:\s*\/\s*(?:sac|hsn))?(?:\s*code)?\s*[:\-]?\s*(\d{4,8})\b/i);
    if (labelled) {
      codes.add(labelled[1]);
      hsnConfidence = Math.max(hsnConfidence, line.confidence * 0.9);
      return;
    }
    if (/\b(hsn|sac)\b/i.test(line.text)) {
      for (const next of lines.slice(i + 1, i + 12)) {
        if (/\b(total|sub\s*total|taxable|cgst|sgst|igst)\b/i.test(next.text) && codes.size > 0) break;
        const m = next.text.match(/(?<![\d.,])(\d{4}|\d{6}|\d{8})(?![\d.,])/);
        if (m && !/^(19|20)\d{2}$/.test(m[1])) {
          codes.add(m[1]);
          hsnConfidence = Math.max(hsnConfidence, next.confidence * 0.75);
        }
      }
    }
  });
  if (codes.size) result.hsnSac = { value: [...codes].slice(0, 5).join(", "), confidence: round(hsnConfidence) };

  // Payment method.
  const methods: [RegExp, string][] = [
    [/\b(upi|gpay|google\s*pay|phonepe|paytm|bhim)\b/i, "upi"],
    [/\b(neft|rtgs|imps|bank\s*transfer|net\s*banking|wire)\b/i, "bank_transfer"],
    [/\b(credit\s*card|debit\s*card|card|visa|mastercard|rupay|amex|pos)\b/i, "card"],
    [/\b(cheque|check\s*no|dd\s*no|demand\s*draft)\b/i, "cheque"],
    [/\bcash\b/i, "cash"],
  ];
  outer: for (const line of lines) {
    const labelled = /\b(payment|paid|mode|tender)\b/i.test(line.text);
    for (const [re, method] of methods) {
      if (re.test(line.text)) {
        result.paymentMethod = { value: method, confidence: round(line.confidence * (labelled ? 0.85 : 0.6)) };
        if (labelled) break outer;
      }
    }
  }

  // Vendor name and address: the first meaningful lines at the top of the page.
  const top = lines.slice(0, Math.min(lines.length, 14));
  let vendorIndex = -1;
  const labelled = top.findIndex((l) => /^(from|sold\s*by|supplier|seller|vendor)\s*[:\-]/i.test(l.text));
  if (labelled >= 0) {
    const name = top[labelled].text.replace(/^(from|sold\s*by|supplier|seller|vendor)\s*[:\-]\s*/i, "");
    if (name.length >= 3) vendorIndex = labelled;
    result.vendorName = name.length >= 3
      ? { value: name, confidence: round(top[labelled].confidence * 0.85) }
      : empty();
  }
  if (vendorIndex === -1) {
    const company = top.findIndex((l) => COMPANY_HINT.test(l.text) && !BUYER_HINT.test(l.text) && !HEADER_NOISE.test(l.text));
    const firstText = top.findIndex(
      (l) =>
        /[A-Za-z]{3,}/.test(l.text) &&
        !HEADER_NOISE.test(l.text) &&
        !GSTIN_TEST_RE.test(l.text.toUpperCase()) &&
        l.text.length <= 60,
    );
    vendorIndex = company >= 0 ? company : firstText;
    if (vendorIndex >= 0) {
      result.vendorName = {
        value: cleanName(top[vendorIndex].text),
        confidence: round(top[vendorIndex].confidence * (company >= 0 ? 0.85 : 0.55)),
      };
    }
  }
  if (vendorIndex >= 0) {
    const addressLines: string[] = [];
    let addressConfidence = 1;
    for (const line of lines.slice(vendorIndex + 1, vendorIndex + 6)) {
      const text = withoutRightColumn(line.text);
      if (!text || /gstin|gst\s*no|phone|mobile|tel|email|e-mail|invoice|bill\s*to|buyer|www\.|state\s*code|pan\b/i.test(text)) break;
      if (HEADER_NOISE.test(text)) continue;
      addressLines.push(text);
      addressConfidence = Math.min(addressConfidence, line.confidence);
    }
    const address = addressLines.join(", ");
    if (address && /\d|road|rd\b|street|st\b|nagar|marg|lane|sector|floor|plot|near|opp|city|india|\b\d{6}\b/i.test(address)) {
      result.vendorAddress = {
        value: address,
        confidence: round(addressConfidence * (/\b\d{6}\b/.test(address) ? 0.8 : 0.6)),
      };
    }
  }

  return reconcileAmounts(result);
}

/**
 * Cross-checks the amounts: when taxable value plus taxes equals the total, every
 * amount is trustworthy; a missing figure can be derived from the others.
 */
function reconcileAmounts(r: InvoiceExtraction): InvoiceExtraction {
  const n = (f: OcrField<number>) => f.value ?? 0;
  const taxes = n(r.cgst) + n(r.sgst) + n(r.igst) + n(r.cess);

  // Intra-state invoices split tax equally; fill a missing half.
  if (r.cgst.value !== null && r.sgst.value === null && r.igst.value === null) {
    r.sgst = { value: r.cgst.value, confidence: 0.5 };
  } else if (r.sgst.value !== null && r.cgst.value === null && r.igst.value === null) {
    r.cgst = { value: r.sgst.value, confidence: 0.5 };
  }

  const taxSum = n(r.cgst) + n(r.sgst) + n(r.igst) + n(r.cess);
  if (r.taxableAmount.value !== null && r.totalAmount.value !== null) {
    const diff = Math.abs(r.taxableAmount.value + taxSum - r.totalAmount.value);
    if (diff <= 1.01) {
      for (const key of ["taxableAmount", "cgst", "sgst", "igst", "cess", "totalAmount"] as const) {
        if (r[key].value !== null) r[key] = { value: r[key].value, confidence: Math.max(r[key].confidence, 0.95) };
      }
    } else if (taxSum === 0 && diff > 1.01) {
      r.totalAmount = { ...r.totalAmount, confidence: Math.min(r.totalAmount.confidence, 0.6) };
    }
  } else if (r.taxableAmount.value !== null && r.totalAmount.value === null) {
    r.totalAmount = { value: round(r.taxableAmount.value + taxSum), confidence: 0.6 };
  } else if (r.totalAmount.value !== null && r.taxableAmount.value === null && taxes > 0) {
    r.taxableAmount = { value: round(r.totalAmount.value - taxSum), confidence: 0.6 };
  }
  return r;
}

/**
 * Drops the right-hand column that OCR joins onto vendor lines:
 * "TechVision Technologies Pvt. Ltd. Invoice No. : INV-1" -> "TechVision Technologies Pvt. Ltd.".
 */
const RIGHT_COLUMN_RE =
  /\s+(?:tax\s+invoice\b|invoice\s*(?:no|number|#|date)\b|inv\.?\s*(?:no|date)\b|bill\s*(?:no|date)\b|dated?\s*[:\-]|due\s*date\b|place\s*of\s*supply\b|(?:phone|mobile|tel|e-?mail)\s*[:\-]).*$/i;

function withoutRightColumn(text: string) {
  return text.replace(RIGHT_COLUMN_RE, "").trim();
}

function cleanName(text: string) {
  return withoutRightColumn(text).replace(/^(m\/s\.?|messrs\.?)\s*/i, "").replace(/[|:]+$/, "").trim();
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
}

/** Average confidence across the fields that were found (for a summary badge). */
export function overallConfidence(r: InvoiceExtraction): number {
  const found = OCR_FIELD_KEYS.map((k) => r[k]).filter((f) => f.value !== null);
  if (!found.length) return 0;
  return round(found.reduce((s, f) => s + f.confidence, 0) / found.length);
}
