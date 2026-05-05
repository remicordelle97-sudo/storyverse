import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeOnboarding,
  completeOnboardingPreset,
  createCheckoutSession,
  getTemplateUniverses,
  saveShippingAddress,
  skipOnboarding,
  type PrintShippingAddress,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import UniverseBuilderForm, { UniverseBuilderPayload } from "../components/UniverseBuilderForm";
import AddressForm, { type AddressFormHandle } from "../components/AddressForm";
import { parseStringList } from "../lib/parseStringList";
import { PREMIUM_MONTHLY_DISPLAY } from "../lib/pricing";

type Step = "address" | "plan" | "choice" | "preset" | "world";
type Plan = "free" | "premium";

export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, refreshUser, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const paidOnReturn = searchParams.get("paid") === "premium";
  // If the user is already premium when they land on onboarding (e.g.
  // they paid then refreshed), reflect that in the plan picker.
  const initialPlan: Plan = user?.plan === "premium" ? "premium" : "free";
  const [step, setStep] = useState<Step>("address");
  const [selectedPlan, setSelectedPlan] = useState<Plan>(initialPlan);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [submittingPreset, setSubmittingPreset] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeCancelledNotice, setUpgradeCancelledNotice] = useState(false);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(paidOnReturn);
  const addressFormRef = useRef<AddressFormHandle | null>(null);

  /**
   * Handle the round-trip from Stripe Checkout. Plan-step Continue
   * with Premium selected calls /billing/create-checkout with
   * returnTo=onboarding, so Stripe sends the user back here:
   *   - success_url adds ?paid=premium → resume on the choice step
   *     (the webhook has flipped User.plan to "premium")
   *   - cancel_url adds ?upgrade_cancelled=1 → stay on the plan step
   *     with an "upgrade cancelled" note so they can retry or pick Free
   */
  useEffect(() => {
    let cancelledEffect = false;
    const paid = searchParams.get("paid");
    const cancelled = searchParams.get("upgrade_cancelled");

    async function resumePremiumFlow() {
      setConfirmingUpgrade(true);
      setUpgradeError(null);
      setUpgradeCancelledNotice(false);

      for (let attempt = 0; attempt < 5; attempt++) {
        const refreshed = await refreshUser();
        if (cancelledEffect) return;
        if (refreshed?.plan === "premium") {
          setSelectedPlan("premium");
          setStep("choice");
          setConfirmingUpgrade(false);
          setSearchParams({}, { replace: true });
          return;
        }
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (cancelledEffect) return;
      setSelectedPlan("premium");
      setStep("plan");
      setUpgradeError(
        "Payment went through, but Premium hasn't finished syncing yet. Please refresh in a moment before continuing.",
      );
      setConfirmingUpgrade(false);
      setSearchParams({}, { replace: true });
    }

    if (paid === "premium") {
      void resumePremiumFlow();
    } else if (cancelled === "1") {
      setConfirmingUpgrade(false);
      setSelectedPlan("free");
      setStep("plan");
      setUpgradeCancelledNotice(true);
      setSearchParams({}, { replace: true });
    } else {
      setConfirmingUpgrade(false);
    }

    return () => {
      cancelledEffect = true;
    };
  }, [refreshUser, searchParams, setSearchParams]);

  async function handlePlanContinue() {
    setUpgradeError(null);
    setUpgradeCancelledNotice(false);
    if (selectedPlan === "premium" && user?.plan !== "premium") {
      // Settle payment before the user invests time in choosing /
      // building a universe. createCheckoutSession redirects through
      // Stripe and back to /onboarding with a query param that the
      // mount-effect above resumes from.
      setUpgrading(true);
      try {
        const { url } = await createCheckoutSession({ returnTo: "onboarding" });
        window.location.assign(url);
        return;
      } catch (e: any) {
        setUpgradeError(e?.message || "Couldn't start checkout");
        setUpgrading(false);
        return;
      }
    }
    setStep("choice");
  }

  async function handleSubmit(payload: UniverseBuilderPayload) {
    // /api/auth/onboard is async (202 + universeId in milliseconds);
    // we don't wait on the build — the global ProgressBanner shows
    // its progress wherever the user lands. Payment (if any) was
    // already settled at the plan step.
    await completeOnboarding(payload);
    await refreshUser();
    queryClient.invalidateQueries({ queryKey: ["universes-my"] });
    queryClient.invalidateQueries({ queryKey: ["progress-banner-universes"] });
    navigate("/library");
  }

  async function handlePreset(templateUniverseId: string) {
    setSubmittingPreset(true);
    setPresetError(null);
    try {
      await completeOnboardingPreset(templateUniverseId);
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ["universes-my"] });
      navigate("/library");
    } catch (e: any) {
      setPresetError(e?.message || "Could not load that preset");
      setSubmittingPreset(false);
    }
  }

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
      setStep("plan");
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
          <StepDot
            active={step === "address"}
            done={["plan", "choice", "preset", "world"].includes(step)}
            label="Shipping"
          />
          <div className="w-6 sm:w-8 h-px bg-stone-300" />
          <StepDot
            active={step === "plan"}
            done={["choice", "preset", "world"].includes(step)}
            label="Plan"
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

        {confirmingUpgrade && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm text-center">
            <h2 className="text-lg font-semibold text-stone-800 mb-2">Confirming Premium…</h2>
            <p className="text-sm text-stone-500">
              We&apos;re waiting for Stripe to confirm your subscription before we continue.
            </p>
          </div>
        )}

        {!confirmingUpgrade && step === "plan" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-800 mb-1">Choose your plan</h2>
            <p className="text-sm text-stone-500 mb-6">You can upgrade anytime later.</p>

            <div className="grid sm:grid-cols-2 gap-4">
              <PlanCard
                name="Free"
                price="$0"
                features={[
                  "1 universe",
                  "2 illustrated stories per month",
                  "10 text-only stories per month",
                ]}
                selected={selectedPlan === "free"}
                onClick={() => setSelectedPlan("free")}
              />
              <PlanCard
                name="Premium"
                price={PREMIUM_MONTHLY_DISPLAY}
                features={[
                  "Unlimited universes",
                  "5 illustrated stories per month",
                  "20 text-only stories per month",
                ]}
                selected={selectedPlan === "premium"}
                onClick={() => setSelectedPlan("premium")}
              />
            </div>
            {selectedPlan === "premium" && user?.plan !== "premium" && (
              <p className="mt-4 text-xs text-stone-500">
                We'll take you to checkout to activate Premium, then come back
                to set up your universe.
              </p>
            )}
            {user?.plan === "premium" && (
              <p className="mt-4 text-xs text-emerald-700">
                Premium is active on your account.
              </p>
            )}
            {upgradeCancelledNotice && (
              <div className="mt-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Upgrade cancelled — pick Free to continue or try Premium again.
              </div>
            )}
            {upgradeError && (
              <div className="mt-4 text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                {upgradeError}
              </div>
            )}

            <div className="mt-6 flex justify-between items-center">
              <button
                onClick={() => setStep("address")}
                className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
                disabled={upgrading}
              >
                &larr; Back
              </button>
              <button
                onClick={handlePlanContinue}
                disabled={upgrading}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {upgrading
                  ? "Redirecting…"
                  : selectedPlan === "premium" && user?.plan !== "premium"
                    ? `Continue to checkout — ${PREMIUM_MONTHLY_DISPLAY}`
                    : "Continue"}
              </button>
            </div>
          </div>
        )}

        {!confirmingUpgrade && step === "address" && (
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

            <div className="mt-6 flex flex-wrap justify-end items-center gap-3">
              <button
                onClick={() => setStep("plan")}
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
        )}

        {!confirmingUpgrade && step === "choice" && (
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
                onClick={() => setStep("plan")}
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
            busy={submittingPreset}
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
  busy,
}: {
  onBack: () => void;
  onPick: (id: string) => void;
  error: string | null;
  busy?: boolean;
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
          disabled={busy}
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors disabled:opacity-50"
        >
          &larr; Back
        </button>
        <button
          onClick={() => selectedId && onPick(selectedId)}
          disabled={!selectedId || busy}
          className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Use this preset"}
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  name,
  price,
  features,
  selected,
  onClick,
}: {
  name: string;
  price: string;
  features: string[];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-pressed={selected}
      className={`text-left border-2 rounded-xl p-5 transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-stone-200 bg-white hover:border-stone-300"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-stone-800">{name}</h3>
        {selected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-white font-medium">
            Selected
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-stone-800 mb-3">{price}</p>
      <ul className="text-xs text-stone-600 space-y-1.5">
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
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
