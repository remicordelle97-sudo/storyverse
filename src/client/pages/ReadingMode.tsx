import { useState, useEffect, useCallback, useRef, forwardRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStory, getStoryStatus, regenerateStoryImages } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { jsPDF } from "jspdf";
import HTMLFlipBook from "react-pageflip";

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function exportStoryAsPdf(story: any) {
  const pages = story.scenes || [];
  // Landscape A4: 297 x 210 mm
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = 297;
  const pageH = 210;
  const halfW = pageW / 2;
  const spineX = halfW;

  // Colors matching the UI
  const parchment = { r: 245, g: 236, b: 215 };      // #F5ECD7
  const parchmentDark = { r: 237, g: 227, b: 200 };   // #EDE3C8
  const spineColor = { r: 184, g: 168, b: 120 };      // #B8A878
  const darkText = { r: 60, g: 50, b: 40 };
  const mediumText = { r: 140, g: 130, b: 120 };
  const lightText = { r: 160, g: 150, b: 140 };

  // Helper: draw parchment page background with edge shadow near spine
  function drawPageBg(x: number, w: number, isLeftPage: boolean) {
    // Base parchment
    pdf.setFillColor(parchment.r, parchment.g, parchment.b);
    pdf.rect(x, 0, w, pageH, "F");

    // Edge shadow near spine (darker strip)
    const shadowW = 8;
    if (isLeftPage) {
      pdf.setFillColor(parchmentDark.r, parchmentDark.g, parchmentDark.b);
      pdf.rect(x + w - shadowW, 0, shadowW, pageH, "F");
    } else {
      pdf.setFillColor(parchmentDark.r, parchmentDark.g, parchmentDark.b);
      pdf.rect(x, 0, shadowW, pageH, "F");
    }
  }

  // Helper: draw the spine
  function drawSpine() {
    pdf.setDrawColor(spineColor.r, spineColor.g, spineColor.b);
    pdf.setLineWidth(1);
    pdf.line(spineX, 0, spineX, pageH);
    // Second lighter line for depth
    pdf.setDrawColor(parchmentDark.r, parchmentDark.g, parchmentDark.b);
    pdf.setLineWidth(0.3);
    pdf.line(spineX - 1.5, 0, spineX - 1.5, pageH);
    pdf.line(spineX + 1.5, 0, spineX + 1.5, pageH);
  }

  // -- Title page --
  drawPageBg(0, halfW, true);
  drawPageBg(halfW, halfW, false);
  drawSpine();

  // Title text (left page, centered)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(28);
  pdf.setTextColor(darkText.r, darkText.g, darkText.b);
  const titleLines = pdf.splitTextToSize(story.title, halfW - 50);
  const titleBlockH = titleLines.length * 12;
  const titleY = pageH / 2 - titleBlockH / 2;
  pdf.text(titleLines, halfW / 2, titleY, { align: "center" });

  // Right page — "A Storyverse tale"
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(11);
  pdf.setTextColor(lightText.r, lightText.g, lightText.b);
  pdf.text("A Storyverse tale", halfW + halfW / 2, pageH / 2, { align: "center" });

  // -- Story pages --
  for (let i = 0; i < pages.length; i++) {
    const scene = pages[i];
    pdf.addPage([pageW, pageH], "landscape");

    const imageOnLeft = i % 2 === 0;

    // Draw both page backgrounds
    drawPageBg(0, halfW, true);
    drawPageBg(halfW, halfW, false);
    drawSpine();

    // Illustration
    const imgPageX = imageOnLeft ? 0 : halfW;
    if (scene.imageUrl) {
      const dataUrl = await loadImageAsDataUrl(scene.imageUrl);
      if (dataUrl) {
        try {
          const availW = halfW;
          const availH = pageH;
          const imgRatio = 4 / 3;
          let imgW = availW;
          let imgH = imgW / imgRatio;
          if (imgH > availH) {
            imgH = availH;
            imgW = imgH * imgRatio;
          }
          const imgX = imgPageX + (availW - imgW) / 2;
          const imgY = (availH - imgH) / 2;
          pdf.addImage(dataUrl, "JPEG", imgX, imgY, imgW, imgH);
        } catch {
          // skip
        }
      }
    }

    // Text
    const textPageX = imageOnLeft ? halfW : 0;
    const textMargin = 14;
    const textX = textPageX + textMargin;
    const textW = halfW - textMargin * 2;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(13);
    pdf.setTextColor(darkText.r, darkText.g, darkText.b);
    const textLines = pdf.splitTextToSize(scene.content, textW);
    // Vertically center the text block
    const lineH = 6.5;
    const textBlockH = textLines.length * lineH;
    const textY = Math.max(20, (pageH - textBlockH) / 2);
    pdf.text(textLines, textX, textY, { lineHeightFactor: 1.8 });

    // Page numbers
    pdf.setFontSize(8);
    pdf.setTextColor(lightText.r, lightText.g, lightText.b);
    const leftPageNum = i * 2 + (imageOnLeft ? 1 : 2);
    const rightPageNum = i * 2 + (imageOnLeft ? 2 : 1);
    pdf.text(String(leftPageNum), halfW / 2, pageH - 6, { align: "center" });
    pdf.text(String(rightPageNum), halfW + halfW / 2, pageH - 6, { align: "center" });

    // Scene counter (top right)
    pdf.setFontSize(7);
    pdf.setTextColor(lightText.r, lightText.g, lightText.b);
    pdf.text(`${i + 1} of ${pages.length}`, pageW - 8, 7, { align: "right" });
  }

  // -- End page --
  pdf.addPage([pageW, pageH], "landscape");
  drawPageBg(0, halfW, true);
  drawPageBg(halfW, halfW, false);
  drawSpine();

  // "The End" on left page
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(32);
  pdf.setTextColor(darkText.r, darkText.g, darkText.b);
  pdf.text("The End", halfW / 2, pageH / 2, { align: "center" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(mediumText.r, mediumText.g, mediumText.b);
  pdf.text(story.title, halfW / 2, pageH / 2 + 14, { align: "center" });

  // Save
  const safeName = story.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase();
  pdf.save(`${safeName}.pdf`);
}

// --- Book pages as forwardRef components ---

// The library adds .stf__item to the ref'd div and overwrites ALL inline styles
// via style.cssText. It also sets display:block, overriding Tailwind flex classes.
// Solution: keep the outer ref'd div bare. Put all layout in an inner wrapper
// with absolute positioning to fill the page.

const pageInner = "absolute inset-0 overflow-hidden";

const TitlePage = forwardRef<HTMLDivElement, { title: string }>(({ title }, ref) => (
  <div ref={ref}>
    <div className={`${pageInner} flex flex-col items-center justify-center p-8 md:p-12`}>
      <h1 className="text-3xl md:text-5xl font-bold text-stone-800 text-center leading-tight mb-4">
        {title}
      </h1>
      <div className="text-stone-400 text-sm italic">A Storyverse tale</div>
    </div>
  </div>
));

const IllustrationPage = forwardRef<HTMLDivElement, { imageUrl?: string; pageNum: number }>(
  ({ imageUrl, pageNum }, ref) => (
    <div ref={ref}>
      <div className={`${pageInner} flex items-center justify-center`}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Illustration for page ${pageNum}`}
            className="w-full h-full object-contain"
            style={{
              mixBlendMode: "multiply",
              filter: "brightness(1.08)",
            }}
            draggable={false}
          />
        ) : (
          <div className="text-stone-400/40 text-sm">Illustration</div>
        )}
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="text-stone-500/50 text-xs">{pageNum}</span>
        </div>
      </div>
    </div>
  )
);

const TextPage = forwardRef<
  HTMLDivElement,
  { content: string; pageNum: number; sceneIndex: number; totalScenes: number }
>(({ content, pageNum, sceneIndex, totalScenes }, ref) => (
  <div ref={ref}>
    <div className={`${pageInner} flex flex-col justify-between`}>
      <div className="flex-1 flex items-center px-8 md:px-12 py-8 md:py-10">
        <p
          className="text-stone-800 leading-[1.85] tracking-wide text-left"
          style={{
            fontSize: "clamp(1rem, 1.8vw + 0.4rem, 1.4rem)",
            wordSpacing: "0.05em",
            letterSpacing: "0.02em",
          }}
        >
          {content}
        </p>
      </div>
      <div className="text-center pb-3">
        <span className="text-stone-500/50 text-xs">{pageNum}</span>
      </div>
      <div className="absolute top-3 right-4">
        <span className="text-stone-400/40 text-[10px]">
          {sceneIndex + 1} of {totalScenes}
        </span>
      </div>
    </div>
  </div>
));

const EndPage = forwardRef<HTMLDivElement, { title: string }>(({ title }, ref) => (
  <div ref={ref}>
    <div className={`${pageInner} flex flex-col items-center justify-center p-8 md:p-12`}>
      <p className="text-stone-800 text-4xl md:text-5xl font-light italic">The End</p>
      <p className="text-stone-500 text-sm mt-3">{title}</p>
    </div>
  </div>
));

const BackCoverPage = forwardRef<
  HTMLDivElement,
  { onReadAgain: () => void; onBack: () => void }
>(({ onReadAgain, onBack }, ref) => (
  <div ref={ref}>
    <div className={`${pageInner} flex flex-col items-center justify-center p-8 md:p-12`}>
      <div className="flex flex-col gap-4 items-center">
        <button
          onClick={onReadAgain}
          className="px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors"
        >
          Read again
        </button>
        <button
          onClick={onBack}
          className="px-6 py-3 text-stone-500 hover:text-stone-800 transition-colors"
        >
          Back to library
        </button>
      </div>
    </div>
  </div>
));

export default function ReadingMode() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [currentPage, setCurrentPage] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsTimer, setControlsTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState("");
  const bookRef = useRef<any>(null);

  const queryClient = useQueryClient();

  const { data: story, isLoading } = useQuery({
    queryKey: ["story", storyId],
    queryFn: () => getStory(storyId!),
    enabled: !!storyId,
  });

  // Poll for image generation status when story is illustrating
  const isIllustrating = story?.status === "illustrating";
  const { data: storyStatus } = useQuery({
    queryKey: ["story-status", storyId],
    queryFn: () => getStoryStatus(storyId!),
    enabled: !!storyId && isIllustrating,
    refetchInterval: isIllustrating ? 5000 : false,
  });

  // When status changes to published, refetch the full story to get image URLs
  useEffect(() => {
    if (storyStatus?.status === "published" && isIllustrating) {
      queryClient.invalidateQueries({ queryKey: ["story", storyId] });
    }
  }, [storyStatus?.status, isIllustrating, storyId, queryClient]);

  const scenes = story?.scenes || [];
  const totalScenes = scenes.length;

  // Total book pages: front cover + (2 per scene) + end + buttons + back cover
  const totalBookPages = 1 + totalScenes * 2 + 3;

  // Map book page index to scene index for the progress dots
  // Page 0 is title cover (alone), then scene pages start at page 1
  const sceneIndexFromPage = useCallback(
    (bookPage: number) => {
      if (bookPage < 1) return -1;
      const sceneRelative = bookPage - 1;
      if (sceneRelative >= totalScenes * 2) return -1;
      return Math.floor(sceneRelative / 2);
    },
    [totalScenes]
  );

  const currentSceneIndex = sceneIndexFromPage(currentPage);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer) clearTimeout(controlsTimer);
    const timer = setTimeout(() => setControlsVisible(false), 3000);
    setControlsTimer(timer);
  }, [controlsTimer]);

  // Hide controls after inactivity
  useEffect(() => {
    const timer = setTimeout(() => setControlsVisible(false), 3000);
    setControlsTimer(timer);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        bookRef.current?.pageFlip()?.flipNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        bookRef.current?.pageFlip()?.flipPrev();
      } else if (e.key === "Escape") {
        navigate("/library");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [navigate]);

  const handleFlip = useCallback((e: any) => {
    setCurrentPage(e.data);
  }, []);

  const handleReadAgain = useCallback(() => {
    bookRef.current?.pageFlip()?.flip(0);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <p className="text-stone-400" style={{ fontFamily: "Lexend, sans-serif" }}>
          Loading story...
        </p>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <p className="text-stone-400" style={{ fontFamily: "Lexend, sans-serif" }}>
          Story not found
        </p>
      </div>
    );
  }

  if (isIllustrating) {
    const imagesReady = storyStatus?.imagesReady || 0;
    const totalImages = storyStatus?.totalPages || 0;
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center gap-6">
        <div className="text-center" style={{ fontFamily: "Lexend, sans-serif" }}>
          <h2 className="text-white text-xl font-bold mb-2">{story.title}</h2>
          <p className="text-stone-400 text-sm mb-4">
            Creating illustrations...
          </p>
          <p className="text-stone-500 text-xs">
            {imagesReady} of {totalImages} illustrations ready
          </p>
        </div>
        {/* Progress bar */}
        <div className="w-64 h-2 bg-stone-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500"
            style={{ width: totalImages > 0 ? `${(imagesReady / totalImages) * 100}%` : "0%" }}
          />
        </div>
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center gap-4">
        <p className="text-stone-400" style={{ fontFamily: "Lexend, sans-serif" }}>
          This story has no pages yet
        </p>
        <button
          onClick={() => navigate("/library")}
          className="text-stone-500 hover:text-white text-sm transition-colors"
        >
          Back to Library
        </button>
      </div>
    );
  }

  // Build page number labels: title pages don't get numbers,
  // then scene pages are numbered sequentially
  let pageCounter = 1;

  return (
    <div
      className="min-h-screen bg-[#1a1a2e] flex items-center justify-center select-none overflow-hidden"
      onMouseMove={showControls}
      onClick={showControls}
      style={{ fontFamily: "Lexend, sans-serif" }}
    >
      {/* Controls overlay */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={() => navigate("/library")}
          className="text-white/60 hover:text-white text-sm transition-colors"
        >
          &times; Close
        </button>
        {currentSceneIndex >= 0 && (
          <div className="flex gap-1.5">
            {scenes.map((_: any, i: number) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === currentSceneIndex ? "bg-white" : "bg-white/20"
                }`}
              />
            ))}
          </div>
        )}
        <div className="flex gap-4">
          {isAdmin && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (regenerating || !storyId) return;
                setRegenerating(true);
                setRegenProgress("Starting...");
                try {
                  await regenerateStoryImages(storyId, (_step, detail) => {
                    setRegenProgress(detail || "Generating...");
                  });
                  window.location.reload();
                } catch (err) {
                  console.error("Regeneration failed:", err);
                  setRegenProgress("");
                  setRegenerating(false);
                }
              }}
              disabled={regenerating}
              className="text-white/60 hover:text-white text-sm transition-colors disabled:opacity-40"
            >
              {regenerating ? regenProgress : "Regen images"}
            </button>
          )}
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (exporting || !story) return;
              setExporting(true);
              try {
                await exportStoryAsPdf(story);
              } catch (err) {
                console.error("PDF export failed:", err);
              }
              setExporting(false);
            }}
            disabled={exporting}
            className="text-white/60 hover:text-white text-sm transition-colors disabled:opacity-40"
          >
            {exporting ? "Saving..." : "Save PDF"}
          </button>
        </div>
      </div>

      {/* Book */}
      <div className="flex items-center justify-center w-full px-4 py-8" style={{ minHeight: "100vh" }}>
        {/* @ts-ignore - react-pageflip types */}
        <HTMLFlipBook
          ref={bookRef}
          width={500}
          height={650}
          size="stretch"
          minWidth={280}
          maxWidth={550}
          minHeight={360}
          maxHeight={720}
          drawShadow={true}
          flippingTime={800}
          showCover={true}
          maxShadowOpacity={0.5}
          mobileScrollSupport={false}
          onFlip={handleFlip}
          className="book-flip"
          style={{
            filter: "drop-shadow(0 25px 60px rgba(0,0,0,0.6))",
          }}
        >
          {/* Title page (front cover — shown alone) */}
          <TitlePage title={story.title} />

          {/* Scene pages: alternate image left/right per scene */}
          {scenes.flatMap((scene: any, i: number) => {
            const imageOnLeft = i % 2 === 0;
            const firstNum = pageCounter++;
            const secondNum = pageCounter++;
            const illust = (
              <IllustrationPage
                key={`illust-${i}`}
                imageUrl={scene.imageUrl}
                pageNum={imageOnLeft ? firstNum : secondNum}
              />
            );
            const text = (
              <TextPage
                key={`text-${i}`}
                content={scene.content}
                pageNum={imageOnLeft ? secondNum : firstNum}
                sceneIndex={i}
                totalScenes={totalScenes}
              />
            );
            return imageOnLeft ? [illust, text] : [text, illust];
          })}

          {/* End spread: "The End" on left, buttons on right */}
          <EndPage title={story.title} />
          <BackCoverPage
            onReadAgain={handleReadAgain}
            onBack={() => navigate("/library")}
          />

          {/* Back cover (shown alone, mirrors the front cover) */}
          <TitlePage title={story.title} />
        </HTMLFlipBook>
      </div>
    </div>
  );
}
