import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMyStories, getMyUniverses } from "../api/client";

// Status vocabularies that should keep the banner visible. Anything
// outside these sets is treated as terminal (published/ready/failed)
// and falls off the banner. Failed items disappear too — the user
// surfaces them via the regular library shelf with its red "Failed"
// label, not the progress strip.
const STORY_IN_FLIGHT = new Set(["queued", "generating_text", "illustrating"]);
const UNIVERSE_IN_FLIGHT = new Set(["queued", "building", "illustrating_assets"]);

// Routes where the banner is hidden — typically full-screen
// experiences (the reader, login) or routes the user hasn't
// onboarded into yet.
const HIDDEN_PREFIXES = ["/reading", "/login", "/onboarding"];

function storyStatusPhrase(status: string): string {
  switch (status) {
    case "queued":
      return "Queued for writing";
    case "generating_text":
      return "Writing";
    case "illustrating":
      return "Illustrating";
    default:
      return "Working";
  }
}

function universeStatusPhrase(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "building":
      return "Building";
    case "illustrating_assets":
      return "Drawing characters";
    default:
      return "Working";
  }
}

/**
 * Top-of-screen progress strip that lists in-flight story + universe
 * builds for the current user. Polls the existing list endpoints
 * every 3s so this works without bespoke server changes; once an
 * item moves to a terminal status it falls off the banner.
 *
 * Mounted globally in App.tsx; opts out on routes where it would
 * intrude (the reader, login, onboarding).
 */
export default function ProgressBanner() {
  const navigate = useNavigate();
  const location = useLocation();

  // Suspend the polling queries on hidden routes — the user can't
  // see the banner there anyway, and keeping fetches running on the
  // reader would make every flip race a refetch.
  const enabled = !HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p));

  const { data: storyData } = useQuery({
    queryKey: ["progress-banner-stories"],
    queryFn: () => getMyStories(undefined, 50),
    enabled,
    refetchInterval: enabled ? 3000 : false,
  });
  const { data: universeData } = useQuery({
    queryKey: ["progress-banner-universes"],
    queryFn: () => getMyUniverses(undefined, 50),
    enabled,
    refetchInterval: enabled ? 3000 : false,
  });

  if (!enabled) return null;

  const stories = (storyData?.items ?? []).filter((s) => STORY_IN_FLIGHT.has(s.status));
  const universes = (universeData?.items ?? []).filter((u: any) =>
    UNIVERSE_IN_FLIGHT.has(u.status)
  );

  if (stories.length === 0 && universes.length === 0) return null;

  return (
    <div className="sticky top-0 z-30 bg-amber-50/95 backdrop-blur border-b border-amber-200 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 overflow-x-auto">
        {universes.map((u: any) => (
          <Item
            key={`u-${u.id}`}
            label={`${universeStatusPhrase(u.status)} "${u.name}"…`}
            onClick={() => navigate("/my-universes")}
          />
        ))}
        {stories.map((s) => (
          <Item
            key={`s-${s.id}`}
            label={`${storyStatusPhrase(s.status)} "${s.title || "Untitled"}"…`}
            onClick={() => navigate(`/reading/${s.id}`)}
          />
        ))}
      </div>
    </div>
  );
}

function Item({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-full bg-white border border-amber-200 text-amber-900 text-xs font-medium hover:border-amber-400 hover:bg-amber-50 transition-colors"
    >
      <Spinner />
      <span className="truncate max-w-[260px]">{label}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="w-3 h-3 animate-spin text-amber-700 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
