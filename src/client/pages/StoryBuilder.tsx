import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUniverses, generateStory, getStoryQuota, createCheckoutSession } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Chip from "../components/Chip";
import StoryLoadingScreen, { STORY_TEXT_PHRASES } from "../components/StoryLoadingScreen";
import { STRUCTURE_LIST } from "../../shared/structures";

const AGE_GROUPS = ["2-3", "4-5", "6-8"];

export default function StoryBuilder() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const storedUniverseId = localStorage.getItem("universeId") || "";

  const { data: universes = [] } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  const { data: quota } = useQuery({
    queryKey: ["story-quota"],
    queryFn: getStoryQuota,
  });

  const [universeId, setUniverseId] = useState(storedUniverseId);

  // Auto-select if only one universe
  useEffect(() => {
    if (!universeId && universes.length === 1) {
      setUniverseId(universes[0].id);
    }
  }, [universes, universeId]);

  const [ageGroup, setAgeGroup] = useState("4-5");
  const [structure, setStructure] = useState<(typeof STRUCTURE_LIST)[number]["id"]>("problem-solution");
  const [generateImages, setGenerateImages] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Active quota depends on which flavor of story the user is creating
  const activeQuota = generateImages ? quota?.illustrated : quota?.text;

  const handleGenerate = async () => {
    if (!universeId) return;

    setLoading(true);
    setError("");

    try {
      // POST /stories/generate now returns 202 + { storyId, jobId } and
      // the worker handles text + image generation in the background.
      // ReadingMode polls /stories/:id/status to drive its loading UI.
      const { storyId } = await generateStory({
        universeId,
        language: "en",
        ageGroup,
        structure: isAdmin ? structure : undefined,
        generateImages,
      });
      navigate(`/reading/${storyId}`);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  if (loading) {
    return <StoryLoadingScreen phrases={STORY_TEXT_PHRASES} />;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate("/library")}
        className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
      >
        &larr; Back to library
      </button>

      <h1 className="text-2xl font-bold text-stone-800 mb-8">
        Create a new story
      </h1>

      <>
          {/* Universe selector (if multiple) */}
          {universes.length > 1 && (
            <section className="mb-8">
              <label className="block text-sm font-medium text-stone-700 mb-3">
                Universe
              </label>
              <div className="flex flex-wrap gap-2">
                {universes.map((u: any) => (
                  <Chip
                    key={u.id}
                    label={u.isPublic ? `${u.name} ★` : u.name}
                    selected={universeId === u.id}
                    onClick={() => setUniverseId(u.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Age group */}
          <section className="mb-8">
            <label className="block text-sm font-medium text-stone-700 mb-3">
              Reader age
            </label>
            <div className="flex gap-2">
              {AGE_GROUPS.map((g) => (
                <Chip key={g} label={g} selected={ageGroup === g} onClick={() => setAgeGroup(g)} />
              ))}
            </div>
          </section>

          {/* Story structure (admin only) */}
          {isAdmin && (
          <section className="mb-8">
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Story structure
            </label>
            <p className="text-xs text-stone-400 mb-3">For testing</p>
            <div className="space-y-2">
              {STRUCTURE_LIST.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStructure(s.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    structure === s.id
                      ? "border-primary bg-primary/5 text-stone-800"
                      : "border-stone-200 bg-white text-stone-600 hover:border-primary/30"
                  }`}
                >
                  <span className="font-medium text-sm">{s.label}</span>
                  <p className="text-xs text-stone-400 mt-0.5">{s.description}</p>
                </button>
              ))}
            </div>
          </section>
          )}


          {/* Illustrations toggle */}
          <section className="mb-8">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setGenerateImages(!generateImages)}
                className={`relative w-11 h-6 rounded-full transition-colors ${generateImages ? "bg-primary" : "bg-stone-300"}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${generateImages ? "translate-x-5" : ""}`} />
              </div>
              <span className="text-sm font-medium text-stone-700">Illustrate the story</span>
            </label>
            <p className="text-xs text-stone-400 mt-1 ml-14">
              {generateImages
                ? "A picture for every page."
                : "Text only. Both pages of each spread show story text."}
            </p>
          </section>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
              {error}
            </div>
          )}

          {/* Quota info */}
          {quota && !isAdmin && (
            <div className="text-center space-y-1">
              {quota.illustrated.limit !== Infinity && (
                <p className={`text-xs ${quota.illustrated.remaining === 0 ? "text-red-500" : "text-stone-400"}`}>
                  Illustrated: {quota.illustrated.remaining} of {quota.illustrated.limit} remaining this month
                </p>
              )}
              {quota.text.limit !== Infinity && (
                <p className={`text-xs ${quota.text.remaining === 0 ? "text-red-500" : "text-stone-400"}`}>
                  Text only: {quota.text.remaining} of {quota.text.limit} remaining this month
                </p>
              )}
              {activeQuota && !activeQuota.allowed && (
                <button
                  onClick={async () => {
                    const { url } = await createCheckoutSession();
                    window.location.href = url;
                  }}
                  className="mt-2 text-xs text-primary hover:text-primary/80 font-medium underline"
                >
                  Upgrade to Premium for more stories
                </button>
              )}
            </div>
          )}

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={!universeId || (activeQuota && !activeQuota.allowed)}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {activeQuota && !activeQuota.allowed
              ? (generateImages ? "Illustrated limit reached" : "Text-only limit reached")
              : "Create story"}
          </button>
      </>
    </div>
  );
}
