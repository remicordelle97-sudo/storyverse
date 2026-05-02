import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyUniverses, generateStory, getStoryQuota, createCheckoutSession } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Chip from "../components/Chip";
import { STRUCTURE_LIST } from "../../shared/structures";

const AGE_GROUPS = ["2-3", "4-5", "6-8"];

export default function StoryBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const storedUniverseId = localStorage.getItem("universeId") || "";

  const { data: universesPage } = useQuery({
    queryKey: ["universes-my"],
    queryFn: () => getMyUniverses(),
  });
  // Only ready universes can be used for story generation. A universe
  // mid-build doesn't have its hero yet (pickStoryParameters would
  // throw "Universe has no main character"), and a failed universe
  // is broken — the user should delete it from MyUniverses, not pick
  // it here.
  const universes = (universesPage?.items ?? []).filter(
    (u: any) => u.status === "ready",
  );

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
  const [storyIdea, setStoryIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Optional parent-supplied story idea. Cap matches the server-side
  // limit; keep it loose enough for "Lily learns to share with her
  // brother", strict enough that users can't dump a synopsis that
  // confuses the planner. Trimmed and dropped if too short.
  const STORY_IDEA_MAX = 500;
  const STORY_IDEA_MIN = 3;
  const trimmedStoryIdea = storyIdea.trim();
  const storyIdeaTooLong = trimmedStoryIdea.length > STORY_IDEA_MAX;

  // Active quota depends on which flavor of story the user is creating
  const activeQuota = generateImages ? quota?.illustrated : quota?.text;

  const handleGenerate = async () => {
    if (!universeId) return;

    setLoading(true);
    setError("");

    try {
      // POST /stories/generate returns 202 + { storyId, jobId } in
      // milliseconds; the actual text + image generation happens in
      // the worker. We send the user back to the library where the
      // ProgressBanner shows in-flight builds and the bookshelf's
      // status-aware BookCover lights up when the story is ready.
      await generateStory({
        universeId,
        language: "en",
        ageGroup,
        structure: isAdmin ? structure : undefined,
        generateImages,
        // Drop very short / whitespace-only inputs entirely — they're
        // typed by accident and an empty parentPrompt confuses the
        // planner more than helps.
        parentPrompt:
          trimmedStoryIdea.length >= STORY_IDEA_MIN ? trimmedStoryIdea : undefined,
      });
      // Refresh the library + banner queries so the new placeholder
      // shows up immediately on the next page.
      queryClient.invalidateQueries({ queryKey: ["my-stories"] });
      queryClient.invalidateQueries({ queryKey: ["progress-banner-stories"] });
      queryClient.invalidateQueries({ queryKey: ["story-quota"] });
      navigate("/library");
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pt-12 pb-8 relative">
      {/* `relative z-50` keeps this above the centered ProgressBanner —
          on narrow screens the floating banner overlaps the top of the
          page, and without an explicit z-index the button used to
          swallow clicks behind the banner pill. */}
      <button
        type="button"
        onClick={() => navigate("/library")}
        className="relative z-50 inline-flex items-center text-sm text-stone-500 hover:text-stone-800 mb-6 px-2 py-1 -ml-2 rounded transition-colors"
      >
        &larr; Back to library
      </button>

      <h1 className="text-2xl font-bold text-stone-800 mb-8">
        Create a new story
      </h1>

      {universes.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-6 text-sm text-stone-500">
          You don't have any universes ready for stories yet.{" "}
          <button
            onClick={() => navigate("/my-universes")}
            className="text-primary hover:text-primary/80 font-medium underline"
          >
            Open My universes
          </button>{" "}
          to build a new one or remove a failed one.
        </div>
      ) : (
      <>
          {/* Universe selector — always render so the user sees which
              universe their story will use, even when there's only one
              choice. The single-universe case still auto-selects via
              the useEffect above. */}
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

          {/* Optional story idea */}
          <section className="mb-8">
            <label
              htmlFor="story-idea"
              className="block text-sm font-medium text-stone-700 mb-1"
            >
              Story idea <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <p className="text-xs text-stone-400 mb-2">
              A sentence or two of inspiration.
            </p>
            <textarea
              id="story-idea"
              value={storyIdea}
              onChange={(e) => setStoryIdea(e.target.value)}
              maxLength={STORY_IDEA_MAX + 50}
              rows={3}
              placeholder="What's this story about?"
              className={`w-full px-3 py-2 rounded-lg border bg-white text-stone-800 text-sm focus:outline-none focus:ring-2 transition-colors resize-none ${
                storyIdeaTooLong
                  ? "border-red-400 focus:ring-red-400"
                  : "border-stone-200 focus:ring-primary"
              }`}
            />
            <div className="flex justify-end items-center mt-1">
              <p
                className={`text-[11px] ${
                  storyIdeaTooLong ? "text-red-600" : "text-stone-400"
                }`}
              >
                {trimmedStoryIdea.length}/{STORY_IDEA_MAX}
              </p>
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
            disabled={loading || !universeId || storyIdeaTooLong || (activeQuota && !activeQuota.allowed)}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? "Starting…"
              : activeQuota && !activeQuota.allowed
                ? (generateImages ? "Illustrated limit reached" : "Text-only limit reached")
                : "Create story"}
          </button>
      </>
      )}
    </div>
  );
}
