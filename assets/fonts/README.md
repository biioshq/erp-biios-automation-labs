# Fonts for PDF exports

`FreeSans.ttf` and `FreeSansBold.ttf` are from GNU FreeFont (https://www.gnu.org/software/freefont/),
licensed GPLv3 or later with the font exception: embedding the font in a document (our PDF reports)
does not make the document subject to the GPL. They are used by
`src/features/reports/server/render-pdf.ts` because the built-in PDF fonts cannot draw the rupee
sign or text outside Latin-1 (Hindi names, Ω, en dashes). jsPDF embeds only the glyphs a report uses.
