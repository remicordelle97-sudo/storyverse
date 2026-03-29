import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStories, getUniverses, getLoraStatus } from "../api/client";
import { useAuth } from "../auth/AuthContext";

// Generate a deterministic color from a string
function stringToColor(str: string): string {
  const colors = [
    "bg-red-700", "bg-blue-800", "bg-emerald-700", "bg-purple-800",
    "bg-amber-700", "bg-rose-700", "bg-indigo-800", "bg-teal-700",
    "bg-orange-700", "bg-cyan-800", "bg-violet-800", "bg-sky-700",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function BookSpine({ story, onClick }: { story: any; onClick: () => void }) {
  const color = stringToColor(story.id);
  const universeName = story.universe?.name || "";

  return (
    <button
      onClick={onClick}
      className={`group relative ${color} rounded-sm shadow-md hover:shadow-xl hover:-translate-y-2 transition-all duration-200 flex flex-col justify-between overflow-hidden`}
      style={{ width: "70px", height: "220px" }}
    >
      {/* Spine edge effect */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-black/20" />
      <div className="absolute right-0 top-0 bottom-0 w-px bg-white/10" />

      {/* Title */}
      <div className="flex-1 flex items-center justify-center px-1.5 py-4">
        <p
          className="text-white font-semibold text-center leading-tight"
          style={{
            fontSize: "10px",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            maxHeight: "160px",
            overflow: "hidden",
          }}
        >
          {story.title}
        </p>
      </div>

      {/* Bottom accent */}
      <div className="h-3 bg-black/15 flex items-center justify-center">
        <div className="w-4 h-0.5 bg-white/30 rounded-full" />
      </div>

      {/* Hover tooltip */}
      <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-3 py-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
        <p className="font-medium">{story.title}</p>
        {universeName && <p className="text-white/60 text-[10px]">{universeName}</p>}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-stone-800 rotate-45" />
      </div>
    </button>
  );
}

function BookCover({ story, onClick }: { story: any; onClick: () => void }) {
  const color = stringToColor(story.id);
  const universeName = story.universe?.name || "";
  const characterNames = (story.characters || [])
    .map((sc: any) => sc.character?.name)
    .filter(Boolean)
    .slice(0, 2);

  return (
    <button
      onClick={onClick}
      className={`group relative ${color} rounded-lg shadow-lg hover:shadow-2xl hover:-translate-y-2 hover:rotate-[-1deg] transition-all duration-200 overflow-hidden text-left`}
      style={{ width: "160px", height: "220px" }}
    >
      {/* Spine edge */}
      <div className="absolute left-0 top-0 bottom-0 w-3 bg-black/20 rounded-l-lg" />

      {/* Cover content */}
      <div className="flex flex-col justify-between h-full p-4 pl-5">
        {/* Universe label */}
        {universeName && (
          <p className="text-white/50 text-[9px] uppercase tracking-wider font-medium">
            {universeName}
          </p>
        )}

        {/* Title */}
        <div className="flex-1 flex items-center">
          <h3 className="text-white font-bold text-sm leading-snug">
            {story.title}
          </h3>
        </div>

        {/* Characters */}
        {characterNames.length > 0 && (
          <p className="text-white/40 text-[10px]">
            {characterNames.join(" & ")}
          </p>
        )}
      </div>

      {/* Subtle texture */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
    </button>
  );
}

function Shelf({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2">
      {/* Books */}
      <div className="flex items-end gap-3 px-6 pb-0 min-h-[230px] flex-wrap">
        {children}
      </div>
      {/* Shelf plank */}
      <div className="relative">
        <div className="h-4 bg-amber-900 rounded-sm shadow-md" />
        <div className="h-1.5 bg-amber-800 rounded-b-sm" />
        <div className="absolute inset-x-0 top-0 h-1 bg-amber-700/50 rounded-t-sm" />
        {/* Shelf shadow */}
        <div className="h-3 bg-gradient-to-b from-black/10 to-transparent" />
      </div>
    </div>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [viewMode, setViewMode] = useState<"covers" | "spines">("covers");

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ["stories-all"],
    queryFn: () => getStories(),
  });

  const { data: universes = [] } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  // Track LoRA training status for universes
  const [loraStatuses, setLoraStatuses] = useState<Record<string, any>>({});

  useEffect(() => {
    const trainingUniverses = universes.filter(
      (u: any) => u.illustrationStyle?.startsWith("lora-training:")
    );
    if (trainingUniverses.length === 0) return;

    // Check status immediately and then poll every 30 seconds
    const checkAll = async () => {
      for (const u of trainingUniverses) {
        try {
          const status = await getLoraStatus(u.id);
          setLoraStatuses((prev) => ({ ...prev, [u.id]: status }));
        } catch {}
      }
    };

    checkAll();
    const interval = setInterval(checkAll, 30000);
    return () => clearInterval(interval);
  }, [universes]);

  const trainingUniverses = universes.filter(
    (u: any) => u.illustrationStyle?.startsWith("lora-training:")
  );
  const readyUniverses = universes.filter(
    (u: any) => u.illustrationStyle?.startsWith("lora:")
  );

  const handleNewStory = () => {
    setShowMenu(false);
    if (universes.length === 0) {
      navigate("/new-universe");
    } else if (universes.length === 1) {
      localStorage.setItem("universeId", universes[0].id);
      navigate("/story-builder");
    } else {
      navigate("/story-builder");
    }
  };

  // Group stories into shelves (items per shelf depends on view mode)
  const perShelf = viewMode === "covers" ? 5 : 8;
  const shelves: any[][] = [];
  for (let i = 0; i < stories.length; i += perShelf) {
    shelves.push(stories.slice(i, i + perShelf));
  }

  return (
    <div className="min-h-screen bg-amber-950/5">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <h1
            className="text-3xl font-bold text-amber-900"
            style={{ fontFamily: "Lexend, sans-serif" }}
          >
            My Library
          </h1>
          <div className="flex items-center gap-4">
            {/* View toggle */}
            <div className="flex bg-white rounded-lg border border-stone-200 p-0.5">
              <button
                onClick={() => setViewMode("covers")}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  viewMode === "covers"
                    ? "bg-amber-900 text-white"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                Covers
              </button>
              <button
                onClick={() => setViewMode("spines")}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  viewMode === "spines"
                    ? "bg-amber-900 text-white"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                Spines
              </button>
            </div>

            <div className="flex items-center gap-3">
              {user?.picture && (
                <img
                  src={user.picture}
                  alt=""
                  className="w-8 h-8 rounded-full"
                  referrerPolicy="no-referrer"
                />
              )}
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
                className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
              >
                Sign out
              </button>
            </div>

            {/* + Button */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="w-10 h-10 bg-primary text-white rounded-full flex items-center justify-center hover:bg-primary/90 transition-colors shadow-sm text-xl font-light"
              >
                +
              </button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-12 z-50 bg-white rounded-xl shadow-lg border border-stone-200 py-2 w-48">
                    <button
                      onClick={handleNewStory}
                      className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                    >
                      New Story
                    </button>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        navigate("/new-universe");
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                    >
                      New Universe
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LoRA training status banners */}
      <div className="max-w-5xl mx-auto px-4">
        {trainingUniverses.map((u: any) => {
          const status = loraStatuses[u.id];
          return (
            <div
              key={u.id}
              className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3"
            >
              <svg className="animate-spin h-4 w-4 text-amber-600 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div>
                <p className="text-sm text-amber-800 font-medium">
                  Training character model for {u.name}...
                </p>
                <p className="text-xs text-amber-600">
                  {status?.replicateStatus === "processing"
                    ? "Processing on Replicate. This takes about 20 minutes."
                    : "Checking status..."}
                </p>
              </div>
            </div>
          );
        })}
        {readyUniverses.map((u: any) => (
          <div
            key={`ready-${u.id}`}
            className="mb-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-emerald-700">
              Character model ready for <strong>{u.name}</strong>
            </p>
          </div>
        ))}
      </div>

      {/* Bookshelf */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        {isLoading ? (
          <div className="py-20 text-center">
            <p className="text-stone-400" style={{ fontFamily: "Lexend, sans-serif" }}>
              Loading your library...
            </p>
          </div>
        ) : stories.length > 0 ? (
          <div className="bg-amber-900/10 rounded-2xl p-6 border border-amber-900/10">
            {shelves.map((shelf, i) => (
              <Shelf key={i}>
                {shelf.map((story: any) =>
                  viewMode === "covers" ? (
                    <BookCover
                      key={story.id}
                      story={story}
                      onClick={() => navigate(`/reading/${story.id}`)}
                    />
                  ) : (
                    <BookSpine
                      key={story.id}
                      story={story}
                      onClick={() => navigate(`/reading/${story.id}`)}
                    />
                  )
                )}
              </Shelf>
            ))}
          </div>
        ) : (
          <div className="bg-amber-900/10 rounded-2xl p-6 border border-amber-900/10">
            <Shelf>
              {/* Empty shelf with CTA */}
              <div className="flex items-center justify-center w-full py-8">
                <div className="text-center">
                  <p
                    className="text-amber-900/40 text-lg mb-4"
                    style={{ fontFamily: "Lexend, sans-serif" }}
                  >
                    Your bookshelf is empty
                  </p>
                  <button
                    onClick={() => navigate("/new-universe")}
                    className="px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
                    style={{ fontFamily: "Lexend, sans-serif" }}
                  >
                    Create your first universe
                  </button>
                </div>
              </div>
            </Shelf>
          </div>
        )}
      </div>
    </div>
  );
}
