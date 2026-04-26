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

function newDoc(widthPt: number, heightPt: number): jsPDF {
  return new jsPDF({ unit: "pt", format: [widthPt, heightPt] });
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

function buildInteriorPdf(
  input: BuildInput,
  pagePt: number
): { bytes: ArrayBuffer; pageCount: number } {
  const pdf = newDoc(pagePt, pagePt);
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
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(13);
      const lines = pdf.splitTextToSize(scene.content, usableWidth);
      pdf.text(lines, margin, textTop, { lineHeightFactor: 1.55 });
    } else {
      // No illustration — text only, vertically centered.
      pdf.setFont("helvetica", "normal");
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

function buildCoverPdf(input: BuildInput, pagePt: number): ArrayBuffer {
  // Lulu computes the cover-wrap geometry (front + spine + back) during
  // printable_normalization from the POD package and the interior page
  // count. Phase 1 just submits a square cover at trim size; Phase 2
  // will produce the full wrap with spine math.
  const pdf = newDoc(pagePt, pagePt);
  const { r, g, b } = storyRgbColor(input.story.id);
  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, pagePt, pagePt, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(40);
  const lines = pdf.splitTextToSize(input.story.title, pagePt - 100);
  pdf.text(lines, pagePt / 2, pagePt / 2, { align: "center" });
  return pdf.output("arraybuffer");
}

export function buildPrintPdfBytes(input: BuildInput): BuiltBytes {
  const trim = trimInchesFromSku(input.podPackageId);
  // Square paperback only for Phase 1 — width and height should match.
  const pagePt = trim.width * POINTS_PER_INCH;
  const interior = buildInteriorPdf(input, pagePt);
  const coverBytes = buildCoverPdf(input, pagePt);
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
  const built = buildPrintPdfBytes(input);
  const result = await storePrintPdfBytes(built);
  debug.story("Print PDFs uploaded", { pageCount: result.pageCount });
  return result;
}
