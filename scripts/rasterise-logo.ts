/**
 * Rasterises the horizontal lockup (public/brand) to a PNG for the PDFs (jsPDF cannot draw SVG).
 * Run once and commit the result: npx tsx scripts/rasterise-logo.ts
 * The proportions of the SVG (774.41 x 74.1) are kept exactly, with a transparent background.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const SRC = path.join(process.cwd(), "public", "brand", "lockup-horizontal-color-on-light.svg");
const OUT = path.join(process.cwd(), "assets", "brand", "lockup-horizontal-color-on-light.png");
const WIDTH = 2400;
const HEIGHT = Math.round((WIDTH * 74.1) / 774.41);

async function main() {
  const image = await loadImage(readFileSync(SRC));
  const canvas = createCanvas(WIDTH, HEIGHT);
  canvas.getContext("2d").drawImage(image, 0, 0, WIDTH, HEIGHT);
  writeFileSync(OUT, canvas.toBuffer("image/png"));
  console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);
}
void main();
