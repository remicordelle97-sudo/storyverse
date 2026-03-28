import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory } from "../api/client";

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
      if (transitioning) return;
      setDirection(dir);
      setTransitioning(true);
      setTimeout(() => {
        setView(newView);
        setPageIndex(newIndex);
        setTransitioning(false);
      }, 300);
    },
    [transitioning]
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
      className="min-h-screen bg-[#1a1a2e] flex items-center justify-center select-none"
      onMouseMove={showControls}
      onClick={showControls}
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
          style={{ fontFamily: "Lexend, sans-serif" }}
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
        <div className="w-12" />
      </div>

      {/* Book container */}
      <div className="w-full max-w-2xl mx-auto relative" style={{ fontFamily: "Lexend, sans-serif" }}>
        {/* Tap zones */}
        {view === "page" && (
          <>
            <div
              className="fixed left-0 top-0 w-1/3 h-full z-40 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                goBack();
              }}
            />
            <div
              className="fixed right-0 top-0 w-2/3 h-full z-40 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                goForward();
              }}
            />
          </>
        )}

        {/* Content with transition */}
        <div
          className={`transition-all duration-300 ease-out ${
            transitioning
              ? direction === "forward"
                ? "opacity-0 translate-x-[-30px]"
                : "opacity-0 translate-x-[30px]"
              : "opacity-100 translate-x-0"
          }`}
        >
          {/* Title page */}
          {view === "title" && (
            <div
              className="min-h-screen flex flex-col items-center justify-center px-8 cursor-pointer"
              onClick={goForward}
            >
              <h1 className="text-4xl md:text-5xl font-bold text-[#FEFCF8] text-center leading-tight mb-6">
                {story.title}
              </h1>
              {story.characters?.length > 0 && (
                <p className="text-white/40 text-sm mb-12">
                  featuring{" "}
                  {story.characters
                    .map((sc: any) => sc.character.name)
                    .join(" & ")}
                </p>
              )}
              <p className="text-white/30 text-xs animate-pulse">
                Tap to begin
              </p>
            </div>
          )}

          {/* Story page */}
          {view === "page" && page && (
            <div className="min-h-screen flex flex-col justify-center px-4 py-20">
              {/* Illustration */}
              {page.imageUrl ? (
                <div className="mb-6 rounded-2xl overflow-hidden shadow-2xl">
                  <img
                    src={page.imageUrl}
                    alt={`Illustration for page ${pageIndex + 1}`}
                    className="w-full"
                    draggable={false}
                  />
                </div>
              ) : (
                <div className="mb-6 rounded-2xl overflow-hidden bg-[#2a2a3e] aspect-[4/3] flex items-center justify-center">
                  <div className="text-white/10 text-sm">Illustration</div>
                </div>
              )}

              {/* Text panel */}
              <div className="bg-[#FEFCF8] rounded-2xl px-8 py-6 shadow-lg">
                <p
                  className="text-stone-800 leading-[1.75] tracking-wide text-left"
                  style={{
                    fontSize: "clamp(1.25rem, 2.5vw + 0.5rem, 1.75rem)",
                    wordSpacing: "0.05em",
                    letterSpacing: "0.02em",
                  }}
                >
                  {page.content}
                </p>
              </div>

              {/* Page number */}
              <p className="text-white/20 text-xs text-center mt-4">
                {pageIndex + 1} / {totalPages}
              </p>
            </div>
          )}

          {/* End page */}
          {view === "end" && (
            <div className="min-h-screen flex flex-col items-center justify-center px-8">
              <p className="text-[#FEFCF8] text-3xl font-light mb-2">
                The End
              </p>
              <p className="text-white/30 text-sm mb-12">{story.title}</p>
              <div className="flex gap-4">
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
                  className="px-6 py-3 text-white/50 hover:text-white transition-colors"
                >
                  Back to library
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
