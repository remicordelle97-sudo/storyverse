import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUniverses, createUniverse, createCharacter } from "../api/client";
import { useAuth } from "../auth/AuthContext";
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
    setting:
      "A vast, sun-drenched savanna filled with golden grasses, towering baobab trees, and friendly animals.",
  },
  Dinosaurs: {
    name: "The Lost Valley",
    setting:
      "A lush hidden valley where gentle dinosaurs roam among giant ferns and bubbling hot springs.",
  },
  Space: {
    name: "The Starfield",
    setting:
      "A glittering expanse of stars, friendly planets, and cosy space stations connected by rainbow bridges.",
  },
  Ocean: {
    name: "The Deep Blue",
    setting:
      "A magical underwater kingdom with coral castles, kelp forests, and glowing sea creatures.",
  },
  Dragons: {
    name: "The Enchanted Realm",
    setting:
      "A mystical land of rolling green hills, crystal caves, and friendly dragons who guard ancient secrets.",
  },
};

function deriveUniverse(interests: string[], childName: string) {
  for (const interest of interests) {
    if (UNIVERSE_MAP[interest]) return UNIVERSE_MAP[interest];
  }
  return {
    name: `${childName}'s World`,
    setting: `A wonderful world shaped by ${interests.join(", ").toLowerCase() || "imagination"}, full of surprises and new friends.`,
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

export default function Universes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const childId = localStorage.getItem("childId");
  const childName = localStorage.getItem("childName") || "Your child";

  const { data: allUniverses = [], isLoading } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  // Filter to this child's universes
  const universes = allUniverses.filter((u: any) => u.childId === childId);

  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1);

  // Step 1: Interests
  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");

  // Step 2: Mood
  const [mood, setMood] = useState("");
  const [avoidThemes, setAvoidThemes] = useState("");

  // Step 3: Hero
  const [heroName, setHeroName] = useState("");
  const [heroTraits, setHeroTraits] = useState<string[]>([]);
  const [heroDetail, setHeroDetail] = useState("");

  const [saving, setSaving] = useState(false);

  const toggleInterest = (i: string) =>
    setInterests((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  const toggleTrait = (t: string) =>
    setHeroTraits((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const resetForm = () => {
    setShowCreate(false);
    setStep(1);
    setInterests([]);
    setCustomInterest("");
    setMood("");
    setAvoidThemes("");
    setHeroName("");
    setHeroTraits([]);
    setHeroDetail("");
  };

  const canNext = () => {
    if (step === 1) return interests.length > 0;
    if (step === 2) return !!mood;
    if (step === 3) return heroName.trim() && heroTraits.length > 0;
    return true;
  };

  const handleCreate = async () => {
    if (!childId) return;
    setSaving(true);

    try {
      const derived = deriveUniverse(interests, childName);
      const allThemes = [
        ...interests.filter((i) => i !== "Something else"),
        ...(customInterest ? [customInterest] : []),
      ];

      const universe = await createUniverse({
        childId,
        name: derived.name,
        settingDescription: derived.setting,
        themes: JSON.stringify(allThemes),
        mood: mood || "exciting adventures",
        avoidThemes,
      });

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

      queryClient.invalidateQueries({ queryKey: ["universes"] });
      resetForm();
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  const handleUniverseClick = (universe: any) => {
    localStorage.setItem("universeId", universe.id);
    navigate("/dashboard");
  };

  // Find hero for each universe
  const getHero = (universe: any) =>
    universe.characters?.find((c: any) => c.role === "main");

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate("/family")}
        className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
      >
        &larr; Back to family
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800">
          {childName}'s Worlds
        </h1>
        <p className="text-stone-500 mt-1">
          Each world has its own hero, characters, and stories.
        </p>
      </div>

      {/* Universe list */}
      {isLoading ? (
        <p className="text-stone-400">Loading...</p>
      ) : (
        <div className="space-y-3 mb-6">
          {universes.map((universe: any) => {
            const hero = getHero(universe);
            const secondaryCount = (universe.characters || []).filter(
              (c: any) => c.role !== "main"
            ).length;

            return (
              <button
                key={universe.id}
                onClick={() => handleUniverseClick(universe)}
                className="w-full bg-white rounded-xl p-5 border border-stone-200 text-left hover:shadow-md hover:border-primary/30 transition-all"
              >
                <h3 className="font-semibold text-stone-800 text-lg">
                  {universe.name}
                </h3>
                {hero && (
                  <p className="text-sm text-primary mt-1">
                    Hero: {hero.name} the {hero.speciesOrType}
                  </p>
                )}
                <p className="text-xs text-stone-400 mt-1">
                  {secondaryCount} supporting character
                  {secondaryCount !== 1 ? "s" : ""} · {universe.mood}
                </p>
              </button>
            );
          })}

          {universes.length === 0 && !showCreate && (
            <div className="bg-white rounded-xl p-8 text-center border border-stone-200">
              <p className="text-stone-400 mb-4">
                No worlds yet. Create one to start telling stories!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Create universe flow */}
      {showCreate ? (
        <div className="bg-white rounded-xl p-6 border border-stone-200">
          {/* Progress */}
          <div className="flex gap-2 mb-6">
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
              <h3 className="text-lg font-bold text-stone-800 mb-2">
                What's this world about?
              </h3>
              <p className="text-sm text-stone-500 mb-4">Pick one or more themes.</p>
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
              <h3 className="text-lg font-bold text-stone-800 mb-2">
                What kind of stories?
              </h3>
              <p className="text-sm text-stone-500 mb-4">Pick the overall vibe.</p>
              <div className="flex flex-wrap gap-2 mb-5">
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
              <h3 className="text-lg font-bold text-stone-800 mb-2">
                Create the hero
              </h3>
              <p className="text-sm text-stone-500 mb-4">
                The main character of this world.
              </p>
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
          <div className="flex justify-between mt-6">
            <button
              onClick={() => (step === 1 ? resetForm() : setStep((s) => s - 1))}
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
                {saving ? "Creating..." : "Create world"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="w-full py-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 hover:border-primary hover:text-primary transition-colors font-medium"
        >
          + Create a new world
        </button>
      )}
    </div>
  );
}
