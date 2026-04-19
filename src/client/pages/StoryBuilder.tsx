import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUniverses, generateStory, getStoryQuota, createCheckoutSession } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Chip from "../components/Chip";

const AGE_GROUPS = ["2-3", "4-5", "6-8"];

const STEP_LABELS: Record<string, string> = {
  building: "Building your story world",
  writing: "Writing the story",
  saving: "Saving pages",
  illustrating: "Illustrating your story",
};

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
  const [structure, setStructure] = useState("problem-solution");
  const [generateImages, setGenerateImages] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progressStep, setProgressStep] = useState("");
  const [progressDetail, setProgressDetail] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  // Active quota depends on which flavor of story the user is creating
  const activeQuota = generateImages ? quota?.illustrated : quota?.text;

  const handleGenerate = async () => {
    if (!universeId) return;

    setLoading(true);
    setError("");
    setProgressStep("");
    setProgressDetail("");
    setCompletedSteps([]);

    try {
      const result = await generateStory(
        {
          universeId,
          language: "en",
          ageGroup,
          structure: isAdmin ? structure : undefined,
          generateImages,
        },
        (step, detail) => {
          setCompletedSteps((prev) => {
            if (prev.includes(step)) return prev;
            if (progressStep && !prev.includes(progressStep)) {
              return [...prev, progressStep];
            }
            return prev;
          });
          setProgressStep(step);
          setProgressDetail(detail || "");
        }
      );
      navigate(`/reading/${result.story.id}`);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
      setLoading(false);
      setProgressStep("");
    }
  };

  const allSteps = ["building", "writing", "saving"];

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

      {/* Progress overlay */}
      {loading && (
        <div className="bg-white rounded-xl border border-stone-200 p-8 mb-8">
          <div className="space-y-4">
            {allSteps.map((step) => {
              const isActive = progressStep === step;
              const isComplete =
                completedSteps.includes(step) ||
                allSteps.indexOf(step) < allSteps.indexOf(progressStep);

              return (
                <div key={step} className="flex items-center gap-3">
                  {isComplete ? (
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  ) : isActive ? (
                    <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                      <svg className="animate-spin h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-stone-200 flex-shrink-0" />
                  )}
                  <div>
                    <p className={`text-sm font-medium ${isActive ? "text-stone-800" : isComplete ? "text-secondary" : "text-stone-300"}`}>
                      {STEP_LABELS[step]}
                    </p>
                    {isActive && progressDetail && (
                      <p className="text-xs text-stone-400 mt-0.5">{progressDetail}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && (
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
              {[
                { value: "problem-solution", label: "Problem & Solution", desc: "A clear problem the hero works to solve" },
                { value: "rule-of-three", label: "Rule of Three", desc: "Three attempts, fail, fail, succeed" },
                { value: "cumulative", label: "Cumulative", desc: "Each event builds on the last, snowball style" },
                { value: "circular", label: "Circular", desc: "Ends where it began, but the hero has changed" },
                { value: "journey", label: "Journey & Return", desc: "Leave home, adventure, return transformed" },
                { value: "unlikely-friendship", label: "Unlikely Friendship", desc: "Two different characters discover an unexpected bond" },
              ].map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStructure(s.value)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    structure === s.value
                      ? "border-primary bg-primary/5 text-stone-800"
                      : "border-stone-200 bg-white text-stone-600 hover:border-primary/30"
                  }`}
                >
                  <span className="font-medium text-sm">{s.label}</span>
                  <p className="text-xs text-stone-400 mt-0.5">{s.desc}</p>
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
      )}
    </div>
  );
}
