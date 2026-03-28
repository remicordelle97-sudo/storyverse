import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUniverse, getStories } from "../api/client";
import CharacterCard from "../components/CharacterCard";
import StoryCard from "../components/StoryCard";

export default function Dashboard() {
  const navigate = useNavigate();
  const universeId = localStorage.getItem("universeId");

  const { data: universe, isLoading: loadingUniverse } = useQuery({
    queryKey: ["universe", universeId],
    queryFn: () => getUniverse(universeId!),
    enabled: !!universeId,
  });

  const { data: stories, isLoading: loadingStories } = useQuery({
    queryKey: ["stories", universeId],
    queryFn: () => getStories(universeId!),
    enabled: !!universeId,
  });

  if (!universeId) {
    navigate("/onboarding");
    return null;
  }

  if (loadingUniverse) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-400">Loading your universe...</p>
      </div>
    );
  }

  const recentStories = (stories || []).slice(0, 3);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-stone-800">
            {universe?.name}
          </h1>
          <p className="text-stone-500 mt-1">
            {universe?.mood}
          </p>
        </div>
        <button
          onClick={() => navigate("/story-builder")}
          className="px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          New story
        </button>
      </div>

      {/* Characters */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-stone-700 mb-4">
          Characters
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {universe?.characters?.map((c: any) => (
            <CharacterCard key={c.id} character={c} />
          ))}
        </div>
      </section>

      {/* Recent Stories */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-stone-700">
            Recent stories
          </h2>
          <button
            onClick={() => navigate("/library")}
            className="text-sm text-primary hover:underline"
          >
            View library
          </button>
        </div>
        {recentStories.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {recentStories.map((s: any) => (
              <StoryCard key={s.id} story={s} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl p-8 text-center border border-stone-200">
            <p className="text-stone-400 mb-4">No stories yet</p>
            <button
              onClick={() => navigate("/story-builder")}
              className="text-primary font-medium hover:underline"
            >
              Write your first story
            </button>
          </div>
        )}
      </section>

      {/* Timeline */}
      {universe?.timelineEvents?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-stone-700 mb-4">
            Timeline
          </h2>
          <div className="bg-white rounded-xl p-5 border border-stone-200">
            {universe.timelineEvents.slice(0, 8).map((e: any) => (
              <div key={e.id} className="flex items-start gap-3 py-2">
                <div
                  className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    e.significance === "major" ? "bg-primary" : "bg-stone-300"
                  }`}
                />
                <div>
                  <span className="text-sm font-medium text-stone-700">
                    {e.character?.name}
                  </span>
                  <p className="text-sm text-stone-500">{e.eventSummary}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
