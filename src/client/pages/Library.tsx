import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStories, getUniverses } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import StoryCard from "../components/StoryCard";

export default function Library() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ["stories-all"],
    queryFn: () => getStories(),
  });

  const { data: universes = [] } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  const handleNewStory = () => {
    setShowMenu(false);
    if (universes.length === 0) {
      // No universes yet — create one first
      navigate("/new-universe");
    } else if (universes.length === 1) {
      localStorage.setItem("universeId", universes[0].id);
      navigate("/story-builder");
    } else {
      // Multiple universes — go to story builder which will let them pick
      navigate("/story-builder");
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-stone-800">My Stories</h1>
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
            <span className="text-sm text-stone-600">{user?.name}</span>
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

      {/* Stories grid */}
      {isLoading ? (
        <p className="text-stone-400 text-center py-12">Loading stories...</p>
      ) : stories.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories.map((s: any) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl p-12 text-center border border-stone-200">
          <h2 className="text-xl font-semibold text-stone-700 mb-2">
            Welcome to Storyverse
          </h2>
          <p className="text-stone-400 mb-6">
            Create a universe and start writing stories.
          </p>
          <button
            onClick={() => navigate("/new-universe")}
            className="px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Create your first universe
          </button>
        </div>
      )}
    </div>
  );
}
