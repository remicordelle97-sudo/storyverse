import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeOnboarding } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import StoryLoadingScreen, { STORY_TEXT_PHRASES } from "../components/StoryLoadingScreen";

const THEME_OPTIONS = [
  "Space",
  "Ocean",
  "Forest",
  "Fairy tale",
  "Magic",
  "Dinosaurs",
  "Robots",
  "Farm",
  "Sports",
  "Everyday adventures",
];

const TRAIT_OPTIONS = [
  "Brave",
  "Curious",
  "Shy",
  "Funny",
  "Kind",
  "Clever",
  "Caring",
  "Mischievous",
  "Determined",
  "Gentle",
];

interface ManualSupporting {
  name: string;
  species: string;
  traits: string[];
  customTrait: string;
}

const ONBOARDING_PHRASES = [
  "Building your universe",
  "Bringing characters to life",
  "Sketching the world",
  "Painting first impressions",
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState<"plan" | "world">("plan");

  const [universeName, setUniverseName] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [customTheme, setCustomTheme] = useState("");

  const [heroName, setHeroName] = useState("");
  const [heroSpecies, setHeroSpecies] = useState("");
  const [heroTraits, setHeroTraits] = useState<string[]>([]);
  const [heroCustomTrait, setHeroCustomTrait] = useState("");

  const [supportingMode, setSupportingMode] = useState<"auto" | "manual">("auto");
  const [manualSupporting, setManualSupporting] = useState<ManualSupporting[]>([
    { name: "", species: "", traits: [], customTrait: "" },
    { name: "", species: "", traits: [], customTrait: "" },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTheme(t: string) {
    setThemes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleHeroTrait(t: string) {
    setHeroTraits((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function updateSupporting(i: number, patch: Partial<ManualSupporting>) {
    setManualSupporting((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function toggleSupportingTrait(i: number, t: string) {
    updateSupporting(i, {
      traits: manualSupporting[i].traits.includes(t)
        ? manualSupporting[i].traits.filter((x) => x !== t)
        : [...manualSupporting[i].traits, t],
    });
  }

  // Combine the chip selection with the optional "Other" free-text input.
  function combineWithCustom(list: string[], custom: string) {
    const trimmed = custom.trim();
    const filtered = list.filter((x) => x !== "Other");
    return list.includes("Other") && trimmed ? [...filtered, trimmed] : filtered;
  }

  const finalThemes = combineWithCustom(themes, customTheme);
  const finalHeroTraits = combineWithCustom(heroTraits, heroCustomTrait);

  const canSubmit =
    universeName.trim().length > 0 &&
    finalThemes.length > 0 &&
    heroName.trim().length > 0 &&
    heroSpecies.trim().length > 0 &&
    finalHeroTraits.length > 0 &&
    (supportingMode === "auto" ||
      manualSupporting.every(
        (s) =>
          s.name.trim() &&
          s.species.trim() &&
          combineWithCustom(s.traits, s.customTrait).length > 0
      ));

  async function handleFinish() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const supporting =
        supportingMode === "auto"
          ? "auto"
          : manualSupporting.map((s) => ({
              name: s.name.trim(),
              species: s.species.trim(),
              traits: combineWithCustom(s.traits, s.customTrait),
            }));

      await completeOnboarding({
        universeName: universeName.trim(),
        themes: finalThemes,
        hero: {
          name: heroName.trim(),
          species: heroSpecies.trim(),
          traits: finalHeroTraits,
        },
        supporting,
      });
      await refreshUser();
      navigate("/library");
    } catch (e: any) {
      setError(e.message || "Failed to complete setup");
      setSubmitting(false);
    }
  }

  if (submitting) {
    return <StoryLoadingScreen phrases={ONBOARDING_PHRASES} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-start justify-center py-12 px-4">
      <div className={`w-full ${step === "world" ? "max-w-3xl" : "max-w-3xl"}`}>
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold text-stone-800 mb-2"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-stone-500 text-sm">
            Let's get your storybook shelf set up.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <StepDot active={step === "plan"} done={step === "world"} label="Plan" />
          <div className="w-8 h-px bg-stone-300" />
          <StepDot active={step === "world"} done={false} label="Your world" />
        </div>

        {step === "plan" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">Choose your plan</h2>
            <p className="text-sm text-stone-500 mb-6">You can upgrade anytime later.</p>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => setStep("world")}
                className="text-left border-2 border-primary bg-primary/5 rounded-xl p-5 hover:bg-primary/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-stone-800">Free</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-white font-medium">
                    Selected
                  </span>
                </div>
                <p className="text-2xl font-bold text-stone-800 mb-3">$0</p>
                <ul className="text-xs text-stone-600 space-y-1.5">
                  <li>1 universe</li>
                  <li>2 illustrated stories per month</li>
                  <li>10 text-only stories per month</li>
                </ul>
              </button>

              <div
                aria-disabled
                className="text-left border-2 border-stone-200 rounded-xl p-5 opacity-60 cursor-not-allowed relative"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-stone-800">Premium</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 font-medium">
                    Coming soon
                  </span>
                </div>
                <p className="text-2xl font-bold text-stone-800 mb-3">—</p>
                <ul className="text-xs text-stone-600 space-y-1.5">
                  <li>Unlimited universes</li>
                  <li>5 illustrated stories per month</li>
                  <li>20 text-only stories per month</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setStep("world")}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "world" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm space-y-8">
            <div>
              <h2 className="text-lg font-semibold text-stone-800 mb-1">Build your world</h2>
              <p className="text-sm text-stone-500">
                Choose a name, themes, and a hero. We'll handle the rest.
              </p>
            </div>

            {/* Universe name */}
            <Field label="Universe name">
              <input
                value={universeName}
                onChange={(e) => setUniverseName(e.target.value)}
                maxLength={60}
                placeholder="e.g. The Whispering Woods"
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </Field>

            {/* Themes */}
            <Field label="Themes" hint="Pick one or more.">
              <ChipPicker
                options={[...THEME_OPTIONS, "Other"]}
                selected={themes}
                onToggle={toggleTheme}
              />
              {themes.includes("Other") && (
                <input
                  value={customTheme}
                  onChange={(e) => setCustomTheme(e.target.value)}
                  placeholder="Tell us more..."
                  className="mt-3 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              )}
            </Field>

            {/* Hero */}
            <div>
              <h3 className="text-sm font-medium text-stone-700 mb-3">Hero</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Name">
                  <input
                    value={heroName}
                    onChange={(e) => setHeroName(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. Mia"
                    className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="Species or type">
                  <input
                    value={heroSpecies}
                    onChange={(e) => setHeroSpecies(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. Rabbit, Robot, Dragon"
                    className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Traits" hint="Pick one or more.">
                  <ChipPicker
                    options={[...TRAIT_OPTIONS, "Other"]}
                    selected={heroTraits}
                    onToggle={toggleHeroTrait}
                  />
                  {heroTraits.includes("Other") && (
                    <input
                      value={heroCustomTrait}
                      onChange={(e) => setHeroCustomTrait(e.target.value)}
                      placeholder="Tell us more..."
                      className="mt-3 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  )}
                </Field>
              </div>
            </div>

            {/* Supporting characters */}
            <div>
              <h3 className="text-sm font-medium text-stone-700 mb-3">Supporting characters</h3>
              <div className="flex gap-2 mb-4">
                <ToggleButton
                  active={supportingMode === "auto"}
                  onClick={() => setSupportingMode("auto")}
                >
                  Auto-create
                </ToggleButton>
                <ToggleButton
                  active={supportingMode === "manual"}
                  onClick={() => setSupportingMode("manual")}
                >
                  I'll add my own
                </ToggleButton>
              </div>
              {supportingMode === "auto" ? (
                <p className="text-xs text-stone-400">
                  We'll invent two friends that fit your world.
                </p>
              ) : (
                <div className="space-y-5">
                  {manualSupporting.map((s, i) => (
                    <div key={i} className="border border-stone-200 rounded-lg p-4 space-y-3">
                      <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                        Friend {i + 1}
                      </p>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Name">
                          <input
                            value={s.name}
                            onChange={(e) => updateSupporting(i, { name: e.target.value })}
                            maxLength={40}
                            placeholder="e.g. Pip"
                            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                          />
                        </Field>
                        <Field label="Species or type">
                          <input
                            value={s.species}
                            onChange={(e) => updateSupporting(i, { species: e.target.value })}
                            maxLength={40}
                            placeholder="e.g. Owl"
                            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                          />
                        </Field>
                      </div>
                      <Field label="Traits">
                        <ChipPicker
                          options={[...TRAIT_OPTIONS, "Other"]}
                          selected={s.traits}
                          onToggle={(t) => toggleSupportingTrait(i, t)}
                        />
                        {s.traits.includes("Other") && (
                          <input
                            value={s.customTrait}
                            onChange={(e) => updateSupporting(i, { customTrait: e.target.value })}
                            placeholder="Tell us more..."
                            className="mt-3 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                          />
                        )}
                      </Field>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep("plan")}
                className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
              >
                &larr; Back
              </button>
              <button
                onClick={handleFinish}
                disabled={!canSubmit}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-2">
        {label}
        {hint && <span className="ml-1 text-stone-400 font-normal">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isSelected = selected.includes(o);
        return (
          <button
            key={o}
            onClick={() => onToggle(o)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              isSelected
                ? "border-primary bg-primary text-white"
                : "border-stone-200 bg-white text-stone-600 hover:border-primary/40"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
        active
          ? "border-primary bg-primary/5 text-stone-800"
          : "border-stone-200 bg-white text-stone-500 hover:border-primary/30"
      }`}
    >
      {children}
    </button>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
          active
            ? "bg-primary text-white"
            : done
              ? "bg-primary/30 text-primary"
              : "bg-stone-200 text-stone-500"
        }`}
      >
        {done ? "✓" : label[0]}
      </div>
      <span className={`text-xs ${active ? "text-stone-800 font-medium" : "text-stone-400"}`}>
        {label}
      </span>
    </div>
  );
}
