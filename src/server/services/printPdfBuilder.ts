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

import jsPDF from "jspdf";
import { saveImage } from "../lib/storage.js";
import { storyHexColor } from "../../shared/storyColor.js";
import { debug } from "../lib/debug.js";

const TRIM_INCHES = 8.5;
const POINTS_PER_INCH = 72;
const PAGE_PT = TRIM_INCHES * POINTS_PER_INCH; // 612pt

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

function newSquareDoc(): jsPDF {
  return new jsPDF({ unit: "pt", format: [PAGE_PT, PAGE_PT] });
}

function buildInteriorPdf(input: BuildInput): { bytes: Uint8Array; pageCount: number } {
  const pdf = newSquareDoc();
  const margin = 54; // 0.75"
  const usableWidth = PAGE_PT - margin * 2;

  // Lulu requires a minimum interior page count (24 for paperback).
  // We emit a title page, one page per scene, and pad with blanks
  // until we hit the minimum so the file is always valid.
  const MIN_INTERIOR_PAGES = 24;
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

  const bytes = pdf.output("arraybuffer");
  return { bytes: new Uint8Array(bytes), pageCount };
}

function buildCoverPdf(input: BuildInput, _interiorPageCount: number): Uint8Array {
  // Lulu computes the proper cover wrap dimensions (front + spine + back)
  // during printable_normalization based on the POD package and the
  // interior PDF's page count. For Phase 1 we submit a square cover at
  // the trim size and let Lulu handle the rest. Phase 2 will emit the
  // full cover wrap with spine.
  const pdf = newSquareDoc();
  const hex = storyHexColor(input.story.id);
  const rgb = hexToRgb(hex);
  pdf.setFillColor(rgb.r, rgb.g, rgb.b);
  pdf.rect(0, 0, PAGE_PT, PAGE_PT, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(40);
  const lines = pdf.splitTextToSize(input.story.title, PAGE_PT - 100);
  pdf.text(lines, PAGE_PT / 2, PAGE_PT / 2 - 16, { align: "center" });
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(14);
  pdf.text("A Storyverse tale", PAGE_PT / 2, PAGE_PT / 2 + 36, { align: "center" });
  return new Uint8Array(pdf.output("arraybuffer"));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 200, g: 200, b: 200 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/**
 * Build both PDFs for a story, persist them to storage, and return
 * the public URLs Lulu can fetch from. Phase 1 reuses the existing
 * R2/local storage helper (saveImage) — the function is content-type
 * agnostic, so we pass a base64 PDF blob with mimeType "application/pdf".
 */
export async function buildAndStorePrintPdfs(
  input: BuildInput
): Promise<BuildResult> {
  debug.story(`Building print PDFs for "${input.story.title}"`, {
    sceneCount: input.story.scenes.length,
  });

  const { bytes: interiorBytes, pageCount } = buildInteriorPdf(input);
  const coverBytes = buildCoverPdf(input, pageCount);

  const interiorPdfUrl = await saveImage(
    Buffer.from(interiorBytes).toString("base64"),
    "application/pdf"
  );
  const coverPdfUrl = await saveImage(
    Buffer.from(coverBytes).toString("base64"),
    "application/pdf"
  );

  debug.story("Print PDFs uploaded", {
    pageCount,
    coverPdfUrl,
    interiorPdfUrl,
  });

  return { coverPdfUrl, interiorPdfUrl, pageCount };
}
