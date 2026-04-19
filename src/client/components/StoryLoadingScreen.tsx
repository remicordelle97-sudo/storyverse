import { useEffect, useState } from "react";

interface StoryLoadingScreenProps {
  phrases: string[];
  title?: string;
  progressLabel?: string;
  progressPercent?: number;
}

/**
 * Unified full-screen loader used during story creation and illustration.
 * Cycles through a list of short phrases so the wait feels alive rather
 * than empty, and optionally shows a progress bar once page-by-page
 * illustration stats become available.
 */
export default function StoryLoadingScreen({
  phrases,
  title,
  progressLabel,
  progressPercent,
}: StoryLoadingScreenProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (phrases.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % phrases.length);
    }, 2800);
    return () => clearInterval(id);
  }, [phrases.length]);

  // Keep the current index in range if the phrase list shrinks.
  const safeIndex = phrases.length > 0 ? index % phrases.length : 0;
  const phrase = phrases[safeIndex] || "";

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
          key={safeIndex}
          className="text-stone-300 text-base sm:text-lg animate-[fadeIn_600ms_ease-out]"
        >
          {phrase}
        </p>
        {progressLabel && (
          <p className="text-stone-500 text-xs mt-4">{progressLabel}</p>
        )}
      </div>
      {typeof progressPercent === "number" && (
        <div className="w-64 h-2 bg-stone-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
          />
        </div>
      )}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
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
