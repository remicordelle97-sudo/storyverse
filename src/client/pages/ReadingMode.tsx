import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStory, getStoryStatus, regenerateStoryImages } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { jsPDF } from "jspdf";

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
  const borderColor = { r: 212, g: 197, b: 160 };     // #D4C5A0

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

type View = "title" | "page" | "end";

export default function ReadingMode() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [pageIndex, setPageIndex] = useState(0);
  const [view, setView] = useState<View>("title");
  const [transitioning, setTransitioning] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsTimer, setControlsTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState("");
  const [flipping, setFlipping] = useState(false);
  const [flipDirection, setFlipDirection] = useState<"forward" | "back">("forward");
  // Track previous state so we can show old content on the flipping page
  const [prevView, setPrevView] = useState<View>("title");
  const [prevPageIndex, setPrevPageIndex] = useState(0);

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

  const pages = story?.scenes || [];
  const totalPages = pages.length;

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer) clearTimeout(controlsTimer);
    const timer = setTimeout(() => setControlsVisible(false), 3000);
    setControlsTimer(timer);
  }, [controlsTimer]);

  // Hide controls after inactivity
  useEffect(() => {
    if (view !== "page") {
      setControlsVisible(true);
      return;
    }
    const timer = setTimeout(() => setControlsVisible(false), 3000);
    setControlsTimer(timer);
    return () => clearTimeout(timer);
  }, [view]);

  const goTo = useCallback(
    (newView: View, newIndex: number, dir: "forward" | "back") => {
      if (transitioning) return;
      setDirection(dir);
      setFlipDirection(dir);
      setPrevView(view);
      setPrevPageIndex(pageIndex);
      setFlipping(true);
      setTransitioning(true);
      // Update content immediately — the old content is preserved via prevView/prevPageIndex
      // on the flipping overlay, so the swap underneath is hidden
      setView(newView);
      setPageIndex(newIndex);
      // End animation after flip completes
      setTimeout(() => {
        setFlipping(false);
        setTransitioning(false);
      }, 500);
    },
    [transitioning, view, pageIndex]
  );

  const goForward = useCallback(() => {
    if (view === "title") {
      goTo("page", 0, "forward");
    } else if (view === "page" && pageIndex < totalPages - 1) {
      goTo("page", pageIndex + 1, "forward");
    } else if (view === "page" && pageIndex === totalPages - 1) {
      goTo("end", pageIndex, "forward");
    }
  }, [view, pageIndex, totalPages, goTo]);

  const goBack = useCallback(() => {
    if (view === "page" && pageIndex > 0) {
      goTo("page", pageIndex - 1, "back");
    } else if (view === "page" && pageIndex === 0) {
      goTo("title", 0, "back");
    } else if (view === "end") {
      goTo("page", totalPages - 1, "back");
    }
  }, [view, pageIndex, totalPages, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goForward();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.key === "Escape") {
        navigate("/library");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goForward, goBack, navigate]);

  // Touch swipe
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
        if (dx < 0) goForward();
        else goBack();
      }
    };
    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [goForward, goBack]);

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

  if (pages.length === 0) {
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

  const page = pages[pageIndex];

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
        {view === "page" && (
          <div className="flex gap-1.5">
            {pages.map((_: any, i: number) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === pageIndex ? "bg-white" : "bg-white/20"
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

      {/* Tap zones */}
      {view === "page" && (
        <>
          <div
            className="fixed left-0 top-0 w-1/3 h-full z-40 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); goBack(); }}
          />
          <div
            className="fixed right-0 top-0 w-2/3 h-full z-40 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); goForward(); }}
          />
        </>
      )}

      {/* Book container with perspective for 3D flip */}
      <div
        className="flex items-center justify-center px-4 py-8 w-full"
        style={{ minHeight: "100vh" }}
        onClick={view === "title" ? goForward : undefined}
      >
        <div
          className="relative w-full max-w-7xl mx-auto"
          style={{
            perspective: "2500px",
            filter: "drop-shadow(0 30px 70px rgba(0,0,0,0.5))",
          }}
        >
          {/* Flip overlay — animates a page turning over the book spread */}
          {flipping && (
            <div
              className="absolute inset-0 z-30 pointer-events-none"
              style={{ perspective: "2500px" }}
            >
              {/* Shadow cast on the page beneath during flip */}
              <div
                className={`absolute top-0 ${flipDirection === "forward" ? "left-1/2" : "left-0"} w-1/2 h-full`}
                style={{
                  background: "rgba(0,0,0,0.08)",
                  animation: `flipShadow 500ms ease-in-out forwards`,
                }}
              />
              <div
                className={`absolute ${flipDirection === "forward" ? "right-0" : "left-0"} top-0 w-1/2 h-full`}
                style={{
                  transformStyle: "preserve-3d",
                  transformOrigin: flipDirection === "forward" ? "left center" : "right center",
                  animation: `pageFlip${flipDirection === "forward" ? "Forward" : "Back"} 500ms cubic-bezier(0.4, 0.0, 0.2, 1) forwards`,
                }}
              >
                {/* Front face — the old page being lifted */}
                <div
                  className="absolute inset-0"
                  style={{
                    backfaceVisibility: "hidden",
                    background: flipDirection === "forward"
                      ? "linear-gradient(to left, #E0D6B8, #F5ECD7 20%)"
                      : "linear-gradient(to right, #E0D6B8, #F5ECD7 20%)",
                    borderRadius: flipDirection === "forward" ? "0 8px 8px 0" : "8px 0 0 8px",
                  }}
                />
                {/* Back face — the underside of the turning page */}
                <div
                  className="absolute inset-0"
                  style={{
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    background: flipDirection === "forward"
                      ? "linear-gradient(to right, #DDD3B8, #EDE3C8 20%)"
                      : "linear-gradient(to left, #DDD3B8, #EDE3C8 20%)",
                    borderRadius: flipDirection === "forward" ? "8px 0 0 8px" : "0 8px 8px 0",
                  }}
                />
              </div>
            </div>
          )}

          {/* Book spread */}
          <div
            className="flex flex-col md:flex-row"
            style={{ minHeight: "min(85vh, 700px)" }}
          >
            {/* Render current view */}
            {view === "title" && (
              <>
                {/* Left page — title */}
                <div
                  className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 relative rounded-l-lg cursor-pointer"
                  style={{
                    background: "linear-gradient(to right, #EDE3C8, #F5ECD7)",
                    transform: "rotateY(1deg)",
                    transformOrigin: "right center",
                    boxShadow: "inset -20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  <h1 className="text-3xl md:text-5xl font-bold text-stone-800 text-center leading-tight mb-4">
                    {story.title}
                  </h1>
                </div>

                {/* Spine */}
                <div
                  className="hidden md:block w-[4px] relative z-20 flex-shrink-0"
                  style={{
                    background: "linear-gradient(to bottom, #B8A878, #96845C, #B8A878)",
                    boxShadow: "-3px 0 12px rgba(0,0,0,0.15), 3px 0 12px rgba(0,0,0,0.15)",
                  }}
                />

                {/* Right page */}
                <div
                  className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 rounded-r-lg cursor-pointer"
                  style={{
                    background: "linear-gradient(to left, #EDE3C8, #F5ECD7)",
                    transform: "rotateY(-1deg)",
                    transformOrigin: "left center",
                    boxShadow: "inset 20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="text-stone-400 text-sm italic mb-6">A Storyverse tale</div>
                  <p className="text-stone-400 text-xs animate-pulse">Tap to begin</p>
                </div>
              </>
            )}

            {view === "page" && page && (() => {
              const imageOnLeft = pageIndex % 2 === 0;

              const illustrationPage = (
                <div
                  className={`flex-1 relative flex items-center justify-center ${imageOnLeft ? "rounded-l-lg" : "rounded-r-lg"}`}
                  style={{
                    background: imageOnLeft
                      ? "linear-gradient(to right, #EDE3C8, #F5ECD7)"
                      : "linear-gradient(to left, #EDE3C8, #F5ECD7)",
                    transform: imageOnLeft ? "rotateY(1deg)" : "rotateY(-1deg)",
                    transformOrigin: imageOnLeft ? "right center" : "left center",
                    boxShadow: imageOnLeft
                      ? "inset -20px 0 30px -15px rgba(0,0,0,0.08)"
                      : "inset 20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  {page.imageUrl ? (
                    <img
                      src={page.imageUrl}
                      alt={`Illustration for page ${pageIndex + 1}`}
                      className={`w-full h-full object-contain ${imageOnLeft ? "rounded-l-lg" : "rounded-r-lg"}`}
                      style={{
                        minHeight: "min(85vh, 700px)",
                        mixBlendMode: "multiply",
                        filter: "brightness(1.08)",
                      }}
                      draggable={false}
                    />
                  ) : (
                    <div
                      className="w-full flex items-center justify-center"
                      style={{
                        minHeight: "min(85vh, 700px)",
                        background: "linear-gradient(135deg, #E8DFC8, #DDD3B8)",
                      }}
                    >
                      <div className="text-stone-400/40 text-sm">Illustration</div>
                    </div>
                  )}
                  <div className="absolute bottom-3 left-0 right-0 text-center">
                    <span className="text-stone-500/50 text-xs">
                      {imageOnLeft ? pageIndex * 2 + 1 : pageIndex * 2 + 2}
                    </span>
                  </div>
                </div>
              );

              const textPage = (
                <div
                  className={`flex-1 flex flex-col justify-between relative ${imageOnLeft ? "rounded-r-lg" : "rounded-l-lg"}`}
                  style={{
                    background: imageOnLeft
                      ? "linear-gradient(to left, #EDE3C8, #F5ECD7)"
                      : "linear-gradient(to right, #EDE3C8, #F5ECD7)",
                    minHeight: "min(85vh, 700px)",
                    transform: imageOnLeft ? "rotateY(-1deg)" : "rotateY(1deg)",
                    transformOrigin: imageOnLeft ? "left center" : "right center",
                    boxShadow: imageOnLeft
                      ? "inset 20px 0 30px -15px rgba(0,0,0,0.08)"
                      : "inset -20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex-1 flex items-center px-8 md:px-12 py-8 md:py-10">
                    <p
                      className="text-stone-800 leading-[1.85] tracking-wide text-left"
                      style={{
                        fontSize: "clamp(1rem, 1.8vw + 0.4rem, 1.4rem)",
                        wordSpacing: "0.05em",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {page.content}
                    </p>
                  </div>
                  <div className="text-center pb-3">
                    <span className="text-stone-500/50 text-xs">
                      {imageOnLeft ? pageIndex * 2 + 2 : pageIndex * 2 + 1}
                    </span>
                  </div>
                  <div className="absolute top-3 right-4">
                    <span className="text-stone-400/40 text-[10px]">
                      {pageIndex + 1} of {totalPages}
                    </span>
                  </div>
                </div>
              );

              return (
                <>
                  {imageOnLeft ? illustrationPage : textPage}
                  <div
                    className="hidden md:block w-[4px] relative z-20 flex-shrink-0"
                    style={{
                      background: "linear-gradient(to bottom, #B8A878, #96845C, #B8A878)",
                      boxShadow: "-3px 0 12px rgba(0,0,0,0.15), 3px 0 12px rgba(0,0,0,0.15)",
                    }}
                  />
                  {imageOnLeft ? textPage : illustrationPage}
                </>
              );
            })()}

            {view === "end" && (
              <>
                <div
                  className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 rounded-l-lg"
                  style={{
                    background: "linear-gradient(to right, #EDE3C8, #F5ECD7)",
                    transform: "rotateY(1deg)",
                    transformOrigin: "right center",
                    boxShadow: "inset -20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  <p className="text-stone-800 text-4xl md:text-5xl font-light italic">
                    The End
                  </p>
                  <p className="text-stone-500 text-sm mt-3">{story.title}</p>
                </div>
                <div
                  className="hidden md:block w-[4px] relative z-20 flex-shrink-0"
                  style={{
                    background: "linear-gradient(to bottom, #B8A878, #96845C, #B8A878)",
                    boxShadow: "-3px 0 12px rgba(0,0,0,0.15), 3px 0 12px rgba(0,0,0,0.15)",
                  }}
                />
                <div
                  className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 rounded-r-lg"
                  style={{
                    background: "linear-gradient(to left, #EDE3C8, #F5ECD7)",
                    transform: "rotateY(-1deg)",
                    transformOrigin: "left center",
                    boxShadow: "inset 20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex flex-col gap-4 items-center">
                    <button
                      onClick={() => { setView("title"); setPageIndex(0); }}
                      className="px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors"
                    >
                      Read again
                    </button>
                    <button
                      onClick={() => navigate("/library")}
                      className="px-6 py-3 text-stone-500 hover:text-stone-800 transition-colors"
                    >
                      Back to library
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Page flip keyframe animations */}
      <style>{`
        @keyframes pageFlipForward {
          0% {
            transform: rotateY(0deg);
            box-shadow: -5px 0 15px rgba(0,0,0,0.1);
          }
          40% {
            box-shadow: -15px 0 40px rgba(0,0,0,0.25);
          }
          100% {
            transform: rotateY(-180deg);
            box-shadow: 0 0 5px rgba(0,0,0,0.05);
          }
        }
        @keyframes pageFlipBack {
          0% {
            transform: rotateY(0deg);
            box-shadow: 5px 0 15px rgba(0,0,0,0.1);
          }
          40% {
            box-shadow: 15px 0 40px rgba(0,0,0,0.25);
          }
          100% {
            transform: rotateY(180deg);
            box-shadow: 0 0 5px rgba(0,0,0,0.05);
          }
        }
        @keyframes flipShadow {
          0% { opacity: 0; }
          40% { opacity: 1; }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes pageFlipForward {
            0% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes pageFlipBack {
            0% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes flipShadow {
            0% { opacity: 0; }
            100% { opacity: 0; }
          }
        }
      `}</style>
    </div>
  );
}
