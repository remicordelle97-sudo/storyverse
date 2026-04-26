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

const TRIM_INCHES = 8.5;
const POINTS_PER_INCH = 72;
const PAGE_PT = TRIM_INCHES * POINTS_PER_INCH; // 612pt
const MIN_INTERIOR_PAGES = 24; // Lulu's paperback minimum

interface BuildInput {
  story: {
    id: string;
    title: string;
    scenes: { sceneNumber: number; content: string }[];
  };
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

function newSquareDoc(): jsPDF {
  return new jsPDF({ unit: "pt", format: [PAGE_PT, PAGE_PT] });
}

function buildInteriorPdf(input: BuildInput): { bytes: ArrayBuffer; pageCount: number } {
  const pdf = newSquareDoc();
  const margin = 54; // 0.75"
  const usableWidth = PAGE_PT - margin * 2;

  let pageCount = 0;

  // Title page
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(36);
  const titleLines = pdf.splitTextToSize(input.story.title, usableWidth);
  pdf.text(titleLines, PAGE_PT / 2, PAGE_PT / 2 - 12, { align: "center" });
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(13);
  pdf.text("A Storyverse tale", PAGE_PT / 2, PAGE_PT / 2 + 24, { align: "center" });
  pageCount++;

  // One scene per interior page (Phase 2 will adapt the 2-up book layout).
  for (const scene of input.story.scenes) {
    pdf.addPage([PAGE_PT, PAGE_PT], "p");
    pageCount++;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(14);
    const lines = pdf.splitTextToSize(scene.content, usableWidth);
    pdf.text(lines, margin, margin + 24, { lineHeightFactor: 1.6 });
    pdf.setFontSize(9);
    pdf.text(String(scene.sceneNumber), PAGE_PT / 2, PAGE_PT - 24, {
      align: "center",
    });
  }

  while (pageCount < MIN_INTERIOR_PAGES) {
    pdf.addPage([PAGE_PT, PAGE_PT], "p");
    pageCount++;
  }

  return { bytes: pdf.output("arraybuffer"), pageCount };
}

function buildCoverPdf(input: BuildInput): ArrayBuffer {
  // Lulu computes the cover-wrap geometry (front + spine + back) during
  // printable_normalization from the POD package and the interior page
  // count. Phase 1 just submits a square cover at trim size; Phase 2
  // will produce the full wrap with spine math.
  const pdf = newSquareDoc();
  const { r, g, b } = storyRgbColor(input.story.id);
  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, PAGE_PT, PAGE_PT, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(40);
  const lines = pdf.splitTextToSize(input.story.title, PAGE_PT - 100);
  pdf.text(lines, PAGE_PT / 2, PAGE_PT / 2 - 16, { align: "center" });
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(14);
  pdf.text("A Storyverse tale", PAGE_PT / 2, PAGE_PT / 2 + 36, { align: "center" });
  return pdf.output("arraybuffer");
}

/**
 * Build the cover + interior PDF bytes synchronously. Exposed so the
 * caller can run the (slow) Lulu cost quote in parallel with the
 * (slow) PDF uploads.
 */
export function buildPrintPdfBytes(input: BuildInput): BuiltBytes {
  const interior = buildInteriorPdf(input);
  const coverBytes = buildCoverPdf(input);
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
