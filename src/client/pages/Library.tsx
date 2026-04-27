import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStories, getUniverses, toggleStoryPublic, deleteStory, createCheckoutSession, createPortalSession } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { storyTailwindColor } from "../../shared/storyColor";


function BookCover({ story, onClick, isAdmin, onTogglePublic, onDelete }: { story: any; onClick: () => void; isAdmin?: boolean; onTogglePublic?: () => void; onDelete?: () => void }) {
  const color = storyTailwindColor(story.id);
  const universeName = story.universe?.name || "";

  return (
    <div className="relative" style={{ width: "160px" }}>
      <button
        onClick={onClick}
        className={`group relative ${color} rounded-lg shadow-lg hover:shadow-2xl hover:-translate-y-2 hover:rotate-[-1deg] transition-all duration-200 overflow-hidden text-left w-full`}
        style={{ height: "220px" }}
      >
        {/* Spine edge */}
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-black/20 rounded-l-lg" />

        {/* Public badge */}
        {story.isPublic && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-yellow-400/90 rounded text-[8px] font-bold text-yellow-900 uppercase tracking-wide z-10">
            Featured
          </div>
        )}

        {/* Cover content */}
        <div className="flex flex-col justify-between h-full p-4 pl-5">
          {/* Universe label */}
          {universeName && (
            <p className="text-white/50 text-[9px] uppercase tracking-wider font-medium">
              {universeName}
            </p>
          )}

          {/* Empty story indicator */}
          {!story.scenesCount && (
            <p className="text-white/30 text-[8px] uppercase tracking-wider">
              Story unavailable
            </p>
          )}

          {/* Title */}
          <div className="flex-1 flex items-center">
            <h3 className="text-white font-bold text-sm leading-snug">
              {story.title}
            </h3>
          </div>
        </div>

        {/* Subtle texture */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      </button>

      {/* Admin controls */}
      {isAdmin && (
        <div className="mt-1 flex gap-1">
          {onTogglePublic && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePublic(); }}
              className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                story.isPublic
                  ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                  : "bg-stone-100 text-stone-400 hover:bg-stone-200"
              }`}
            >
              {story.isPublic ? "Unpublish" : "Publish"}
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-400 hover:bg-red-100 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Shelf({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4">
      {/* Books */}
      <div className="flex items-end gap-3 sm:gap-4 px-3 sm:px-8 pb-0 min-h-[230px] overflow-x-auto sm:overflow-x-visible sm:flex-wrap sm:justify-start flex-nowrap">
        {children}
      </div>
      {/* Shelf plank */}
      <div className="relative">
        <div
          className="h-5 rounded-t-sm"
          style={{ background: "linear-gradient(to bottom, #C4A265, #A8884E)" }}
        />
        <div
          className="h-2"
          style={{ background: "linear-gradient(to bottom, #96773F, #856A38)" }}
        />
        <div className="h-[2px]" style={{ background: "#7A6034" }} />
        <div
          className="h-6"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.1), transparent)" }}
        />
      </div>
    </div>
  );
}

import { FAQ_ITEMS } from "../components/faqItems";

export default function Library() {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const queryClient = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);
  const [showFaq, setShowFaq] = useState(false);

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ["stories-all"],
    queryFn: () => getStories(),
  });

  // Universe lifecycle states (PR 5 added the explicit status column):
  //   queued | building | illustrating_assets | ready | failed
  // Treat status="ready" as the only success terminal. status="failed"
  // is a terminal we should stop polling on (otherwise a failed build
  // would keep the library refetching forever).
  const isUniverseReady = (u: any) => u.status === "ready";
  const isUniverseFailed = (u: any) => u.status === "failed";

  const { data: universes = [] } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
    // Poll every 5s while any universe is still mid-build/illustrating.
    refetchInterval: (query) => {
      const data = (query.state.data as any[]) || [];
      const anyPending = data.some(
        (u: any) => !isUniverseReady(u) && !isUniverseFailed(u),
      );
      return anyPending ? 5000 : false;
    },
  });

  // Track "newly-ready" transitions so we can show a toast when background
  // image generation completes.
  const pendingRef = useRef<Set<string>>(new Set());
  const [readyNotice, setReadyNotice] = useState<string | null>(null);

  useEffect(() => {
    const justReady: string[] = [];
    for (const u of universes as any[]) {
      const ready = isUniverseReady(u);
      if (!ready) {
        pendingRef.current.add(u.id);
      } else if (pendingRef.current.has(u.id)) {
        pendingRef.current.delete(u.id);
        justReady.push(u.name);
      }
    }
    if (justReady.length > 0) {
      setReadyNotice(`${justReady.join(" and ")} ${justReady.length === 1 ? "is" : "are"} ready!`);
      const timer = setTimeout(() => setReadyNotice(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [universes]);

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

  // Books per shelf — recomputed from viewport width so wider screens get
  // more books per row instead of the previous hardcoded 5.
  const BOOK_WIDTH = 160;
  const BOOK_GAP = 16;
  const HORIZONTAL_CHROME = 80; // container px-4 (32) + shelf px-8 (64) - first-book has no leading gap (16)
  const [perShelf, setPerShelf] = useState(() => computePerShelf());

  function computePerShelf() {
    if (typeof window === "undefined") return 5;
    const available = window.innerWidth * 0.95 - HORIZONTAL_CHROME;
    const count = Math.floor((available + BOOK_GAP) / (BOOK_WIDTH + BOOK_GAP));
    return Math.max(3, Math.min(12, count));
  }

  useEffect(() => {
    const onResize = () => setPerShelf(computePerShelf());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const shelves: any[][] = [];
  for (let i = 0; i < stories.length; i += perShelf) {
    shelves.push(stories.slice(i, i + perShelf));
  }

  return (
    <div className="min-h-screen app-bg">
      {/* Universe-ready toast */}
      {readyNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 animate-[fadeInDown_400ms_ease-out]">
          <span>✓</span>
          <span>{readyNotice}</span>
          <button
            onClick={() => setReadyNotice(null)}
            className="ml-2 text-white/70 hover:text-white text-xs"
          >
            ✕
          </button>
          <style>{`
            @keyframes fadeInDown {
              from { opacity: 0; transform: translate(-50%, -8px); }
              to   { opacity: 1; transform: translate(-50%, 0); }
            }
          `}</style>
        </div>
      )}

      {/* Header */}
      <div className="max-w-[95vw] mx-auto px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <h1
            className="text-3xl font-bold text-amber-900"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            My Library
          </h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowFaq(!showFaq)}
              className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
            >
              FAQ
            </button>
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
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="w-10 h-10 bg-amber-800 text-white rounded-full flex items-center justify-center hover:bg-amber-700 transition-colors shadow-sm text-xl font-light"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* FAQ modal — centered on screen */}
      {showFaq && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowFaq(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-xl border border-stone-200 p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto space-y-4 pointer-events-auto">
              <h2 className="text-lg font-bold text-stone-800 mb-2">FAQ</h2>
              {FAQ_ITEMS.map((item) => (
                <div key={item.q}>
                  <h3 className="text-sm font-semibold text-stone-800">{item.q}</h3>
                  <p className="text-xs text-stone-500 mt-1">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* + Menu overlay */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="fixed top-16 right-4 z-50 bg-white rounded-xl shadow-lg border border-stone-200 py-2 w-48">
            <button
              onClick={handleNewStory}
              className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
            >
              New Story
            </button>
            <button
              onClick={() => { setShowMenu(false); navigate("/my-universes"); }}
              className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
            >
              My universes
            </button>
            {isAdmin && (
              <>
                <div className="border-t border-stone-100 my-1" />
                <button
                  onClick={() => { setShowMenu(false); navigate("/universe-manager"); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-50 transition-colors"
                >
                  Manage Universes
                </button>
                <button
                  onClick={() => { setShowMenu(false); navigate("/admin"); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-50 transition-colors"
                >
                  Admin
                </button>
              </>
            )}
            {!isAdmin && (
              <>
                <div className="border-t border-stone-100 my-1" />
                {user?.plan === "premium" ? (
                  <button
                    onClick={async () => { setShowMenu(false); const { url } = await createPortalSession(); window.location.href = url; }}
                    className="w-full text-left px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-50 transition-colors"
                  >
                    Manage Subscription
                  </button>
                ) : (
                  <button
                    onClick={async () => { setShowMenu(false); const { url } = await createCheckoutSession(); window.location.href = url; }}
                    className="w-full text-left px-4 py-2.5 text-sm text-amber-800 hover:bg-stone-50 transition-colors font-medium"
                  >
                    Upgrade to Premium
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Bookshelf */}
      <div className="max-w-[95vw] mx-auto px-4 py-4">
        {isLoading ? (
          <div className="py-20 text-center">
            <p className="text-stone-400" style={{ fontFamily: "Georgia, serif" }}>
              Loading your library...
            </p>
          </div>
        ) : stories.length > 0 ? (
          <div className="py-2">
            {shelves.map((shelf, i) => (
              <Shelf key={i}>
                {shelf.map((story: any) => (
                  <BookCover
                    key={story.id}
                    story={story}
                    onClick={() => navigate(`/reading/${story.id}`)}
                    isAdmin={isAdmin}
                    onTogglePublic={async () => {
                      await toggleStoryPublic(story.id);
                      queryClient.invalidateQueries({ queryKey: ["stories-all"] });
                    }}
                    onDelete={async () => {
                      if (!confirm(`Delete "${story.title}"? This cannot be undone.`)) return;
                      await deleteStory(story.id);
                      queryClient.invalidateQueries({ queryKey: ["stories-all"] });
                    }}
                  />
                ))}
              </Shelf>
            ))}
          </div>
        ) : (
          <div className="py-2">
            <Shelf>
              <div className="flex items-center justify-center w-full py-8">
                <div className="text-center">
                  <p className="text-stone-400 text-lg mb-4" style={{ fontFamily: "Georgia, serif" }}>
                    Your bookshelf is empty
                  </p>
                  <button
                    onClick={() => navigate("/new-universe")}
                    className="px-6 py-3 bg-amber-800 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors"
                    style={{ fontFamily: "Georgia, serif" }}
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
