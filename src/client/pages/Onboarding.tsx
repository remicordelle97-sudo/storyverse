import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  completeOnboarding,
  completeOnboardingPreset,
  getTemplateUniverses,
  saveShippingAddress,
  skipOnboarding,
  type PrintShippingAddress,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import StoryLoadingScreen from "../components/StoryLoadingScreen";
import UniverseBuilderForm, { UniverseBuilderPayload } from "../components/UniverseBuilderForm";
import AddressForm, { type AddressFormHandle } from "../components/AddressForm";
import { parseStringList } from "../lib/parseStringList";

const ONBOARDING_PHRASES = [
  "Building your universe",
  "Bringing characters to life",
  "Sketching the world",
  "Painting first impressions",
];

const PRESET_PHRASES = ["Setting up your shelf", "Almost ready"];

type Step = "plan" | "address" | "choice" | "preset" | "world";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, refreshUser, logout } = useAuth();
  const [step, setStep] = useState<Step>("plan");
  const [submitting, setSubmitting] = useState(false);
  const [submittingPreset, setSubmittingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const addressFormRef = useRef<AddressFormHandle | null>(null);

  async function handleSubmit(payload: UniverseBuilderPayload) {
    setSubmitting(true);
    try {
      await completeOnboarding(payload);
      await refreshUser();
      navigate("/library");
    } catch (e) {
      setSubmitting(false);
      throw e;
    }
  }

  async function handlePreset(templateUniverseId: string) {
    setSubmittingPreset(true);
    setPresetError(null);
    try {
      await completeOnboardingPreset(templateUniverseId);
      await refreshUser();
      navigate("/library");
    } catch (e: any) {
      setPresetError(e?.message || "Could not load that preset");
      setSubmittingPreset(false);
    }
  }

  if (submitting) return <StoryLoadingScreen phrases={ONBOARDING_PHRASES} />;
  if (submittingPreset) return <StoryLoadingScreen phrases={PRESET_PHRASES} />;

  async function handleAdminSkip() {
    try {
      await skipOnboarding();
      await refreshUser();
      navigate("/library");
    } catch (e: any) {
      console.error("Skip failed:", e?.message);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  async function handleSaveAddress() {
    if (!addressFormRef.current?.validate()) return;
    setAddressError(null);
    setSavingAddress(true);
    try {
      await saveShippingAddress(addressFormRef.current.current() as PrintShippingAddress);
      await refreshUser();
      setStep("choice");
    } catch (e: any) {
      setAddressError(e?.message || "Couldn't save your address");
    } finally {
      setSavingAddress(false);
    }
  }

  return (
    <div className="min-h-screen app-bg flex items-start justify-center py-12 px-4">
      <div className={`w-full ${step === "preset" ? "max-w-6xl" : "max-w-3xl"}`}>
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
          <div className="mt-3 flex items-center justify-center gap-4">
            {user?.role === "admin" && (
              <button
                onClick={handleAdminSkip}
                className="text-xs text-stone-400 hover:text-stone-700 underline transition-colors"
              >
                Skip setup (admin)
              </button>
            )}
            <button
              onClick={handleLogout}
              className="text-xs text-stone-400 hover:text-stone-700 underline transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-10 flex-wrap">
          <StepDot active={step === "plan"} done={step !== "plan"} label="Plan" />
          <div className="w-6 sm:w-8 h-px bg-stone-300" />
          <StepDot
            active={step === "address"}
            done={["choice", "preset", "world"].includes(step)}
            label="Shipping"
          />
          <div className="w-6 sm:w-8 h-px bg-stone-300" />
          <StepDot
            active={step === "choice"}
            done={step === "preset" || step === "world"}
            label="Start"
          />
          <div className="w-6 sm:w-8 h-px bg-stone-300" />
          <StepDot
            active={step === "preset" || step === "world"}
            done={false}
            label="Your world"
          />
        </div>

        {step === "plan" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">Choose your plan</h2>
            <p className="text-sm text-stone-500 mb-6">You can upgrade anytime later.</p>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => setStep("choice")}
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
                onClick={() => setStep("address")}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "address" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">
              Want printed copies later?
            </h2>
            <p className="text-sm text-stone-500 mb-6">
              Save a shipping address now and we'll have it ready when you order
              a real printed copy of one of your stories. You can skip this and
              add one later from your account.
            </p>

            <AddressForm formRef={addressFormRef} busy={savingAddress} />

            {addressError && (
              <div className="mt-4 text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                {addressError}
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-between items-center gap-3">
              <button
                onClick={() => setStep("plan")}
                className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
                disabled={savingAddress}
              >
                &larr; Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep("choice")}
                  className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
                  disabled={savingAddress}
                >
                  Skip for now
                </button>
                <button
                  onClick={handleSaveAddress}
                  disabled={savingAddress}
                  className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {savingAddress ? "Saving…" : "Save & continue"}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "choice" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">How do you want to start?</h2>
            <p className="text-sm text-stone-500 mb-6">
              Build your own universe from scratch, or pick a ready-made one to start reading
              right away. You can always create your own later.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => setStep("world")}
                className="text-left border-2 border-stone-200 rounded-xl p-5 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <h3 className="font-semibold text-stone-800 mb-2">Create my own universe</h3>
                <p className="text-xs text-stone-500">
                  Pick a name, themes, a hero, and friends. Takes a couple minutes — your hero
                  can even be a real toy.
                </p>
              </button>
              <button
                onClick={() => setStep("preset")}
                className="text-left border-2 border-stone-200 rounded-xl p-5 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <h3 className="font-semibold text-stone-800 mb-2">Use a preset for now</h3>
                <p className="text-xs text-stone-500">
                  Start with a ready-made universe so you can read your first story
                  immediately. Build a custom one whenever you're ready.
                </p>
              </button>
            </div>

            <div className="mt-6 flex justify-between items-center">
              <button
                onClick={() => setStep("address")}
                className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
              >
                &larr; Back
              </button>
            </div>
          </div>
        )}

        {step === "preset" && (
          <PresetPicker
            onBack={() => setStep("choice")}
            onPick={handlePreset}
            error={presetError}
          />
        )}

        {step === "world" && (
          <UniverseBuilderForm
            onSubmit={handleSubmit}
            onCancel={() => setStep("choice")}
            cancelLabel="Back"
            submitLabel="Create universe"
          />
        )}
      </div>
    </div>
  );
}

function PresetPicker({
  onBack,
  onPick,
  error,
}: {
  onBack: () => void;
  onPick: (id: string) => void;
  error: string | null;
}) {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: getTemplateUniverses,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-800 mb-1">Pick a preset universe</h2>
      <p className="text-sm text-stone-500 mb-6">
        We'll set this up instantly so you can start reading.
      </p>

      {isLoading ? (
        <p className="text-sm text-stone-400">Loading presets...</p>
      ) : templates.length === 0 ? (
        <div className="text-sm text-stone-400 py-8 text-center space-y-3">
          <p>No presets are available right now.</p>
          <button
            onClick={onBack}
            className="text-primary hover:text-primary/80 transition-colors text-sm font-medium"
          >
            Build your own instead
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {templates.map((t) => {
            const selected = selectedId === t.id;
            const themes = parseStringList(t.themes);
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
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
                  {themes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {themes.map((theme) => (
                        <span
                          key={theme}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-stone-500 whitespace-pre-wrap">
                    {t.settingDescription}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-500 mt-4">{error}</p>}

      <div className="mt-6 flex justify-between items-center">
        <button
          onClick={onBack}
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          &larr; Back
        </button>
        <button
          onClick={() => selectedId && onPick(selectedId)}
          disabled={!selectedId}
          className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          Use this preset
        </button>
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
