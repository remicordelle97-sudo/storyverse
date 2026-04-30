import { useState, useEffect, useCallback, useRef, forwardRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStory, getStoryStatus, getStoryDebug, regenerateStoryImages } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { jsPDF } from "jspdf";
import HTMLFlipBook from "react-pageflip";
import StoryLoadingScreen, { STORY_IMAGE_PHRASES, STORY_TEXT_PHRASES } from "../components/StoryLoadingScreen";
import PrintModal from "../components/PrintModal";
import { storyHexColor } from "../../shared/storyColor";

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

const CoverPage = forwardRef<HTMLDivElement, { title?: string; color: string; subtitle?: string }>(
  ({ title, color, subtitle }, ref) => (
    <div ref={ref} className="cover-page">
      <div
        className={`${pageInner} flex flex-col items-center justify-center p-8 md:p-12`}
        style={{ background: color }}
      >
        {/* Spine edge */}
        <div className="absolute left-0 top-0 bottom-0 w-4" style={{ background: "rgba(0,0,0,0.2)" }} />
        {/* Subtle texture overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

        {title && (
          <h1
            className="text-3xl md:text-4xl font-bold text-white text-center leading-tight mb-4 relative z-10"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.3)" }}
          >
            {title}
          </h1>
        )}
        {subtitle && (
          <div className="text-white/60 text-sm italic relative z-10">{subtitle}</div>
        )}
      </div>
    </div>
  )
);

const IllustrationPage = forwardRef<HTMLDivElement, { imageUrl?: string; pageNum: number }>(
  ({ imageUrl, pageNum }, ref) => (
    <div ref={ref}>
      <div
        className={`${pageInner} flex items-center justify-center`}
        // Explicit beige backdrop so the image's mix-blend-mode:multiply
        // has a guaranteed parchment color to multiply against, even if
        // react-pageflip's per-frame inline style updates clobber the
        // .stf__item background-color rule.
        style={{ backgroundColor: "#F5ECD7" }}
      >
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
  { content: string; pageNum: number }
>(({ content, pageNum }, ref) => (
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
  const [showDebug, setShowDebug] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const bookRef = useRef<any>(null);

  const queryClient = useQueryClient();

  const { data: story, isLoading } = useQuery({
    queryKey: ["story", storyId],
    queryFn: () => getStory(storyId!),
    enabled: !!storyId,
  });

  // Debug data (admin only, fetched on demand)
  const { data: debugData } = useQuery({
    queryKey: ["story-debug", storyId],
    queryFn: () => getStoryDebug(storyId!),
    enabled: !!storyId && isAdmin && showDebug,
  });

  // Async pipeline status vocabulary. We poll while the story is in
  // any non-terminal state (queued / generating_text / illustrating)
  // and stop polling once it's published or failed.
  const isInProgress =
    story?.status === "queued" ||
    story?.status === "generating_text" ||
    story?.status === "illustrating";
  const isFailed =
    story?.status === "failed_text" || story?.status === "failed_illustration";

  const { data: storyStatus } = useQuery({
    queryKey: ["story-status", storyId],
    queryFn: () => getStoryStatus(storyId!),
    enabled: !!storyId && isInProgress,
    refetchInterval: isInProgress ? 3000 : false,
  });

  // Whenever the polled status is ahead of the cached story (text just
  // landed, or images just finished) refetch the full story so the
  // page-flip view picks up the new content.
  useEffect(() => {
    if (!storyStatus || !story) return;
    const advanced =
      (story.status === "queued" || story.status === "generating_text") &&
      storyStatus.status !== "queued" &&
      storyStatus.status !== "generating_text";
    const finished = storyStatus.status === "published" && story.status !== "published";
    if (advanced || finished) {
      queryClient.invalidateQueries({ queryKey: ["story", storyId] });
    }
  }, [storyStatus?.status, story?.status, storyId, queryClient]);

  const scenes = story?.scenes || [];
  const totalScenes = scenes.length;
  // Text-only stories render one page per scene; illustrated stories render
  // two (one illustration page + one text page).
  const pagesPerScene = story?.hasIllustrations ? 2 : 1;

  // Map book page index to scene index for the progress dots
  // Page 0 is title cover (alone), then scene pages start at page 1
  const sceneIndexFromPage = useCallback(
    (bookPage: number) => {
      if (bookPage < 1) return -1;
      const sceneRelative = bookPage - 1;
      if (sceneRelative >= totalScenes * pagesPerScene) return -1;
      return Math.floor(sceneRelative / pagesPerScene);
    },
    [totalScenes, pagesPerScene]
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

  if (isFailed) {
    const message =
      story.status === "failed_text"
        ? "We couldn't write this story. Try again from the library."
        : "We couldn't illustrate this story. Try regenerating from the library.";
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-stone-300 text-center" style={{ fontFamily: "Lexend, sans-serif" }}>
          {message}
        </p>
        {storyStatus?.job?.lastError && isAdmin && (
          <p className="text-stone-500 text-xs max-w-md text-center font-mono">
            {storyStatus.job.lastError}
          </p>
        )}
        <button
          onClick={() => navigate("/library")}
          className="text-stone-400 hover:text-white text-sm transition-colors"
        >
          Back to Library
        </button>
      </div>
    );
  }

  if (isInProgress) {
    // Pick copy based on which phase we're in. Text-phase steps come
    // out of storyGenerator's onProgress; image-phase progress comes
    // from the per-page save callback.
    const inTextPhase = story.status === "queued" || story.status === "generating_text";
    const phrases = inTextPhase ? STORY_TEXT_PHRASES : STORY_IMAGE_PHRASES;

    let percent: number;
    if (inTextPhase) {
      // Text job: the worker writes a 0–95 ramp into the job row.
      percent = storyStatus?.job?.progressPercent ?? 0;
    } else {
      // Image job: derive from scenes saved.
      const imagesReady = storyStatus?.imagesReady ?? 0;
      const totalImages = storyStatus?.totalPages ?? 0;
      percent = totalImages > 0 ? (imagesReady / totalImages) * 100 : 0;
    }

    return (
      <StoryLoadingScreen
        phrases={phrases}
        title={story.title || undefined}
        progressPercent={percent}
      />
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
      {/* Controls overlay — always visible on mobile, auto-hide on desktop */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "sm:opacity-0 sm:pointer-events-none"
        }`}
      >
        <button
          onClick={() => navigate("/library")}
          className="text-white/60 hover:text-white text-sm transition-colors"
        >
          &times; Close
        </button>
        {currentSceneIndex >= 0 && (
          <div className="flex gap-1.5 sm:gap-2">
            {scenes.map((_: any, i: number) => (
              <div
                key={i}
                className={`w-2 h-2 sm:w-1.5 sm:h-1.5 rounded-full transition-colors ${
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
                setRegenProgress("Queueing...");
                try {
                  // Async now: returns 202 + { jobId }, the worker
                  // flips status back to "illustrating" and the
                  // existing poll above shows progress.
                  await regenerateStoryImages(storyId);
                  // Refetch the story so its status reflects
                  // "illustrating", which kicks the loading view in.
                  await queryClient.invalidateQueries({ queryKey: ["story", storyId] });
                  setRegenProgress("");
                  setRegenerating(false);
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
          {isAdmin && (
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
          )}
          {/* Print on Demand. Hidden until the story has finished
              illustrating — printing a half-rendered book is wasted
              money. Once status is "published" the button shows. */}
          {story?.status === "published" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPrintModal(true);
              }}
              className="text-white/80 hover:text-white text-sm font-semibold transition-colors"
            >
              Print book
            </button>
          )}
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowDebug(!showDebug); }}
              className="text-white/60 hover:text-white text-sm transition-colors"
            >
              {showDebug ? "Hide debug" : "Debug"}
            </button>
          )}
        </div>
      </div>

      {/* Print on Demand modal */}
      {showPrintModal && story && (
        <PrintModal
          storyId={storyId!}
          storyTitle={story.title}
          onClose={() => setShowPrintModal(false)}
        />
      )}

      {/* Debug panel (admin only) */}
      {isAdmin && showDebug && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowDebug(false)} />
          <div className="fixed inset-4 sm:inset-10 z-50 bg-[#1e1e2e] rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h2 className="text-white font-bold text-sm">Story Debug — {story?.title}</h2>
              <button onClick={() => setShowDebug(false)} className="text-white/40 hover:text-white text-sm">&times; Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm font-mono">
              {!debugData ? (
                <p className="text-white/40">Loading debug data...</p>
              ) : !debugData.planPrompt ? (
                <p className="text-white/40">No debug data stored for this story (generated before debug logging was added).</p>
              ) : (
                <>
                  <div>
                    <h3 className="text-amber-400 font-bold mb-1">Metadata</h3>
                    <p className="text-white/60">Structure: <span className="text-white">{debugData.structure}</span></p>
                    <p className="text-white/60">Mood: <span className="text-white">{debugData.mood}</span></p>
                    <p className="text-white/60">Age group: <span className="text-white">{debugData.ageGroup}</span></p>
                  </div>
                  <div>
                    <h3 className="text-amber-400 font-bold mb-1">Plan (generated)</h3>
                    <pre className="text-white/80 whitespace-pre-wrap bg-black/30 rounded-lg p-4 text-xs leading-relaxed">
                      {JSON.stringify(debugData.plan, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-amber-400 font-bold mb-1">Planner System Prompt</h3>
                    <pre className="text-white/80 whitespace-pre-wrap bg-black/30 rounded-lg p-4 text-xs leading-relaxed">
                      {debugData.plannerSystemPrompt}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-amber-400 font-bold mb-1">Plan User Prompt</h3>
                    <pre className="text-white/80 whitespace-pre-wrap bg-black/30 rounded-lg p-4 text-xs leading-relaxed">
                      {debugData.planPrompt}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-amber-400 font-bold mb-1">Writer System Prompt</h3>
                    <pre className="text-white/80 whitespace-pre-wrap bg-black/30 rounded-lg p-4 text-xs leading-relaxed">
                      {debugData.writerSystemPrompt}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-amber-400 font-bold mb-1">Writer User Prompt</h3>
                    <pre className="text-white/80 whitespace-pre-wrap bg-black/30 rounded-lg p-4 text-xs leading-relaxed">
                      {debugData.writePrompt}
                    </pre>
                  </div>
                  {debugData.imagePrompts?.length > 0 && (
                    <div>
                      <h3 className="text-amber-400 font-bold mb-1">Image Prompts (per page)</h3>
                      <div className="space-y-3">
                        {debugData.imagePrompts.map((ip: any) => (
                          <div key={ip.page} className="bg-black/30 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-amber-300 text-xs font-bold">Page {ip.page}</span>
                              {ip.imageUrl && <span className="text-green-400 text-[10px]">has image</span>}
                              {!ip.imageUrl && <span className="text-red-400 text-[10px]">no image</span>}
                            </div>
                            <p className="text-white/80 text-xs leading-relaxed">{ip.prompt || "(empty)"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Book */}
      <div className="flex items-center justify-center w-full px-2 sm:px-4 py-4 sm:py-8" style={{ minHeight: "100vh" }}>
        {/* @ts-ignore - react-pageflip types */}
        <HTMLFlipBook
          ref={bookRef}
          width={480}
          height={620}
          size="stretch"
          minWidth={200}
          maxWidth={560}
          minHeight={240}
          maxHeight={730}
          usePortrait={true}
          drawShadow={true}
          flippingTime={800}
          showCover={true}
          maxShadowOpacity={0.5}
          mobileScrollSupport={false}
          showPageCorners={false}
          onFlip={handleFlip}
          className="book-flip"
          style={{
            filter: "drop-shadow(0 25px 60px rgba(0,0,0,0.6))",
          }}
        >
          {/* Title page (front cover — shown alone) */}
          <CoverPage title={story.title} color={storyHexColor(story.id)} subtitle="A Storyverse tale" />

          {/* Scene pages */}
          {story?.hasIllustrations
            ? scenes.flatMap((scene: any, i: number) => {
                // Illustrated: 2 pages per scene — alternate on desktop,
                // text-first on mobile.
                const firstNum = pageCounter++;
                const secondNum = pageCounter++;
                const isPortrait = window.innerWidth < 400;
                const imageFirst = !isPortrait && i % 2 === 0;
                const illust = (
                  <IllustrationPage
                    key={`illust-${i}`}
                    imageUrl={scene.imageUrl}
                    pageNum={imageFirst ? firstNum : secondNum}
                  />
                );
                const text = (
                  <TextPage
                    key={`text-${i}`}
                    content={scene.content}
                    pageNum={imageFirst ? secondNum : firstNum}
                  />
                );
                return imageFirst ? [illust, text] : [text, illust];
              })
            : scenes.map((scene: any, i: number) => (
                // Text-only: one text page per scene, so each spread shows
                // two scenes of text side by side.
                <TextPage
                  key={`text-${i}`}
                  content={scene.content}
                  pageNum={pageCounter++}
                />
              ))}

          {/* End spread: "The End" on left, buttons on right */}
          <EndPage title={story.title} />
          <BackCoverPage
            onReadAgain={handleReadAgain}
            onBack={() => navigate("/library")}
          />

          {/* Back cover (shown alone, no title) */}
          <CoverPage color={storyHexColor(story.id)} />
        </HTMLFlipBook>
      </div>
    </div>
  );
}
