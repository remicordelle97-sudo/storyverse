/**
 * Phase-1 print PDF builder.
 *
 * Produces a minimal Lulu-acceptable cover + interior PDF for the
 * 8.5x8.5 square paperback POD package. The layout is deliberately
 * basic — text-only interior, single-color cover with title — because
 * Phase 1 is about validating the Lulu integration end-to-end. Phase 2
 * will replace this with a Puppeteer-based renderer that pulls each
 * scene's illustration and matches the on-screen ReadingMode design.
 *
 * Dimensions: PDFs are emitted at trim size (8.5x8.5 inches). Lulu's
 * `printable_normalization` adds bleed/safety margins server-side, so
 * Phase 1 doesn't need to compute spine width or bleed boxes itself.
 * That accuracy work belongs in Phase 2 alongside the real layout.
 */

import { jsPDF } from "jspdf";
import { saveImage } from "../lib/storage.js";
import { storyRgbColor } from "../../shared/storyColor.js";
import { debug } from "../lib/debug.js";

const POINTS_PER_INCH = 72;
// Saddle-stitch requires the interior page count to be a multiple of 4.
// We round up to that boundary with blanks; the final book design
// (Phase 2) replaces those with real end-matter pages.
const PAGE_COUNT_MULTIPLE = 4;
// Lulu's standard print bleed for POD products.
const BLEED_INCHES = 0.125;
// Custom font registered with jsPDF so glyphs are embedded as font
// data rather than referenced as a "Standard 14" name. Lulu's print
// pipeline rejects PDFs with non-embedded fonts.
const FONT_FAMILY = "Inter";

// @fontsource v5 only ships woff/woff2 in node_modules — no TTFs. jsPDF
// needs TTF, so we fetch Inter's TTF from a stable CDN once per
// container lifetime and cache the bytes in memory. v4.5.15 is pinned
// because that's the last @fontsource release that bundled .ttf.
const FONT_URL_REGULAR =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/files/inter-latin-400-normal.ttf";
const FONT_URL_BOLD =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/files/inter-latin-700-normal.ttf";

let cachedFontData: { regular: string; bold: string } | null = null;
let pendingFontLoad: Promise<{ regular: string; bold: string }> | null = null;
async function loadFontData(): Promise<{ regular: string; bold: string }> {
  if (cachedFontData) return cachedFontData;
  if (pendingFontLoad) return pendingFontLoad;
  pendingFontLoad = (async () => {
    const fetchTtf = async (url: string): Promise<string> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Font download failed (${res.status}): ${url}`);
      }
      return Buffer.from(await res.arrayBuffer()).toString("base64");
    };
    const [regular, bold] = await Promise.all([
      fetchTtf(FONT_URL_REGULAR),
      fetchTtf(FONT_URL_BOLD),
    ]);
    cachedFontData = { regular, bold };
    debug.story("Print: Inter TTFs cached");
    return cachedFontData;
  })().finally(() => {
    pendingFontLoad = null;
  });
  return pendingFontLoad;
}

async function registerFonts(pdf: jsPDF) {
  const { regular, bold } = await loadFontData();
  pdf.addFileToVFS("Inter-Regular.ttf", regular);
  pdf.addFont("Inter-Regular.ttf", FONT_FAMILY, "normal");
  pdf.addFileToVFS("Inter-Bold.ttf", bold);
  pdf.addFont("Inter-Bold.ttf", FONT_FAMILY, "bold");
}

/**
 * Lulu POD package SKUs encode the trim size in their first 9 chars:
 * "WWWWXHHHH" in hundredths of an inch. Parsing it means the PDF
 * dimensions stay in sync with whatever SKU Railway is configured
 * to use — no separate env var to forget.
 */
function trimInchesFromSku(sku: string): { width: number; height: number } {
  const m = /^(\d{4})X(\d{4})/.exec(sku);
  if (!m) {
    throw new Error(
      `Could not parse trim from POD package id "${sku}". Expected format like "0850X0850...".`
    );
  }
  return { width: parseInt(m[1], 10) / 100, height: parseInt(m[2], 10) / 100 };
}

interface BuildInput {
  story: {
    id: string;
    title: string;
    scenes: {
      sceneNumber: number;
      content: string;
      // Pre-fetched illustration bytes (route fetches in parallel
      // before calling buildPrintPdfBytes so this stays sync).
      image?: { mimeType: string; data: string };
    }[];
  };
  // Lulu POD package id — drives the trim size of the emitted PDFs.
  podPackageId: string;
}

export interface BuildResult {
  coverPdfUrl: string;
  interiorPdfUrl: string;
  pageCount: number;
}

export interface BuiltBytes {
  coverBytes: ArrayBuffer;
  interiorBytes: ArrayBuffer;
  pageCount: number;
}

async function newDoc(widthPt: number, heightPt: number, orientation: "p" | "l" = "p"): Promise<jsPDF> {
  // Compress streams (smaller PDF) and target a modern PDF version —
  // Lulu's normalizer prefers PDF 1.5+. jsPDF defaults to 1.3 in some
  // builds.
  const pdf = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation,
    compress: true,
    putOnlyUsedFonts: false,
  });
  await registerFonts(pdf);
  return pdf;
}

function pdfImageFormat(mimeType: string): "PNG" | "JPEG" | "WEBP" {
  if (mimeType.includes("png")) return "PNG";
  if (mimeType.includes("webp")) return "WEBP";
  return "JPEG";
}

// Same parchment color as .stf__item in src/client/index.css — the
// page background users see in the on-screen reader. Keeping the
// printed book visually consistent with the on-screen experience.
const PAPER_RGB = { r: 0xf5, g: 0xec, b: 0xd7 };

function paintPaper(pdf: jsPDF, pagePt: number) {
  pdf.setFillColor(PAPER_RGB.r, PAPER_RGB.g, PAPER_RGB.b);
  pdf.rect(0, 0, pagePt, pagePt, "F");
}

async function buildInteriorPdf(
  input: BuildInput,
  pagePt: number
): Promise<{ bytes: ArrayBuffer; pageCount: number }> {
  const pdf = await newDoc(pagePt, pagePt);
  const margin = 54; // 0.75"
  const usableWidth = pagePt - margin * 2;

  // Saddle-stitch requires the interior page count to be a multiple
  // of 4. With 10 scenes that's 12 pages: 1 blank front + 10 scenes
  // + 1 blank back. The cover already shows the title, so we don't
  // repeat it on the front matter.
  paintPaper(pdf, pagePt);
  let pageCount = 1; // first page is blank front matter (already created by jsPDF)

  for (const scene of input.story.scenes) {
    pdf.addPage([pagePt, pagePt], "p");
    paintPaper(pdf, pagePt);
    pageCount++;

    if (scene.image) {
      const dataUrl = `data:${scene.image.mimeType};base64,${scene.image.data}`;
      const format = pdfImageFormat(scene.image.mimeType);
      // Fit the image inside the box preserving its aspect ratio. If
      // we drew it at the box's exact dimensions jsPDF would stretch
      // it (Gemini's 4:3 scene art in a 1.45:1 box ends up ~9% wider
      // than reality). Letterbox/pillarbox the slack instead.
      const boxLeft = margin;
      const boxTop = margin;
      const boxW = usableWidth;
      const boxH = pagePt * 0.55;
      const props = pdf.getImageProperties(dataUrl);
      const imageAR = props.width / props.height;
      const boxAR = boxW / boxH;
      const drawW = imageAR > boxAR ? boxW : boxH * imageAR;
      const drawH = imageAR > boxAR ? boxW / imageAR : boxH;
      const drawX = boxLeft + (boxW - drawW) / 2;
      const drawY = boxTop + (boxH - drawH) / 2;
      pdf.addImage(dataUrl, format, drawX, drawY, drawW, drawH);
      const textTop = boxTop + boxH + 24;
      pdf.setFont(FONT_FAMILY, "normal");
      pdf.setFontSize(13);
      const lines = pdf.splitTextToSize(scene.content, usableWidth);
      pdf.text(lines, margin, textTop, { lineHeightFactor: 1.55 });
    } else {
      // No illustration — text only, vertically centered.
      pdf.setFont(FONT_FAMILY, "normal");
      pdf.setFontSize(14);
      const lines = pdf.splitTextToSize(scene.content, usableWidth);
      pdf.text(lines, margin, margin + 24, { lineHeightFactor: 1.6 });
    }

    pdf.setFontSize(9);
    pdf.setTextColor(120);
    pdf.text(String(scene.sceneNumber), pagePt / 2, pagePt - 24, { align: "center" });
    pdf.setTextColor(0);
  }

  while (pageCount % PAGE_COUNT_MULTIPLE !== 0) {
    pdf.addPage([pagePt, pagePt], "p");
    paintPaper(pdf, pagePt);
    pageCount++;
  }

  return { bytes: pdf.output("arraybuffer"), pageCount };
}

async function buildCoverPdf(input: BuildInput, trimInches: number): Promise<ArrayBuffer> {
  // Lulu wants the cover as a wraparound: back-cover + spine + front-cover,
  // each with bleed on the outer edges. For saddle-stitch (SS binding)
  // the spine is zero — the book is stapled, no spine width to account
  // for. For perfect-bound paperback (PB) Phase 2 will compute spine
  // width from interior page count and paper weight.
  const SPINE_INCHES = 0;
  const widthInches = 2 * (trimInches + BLEED_INCHES) + SPINE_INCHES;
  const heightInches = trimInches + 2 * BLEED_INCHES;
  const widthPt = widthInches * POINTS_PER_INCH;
  const heightPt = heightInches * POINTS_PER_INCH;

  // Cover is wider than tall (back + spine + front + bleed). Pass
  // landscape so jsPDF doesn't normalize the [w, h] format array
  // back to portrait and swap our dimensions.
  const pdf = await newDoc(widthPt, heightPt, "l");
  const { r, g, b } = storyRgbColor(input.story.id);
  // Fill the entire wrap with the story color (back, spine area, front).
  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, widthPt, heightPt, "F");

  // Front cover spans from the centerline (after spine, here zero) out
  // to the inner edge of the right bleed. Center the title inside that
  // visible trim area rather than the half of the full PDF.
  const bleedPt = BLEED_INCHES * POINTS_PER_INCH;
  const frontStart = widthPt / 2 + (SPINE_INCHES * POINTS_PER_INCH) / 2;
  const frontEnd = widthPt - bleedPt;
  const frontCenterX = (frontStart + frontEnd) / 2;
  const frontTextWidth = frontEnd - frontStart - 36; // ~0.25" inside the trim
  pdf.setTextColor(255, 255, 255);
  pdf.setFont(FONT_FAMILY, "bold");
  pdf.setFontSize(40);
  const lines = pdf.splitTextToSize(input.story.title, frontTextWidth);
  pdf.text(lines, frontCenterX, heightPt / 2, { align: "center" });
  return pdf.output("arraybuffer");
}

export async function buildPrintPdfBytes(input: BuildInput): Promise<BuiltBytes> {
  const trim = trimInchesFromSku(input.podPackageId);
  // Interior pages include 0.125" bleed on each edge so the beige paper
  // fill extends past the visible trim. Without bleed, the printer's
  // trim cut can leave a thin white sliver on the edge of every page.
  const pagePt = (trim.width + 2 * BLEED_INCHES) * POINTS_PER_INCH;
  // Both PDFs need the cached fonts; running them concurrently means we
  // share the single font fetch (single-flighted in loadFontData).
  const [interior, coverBytes] = await Promise.all([
    buildInteriorPdf(input, pagePt),
    buildCoverPdf(input, trim.width),
  ]);
  return { coverBytes, interiorBytes: interior.bytes, pageCount: interior.pageCount };
}

/**
 * Upload pre-built PDF bytes to storage in parallel and return the URLs.
 */
export async function storePrintPdfBytes(built: BuiltBytes): Promise<BuildResult> {
  const [coverPdfUrl, interiorPdfUrl] = await Promise.all([
    saveImage(Buffer.from(built.coverBytes).toString("base64"), "application/pdf"),
    saveImage(Buffer.from(built.interiorBytes).toString("base64"), "application/pdf"),
  ]);
  return { coverPdfUrl, interiorPdfUrl, pageCount: built.pageCount };
}

/**
 * Convenience wrapper for callers that don't need to overlap the
 * uploads with anything else.
 */
export async function buildAndStorePrintPdfs(input: BuildInput): Promise<BuildResult> {
  debug.story(`Building print PDFs for "${input.story.title}"`, {
    sceneCount: input.story.scenes.length,
  });
  const built = await buildPrintPdfBytes(input);
  const result = await storePrintPdfBytes(built);
  debug.story("Print PDFs uploaded", { pageCount: result.pageCount });
  return result;
}
