import "server-only";

import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";
import { amountInWords } from "@/lib/amount-words";
import type { CompanyIdentity } from "@/features/settings/company/server";
import { FONT, MUTED, NAVY, ORANGE, clean, drawLogo, loadFonts, loadLogo, logoClearSpace, pdfAmount, pdfDate, pdfMoney } from "@/features/reports/server/pdf-kit";

/**
 * Renders one invoice or receipt as a single A4 document. Pure: it prints exactly what the
 * DocumentSpec holds (the callers read the stored figures; nothing is recomputed here) and leaves
 * out anything that is empty. Uses the shared fonts and logo of the report PDFs.
 */

export type Tone = "good" | "warn" | "bad" | "neutral";

export type DocumentSpec = {
  /** "Tax invoice", "Invoice", "Payment receipt". */
  title: string;
  number: string;
  /** Label and value facts under the title, such as Date, Due date, Project. */
  meta: [string, string][];
  /** "Bill to", "Received from". */
  party: { heading: string; name: string; lines: string[] };
  /** Priced lines (invoices). */
  lines?: { description: string; detail?: string; quantity: number; rate: number; gstRate: number; amount: number }[];
  /** Plain description rows with an amount (receipts). */
  items?: { description: string; detail?: string; amount: number }[];
  /** Rows under the table, label and amount; the last strong row is the grand total. */
  totals: { label: string; amount: number; strong?: boolean }[];
  /** The amount that is written in words. */
  wordsAmount: number;
  wordsLabel?: string;
  status: { label: string; tone: Tone };
  /** Fact lines beside the status: payment mode, reference, received so far, balance. */
  statusLines: [string, string][];
  /** Receipts against an invoice. */
  receipts?: { date: string; number: string; mode: string; reference: string; amount: number }[];
  /** A titled block of facts, such as the invoice a receipt settles with its tax figures. */
  factBlock?: { title: string; rows: [string, string][] };
  /** Print the bank and UPI details so the customer knows where to pay. */
  showPaymentDetails: boolean;
  /** Print the saved invoice terms. */
  showTerms: boolean;
  notes?: string;
  /** Diagonal word across every page, such as "CANCELLED". */
  watermark?: string;
};

const TONES: Record<Tone, [number, number, number]> = {
  good: [21, 128, 61],
  warn: [180, 83, 9],
  bad: [185, 28, 28],
  neutral: [75, 85, 99],
};

const MARGIN = 40;
const FOOTER_ROOM = 46;
const LOGO_HEIGHT = 28;

export function renderDocument(spec: DocumentSpec, company: CompanyIdentity): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  loadFonts(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const right = pageW - MARGIN;
  const contentW = right - MARGIN;
  const set = (style: "normal" | "bold", size: number, color: [number, number, number] = NAVY) => {
    doc.setFont(FONT, style).setFontSize(size).setTextColor(...color);
  };
  const wrap = (text: string, width: number, size: number, style: "normal" | "bold" = "normal") => {
    doc.setFont(FONT, style).setFontSize(size);
    return doc.splitTextToSize(clean(text), width) as string[];
  };

  let y = 36;

  /* Letterhead: logo, then the business details on the left, the title and facts on the right. */
  const hasLogo = Boolean(loadLogo());
  if (hasLogo) {
    drawLogo(doc, MARGIN, y, LOGO_HEIGHT);
    y += LOGO_HEIGHT + logoClearSpace(LOGO_HEIGHT);
  } else {
    set("bold", 15);
    doc.text(clean(company.displayName), MARGIN, y + 12);
    y += 14 + 12;
  }
  const letterheadTop = y;

  // Right column: title, number, facts.
  const rightX = 340;
  let ry = letterheadTop + 14;
  doc.setFillColor(...ORANGE);
  doc.rect(rightX - 10, ry - 14, 3, 20, "F");
  set("bold", 17);
  doc.text(clean(spec.title).toUpperCase(), rightX, ry);
  ry += 15;
  set("normal", 9.5, MUTED);
  doc.text(clean(spec.number), rightX, ry);
  ry += 6;
  ry += 10;
  for (const [label, value] of spec.meta) {
    if (!value) continue;
    set("normal", 8.5, MUTED);
    doc.text(clean(label), rightX, ry);
    set("bold", 8.5);
    doc.text(clean(value), right, ry, { align: "right" });
    ry += 13;
  }

  // Left column: the business details (what is empty is left off).
  let ly = letterheadTop;
  const leftW = 270;
  if (hasLogo) {
    set("bold", 11);
    for (const line of wrap(company.displayName, leftW, 11, "bold")) {
      doc.text(line, MARGIN, ly + 8);
      ly += 13;
    }
  }
  if (company.tradeName && company.tradeName !== company.displayName) {
    set("normal", 8.5, MUTED);
    doc.text(clean(company.tradeName), MARGIN, ly + 8);
    ly += 12;
  }
  const cityLine = [company.city, [company.state, company.stateCode ? `(${company.stateCode})` : ""].filter(Boolean).join(" "), company.pin].filter(Boolean).join(", ");
  const detailLines = [
    company.addressLine1,
    company.addressLine2,
    cityLine,
    company.gstin ? `GSTIN: ${company.gstin}` : "",
    company.pan ? `PAN: ${company.pan}` : "",
    company.cin ? `CIN/LLPIN: ${company.cin}` : "",
    [company.phone ? `Phone: ${company.phone}` : "", company.email].filter(Boolean).join("  |  "),
    company.website,
  ].filter(Boolean);
  set("normal", 8.5, MUTED);
  for (const text of detailLines) {
    for (const line of wrap(text, leftW, 8.5)) {
      doc.text(line, MARGIN, ly + 8);
      ly += 11.5;
    }
  }

  y = Math.max(ly, ry) + 10;
  doc.setDrawColor(220, 224, 232).line(MARGIN, y, right, y);
  y += 16;

  const newPage = () => {
    doc.addPage();
    y = 50;
  };
  const ensure = (room: number) => {
    if (y + room > pageH - FOOTER_ROOM) newPage();
  };

  /* Party and status band. */
  const bandTop = y;
  set("normal", 7.5, MUTED);
  doc.text(clean(spec.party.heading).toUpperCase(), MARGIN, y);
  y += 14;
  const partyW = 250;
  set("bold", 11.5);
  for (const line of wrap(spec.party.name, partyW, 11.5, "bold")) {
    doc.text(line, MARGIN, y);
    y += 14;
  }
  set("normal", 9, MUTED);
  for (const text of spec.party.lines.filter(Boolean)) {
    for (const line of wrap(text, partyW, 9)) {
      doc.text(line, MARGIN, y);
      y += 12;
    }
  }
  // Status on the right.
  let sy = bandTop;
  set("normal", 7.5, MUTED);
  doc.text("PAYMENT STATUS", rightX, sy);
  sy += 15;
  set("bold", 12, TONES[spec.status.tone]);
  doc.text(clean(spec.status.label).toUpperCase(), rightX, sy);
  sy += 14;
  for (const [label, value] of spec.statusLines) {
    if (!value) continue;
    set("normal", 8.5, MUTED);
    doc.text(clean(label), rightX, sy);
    set("bold", 8.5);
    const valueLines = wrap(value, right - rightX - 90, 8.5, "bold");
    doc.text(valueLines, right, sy, { align: "right" });
    sy += 12.5 * valueLines.length;
  }
  y = Math.max(y, sy) + 12;

  /* The table. */
  const head = spec.lines ? ["Description", "Qty", "Rate (₹)", "GST", "Amount (₹)"] : ["Description", "Amount (₹)"];
  const body: CellDef[][] = spec.lines
    ? spec.lines.map((l) => [
        { content: l.detail ? `${clean(l.description)}\n${clean(l.detail)}` : clean(l.description) },
        { content: String(l.quantity) },
        { content: pdfAmount(l.rate) },
        { content: `${l.gstRate}%` },
        { content: pdfAmount(l.amount) },
      ])
    : (spec.items ?? []).map((i) => [{ content: i.detail ? `${clean(i.description)}\n${clean(i.detail)}` : clean(i.description) }, { content: pdfAmount(i.amount) }]);
  const lastCol = head.length - 1;
  const tableStyles = {
    font: FONT,
    fontSize: 9,
    cellPadding: { top: 6, bottom: 6, left: 6, right: 6 },
    textColor: [30, 37, 52] as [number, number, number],
    overflow: "linebreak" as const,
    lineColor: [222, 214, 203] as [number, number, number],
    lineWidth: { bottom: 0.4 },
  };
  const rightAlign = Object.fromEntries(head.map((_, i) => [i, { halign: i === 0 ? "left" : "right" } as const]));
  autoTable(doc, {
    startY: y,
    head: [head.map((h, i) => ({ content: h, styles: { halign: i === 0 ? "left" : "right" } as const }))],
    body,
    margin: { top: 50, left: MARGIN, right: MARGIN, bottom: FOOTER_ROOM },
    theme: "plain",
    styles: tableStyles,
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", lineWidth: 0 },
    columnStyles: {
      ...rightAlign,
      ...(spec.lines ? { 1: { halign: "right", cellWidth: 44 }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 40 }, [lastCol]: { halign: "right", cellWidth: 92 } } : { [lastCol]: { halign: "right", cellWidth: 110 } }),
    },
    rowPageBreak: "avoid",
    didDrawPage: (data) => {
      y = data.cursor?.y ?? y;
    },
  });
  y += 10;

  /* Totals. */
  const totalsX = right - 220;
  for (const row of spec.totals) {
    ensure(row.strong ? 26 : 16);
    if (row.strong) {
      doc.setDrawColor(...NAVY).setLineWidth(0.8).line(totalsX, y - 4, right, y - 4);
      y += 8;
      set("bold", 11);
    } else {
      set("normal", 9, MUTED);
    }
    doc.text(clean(row.label), totalsX, y);
    if (!row.strong) set("normal", 9);
    doc.text(pdfMoney(row.amount), right, y, { align: "right" });
    y += row.strong ? 18 : 14;
  }

  /* Amount in words. */
  ensure(36);
  y += 4;
  const words = `${spec.wordsLabel ?? "Amount in words"}: ${amountInWords(spec.wordsAmount)}`;
  const wordLines = wrap(words, contentW - 20, 9);
  const boxH = wordLines.length * 12 + 14;
  doc.setFillColor(247, 248, 251).setDrawColor(226, 230, 238).roundedRect(MARGIN, y, contentW, boxH, 3, 3, "FD");
  set("normal", 9);
  doc.text(wordLines, MARGIN + 10, y + 15);
  y += boxH + 16;

  /* Receipts against an invoice. */
  if (spec.receipts && spec.receipts.length) {
    ensure(60);
    set("bold", 10);
    doc.text("Payments received", MARGIN, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [["Date", "Receipt", "Mode", "Amount (₹)"].map((h, i) => ({ content: h, styles: { halign: i === 3 ? "right" : "left" } as const }))],
      body: spec.receipts.map((r) => [
        { content: pdfDate(r.date) },
        { content: r.number },
        { content: r.reference ? `${clean(r.mode)} (${clean(r.reference)})` : clean(r.mode) },
        { content: pdfAmount(r.amount) },
      ]),
      margin: { top: 50, left: MARGIN, right: MARGIN, bottom: FOOTER_ROOM },
      theme: "plain",
      styles: { ...tableStyles, fontSize: 8.5, cellPadding: 4.5 },
      headStyles: { fillColor: [244, 237, 227], textColor: NAVY, fontStyle: "bold", lineWidth: 0 },
      columnStyles: { 3: { halign: "right", cellWidth: 90 } },
      rowPageBreak: "avoid",
      didDrawPage: (data) => {
        y = data.cursor?.y ?? y;
      },
    });
    y += 18;
  }

  /* Facts: the invoice a receipt settles, with its tax figures. */
  if (spec.factBlock && spec.factBlock.rows.length) {
    ensure(24 + spec.factBlock.rows.length * 13);
    set("bold", 10);
    doc.text(clean(spec.factBlock.title), MARGIN, y);
    y += 14;
    for (const [label, value] of spec.factBlock.rows) {
      set("normal", 9, MUTED);
      doc.text(clean(label), MARGIN, y);
      set("normal", 9);
      doc.text(clean(value), MARGIN + 170, y);
      y += 13;
    }
    y += 8;
  }

  /* Payment details and signatory side by side. */
  const bankRows: [string, string][] = company.bankName || company.accountNumber || company.upiId
    ? ([
        ["Bank", company.bankName],
        ["Account name", company.accountName],
        ["Account number", company.accountNumber],
        ["IFSC", company.ifsc],
        ["Branch", company.branch],
        ["UPI ID", company.upiId],
      ] as [string, string][]).filter(([, v]) => v)
    : [];
  const showBank = spec.showPaymentDetails && bankRows.length > 0;
  const signatory = company.signatoryName || company.signatoryTitle;
  if (showBank || signatory || company.displayName) {
    const blockH = Math.max(showBank ? 28 + bankRows.length * 13 : 0, 84);
    ensure(blockH);
    const top = y;
    if (showBank) {
      set("bold", 10);
      doc.text("Pay by bank transfer or UPI", MARGIN, top);
      let by = top + 14;
      for (const [label, value] of bankRows) {
        set("normal", 9, MUTED);
        doc.text(label, MARGIN, by);
        set("bold", 9);
        doc.text(clean(value), MARGIN + 85, by);
        by += 13;
      }
    }
    // Signatory: space to sign, then the name and title.
    const sx = right - 190;
    set("normal", 9, MUTED);
    doc.text(clean(`For ${company.displayName}`), right, top, { align: "right" });
    doc.setDrawColor(150, 160, 175).setLineWidth(0.5).line(sx, top + 56, right, top + 56);
    set("bold", 9);
    if (company.signatoryName) doc.text(clean(company.signatoryName), right, top + 68, { align: "right" });
    set("normal", 8.5, MUTED);
    doc.text(clean(company.signatoryTitle ? `${company.signatoryTitle}, Authorised signatory` : "Authorised signatory"), right, top + (company.signatoryName ? 80 : 68), {
      align: "right",
    });
    y = top + Math.max(blockH, 88) + 4;
  }

  /* Terms and notes. */
  const terms = spec.showTerms ? company.invoiceTerms : "";
  for (const [title, text] of [
    ["Notes", spec.notes ?? ""],
    ["Terms", terms],
  ] as const) {
    if (!text) continue;
    const lines = wrap(text, contentW, 8.5);
    ensure(36);
    set("bold", 9);
    doc.text(title, MARGIN, y);
    y += 12;
    set("normal", 8.5, MUTED);
    for (const line of lines) {
      ensure(12);
      doc.text(line, MARGIN, y);
      y += 11;
    }
    y += 6;
  }

  /* Every page: running header after the first, watermark, footer. */
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    if (page > 1) {
      set("normal", 8, MUTED);
      doc.text(clean(`${company.displayName}  |  ${spec.title} ${spec.number}`), MARGIN, 30);
      doc.setDrawColor(226, 230, 238).setLineWidth(0.5).line(MARGIN, 36, right, 36);
    }
    if (spec.watermark) {
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: 0.1 }));
      set("bold", 88, [185, 28, 28]);
      const text = spec.watermark.toUpperCase();
      const w = doc.getTextWidth(text);
      const angle = 35;
      const rad = (angle * Math.PI) / 180;
      doc.text(text, pageW / 2 - (w / 2) * Math.cos(rad), pageH / 2 + (w / 2) * Math.sin(rad), { angle });
      doc.restoreGraphicsState();
    }
    doc.setDrawColor(226, 230, 238).setLineWidth(0.5).line(MARGIN, pageH - 38, right, pageH - 38);
    set("normal", 7.5, MUTED);
    if (company.footerNote) doc.text(clean(company.footerNote), MARGIN, pageH - 26);
    doc.text(`Page ${page} of ${total}`, right, pageH - 26, { align: "right" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
