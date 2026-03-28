import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUniverse, generateStory } from "../api/client";
import Chip from "../components/Chip";

const MOODS = ["Gentle", "Funny", "Exciting", "Mysterious"];
const LENGTHS: { label: string; value: string }[] = [
  { label: "Short (3 scenes)", value: "short" },
  { label: "Medium (5 scenes)", value: "medium" },
  { label: "Long (7 scenes)", value: "long" },
];

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
  const [length, setLength] = useState("medium");
  const [parentPrompt, setParentPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleCharacter = (id: string) =>
    setSelectedCharacters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const childId = universe?.family?.children?.[0]?.id;

  const handleGenerate = async () => {
    if (!selectedCharacters.length || !childId) return;
    setLoading(true);
    setError("");

    try {
      const result = await generateStory({
        universeId,
        childId,
        characterIds: selectedCharacters,
        mood: mood.toLowerCase(),
        language: universe?.family?.preferredLanguage || "en",
        length,
        parentPrompt,
      });
      navigate(`/reading/${result.story.id}`);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

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
        <div className="flex flex-wrap gap-2">
          {LENGTHS.map((l) => (
            <Chip
              key={l.value}
              label={l.label}
              selected={length === l.value}
              onClick={() => setLength(l.value)}
            />
          ))}
        </div>
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
        disabled={loading || selectedCharacters.length === 0}
        className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin h-5 w-5"
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
            Generating story...
          </span>
        ) : (
          "Generate story"
        )}
      </button>
    </div>
  );
}
