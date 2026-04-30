import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getAccount,
  saveShippingAddress,
  clearShippingAddress,
  type PrintShippingAddress,
} from "../api/client";
import AddressForm, { type AddressFormHandle } from "../components/AddressForm";
import { useAuth } from "../auth/AuthContext";

export default function Account() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["account"],
    queryFn: getAccount,
  });
  const formRef = useRef<AddressFormHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
