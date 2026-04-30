import { useState } from "react";
import {
  getPrintQuote,
  startPrintCheckout,
  type PrintQuote,
  type PrintShippingAddress,
} from "../api/client";

interface PrintModalProps {
  storyId: string;
  storyTitle: string;
  onClose: () => void;
}

const EMPTY_ADDRESS: PrintShippingAddress = {
  name: "",
  street1: "",
  street2: "",
  city: "",
  state_code: "",
  country_code: "US",
  postcode: "",
  phone_number: "",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function isAddressComplete(address: PrintShippingAddress): boolean {
  return Boolean(
    address.name.trim() &&
      address.street1.trim() &&
      address.city.trim() &&
      address.state_code.trim() &&
      address.country_code.trim() &&
      address.postcode.trim() &&
      address.phone_number.trim()
  );
}

/**
 * Print-on-demand modal.
 *
 * Two-step flow:
 *   1. User enters shipping address; clicks "Get quote" → calls
 *      /api/print/quote and shows the price breakdown.
 *   2. User confirms; clicks "Pay & order" → calls /api/print/checkout
 *      and is redirected to Stripe Checkout. The Stripe success_url
 *      lands on /print/orders/:id which polls the order until Lulu
 *      accepts.
 */
export default function PrintModal({ storyId, storyTitle, onClose }: PrintModalProps) {
  const [address, setAddress] = useState<PrintShippingAddress>(EMPTY_ADDRESS);
  const [quote, setQuote] = useState<PrintQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof PrintShippingAddress>(
    key: K,
    value: PrintShippingAddress[K]
  ) {
    setAddress((prev) => ({ ...prev, [key]: value }));
    // Address change invalidates the existing quote — force the user
    // to re-quote so the price they pay matches what we got from Lulu.
    if (quote) setQuote(null);
  }

  async function handleQuote() {
    if (!isAddressComplete(address)) {
      setError("Please fill in every shipping field.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await getPrintQuote({ storyId, shippingAddress: address });
      setQuote(result);
    } catch (e: any) {
      setError(e?.message || "Failed to get quote");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout() {
    setError(null);
    setLoading(true);
    try {
      const result = await startPrintCheckout({
        storyId,
        shippingAddress: address,
      });
      // Hard nav — Stripe owns the next page.
      window.location.assign(result.url);
    } catch (e: any) {
      setError(e?.message || "Failed to start checkout");
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-[#F5ECD7] text-stone-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto pointer-events-auto"
          style={{ fontFamily: "Lexend, sans-serif" }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-300">
            <div>
              <h2 className="text-lg font-bold">Print "{storyTitle}"</h2>
              <p className="text-xs text-stone-500">
                A real, printed children's book — shipped to your door.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-stone-500 hover:text-stone-800 text-2xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          <div className="px-6 py-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Full name</Label>
                <Input
                  value={address.name}
                  onChange={(v) => update("name", v)}
                  placeholder="Jane Doe"
                />
              </div>
              <div className="col-span-2">
                <Label>Street address</Label>
                <Input
                  value={address.street1}
                  onChange={(v) => update("street1", v)}
                  placeholder="123 Main St"
                />
              </div>
              <div className="col-span-2">
                <Label>Apartment / unit (optional)</Label>
                <Input
                  value={address.street2 || ""}
                  onChange={(v) => update("street2", v)}
                  placeholder="Apt 4B"
                />
              </div>
              <div>
                <Label>City</Label>
                <Input value={address.city} onChange={(v) => update("city", v)} />
              </div>
              <div>
                <Label>State / region</Label>
                <Input
                  value={address.state_code}
                  onChange={(v) => update("state_code", v.toUpperCase().slice(0, 4))}
                  placeholder="CA"
                />
              </div>
              <div>
                <Label>Postal code</Label>
                <Input
                  value={address.postcode}
                  onChange={(v) => update("postcode", v)}
                />
              </div>
              <div>
                <Label>Country</Label>
                <Input
                  value={address.country_code}
                  onChange={(v) => update("country_code", v.toUpperCase().slice(0, 2))}
                  placeholder="US"
                />
              </div>
              <div className="col-span-2">
                <Label>Phone</Label>
                <Input
                  value={address.phone_number}
                  onChange={(v) => update("phone_number", v)}
                  placeholder="555-555-1234"
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {quote && (
              <div className="bg-white/60 border border-stone-300 rounded-xl p-4 space-y-1.5">
                <PriceRow label="Print" value={formatCents(quote.printCostCents)} muted />
                <PriceRow
                  label="Shipping"
                  value={formatCents(quote.shippingCostCents)}
                  muted
                />
                <div className="border-t border-stone-300 pt-2 mt-2">
                  <PriceRow
                    label="You pay"
                    value={formatCents(quote.customerPriceCents)}
                    bold
                  />
                </div>
                <p className="text-[11px] text-stone-500 mt-2">
                  Tax (if any) collected at checkout. Shipping arrives in ~10–14
                  days for standard mail.
                </p>
              </div>
            )}
          </div>

          <div className="px-6 pb-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-stone-700 hover:bg-stone-200 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            {!quote ? (
              <button
                onClick={handleQuote}
                disabled={loading}
                className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors disabled:opacity-50"
              >
                {loading ? "Getting quote..." : "Get quote"}
              </button>
            ) : (
              <button
                onClick={handleCheckout}
                disabled={loading}
                className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium transition-colors disabled:opacity-50"
              >
                {loading ? "Redirecting..." : `Pay ${formatCents(quote.customerPriceCents)}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-stone-600 mb-0.5">
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-stone-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
    />
  );
}

function PriceRow({
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
