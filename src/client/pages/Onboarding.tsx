import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Chip from "../components/Chip";
import { createUniverse, createCharacter, createFamily } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const AGE_GROUPS = ["2-4", "5-7", "8-10"];

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

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1
  const [childName, setChildName] = useState("");
  const [ageGroup, setAgeGroup] = useState("");

  // Step 2
  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");

  // Step 3
  const [mood, setMood] = useState("");
  const [avoidThemes, setAvoidThemes] = useState("");

  // Step 4
  const [heroName, setHeroName] = useState("");
  const [heroTraits, setHeroTraits] = useState<string[]>([]);
  const [heroDetail, setHeroDetail] = useState("");

  const toggleInterest = (i: string) =>
    setInterests((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );

  const toggleTrait = (t: string) =>
    setHeroTraits((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const deriveUniverse = () => {
    for (const interest of interests) {
      if (UNIVERSE_MAP[interest]) return UNIVERSE_MAP[interest];
    }
    return {
      name: `${childName}'s World`,
      setting: `A wonderful world shaped by ${interests.join(", ").toLowerCase() || "imagination"}, full of surprises and new friends.`,
    };
  };

  const ageFromGroup = (group: string) => {
    const map: Record<string, number> = { "2-4": 3, "5-7": 5, "8-10": 8 };
    return map[group] || 5;
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      // Create family if user doesn't have one yet
      if (!user?.familyId) {
        await createFamily({ name: `${childName}'s Family` });
        await refreshUser();
      }

      const derived = deriveUniverse();
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
        childName,
        childAge: ageFromGroup(ageGroup),
        childAgeGroup: ageGroup,
      });

      // Derive species from universe name
      const speciesMap: Record<string, string> = {
        "The Golden Savanna": "Lion",
        "The Lost Valley": "Dinosaur",
        "The Starfield": "Space Explorer",
        "The Deep Blue": "Sea Creature",
        "The Enchanted Realm": "Dragon",
      };

      await createCharacter({
        universeId: universe.id,
        name: heroName,
        speciesOrType: speciesMap[derived.name] || "Adventurer",
        personalityTraits: JSON.stringify(heroTraits),
        appearance: `A friendly ${(speciesMap[derived.name] || "character").toLowerCase()} with bright, curious eyes`,
        specialDetail: heroDetail,
        role: "main",
      });

      localStorage.setItem("universeId", universe.id);
      navigate("/dashboard");
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  const canNext = () => {
    if (step === 1) return childName.trim() && ageGroup;
    if (step === 2) return interests.length > 0;
    if (step === 3) return !!mood;
    if (step === 4) return heroName.trim() && heroTraits.length > 0;
    return true;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-lg p-8">
        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3, 4, 5].map((s) => (
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
              Who's the story for?
            </h2>
            <p className="text-stone-500 mb-6">
              Tell us about your little reader.
            </p>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Child's name
            </label>
            <input
              type="text"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mb-5 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. Mia"
            />
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Age group
            </label>
            <div className="flex gap-2">
              {AGE_GROUPS.map((g) => (
                <Chip
                  key={g}
                  label={g}
                  selected={ageGroup === g}
                  onClick={() => setAgeGroup(g)}
                />
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold text-stone-800 mb-2">
              What does {childName} love?
            </h2>
            <p className="text-stone-500 mb-6">
              Pick one or more interests to shape the story world.
            </p>
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

        {step === 3 && (
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

        {step === 4 && (
          <div>
            <h2 className="text-2xl font-bold text-stone-800 mb-2">
              Create the hero
            </h2>
            <p className="text-stone-500 mb-6">
              The main character of {childName}'s stories.
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

        {step === 5 && (
          <div>
            <h2 className="text-2xl font-bold text-stone-800 mb-2">
              Your story world is ready!
            </h2>
            <div className="bg-stone-50 rounded-xl p-5 mb-6">
              <h3 className="font-bold text-lg text-primary mb-1">
                {deriveUniverse().name}
              </h3>
              <p className="text-sm text-stone-600 mb-4">
                {deriveUniverse().setting}
              </p>
              <div className="border-t border-stone-200 pt-3">
                <p className="text-sm font-medium text-stone-700">
                  Hero: {heroName}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {heroTraits.map((t) => (
                    <span
                      key={t}
                      className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                {heroDetail && (
                  <p className="text-xs text-stone-500 mt-2">{heroDetail}</p>
                )}
              </div>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
                {error}
              </div>
            )}
            <p className="text-sm text-stone-500 mb-4">
              Stories for <strong>{childName}</strong> ({ageGroup} years) ·{" "}
              {mood}
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          {step > 1 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="px-5 py-2.5 text-stone-600 hover:text-stone-800 transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}
          {step < 5 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
              className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving ? "Creating..." : "Start my first story"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
