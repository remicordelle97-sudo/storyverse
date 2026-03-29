import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createUniverse, createCharacter, generateCharacters } from "../api/client";
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

const MOODS = [
  "Gentle & calming",
  "Funny & silly",
  "Exciting adventures",
  "Mysterious & magical",
  "Mix it up",
];

const PERSONALITIES = [
  "Brave",
  "Curious",
  "Funny",
  "Kind",
  "Shy but brave",
  "Clever",
  "Mischievous",
];

const UNIVERSE_MAP: Record<string, { name: string; setting: string }> = {
  "Lions & big cats": {
    name: "The Golden Savanna",
    setting: "A vast, sun-drenched savanna filled with golden grasses, towering baobab trees, and friendly animals.",
  },
  Dinosaurs: {
    name: "The Lost Valley",
    setting: "A lush hidden valley where gentle dinosaurs roam among giant ferns and bubbling hot springs.",
  },
  Space: {
    name: "The Starfield",
    setting: "A glittering expanse of stars, friendly planets, and cosy space stations connected by rainbow bridges.",
  },
  Ocean: {
    name: "The Deep Blue",
    setting: "A magical underwater kingdom with coral castles, kelp forests, and glowing sea creatures.",
  },
  Dragons: {
    name: "The Enchanted Realm",
    setting: "A mystical land of rolling green hills, crystal caves, and friendly dragons who guard ancient secrets.",
  },
};

function deriveUniverse(interests: string[]) {
  for (const interest of interests) {
    if (UNIVERSE_MAP[interest]) return UNIVERSE_MAP[interest];
  }
  return {
    name: "The Wonder World",
    setting: `A wonderful world shaped by ${interests.join(", ").toLowerCase()}, full of surprises and new friends.`,
  };
}

function deriveSpecies(universeName: string) {
  const map: Record<string, string> = {
    "The Golden Savanna": "Lion",
    "The Lost Valley": "Dinosaur",
    "The Starfield": "Space Explorer",
    "The Deep Blue": "Sea Creature",
    "The Enchanted Realm": "Dragon",
  };
  return map[universeName] || "Adventurer";
}

export default function NewUniverse() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);

  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");
  const [mood, setMood] = useState("");
  const [avoidThemes, setAvoidThemes] = useState("");
  const [heroName, setHeroName] = useState("");
  const [heroTraits, setHeroTraits] = useState<string[]>([]);
  const [heroDetail, setHeroDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState("");

  const toggleInterest = (i: string) =>
    setInterests((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  const toggleTrait = (t: string) =>
    setHeroTraits((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const canNext = () => {
    if (step === 1) return interests.length > 0;
    if (step === 2) return !!mood;
    if (step === 3) return heroName.trim() && heroTraits.length > 0;
    return true;
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      setSavingStep("Creating world...");
      const derived = deriveUniverse(interests);
      const allThemes = [
        ...interests.filter((i) => i !== "Something else"),
        ...(customInterest ? [customInterest] : []),
      ];

      const universe = await createUniverse({
        name: derived.name,
        settingDescription: derived.setting,
        themes: JSON.stringify(allThemes),
        mood: mood || "exciting adventures",
        avoidThemes,
      });

      setSavingStep("Creating hero...");
      const species = deriveSpecies(derived.name);
      await createCharacter({
        universeId: universe.id,
        name: heroName,
        speciesOrType: species,
        personalityTraits: JSON.stringify(heroTraits),
        appearance: `A friendly ${species.toLowerCase()} with bright, curious eyes`,
        specialDetail: heroDetail,
        role: "main",
      });

      setSavingStep("Populating world with characters and drawing them...");
      await generateCharacters(universe.id);

      queryClient.invalidateQueries({ queryKey: ["universes"] });
      queryClient.invalidateQueries({ queryKey: ["stories-all"] });
      localStorage.setItem("universeId", universe.id);
      navigate("/story-builder");
    } catch (e) {
      console.error(e);
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
              What kind of stories?
            </h2>
            <p className="text-stone-500 mb-6">Pick the overall vibe.</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {MOODS.map((m) => (
                <Chip
                  key={m}
                  label={m}
                  selected={mood === m}
                  onClick={() => setMood(m)}
                />
              ))}
            </div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Anything to avoid? (optional)
            </label>
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
              Create the hero
            </h2>
            <p className="text-stone-500 mb-6">The main character of this world.</p>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Hero's name
            </label>
            <input
              type="text"
              value={heroName}
              onChange={(e) => setHeroName(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mb-5 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. Leo the Lion"
            />
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Personality
            </label>
            <div className="flex flex-wrap gap-2 mb-5">
              {PERSONALITIES.map((p) => (
                <Chip
                  key={p}
                  label={p}
                  selected={heroTraits.includes(p)}
                  onClick={() => toggleTrait(p)}
                />
              ))}
            </div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              One special detail (optional)
            </label>
            <input
              type="text"
              value={heroDetail}
              onChange={(e) => setHeroDetail(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. Always carries a tiny blue backpack"
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
