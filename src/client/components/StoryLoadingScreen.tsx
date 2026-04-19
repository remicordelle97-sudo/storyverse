import { useEffect, useState } from "react";

interface StoryLoadingScreenProps {
  phrases: string[];
  title?: string;
  progressLabel?: string;
  progressPercent?: number;
}

// Cycle timing: fade-in (FADE_MS) → hold → fade-out (FADE_MS) → swap → repeat
const CYCLE_MS = 6000;
const FADE_MS = 900;

/**
 * Unified full-screen loader used during story creation and illustration.
 * Cycles through a list of short phrases so the wait feels alive rather
 * than empty, with a slow cross-fade between phrases. A progress bar
 * always renders — determinate when a percent is supplied, indeterminate
 * (sliding chaser) otherwise.
 */
export default function StoryLoadingScreen({
  phrases,
  title,
  progressLabel,
  progressPercent,
}: StoryLoadingScreenProps) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (phrases.length <= 1) return;
    // Start fading out just before we swap the phrase so the transition
    // is visible on the way out, not only on the way in.
    const fadeOutTimer = setTimeout(() => setVisible(false), CYCLE_MS - FADE_MS);
    const swapTimer = setTimeout(() => {
      setIndex((i) => (i + 1) % phrases.length);
      setVisible(true);
    }, CYCLE_MS);
    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(swapTimer);
    };
  }, [index, phrases.length]);

  const safeIndex = phrases.length > 0 ? index % phrases.length : 0;
  const phrase = phrases[safeIndex] || "";
  const hasPercent = typeof progressPercent === "number";

  return (
    <div
      className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center gap-6 px-6"
      style={{ fontFamily: "Lexend, sans-serif" }}
    >
      <div className="text-center">
        {title && (
          <h2 className="text-white text-xl font-bold mb-3">{title}</h2>
        )}
        <p
          className="text-stone-300 text-base sm:text-lg"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(4px)",
            transition: `opacity ${FADE_MS}ms ease-in-out, transform ${FADE_MS}ms ease-in-out`,
          }}
        >
          {phrase}
        </p>
        {progressLabel && (
          <p className="text-stone-500 text-xs mt-4">{progressLabel}</p>
        )}
      </div>
      <div className="w-64 h-2 bg-stone-700 rounded-full overflow-hidden relative">
        {hasPercent ? (
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, progressPercent!))}%` }}
          />
        ) : (
          <div
            className="h-full bg-amber-500 rounded-full absolute"
            style={{
              width: "35%",
              animation: "loadingChaser 1.8s ease-in-out infinite",
            }}
          />
        )}
      </div>
      <style>{`
        @keyframes loadingChaser {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(185%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}

export const STORY_TEXT_PHRASES = [
  "Crafting your story",
  "Finding the right words",
  "Bringing characters to life",
  "Weaving the plot",
];

export const STORY_IMAGE_PHRASES = [
  "Illustrating your world",
  "Painting the scenes",
  "Bringing the pages to life",
  "Adding finishing touches",
];
