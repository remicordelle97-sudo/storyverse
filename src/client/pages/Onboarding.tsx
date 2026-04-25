import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeOnboarding } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import StoryLoadingScreen from "../components/StoryLoadingScreen";
import UniverseBuilderForm, { UniverseBuilderPayload } from "../components/UniverseBuilderForm";

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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(payload: UniverseBuilderPayload) {
    setSubmitting(true);
    try {
      await completeOnboarding(payload);
      await refreshUser();
      navigate("/library");
    } catch (e) {
      // The form surfaces errors itself; rethrow so the form re-enables
      // its submit state.
      setSubmitting(false);
      throw e;
    }
  }

  if (submitting) {
    return <StoryLoadingScreen phrases={ONBOARDING_PHRASES} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-3xl">
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
          <UniverseBuilderForm
            onSubmit={handleSubmit}
            onCancel={() => setStep("plan")}
            cancelLabel="Back"
            submitLabel="Confirm"
          />
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
