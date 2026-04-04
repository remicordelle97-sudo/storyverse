import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory, regenerateStoryImages } from "../api/client";
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

  // -- Title page --
  pdf.setFillColor(245, 236, 215); // parchment
  pdf.rect(0, 0, pageW, pageH, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(28);
  pdf.setTextColor(60, 50, 40);
  const titleLines = pdf.splitTextToSize(story.title, halfW - 30);
  const titleY = pageH / 2 - (titleLines.length * 12) / 2;
  pdf.text(titleLines, halfW / 2, titleY, { align: "center" });

  if (story.characters?.length > 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    pdf.setTextColor(140, 130, 120);
    const names = story.characters.map((sc: any) => sc.character.name).join(" & ");
    pdf.text(`featuring ${names}`, halfW / 2, titleY + titleLines.length * 12 + 8, { align: "center" });
  }

  // Right side of title page
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(11);
  pdf.setTextColor(160, 150, 140);
  pdf.text("A Storyverse tale", halfW + halfW / 2, pageH / 2, { align: "center" });

  // Spine line
  pdf.setDrawColor(196, 180, 138);
  pdf.setLineWidth(0.5);
  pdf.line(halfW, 0, halfW, pageH);

  // -- Story pages --
  for (let i = 0; i < pages.length; i++) {
    const scene = pages[i];
    pdf.addPage([pageW, pageH], "landscape");

    // Background
    pdf.setFillColor(245, 236, 215);
    pdf.rect(0, 0, pageW, pageH, "F");

    // Left side: illustration
    if (scene.imageUrl) {
      const dataUrl = await loadImageAsDataUrl(scene.imageUrl);
      if (dataUrl) {
        try {
          // Fit image within left page while preserving 4:3 aspect ratio
          const availW = halfW - 4;
          const availH = pageH - 4;
          const imgRatio = 4 / 3;
          let imgW = availW;
          let imgH = imgW / imgRatio;
          if (imgH > availH) {
            imgH = availH;
            imgW = imgH * imgRatio;
          }
          const imgX = 2 + (availW - imgW) / 2;
          const imgY = 2 + (availH - imgH) / 2;
          pdf.addImage(dataUrl, "JPEG", imgX, imgY, imgW, imgH);
        } catch {
          // Image failed to load, skip
        }
      }
    }

    // Spine
    pdf.setDrawColor(196, 180, 138);
    pdf.setLineWidth(0.5);
    pdf.line(halfW, 0, halfW, pageH);

    // Right side: text
    const textX = halfW + 12;
    const textW = halfW - 24;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(14);
    pdf.setTextColor(60, 50, 40);
    const textLines = pdf.splitTextToSize(scene.content, textW);
    pdf.text(textLines, textX, 20);

    // Page numbers
    pdf.setFontSize(8);
    pdf.setTextColor(160, 150, 140);
    pdf.text(String(i * 2 + 1), halfW / 2, pageH - 6, { align: "center" });
    pdf.text(String(i * 2 + 2), halfW + halfW / 2, pageH - 6, { align: "center" });

    // Scene counter
    pdf.text(`${i + 1} of ${pages.length}`, pageW - 10, 8, { align: "right" });
  }

  // -- End page --
  pdf.addPage([pageW, pageH], "landscape");
  pdf.setFillColor(245, 236, 215);
  pdf.rect(0, 0, pageW, pageH, "F");

  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(32);
  pdf.setTextColor(60, 50, 40);
  pdf.text("The End", halfW / 2, pageH / 2, { align: "center" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(140, 130, 120);
  pdf.text(story.title, halfW / 2, pageH / 2 + 14, { align: "center" });

  // Spine
  pdf.setDrawColor(196, 180, 138);
  pdf.setLineWidth(0.5);
  pdf.line(halfW, 0, halfW, pageH);

  // Save
  const safeName = story.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase();
  pdf.save(`${safeName}.pdf`);
}

type View = "title" | "page" | "end";

export default function ReadingMode() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
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

  const { data: story, isLoading } = useQuery({
    queryKey: ["story", storyId],
    queryFn: () => getStory(storyId!),
    enabled: !!storyId,
  });

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
      if (transitioning || flipping) return;
      setFlipDirection(dir);
      setDirection(dir);

      // Use page flip for page-to-page, fade for title/end transitions
      if (view === "page" && newView === "page") {
        setFlipping(true);
        setTimeout(() => {
          setView(newView);
          setPageIndex(newIndex);
          setFlipping(false);
        }, 500);
      } else {
        setTransitioning(true);
        setTimeout(() => {
          setView(newView);
          setPageIndex(newIndex);
          setTransitioning(false);
        }, 300);
      }
    },
    [transitioning, flipping, view]
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
                // Refetch story data to show new images
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

      {/* Content with transition */}
      <div
        className={`w-full ${
          transitioning
            ? `transition-all duration-300 ease-out ${
                direction === "forward"
                  ? "opacity-0 translate-x-[-30px]"
                  : "opacity-0 translate-x-[30px]"
              }`
            : transitioning === false && !flipping
            ? "opacity-100 translate-x-0 transition-all duration-300 ease-out"
            : ""
        }`}
      >
        {/* Title page */}
        {view === "title" && (
          <div
            className="flex items-center justify-center px-4 cursor-pointer"
            style={{ minHeight: "100vh" }}
            onClick={goForward}
          >
            <div
              className="relative w-full max-w-7xl mx-auto"
              style={{
                perspective: "2000px",
                filter: "drop-shadow(0 25px 60px rgba(0,0,0,0.5))",
              }}
            >
              <div
                className="flex flex-col md:flex-row"
                style={{ minHeight: "min(85vh, 700px)" }}
              >
                {/* Left page */}
                <div
                  className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 relative rounded-l-lg"
                  style={{
                    background: "linear-gradient(to right, #EDE3C8, #F5ECD7)",
                    transform: "rotateY(1deg)",
                    transformOrigin: "right center",
                    boxShadow: "inset -20px 0 30px -15px rgba(0,0,0,0.08)",
                  }}
                >
                  <div
                    className="absolute inset-6 md:inset-10 rounded-sm pointer-events-none"
                    style={{ border: "2px solid #D4C5A0" }}
                  />
                  <h1 className="text-3xl md:text-5xl font-bold text-stone-800 text-center leading-tight mb-4 relative z-10">
                    {story.title}
                  </h1>
                  {story.characters?.length > 0 && (
                    <p className="text-stone-500 text-sm relative z-10">
                      featuring{" "}
                      {story.characters.map((sc: any) => sc.character.name).join(" & ")}
                    </p>
                  )}
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
                  className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 rounded-r-lg"
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
              </div>
            </div>
          </div>
        )}

        {/* Story page — open book spread with page flip */}
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
                  className={`w-full h-full object-cover ${imageOnLeft ? "rounded-l-lg" : "rounded-r-lg"}`}
                  style={{ minHeight: "min(85vh, 700px)" }}
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
            <div
              className="flex items-center justify-center px-4 py-8"
              style={{ minHeight: "100vh" }}
            >
              <div
                className="relative w-full max-w-7xl mx-auto"
                style={{
                  perspective: "2500px",
                  filter: "drop-shadow(0 30px 70px rgba(0,0,0,0.5))",
                }}
              >
                {/* Page flip overlay */}
                {flipping && (
                  <div
                    className="absolute inset-0 z-30 pointer-events-none"
                    style={{
                      transformStyle: "preserve-3d",
                    }}
                  >
                    <div
                      className={`absolute ${flipDirection === "forward" ? "right-0" : "left-0"} top-0 w-1/2 h-full`}
                      style={{
                        background: "#F5ECD7",
                        transformOrigin: flipDirection === "forward" ? "left center" : "right center",
                        animation: `${flipDirection === "forward" ? "pageFlipForward" : "pageFlipBack"} 500ms ease-in-out forwards`,
                        boxShadow: "0 0 30px rgba(0,0,0,0.2)",
                        borderRadius: flipDirection === "forward" ? "0 8px 8px 0" : "8px 0 0 8px",
                      }}
                    />
                  </div>
                )}

                <div
                  className="flex flex-col md:flex-row"
                  style={{ minHeight: "min(85vh, 700px)" }}
                >
                  {imageOnLeft ? illustrationPage : textPage}

                  {/* Spine */}
                  <div
                    className="hidden md:block w-[4px] relative z-20 flex-shrink-0"
                    style={{
                      background: "linear-gradient(to bottom, #B8A878, #96845C, #B8A878)",
                      boxShadow: "-3px 0 12px rgba(0,0,0,0.15), 3px 0 12px rgba(0,0,0,0.15)",
                    }}
                  />

                  {imageOnLeft ? textPage : illustrationPage}
                </div>
              </div>
            </div>
          );
        })()}

        {/* End page */}
        {view === "end" && (
          <div
            className="flex items-center justify-center px-4"
            style={{ minHeight: "100vh" }}
          >
            <div
              className="relative w-full max-w-7xl mx-auto"
              style={{
                perspective: "2000px",
                filter: "drop-shadow(0 25px 60px rgba(0,0,0,0.5))",
              }}
            >
              <div
                className="flex flex-col md:flex-row"
                style={{ minHeight: "min(85vh, 700px)" }}
              >
                {/* Left page */}
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
                      onClick={() => {
                        setView("title");
                        setPageIndex(0);
                      }}
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
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Page flip keyframe animations */}
      <style>{`
        @keyframes pageFlipForward {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(-180deg); }
        }
        @keyframes pageFlipBack {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(180deg); }
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
        }
      `}</style>
    </div>
  );
}
