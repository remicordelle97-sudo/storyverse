import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createUniverse, createCharacter, generateUniverseConcept, generateCharacters } from "../api/client";

import Chip from "../components/Chip";

const INTERESTS = [
  "Lions & big cats",
  "Dinosaurs",
  "Space",
  "Ocean",
  "Dragons",
  "Robots",
  "Fairies",
  "Farm animals",
  "Trains",
  "Something else",
];

export default function NewUniverse() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);

  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");
  const [avoidThemes, setAvoidThemes] = useState("");
  const [heroName, setHeroName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState("");

  const toggleInterest = (i: string) =>
    setInterests((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );

  const canNext = () => {
    if (step === 1) return interests.length > 0;
    if (step === 2) return true;
    if (step === 3) return heroName.trim().length > 0;
    return true;
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const allThemes = [
        ...interests.filter((i) => i !== "Something else"),
        ...(customInterest ? [customInterest] : []),
      ];

      // Generate unique universe name and description via AI
      setSavingStep("Imagining your world...");
      const concept = await generateUniverseConcept({
        interests: allThemes,
      });

      setSavingStep(`Creating "${concept.name}"...`);
      const universe = await createUniverse({
        name: concept.name,
        settingDescription: concept.settingDescription,
        sensoryDetails: concept.sensoryDetails || "",
        worldRules: concept.worldRules || "",
        scaleAndGeography: concept.scaleAndGeography || "",
        themes: JSON.stringify(allThemes),
        avoidThemes,
      });

      // Create a bare hero placeholder — generateCharacters will flesh it out
      await createCharacter({
        universeId: universe.id,
        name: heroName,
        speciesOrType: "TBD",
        personalityTraits: "[]",
        appearance: "",
        role: "main",
      });

      setSavingStep("Creating characters...");
      await generateCharacters(universe.id);

      queryClient.invalidateQueries({ queryKey: ["universes"] });
      localStorage.setItem("universeId", universe.id);
      navigate("/universe-manager");
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Failed to create universe. Please try again.");
      setSaving(false);
      setSavingStep("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-lg p-8">
        <button
          onClick={() => navigate("/library")}
          className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
        >
          &larr; Back to library
        </button>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${
                s <= step ? "bg-primary" : "bg-stone-200"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-bold text-stone-800 mb-2">
              What's this world about?
            </h2>
            <p className="text-stone-500 mb-6">Pick one or more themes.</p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => (
                <Chip
                  key={i}
                  label={i}
                  selected={interests.includes(i)}
                  onClick={() => toggleInterest(i)}
                />
              ))}
            </div>
            {interests.includes("Something else") && (
              <input
                type="text"
                value={customInterest}
                onChange={(e) => setCustomInterest(e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mt-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Tell us more..."
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold text-stone-800 mb-2">
              Anything to avoid?
            </h2>
            <p className="text-stone-500 mb-6">Optional — let us know if there are themes to skip.</p>
            <input
              type="text"
              value={avoidThemes}
              onChange={(e) => setAvoidThemes(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. No scary villains"
            />
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold text-stone-800 mb-2">
              Name your hero
            </h2>
            <p className="text-stone-500 mb-6">We'll create their personality, look, and friends.</p>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Hero's name
            </label>
            <input
              type="text"
              value={heroName}
              onChange={(e) => setHeroName(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. Leo"
            />
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <button
            onClick={() => (step === 1 ? navigate("/library") : setStep((s) => s - 1))}
            className="px-5 py-2.5 text-stone-600 hover:text-stone-800 transition-colors"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
              className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={saving || !canNext()}
              className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {savingStep}
                </span>
              ) : (
                "Create world"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
