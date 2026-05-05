import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getAccount,
  saveShippingAddress,
  clearShippingAddress,
  getStoryQuota,
  createCheckoutSession,
  createPortalSession,
} from "../api/client";
import AddressForm, { type AddressFormHandle } from "../components/AddressForm";
import { useAuth } from "../auth/AuthContext";
import { PREMIUM_MONTHLY_DISPLAY } from "../lib/pricing";

export default function Account() {
  const navigate = useNavigate();
  const { user, isAdmin, refreshUser } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["account"],
    queryFn: getAccount,
  });
  const { data: quota } = useQuery({
    queryKey: ["story-quota"],
    queryFn: getStoryQuota,
  });
  const formRef = useRef<AddressFormHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  async function handleUpgrade() {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { url } = await createCheckoutSession();
      window.location.assign(url);
    } catch (e: any) {
      setBillingError(e?.message || "Couldn't start checkout");
      setBillingBusy(false);
    }
  }

  async function handleManage() {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { url } = await createPortalSession();
      window.location.assign(url);
    } catch (e: any) {
      setBillingError(e?.message || "Couldn't open billing portal");
      setBillingBusy(false);
    }
  }

  const plan = isAdmin ? "admin" : user?.plan || "free";

  // Hide the "Saved" banner after a few seconds.
  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  async function handleSave() {
    setServerError(null);
    if (!formRef.current?.validate()) return;
    const address = formRef.current.current();
    setSaving(true);
    try {
      await saveShippingAddress(address);
      await Promise.all([refetch(), refreshUser()]);
      setSavedAt(Date.now());
    } catch (e: any) {
      setServerError(e?.message || "Failed to save address");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm("Remove your saved shipping address?")) return;
    setSaving(true);
    setServerError(null);
    try {
      await clearShippingAddress();
      await Promise.all([refetch(), refreshUser()]);
    } catch (e: any) {
      setServerError(e?.message || "Failed to clear address");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ fontFamily: "Lexend, sans-serif" }}
    >
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/library")}
            className="text-stone-500 hover:text-stone-800 text-sm transition-colors"
          >
            &larr; Back to library
          </button>
          <h1 className="text-2xl font-bold text-stone-900">Account</h1>
        </div>

        {isLoading || !data ? (
          <p className="text-stone-500 text-center py-12">Loading…</p>
        ) : (
          <>
            <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-stone-500">
                  Signed in as
                </p>
                <p className="font-semibold text-stone-900">{data.name}</p>
                <p className="text-sm text-stone-500">{data.email}</p>
              </div>
            </section>

            {/* Plan + this-month usage. Admin sees a read-only badge —
                they don't have a Stripe subscription. */}
            <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-semibold text-stone-900">Plan</h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {plan === "premium"
                      ? "You're on Premium."
                      : plan === "admin"
                        ? "Admin account — unlimited everything."
                        : "You're on the Free plan."}
                  </p>
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                    plan === "premium"
                      ? "bg-amber-200 text-amber-900"
                      : plan === "admin"
                        ? "bg-stone-200 text-stone-700"
                        : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {plan}
                </span>
              </div>

              {quota && plan !== "admin" && (
                <div className="grid grid-cols-2 gap-3 text-xs text-stone-600">
                  <QuotaTile
                    label="Illustrated stories"
                    used={quota.illustrated.used}
                    limit={quota.illustrated.limit}
                  />
                  <QuotaTile
                    label="Text-only stories"
                    used={quota.text.used}
                    limit={quota.text.limit}
                  />
                </div>
              )}

              {billingError && (
                <div className="text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                  {billingError}
                </div>
              )}

              {plan === "free" && (
                <button
                  onClick={handleUpgrade}
                  disabled={billingBusy}
                  className="w-full py-2.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {billingBusy
                    ? "Redirecting…"
                    : `Upgrade to Premium — ${PREMIUM_MONTHLY_DISPLAY}`}
                </button>
              )}
              {plan === "premium" && (
                <button
                  onClick={handleManage}
                  disabled={billingBusy}
                  className="w-full py-2.5 rounded-lg border border-stone-300 hover:border-stone-400 text-stone-800 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {billingBusy ? "Opening…" : "Manage subscription"}
                </button>
              )}
            </section>

            {/* Print-related shortcuts. The library nav menu used to
                expose these directly; consolidating them under
                /account keeps the top-level nav tidier. */}
            <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-2">
              <h2 className="font-semibold text-stone-900 mb-2">Printed books</h2>
              <button
                onClick={() => navigate("/print/cart")}
                className="w-full text-left px-4 py-3 rounded-lg border border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-colors"
              >
                <p className="text-sm font-medium text-stone-800">Waiting to print</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Books you've added to your print list.
                </p>
              </button>
              <button
                onClick={() => navigate("/orders")}
                className="w-full text-left px-4 py-3 rounded-lg border border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-colors"
              >
                <p className="text-sm font-medium text-stone-800">My printed books</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Past and pending print orders.
                </p>
              </button>
            </section>

            <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-stone-900">Shipping address</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Used when you order printed copies of your books.
                </p>
              </div>
              <AddressForm
                initialValue={data.shippingAddress}
                formRef={formRef}
                busy={saving}
              />
              {serverError && (
                <div className="text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                  {serverError}
                </div>
              )}
              {savedAt && (
                <div className="text-sm text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-lg px-3 py-2">
                  Saved.
                </div>
              )}
              <div className="flex gap-3 justify-end pt-2">
                {data.shippingAddress && (
                  <button
                    onClick={handleClear}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save address"}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function QuotaTile({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  // limit === Infinity comes back as `null` over JSON. Treat both as
  // "no cap" so the tile renders sensibly for premium / admin.
  const isInfinite = !Number.isFinite(limit) || limit === null;
  const display = isInfinite ? `${used} this month` : `${used} / ${limit}`;
  const exhausted = !isInfinite && used >= limit;
  return (
    <div className="rounded-lg border border-stone-200 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p
        className={`text-sm font-semibold mt-0.5 ${
          exhausted ? "text-red-700" : "text-stone-800"
        }`}
      >
        {display}
      </p>
      {!isInfinite && (
        <p className="text-[10px] text-stone-500 mt-0.5">
          Resets on the 1st of each month
        </p>
      )}
    </div>
  );
}
