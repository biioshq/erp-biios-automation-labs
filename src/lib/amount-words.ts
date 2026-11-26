/**
 * An amount in words with Indian numbering (thousand, lakh, crore): 1,25,000.50 reads
 * "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only". Works in whole paise, so there is no
 * floating point drift. Client-safe and pure.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 1 to 99. */
function underHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${tens} ${ONES[n % 10]}` : tens;
}

/** 1 to 999. */
function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(underHundred(rest));
  return parts.join(" ");
}

/** Whole number words in the Indian system. 0 gives "Zero". Crores are counted without a higher unit. */
export function integerInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError("integerInWords needs a whole number of zero or more");
  let rest = Math.floor(n);
  if (rest === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(rest / 10_000_000);
  rest %= 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  // A count of crores can itself pass 99 (150 crore): its words are the Western-style ones for that count.
  if (crore) parts.push(`${crore < 1000 ? underThousand(crore) : integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(" ");
}

/** "Rupees Twelve Thousand and Fifty Paise Only" for 12000.50. */
export function amountInWords(amount: number): string {
  const paiseTotal = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const sign = amount < 0 ? "Minus " : "";
  const rupeeWords = `Rupees ${integerInWords(rupees)}`;
  if (!paise) return `${sign}${rupeeWords} Only`;
  const paiseWords = `${integerInWords(paise)} Paise`;
  return rupees === 0 ? `${sign}${paiseWords} Only` : `${sign}${rupeeWords} and ${paiseWords} Only`;
}
