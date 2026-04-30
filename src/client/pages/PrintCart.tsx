import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPrintCart,
  removeFromPrintCart,
  checkoutPrintCart,
} from "../api/client";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PrintCart() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cancelled = searchParams.get("checkout") === "cancelled";
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["print-cart"],
    queryFn: getPrintCart,
  });

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleRemove(itemId: string) {
    setActionError(null);
    setBusy(true);
    try {
      await removeFromPrintCart(itemId);
      await refetch();
    } catch (e: any) {
      setActionError(e?.message || "Failed to remove item");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout() {
    setActionError(null);
    setBusy(true);
    try {
      const result = await checkoutPrintCart();
      // Hard nav — Stripe owns the next page. Invalidate the cart so a
      // back-button return shows the now-empty list.
      queryClient.invalidateQueries({ queryKey: ["print-cart"] });
      window.location.assign(result.url);
    } catch (e: any) {
      setActionError(e?.message || "Failed to start checkout");
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500" style={{ fontFamily: "Lexend, sans-serif" }}>
          Loading your print list…
        </p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-stone-700" style={{ fontFamily: "Lexend, sans-serif" }}>
          We couldn't load your print list.
        </p>
        <button
          onClick={() => navigate("/library")}
          className="text-stone-500 hover:text-stone-800 text-sm transition-colors"
        >
          Back to library
        </button>
      </div>
    );
  }

  const empty = data.items.length === 0;

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ fontFamily: "Lexend, sans-serif" }}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/library")}
            className="text-stone-500 hover:text-stone-800 text-sm transition-colors"
          >
            &larr; Back to library
          </button>
          <h1 className="text-2xl font-bold text-stone-900">Waiting to print</h1>
        </div>

        {cancelled && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
            Checkout was cancelled — your print list is still here.
          </div>
        )}

        {/* Address summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-stone-500 mb-1">
                Ship to
              </p>
              {data.address ? (
                <div className="text-sm text-stone-700 leading-relaxed">
                  <div className="font-semibold text-stone-900">{data.address.name}</div>
                  <div>{data.address.street1}</div>
                  {data.address.street2 && <div>{data.address.street2}</div>}
                  <div>
                    {data.address.city}, {data.address.state_code} {data.address.postcode}
                  </div>
                  <div>{data.address.country_code}</div>
                </div>
              ) : (
                <p className="text-sm text-stone-500">
                  No shipping address saved yet. Add one to check out.
                </p>
              )}
            </div>
            <Link
              to="/account"
              className="text-sm text-amber-700 hover:text-amber-800 font-medium transition-colors whitespace-nowrap"
            >
              {data.address ? "Edit" : "Add address"}
            </Link>
          </div>
        </div>

        {/* Items */}
        {empty ? (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-10 text-center space-y-2">
            <p className="text-stone-700">Your print list is empty.</p>
            <p className="text-sm text-stone-500">
              Open a story and tap "Add to print list" to queue it for a printed copy.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.items.map((item) => {
              const perItem = data.quote?.perItem.find((p) => p.id === item.id);
              return (
                <li
                  key={item.id}
                  className="bg-white rounded-xl shadow-sm border border-stone-200 p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-stone-900 truncate">{item.storyTitle}</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      {item.sceneCount} pages · printed copy
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-sm text-stone-600">
                      {perItem ? formatCents(Math.round(perItem.printCostCents * 1.5)) : "—"}
                    </span>
                    <button
                      onClick={() => handleRemove(item.id)}
                      disabled={busy}
                      className="text-stone-400 hover:text-red-700 text-sm transition-colors"
                      aria-label={`Remove ${item.storyTitle}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Quote summary */}
        {!empty && data.quote && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5 space-y-1.5">
            <Row
              label="Print"
              value={formatCents(Math.round(data.quote.printCostCents * 1.5))}
              muted
            />
            <Row label="Shipping" value={formatCents(data.quote.shippingCostCents)} muted />
            <div className="border-t border-stone-300 pt-2 mt-2">
              <Row
                label="Total"
                value={formatCents(data.quote.customerPriceCents)}
                bold
              />
            </div>
            <p className="text-[11px] text-stone-500 mt-2">
              Tax (if any) collected at checkout. Standard mail arrives in ~10–14 days.
            </p>
          </div>
        )}

        {!empty && !data.quote && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
            {!data.luluConfigured
              ? "Print isn't configured right now."
              : !data.hasAddress
                ? "Add a shipping address to see the total and check out."
                : "Couldn't load a quote — try again in a moment."}
          </div>
        )}

        {actionError && (
          <div className="bg-red-100 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        {!empty && (
          <div className="flex justify-end">
            <button
              onClick={handleCheckout}
              disabled={busy || !data.quote || !data.hasAddress}
              className="px-6 py-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {busy
                ? "Redirecting…"
                : data.quote
                  ? `Pay ${formatCents(data.quote.customerPriceCents)} & order`
                  : "Add address to continue"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between items-baseline ${
        bold ? "font-bold text-stone-900" : muted ? "text-stone-600" : ""
      }`}
    >
      <span className="text-sm">{label}</span>
      <span className={bold ? "text-base" : "text-sm"}>{value}</span>
    </div>
  );
}
