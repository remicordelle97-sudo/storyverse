import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStories, getUniverses, getUniverseQuota, toggleStoryPublic, deleteStory, createCheckoutSession, createPortalSession } from "../api/client";
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


function BookCover({ story, onClick, isAdmin, onTogglePublic, onDelete }: { story: any; onClick: () => void; isAdmin?: boolean; onTogglePublic?: () => void; onDelete?: () => void }) {
  const color = stringToColor(story.id);
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
          {(!story.scenes || story.scenes.length === 0) && (
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
  const { user, isAdmin, logout } = useAuth();
  const queryClient = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);
  const viewMode = "covers";

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ["stories-all"],
    queryFn: () => getStories(),
  });

  const { data: universes = [] } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  const { data: universeQuota } = useQuery({
    queryKey: ["universe-quota"],
    queryFn: getUniverseQuota,
  });

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
  const perShelf = 5;
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
                      disabled={universeQuota && !universeQuota.allowed}
                      className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors disabled:text-stone-300 disabled:cursor-not-allowed"
                    >
                      New Universe{universeQuota && !universeQuota.allowed ? " (limit reached)" : ""}
                    </button>
                    {isAdmin && (
                      <>
                        <div className="border-t border-stone-100 my-1" />
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            navigate("/universe-manager");
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-50 transition-colors"
                        >
                          Manage Universes
                        </button>
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            navigate("/admin");
                          }}
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
                            onClick={async () => {
                              setShowMenu(false);
                              const { url } = await createPortalSession();
                              window.location.href = url;
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-50 transition-colors"
                          >
                            Manage Subscription
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              setShowMenu(false);
                              const { url } = await createCheckoutSession();
                              window.location.href = url;
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-primary hover:bg-stone-50 transition-colors font-medium"
                          >
                            Upgrade to Premium
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
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
