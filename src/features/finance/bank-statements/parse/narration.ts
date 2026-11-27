/**
 * What a statement narration says: the channel (UPI, NEFT, card, cheque, ATM), the payee's name
 * and the kind of line (bank charges, interest, loan instalment, refund). Client-safe and pure.
 *
 * Narrations are built from parts split by "/" or "-": "UPI/DR/412345678901/RAHUL KUMAR/SBIN/
 * rahul@okaxis/Payment", "NEFT DR-HDFC0000123-ACME SUPPLIES PVT LTD-NETBANK, MUM-N123456789-INV 42",
 * "POS 4567XXXXXXXX1234 AMAZON PAY INDIA". The payee is the part that reads as a name once the
 * channel words, reference numbers, IFSC codes, card numbers and UPI handles are taken out. Only
 * names are taken: a line with no name gets none, never a product or a guess.
 */

import type { PaymentMethod } from "@/lib/constants";

export type Channel = "upi" | "neft" | "rtgs" | "imps" | "card" | "cheque" | "atm" | "ach" | "transfer" | "other";

export type LineKind = "charges" | "interest" | "atm" | "loan" | "refund" | "salary" | "tax" | null;

export type NarrationInfo = {
  channel: Channel;
  method: PaymentMethod;
  payee: string | null;
  kind: LineKind;
  /** The UPI handle (name@bank), when there is one: it helps match the payee to a known name. */
  vpa: string | null;
  /**
   * When a UPI narration names no one: what it shows in the payee's place instead, as printed (a UPI
   * handle such as "ombk.aahh47175" or "MH12VW5243"). A short, stable label for the vendor, never a guess.
   */
  handle: string | null;
};

const CHANNEL_RES: [RegExp, Channel][] = [
  [/\bupi\b|\bbhim\b|@ok|@ybl|@paytm|@ibl|@axl/i, "upi"],
  [/\brtgs\b/i, "rtgs"],
  [/\bneft\b/i, "neft"],
  [/\bimps\b|\bmmt\b/i, "imps"],
  [/\b(atm|atw|nwd|eaw)\b|cash ?(wdl|withdrawal)|\bcash wd\b/i, "atm"],
  [/\b(pos|pcd|ecom|vps|ips|card)\b|debit card|credit card|\bvisa\b|\bmastercard\b|\brupay\b/i, "card"],
  [/\b(chq|cheque|clg|clearing|inward|outward)\b|\bto clg\b|\bby clg\b/i, "cheque"],
  [/\b(ach|nach|ecs|si|autopay|mandate)\b/i, "ach"],
  [/\b(trf|transfer|ift|tpt|inft|fund trf|ft|ib|inb|mb|netbanking|net banking)\b/i, "transfer"],
];

const METHOD_OF: Record<Channel, PaymentMethod> = {
  upi: "upi",
  neft: "bank_transfer",
  rtgs: "bank_transfer",
  imps: "bank_transfer",
  card: "card",
  cheque: "cheque",
  atm: "cash",
  ach: "bank_transfer",
  transfer: "bank_transfer",
  other: "bank_transfer",
};

/** Words that are never part of a payee's name in a narration. */
const NOISE = new Set(
  (
    "upi neft rtgs imps pos ecom atm atw nwd eaw ach nach ecs chq cheque clg clearing inward outward inb ib mb bil billpay onl dr cr p2a p2m p2p mmt tpt ift inft ft trf " +
    "transfer to by from payment payments pay paid sent received ref no na nil netbank netbanking mob mobile othpg pg autopay si pcd vps ips dep wdl cash self " +
    "debit credit card visa mastercard rupay txn tran transaction ach-dr ach-cr ecs-dr inft-dr neftdr neftcr imps-dr upiout upiin collect request reversal rev " +
    "towards being for via the of and charges charge chgs chg micr cts clg loan term disbursement disb emi instalment installment repayment inv invoice bill " +
    "gst cgst sgst igst inf"
  ).split(" "),
);

/** Bank short codes (the first four letters of an IFSC) that appear in narrations as the payee's bank. */
const BANK_CODES = new Set(
  (
    "sbin hdfc icic utib kkbk yesb idfb punb barb cnrb ubin ioba bkid indb fdrl mahb psib ucba cbin idib kvbl tmbl sibl rbl rbln ausf esfb jsfb pytm airp fino " +
    "ppiw srcb jaka dlxb csbk kari aubl ujvn nsdl ipos jiop cosb svcb abhy ntbl hsbc scbl dbss deut citi andb synb vijb orbc lavb dcbl bdbl nkgs tjsb utbi"
  ).split(" "),
);

const CHARGES_RE =
  /\bchrg|\bcharges?\b|\bchgs?\b|\bsms\b|min(imum)? ?bal|non[- ]?maint|annual fee|card fee|service charge|\bpenal|\bint\.? ?(dr|debit|coll)|\bdebit interest|\binterest (dr|debit|charged)|cheque book|stmt fee|ledger fee|folio/i;
/**
 * Words that mean a bank charge only when the bank debits them itself ("CGST 18.00", "DEBIT CARD
 * AMC"). On a UPI, NEFT, RTGS, IMPS or cheque payment they are the payer's remark ("INV 42 GST",
 * "AMC"), and the line is a payment to that vendor.
 */
const BANK_ONLY_CHARGES_RE = /\bgst\b|\bcgst\b|\bsgst\b|\bigst\b|\bamc\b|\bcommission\b/i;
const PAYMENT_CHANNELS = new Set<Channel>(["upi", "neft", "rtgs", "imps", "cheque"]);
const INTEREST_RE = /\bint\.? ?(pd|paid|cr|credit|earned)\b|\binterest\b|\bsb int\b|\bfd int\b|\bint\.?coll|\bcredit interest\b|\bint on\b/i;
const LOAN_RE = /\bemi\b|\bloan\b|\bln ?(rec|repay|emi)\b|\brepayment\b|\binstal+ment\b/i;
const REFUND_RE = /\brefund\b|\breversal\b|\brev[-/ ]|\breturned?\b|\bchargeback\b|\bcashback\b|\bfailed\b/i;
const SALARY_RE = /\bsalary\b|\bsalaries\b|\bpayroll\b|\bwages\b|\bstipend\b/i;
const TAX_RE = /\bgstn\b|\bcbic\b|\bcbdt\b|\bincome tax\b|\btds\b|\badvance tax\b|\bchallan\b|\bitns\b|\bprofession(al)? tax\b|\bepfo?\b|\besic\b/i;

const isReference = (t: string) => {
  const digits = (t.match(/\d/g) ?? []).length;
  return digits >= 4 && digits / t.replace(/\s/g, "").length >= 0.35;
};

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llp|Pvt|Ltd|Opc|Huf|Gst|Ac|Hp|Tvs|Lg|Abb|Sbi|Hdfc|Icici|Idfc|Hpcl|Bpcl|Iocl|Irctc)\b/g, (m) => (/^(Pvt|Ltd)$/.test(m) ? m : m.toUpperCase()));

/** A part of the narration that reads as a name: letters, not a code, not a channel word. */
function nameLike(part: string): string | null {
  const words = part
    .replace(/[^a-z0-9&.' ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Channel words are dropped at the ends of a part only: "AMAZON PAY INDIA" keeps its "PAY".
  // Bare numbers at the ends ("TERM LOAN 4471", "INV 42") are references, not part of a name.
  const noise = (w: string) => NOISE.has(w.toLowerCase().replace(/\.$/, "")) || /^\d+$/.test(w);
  while (words.length && noise(words[0]!)) words.shift();
  while (words.length && noise(words[words.length - 1]!)) words.pop();
  const text = words.join(" ").trim();
  if (!text) return null;
  const letters = (text.match(/[a-z]/gi) ?? []).length;
  if (letters < 3 || isReference(text)) return null;
  if (/^[a-z]{4}0[a-z0-9]{6}$/i.test(text)) return null; // IFSC
  if (BANK_CODES.has(text.toLowerCase())) return null;
  if (/x{3,}|\*{3,}/i.test(text)) return null; // card number
  return text;
}

/**
 * Reads the channel, payee and kind of a narration. `side` is the line's side on the statement;
 * `exclude` lists the company's own names, which appear in narrations but are never the payee.
 */
export function analyseNarration(narration: string, side: "dr" | "cr", options: { exclude?: string[] } = {}): NarrationInfo {
  const n = narration.replace(/\s+/g, " ").trim();
  const channel = CHANNEL_RES.find(([re]) => re.test(n))?.[1] ?? "other";
  const vpa = /[a-z0-9._]{2,}@[a-z]{2,}/i.exec(n)?.[0]?.toLowerCase() ?? null;

  let kind: LineKind = null;
  if (channel === "atm" && side === "dr") kind = "atm";
  else if (side === "dr" && TAX_RE.test(n)) kind = "tax";
  else if (side === "dr" && (CHARGES_RE.test(n) || (BANK_ONLY_CHARGES_RE.test(n) && !PAYMENT_CHANNELS.has(channel)))) kind = "charges";
  else if (side === "cr" && INTEREST_RE.test(n)) kind = "interest";
  else if (LOAN_RE.test(n)) kind = "loan";
  else if (side === "cr" && REFUND_RE.test(n)) kind = "refund";
  else if (SALARY_RE.test(n)) kind = "salary";

  // Card numbers and UPI handles go first so their pieces never read as a name.
  const cleaned = n.replace(/[a-z0-9._]{2,}@[a-z]{2,}/gi, "/").replace(/\b[0-9x*]{4,}[x*]{3,}[0-9x*]*\b/gi, "/");
  const parts = cleaned
    .split(/[\/|:*]+|\s-\s?|-(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])-|\s{2,}|,/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Kotak and others print the payee's bank right before the 12-digit UPI reference, after the payee
  // ("UPI/Siddh Sagar Bh/PPIW/632516679288/enjoy"): four capitals there are a bank code, not a name.
  // Only between a payee and the reference: "UPI/NEHA/632516679288" names Neha, and in SBI's order
  // ("UPI/DR/412345678901/AMIT/SBIN") the payee comes after the reference.
  const handleLike = (p: string) => /^[a-z0-9][a-z0-9._-]{3,39}$/i.test(p) && /[a-z]/i.test(p) && /\d/.test(p) && !NOISE.has(p.toLowerCase());
  const bankSlot = (i: number) =>
    channel === "upi" &&
    /^[A-Z]{4}$/.test(parts[i]!) &&
    /^\d{12}$/.test(parts[i + 1] ?? "") &&
    i > 0 &&
    (nameLike(parts[i - 1]!) !== null || handleLike(parts[i - 1]!));
  const names = parts.map((p, i) => (bankSlot(i) ? null : nameLike(p))).filter((p): p is string => Boolean(p));

  let payee: string | null = null;
  // Cash withdrawals, bank charges and interest have no payee: the bank is the other side.
  if (names.length && kind !== "atm" && kind !== "charges" && kind !== "interest") {
    const local = vpa?.split("@")[0]?.replace(/[^a-z]/g, "") ?? "";
    const own = (options.exclude ?? []).map(nameKey).filter(Boolean);
    const score = (nm: string, i: number) => {
      const key = nameKey(nm).replace(/ /g, "");
      let s = -i * 0.1;
      if (local.length >= 4 && key.includes(local.slice(0, 4))) s += 3;
      // Statements print names in capitals; a mixed-case part is usually the remark the payer typed.
      if (nm === nm.toUpperCase()) s += 2;
      if (nm.trim().includes(" ")) s += 1;
      return s;
    };
    const ranked = names
      .map((nm, i) => ({ nm, s: score(nm, i) }))
      .filter((c) => !own.some((o) => nameSimilarity(o, c.nm) >= 0.6))
      .sort((a, b) => b.s - a.s);
    payee = ranked[0]?.nm ?? null;
  }
  if (payee && payee.length > 120) payee = payee.slice(0, 120);

  // No name: a UPI line still shows who was paid, as a handle ("ombk.aahh47175", "MH12VW5243"). Only
  // the payee's place counts, before the bank code and the reference: what follows is the payer's
  // remark or a transaction id ("Inv2411", "T2411271234567890123"), never the payee.
  let handle: string | null = null;
  if (!payee && channel === "upi" && kind !== "atm" && kind !== "charges" && kind !== "interest") {
    const end = parts.findIndex((p, i) => /^\d{12}$/.test(p) || bankSlot(i));
    const digitShare = (p: string) => (p.match(/\d/g) ?? []).length / p.length;
    handle =
      vpa ??
      parts
        .slice(0, end >= 0 ? end : parts.length)
        .find((p) => handleLike(p) && p.length <= 24 && digitShare(p) <= 0.7 && !/^[a-z]{4}0[a-z0-9]{6}$/i.test(p) && !/x{3,}|\*{3,}/i.test(p)) ??
      null;
  }

  return { channel, method: METHOD_OF[channel], payee: payee ? titleCase(payee) : null, kind, vpa, handle };
}

/** Lower-case letters and digits only, for comparing names. */
export const nameKey = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const WEAK = new Set(["pvt", "ltd", "llp", "private", "limited", "the", "and", "india", "co", "company", "enterprises", "enterprise", "services", "solutions", "technologies", "tech", "traders", "industries", "mr", "mrs", "ms", "m s"]);

/** Share of a name's distinctive words found in a text (0 to 1). "ACME SUPPLIES PVT LTD" in "NEFT-ACME SUPPLIES" is 1. */
export function nameSimilarity(name: string, text: string): number {
  const words = nameKey(name)
    .split(" ")
    .filter((w) => w.length >= 3 && !WEAK.has(w));
  if (!words.length) return 0;
  const hay = ` ${nameKey(text)} `;
  const hit = words.filter((w) => hay.includes(` ${w} `) || (w.length >= 5 && hay.includes(w))).length;
  return hit / words.length;
}

/**
 * True when every distinctive word of a known name is in the text as a whole word, or the name is
 * there with its spaces left out ("SMARTLIVING"). Stricter than nameSimilarity: "QA Supplies" is
 * not in "ACME SUPPLIES PVT LTD", because "QA" is not there.
 */
export function containsName(name: string, text: string): boolean {
  const words = nameKey(name)
    .split(" ")
    .filter((w) => w && !WEAK.has(w));
  if (words.join("").length < 4) return false;
  const hay = ` ${nameKey(text)} `;
  if (words.every((w) => hay.includes(` ${w} `))) return true;
  return words.join("").length >= 6 && hay.replace(/ /g, "").includes(words.join(""));
}

/**
 * True when a payment line names this vendor well enough to pay its bill: every distinctive word of the
 * name is in the text as a whole word (or the name is there with its spaces left out). "M/s" and
 * one-letter initials are left out, and the last word may be cut short by the bank as long as at
 * least five of its letters are kept ("SRI BALAJI AGENCIE"). One shared word is never enough:
 * "IRCTC WEB" does not name "Amazon Web Services".
 */
export function namesVendor(name: string, text: string): boolean {
  let words = nameKey(name).split(" ").filter(Boolean);
  if (words[0] === "m" && words[1] === "s") words = words.slice(2);
  words = words.filter((w) => w.length >= 2 && !WEAK.has(w));
  if (words.join("").length < 4) return false;
  const hay = ` ${nameKey(text)} `;
  if (words.every((w) => hay.includes(` ${w} `))) return true;
  if (words.join("").length >= 6 && hay.replace(/ /g, "").includes(words.join(""))) return true;
  const last = words[words.length - 1]!;
  if (words.length >= 2 && last.length >= 6 && words.slice(0, -1).every((w) => hay.includes(` ${w} `))) {
    for (let k = last.length - 1; k >= 5; k--) if (hay.includes(` ${last.slice(0, k)} `)) return true;
  }
  return false;
}

/**
 * containsName for one name tested against many texts, with the name's words worked out once.
 * The test takes the text as ` ${nameKey(text)} ` (padded) and the same without spaces. Null for a
 * name too short to test, as containsName would always say no.
 */
export function nameTest(name: string): ((padded: string, flat: string) => boolean) | null {
  const words = nameKey(name)
    .split(" ")
    .filter((w) => w && !WEAK.has(w));
  const joined = words.join("");
  if (joined.length < 4) return null;
  return (padded, flat) => words.every((w) => padded.includes(` ${w} `)) || (joined.length >= 6 && flat.includes(joined));
}

/** Expense category from the narration's words, for lines whose vendor has no history. */
const CATEGORY_RULES: [RegExp, string][] = [
  [/\brent\b|\blease\b/i, "rent"],
  [/electric|msedcl|mahadiscom|bescom|tneb|tata power|adani elec|bses|torrent power|water bill|airtel|\bjio\b|vodafone|\bvi\b|bsnl|broadband|fibernet|internet|postpaid|mahanagar gas|\bmgl\b|\bigl\b/i, "utilities"],
  [/\baws\b|amazon web|google ?cloud|gsuite|google workspace|microsoft|azure|\bzoho\b|github|atlassian|slack|notion|figma|adobe|openai|digitalocean|godaddy|hostinger|vercel|canva|autodesk|solidworks|jetbrains|mathworks|subscription/i, "software"],
  [/\buber\b|\bola\b|rapido|irctc|makemytrip|goibibo|indigo|air india|vistara|spicejet|akasa|redbus|cleartrip|ixigo|fastag|petrol|diesel|fuel|hpcl|bpcl|iocl|indian oil|\btoll\b|\bhotel\b|oyo/i, "travel"],
  [/delhivery|blue ?dart|\bdtdc\b|porter|shiprocket|courier|xpressbees|ecom express|dunzo|borzo|gati\b/i, "logistics"],
  [/salary|salaries|payroll|wages|stipend/i, "salaries"],
  [/chartered|\bca\b|consult|legal|advocate|lawyer|audit|professional fee|\bcs\b/i, "professional_fees"],
  [/facebook|meta ads|google ads|adwords|linkedin|instagram|advert|marketing|justdial|indiamart|tradeindia/i, "marketing"],
  [/stationery|swiggy|zomato|blinkit|zepto|bigbasket|dmart|housekeeping|pantry|office/i, "office"],
  [/\brobu\b|mouser|digi ?key|element14|\blcsc\b|jlcpcb|pcbway|evelta|probots|electronicscomp|robokits|components?\b/i, "materials"],
  [/repair|maintenance|servicing|service cent/i, "maintenance"],
];

export function categoryFromWords(narration: string): string | null {
  return CATEGORY_RULES.find(([re]) => re.test(narration))?.[1] ?? null;
}
