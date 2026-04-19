import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTemplateUniverses, completeOnboarding } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState<"plan" | "universe" | "hero">("plan");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [heroName, setHeroName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: getTemplateUniverses,
    enabled: step === "universe" || step === "hero",
  });

  const selectedTemplateData = templates.find((t: any) => t.id === selectedTemplate);
  const templateMainCharacter = selectedTemplateData?.characters?.find((c: any) => c.role === "main");

  function goToHero() {
    if (!selectedTemplate) return;
    // Always prefill with the current template's main character — picking a
    // different universe after going back shouldn't keep the old default.
    setHeroName(templateMainCharacter?.name || "");
    setStep("hero");
  }

  async function handleFinish() {
    if (!selectedTemplate) return;
    const trimmed = heroName.trim();
    if (!trimmed) {
      setError("Please give your hero a name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding(selectedTemplate, trimmed);
      await refreshUser();
      navigate("/library");
    } catch (e: any) {
      setError(e.message || "Failed to complete setup");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-start justify-center py-12 px-4">
      <div className="max-w-3xl w-full">
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
          <StepDot active={step === "plan"} done={step === "universe" || step === "hero"} label="Plan" />
          <div className="w-8 h-px bg-stone-300" />
          <StepDot active={step === "universe"} done={step === "hero"} label="Universe" />
          <div className="w-8 h-px bg-stone-300" />
          <StepDot active={step === "hero"} done={false} label="Hero" />
        </div>

        {step === "plan" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">Choose your plan</h2>
            <p className="text-sm text-stone-500 mb-6">
              You can upgrade anytime later.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => setStep("universe")}
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
                onClick={() => setStep("universe")}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "universe" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-6">Pick your first universe</h2>

            {isLoading ? (
              <p className="text-sm text-stone-400 py-8 text-center">Loading universes...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-stone-400 py-8 text-center">
                No universes available yet. Please check back soon.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {templates.map((t: any) => {
                  const selected = selectedTemplate === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplate(t.id)}
                      className={`text-left rounded-xl overflow-hidden border-2 transition-colors ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-stone-200 bg-white hover:border-stone-300"
                      }`}
                    >
                      {t.styleReferenceUrl && (
                        <div className="aspect-[4/3] bg-stone-100">
                          <img
                            src={t.styleReferenceUrl}
                            alt={t.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="p-4">
                        <h3 className="font-semibold text-stone-800 mb-1">{t.name}</h3>
                        <p className="text-xs text-stone-500 whitespace-pre-wrap">
                          {t.settingDescription}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex justify-between items-center">
              <button
                onClick={() => setStep("plan")}
                className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
              >
                &larr; Back
              </button>
              <button
                onClick={goToHero}
                disabled={!selectedTemplate}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "hero" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">Name your hero</h2>
            <p className="text-sm text-stone-500 mb-6">
              This is the star of every story in your universe.
            </p>

            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {templateMainCharacter?.referenceImageUrl && (
                <img
                  src={templateMainCharacter.referenceImageUrl}
                  alt="Main character"
                  className="w-32 h-32 object-cover rounded-xl border border-stone-200 flex-shrink-0"
                />
              )}
              <div className="flex-1 w-full">
                <label className="block text-xs font-medium text-stone-600 mb-2">
                  Hero's name
                </label>
                <input
                  autoFocus
                  value={heroName}
                  onChange={(e) => setHeroName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && heroName.trim() && !submitting) handleFinish();
                  }}
                  maxLength={40}
                  placeholder={templateMainCharacter?.name || "Pick a name"}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-[11px] text-stone-400 mt-2">
                  The default name is <span className="font-medium text-stone-500">{templateMainCharacter?.name || "—"}</span>. You can keep it or pick your own.
                </p>
              </div>
            </div>

            {error && <p className="text-xs text-red-500 mt-4">{error}</p>}

            <div className="mt-6 flex justify-between items-center">
              <button
                onClick={() => setStep("universe")}
                className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
                disabled={submitting}
              >
                &larr; Back
              </button>
              <button
                onClick={handleFinish}
                disabled={!heroName.trim() || submitting}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting ? "Setting up..." : "Finish setup"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
