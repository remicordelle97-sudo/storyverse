import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUniverse, generateStory } from "../api/client";
import Chip from "../components/Chip";

const MOODS = ["Gentle", "Funny", "Exciting", "Mysterious"];

const STEP_LABELS: Record<string, string> = {
  building: "Building your story world",
  writing: "Writing the story",
  saving: "Saving pages",
  illustrating: "Creating illustrations",
  finishing: "Adding to the timeline",
};

export default function StoryBuilder() {
  const navigate = useNavigate();
  const universeId = localStorage.getItem("universeId") || "";

  const { data: universe } = useQuery({
    queryKey: ["universe", universeId],
    queryFn: () => getUniverse(universeId),
    enabled: !!universeId,
  });

  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [mood, setMood] = useState("Exciting");
  const [length, setLength] = useState<"short" | "long">("long");
  const [parentPrompt, setParentPrompt] = useState("");
  const [generateImages, setGenerateImages] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progressStep, setProgressStep] = useState("");
  const [progressDetail, setProgressDetail] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  const toggleCharacter = (id: string) =>
    setSelectedCharacters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const childId =
    localStorage.getItem("childId") || universe?.family?.children?.[0]?.id;

  const handleGenerate = async () => {
    if (!selectedCharacters.length || !childId) return;
    setLoading(true);
    setError("");
    setProgressStep("");
    setProgressDetail("");
    setCompletedSteps([]);

    try {
      const result = await generateStory(
        {
          universeId,
          childId,
          characterIds: selectedCharacters,
          mood: mood.toLowerCase(),
          language: universe?.family?.preferredLanguage || "en",
          length,
          parentPrompt,
          generateImages,
        },
        (step, detail) => {
          setCompletedSteps((prev) => {
            if (prev.includes(step)) return prev;
            // Mark previous step as completed
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

  const allSteps = generateImages
    ? ["building", "writing", "saving", "illustrating", "finishing"]
    : ["building", "writing", "saving", "finishing"];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate("/dashboard")}
        className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
      >
        &larr; Back to dashboard
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
                (allSteps.indexOf(step) < allSteps.indexOf(progressStep));

              return (
                <div key={step} className="flex items-center gap-3">
                  {/* Icon */}
                  {isComplete ? (
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-3.5 h-3.5 text-white"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  ) : isActive ? (
                    <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                      <svg
                        className="animate-spin h-5 w-5 text-primary"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-stone-200 flex-shrink-0" />
                  )}

                  {/* Label */}
                  <div>
                    <p
                      className={`text-sm font-medium ${
                        isActive
                          ? "text-stone-800"
                          : isComplete
                            ? "text-secondary"
                            : "text-stone-300"
                      }`}
                    >
                      {STEP_LABELS[step]}
                    </p>
                    {isActive && progressDetail && (
                      <p className="text-xs text-stone-400 mt-0.5">
                        {progressDetail}
                      </p>
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
          {/* Characters */}
          <section className="mb-8">
            <label className="block text-sm font-medium text-stone-700 mb-3">
              Characters
            </label>
            <div className="flex flex-wrap gap-2">
              {universe?.characters?.map((c: any) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={selectedCharacters.includes(c.id)}
                  onClick={() => toggleCharacter(c.id)}
                />
              ))}
            </div>
          </section>

          {/* Mood */}
          <section className="mb-8">
            <label className="block text-sm font-medium text-stone-700 mb-3">
              Mood
            </label>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <Chip
                  key={m}
                  label={m}
                  selected={mood === m}
                  onClick={() => setMood(m)}
                />
              ))}
            </div>
          </section>

          {/* Length */}
          <section className="mb-8">
            <label className="block text-sm font-medium text-stone-700 mb-3">
              Length
            </label>
            <div className="flex gap-2">
              <Chip
                label="Short (10 pages)"
                selected={length === "short"}
                onClick={() => setLength("short")}
              />
              <Chip
                label="Long (32 pages)"
                selected={length === "long"}
                onClick={() => setLength("long")}
              />
            </div>
          </section>

          {/* Illustrations toggle */}
          <section className="mb-8">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setGenerateImages(!generateImages)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  generateImages ? "bg-primary" : "bg-stone-300"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    generateImages ? "translate-x-5" : ""
                  }`}
                />
              </div>
              <span className="text-sm font-medium text-stone-700">
                Generate illustrations (DALL-E 3)
              </span>
            </label>
            <p className="text-xs text-stone-400 mt-1 ml-14">
              ~$0.04 per page. Leave off to save credits during testing.
            </p>
          </section>

          {/* Parent prompt */}
          <section className="mb-8">
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Story idea (optional)
            </label>
            <textarea
              value={parentPrompt}
              onChange={(e) => setParentPrompt(e.target.value)}
              rows={3}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              placeholder="e.g. Leo finds a treasure map"
            />
          </section>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
              {error}
            </div>
          )}

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={selectedCharacters.length === 0}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Generate story
          </button>
        </>
      )}
    </div>
  );
}
