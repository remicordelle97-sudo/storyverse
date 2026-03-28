import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStories } from "../api/client";
import StoryCard from "../components/StoryCard";

export default function Library() {
  const navigate = useNavigate();
  const universeId = localStorage.getItem("universeId") || "";

  const { data: stories, isLoading } = useQuery({
    queryKey: ["stories", universeId],
    queryFn: () => getStories(universeId),
    enabled: !!universeId,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm text-stone-500 hover:text-stone-700 mb-2 block"
          >
            &larr; Back to dashboard
          </button>
          <h1 className="text-2xl font-bold text-stone-800">Story Library</h1>
        </div>
        <button
          onClick={() => navigate("/story-builder")}
          className="px-5 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          New story
        </button>
      </div>

      {isLoading ? (
        <p className="text-stone-400 text-center py-12">Loading stories...</p>
      ) : stories && stories.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories.map((s: any) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl p-12 text-center border border-stone-200">
          <p className="text-stone-400 mb-4">No stories yet</p>
          <button
            onClick={() => navigate("/story-builder")}
            className="text-primary font-medium hover:underline"
          >
            Write your first story
          </button>
        </div>
      )}
    </div>
  );
}
