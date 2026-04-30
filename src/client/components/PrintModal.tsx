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

// Fields whose presence we require. street2 is intentionally optional.
const REQUIRED_FIELDS = new Set<keyof PrintShippingAddress>([
  "name",
  "street1",
  "city",
  "state_code",
  "country_code",
  "postcode",
  "phone_number",
]);

const FIELD_LABEL: Record<keyof PrintShippingAddress, string> = {
  name: "Full name",
  street1: "Street address",
  street2: "Apartment / unit",
  city: "City",
  state_code: "State / region",
  country_code: "Country",
  postcode: "Postal code",
  phone_number: "Phone",
};

// Per-field validation. Returns an error string for the first rule
// that fails, or null if the field is valid. Validation is forgiving:
// non-empty + format hint where helpful (postcode, phone, country).
// Lulu does its own definitive validation server-side at quote time.
function validateField(
  field: keyof PrintShippingAddress,
  value: string
): string | null {
  const v = value.trim();
  if (REQUIRED_FIELDS.has(field) && !v) {
    return `${FIELD_LABEL[field]} is required`;
  }
  if (!v) return null;
  switch (field) {
    case "country_code":
      if (!/^[A-Z]{2}$/.test(v)) return "Use a 2-letter country code (e.g. US)";
      break;
    case "state_code":
      // Lulu wants ISO subdivision codes for US/CA (e.g. CA, NY, ON).
      // For other countries the format varies wildly — accept anything
      // non-empty and let Lulu validate.
      if (v.length > 6) return "State / region looks too long";
      break;
    case "postcode":
      if (!/^[A-Za-z0-9 \-]{2,12}$/.test(v)) return "Postal code looks invalid";
      break;
    case "phone_number":
      // Strip allowed separators; require 7+ digits. Lulu accepts most
      // formats so we stay permissive.
      if ((v.match(/\d/g)?.length ?? 0) < 7) return "Phone number looks too short";
      break;
    case "name":
      if (v.length < 2) return "Name looks too short";
      break;
  }
  return null;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Print-on-demand modal.
 *
 * Two-step flow: collect address → /quote → confirm → /checkout →
 * Stripe redirect. The Stripe success_url lands on /print/orders/:id
 * which polls the order until Lulu accepts.
 *
 * Validation runs per-field on blur (so users aren't yelled at while
 * typing) and a final pass on submit. Server-level errors (Lulu
 * rejecting a region, etc.) surface in a single banner above the
 * actions.
 */
export default function PrintModal({ storyId, storyTitle, onClose }: PrintModalProps) {
  const [address, setAddress] = useState<PrintShippingAddress>(EMPTY_ADDRESS);
  const [touched, setTouched] = useState<Partial<Record<keyof PrintShippingAddress, boolean>>>({});
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof PrintShippingAddress, string>>
  >({});
  const [quote, setQuote] = useState<PrintQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function update<K extends keyof PrintShippingAddress>(
    key: K,
    value: PrintShippingAddress[K]
  ) {
    setAddress((prev) => ({ ...prev, [key]: value }));
    // As the user fixes a field that already showed an error, clear it
    // immediately — don't make them blur to be told they fixed it.
    if (fieldErrors[key]) {
      const error = validateField(key, value as string);
      setFieldErrors((prev) => ({ ...prev, [key]: error || undefined }));
    }
    // Address change invalidates the existing quote.
    if (quote) setQuote(null);
  }

  function handleBlur<K extends keyof PrintShippingAddress>(key: K) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const error = validateField(key, (address[key] || "") as string);
    setFieldErrors((prev) => ({ ...prev, [key]: error || undefined }));
  }

  function validateAll(): boolean {
    const errors: Partial<Record<keyof PrintShippingAddress, string>> = {};
    for (const key of Object.keys(FIELD_LABEL) as (keyof PrintShippingAddress)[]) {
      const error = validateField(key, (address[key] || "") as string);
      if (error) errors[key] = error;
    }
    setFieldErrors(errors);
    // Mark every field as touched so all errors render at once on submit.
    const allTouched = Object.fromEntries(
      Object.keys(FIELD_LABEL).map((k) => [k, true])
    ) as Record<keyof PrintShippingAddress, boolean>;
    setTouched(allTouched);
    return Object.keys(errors).length === 0;
  }

  async function handleQuote() {
    setServerError(null);
    if (!validateAll()) return;
    setLoading(true);
    try {
      const result = await getPrintQuote({ storyId, shippingAddress: address });
      setQuote(result);
    } catch (e: any) {
      setServerError(e?.message || "We couldn't get a quote for this address.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout() {
    setServerError(null);
    setLoading(true);
    try {
      const result = await startPrintCheckout({
        storyId,
        shippingAddress: address,
      });
      // Hard nav — Stripe owns the next page.
      window.location.assign(result.url);
    } catch (e: any) {
      setServerError(e?.message || "Failed to start checkout");
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
          onKeyDownCapture={(e) => {
            // Stop the reader's global Arrow/Space/Esc handler from
            // hijacking keystrokes while the user types in the form.
            // (The reader-level handler already opts out via showPrintModal,
            // but capturing here is belt-and-suspenders against future
            // additions.)
            e.stopPropagation();
          }}
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
              <Field
                className="col-span-2"
                field="name"
                value={address.name}
                onChange={(v) => update("name", v)}
                onBlur={() => handleBlur("name")}
                error={touched.name ? fieldErrors.name : undefined}
                placeholder="Jane Doe"
                required
                autoComplete="name"
              />
              <Field
                className="col-span-2"
                field="street1"
                value={address.street1}
                onChange={(v) => update("street1", v)}
                onBlur={() => handleBlur("street1")}
                error={touched.street1 ? fieldErrors.street1 : undefined}
                placeholder="123 Main St"
                required
                autoComplete="address-line1"
              />
              <Field
                className="col-span-2"
                field="street2"
                value={address.street2 || ""}
                onChange={(v) => update("street2", v)}
                onBlur={() => handleBlur("street2")}
                placeholder="Apt 4B (optional)"
                autoComplete="address-line2"
              />
              <Field
                field="city"
                value={address.city}
                onChange={(v) => update("city", v)}
                onBlur={() => handleBlur("city")}
                error={touched.city ? fieldErrors.city : undefined}
                required
                autoComplete="address-level2"
              />
              <Field
                field="state_code"
                value={address.state_code}
                onChange={(v) => update("state_code", v.toUpperCase().slice(0, 6))}
                onBlur={() => handleBlur("state_code")}
                error={touched.state_code ? fieldErrors.state_code : undefined}
                placeholder="CA"
                required
                autoComplete="address-level1"
              />
              <Field
                field="postcode"
                value={address.postcode}
                onChange={(v) => update("postcode", v)}
                onBlur={() => handleBlur("postcode")}
                error={touched.postcode ? fieldErrors.postcode : undefined}
                required
                autoComplete="postal-code"
              />
              <Field
                field="country_code"
                value={address.country_code}
                onChange={(v) => update("country_code", v.toUpperCase().slice(0, 2))}
                onBlur={() => handleBlur("country_code")}
                error={touched.country_code ? fieldErrors.country_code : undefined}
                placeholder="US"
                required
                autoComplete="country"
              />
              <Field
                className="col-span-2"
                field="phone_number"
                value={address.phone_number}
                onChange={(v) => update("phone_number", v)}
                onBlur={() => handleBlur("phone_number")}
                error={touched.phone_number ? fieldErrors.phone_number : undefined}
                placeholder="555-555-1234"
                required
                autoComplete="tel"
              />
            </div>

            {serverError && (
              <div className="text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                {serverError}
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
                  Tax (if any) collected at checkout. Standard mail arrives in
                  ~10–14 days.
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

interface FieldProps {
  field: keyof PrintShippingAddress;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}

function Field({
  field,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  required,
  autoComplete,
  className,
}: FieldProps) {
  const hasError = Boolean(error);
  return (
    <div className={className}>
      <label
        className="block text-xs font-medium text-stone-600 mb-0.5"
        htmlFor={`print-field-${field}`}
      >
        {FIELD_LABEL[field]}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      <input
        id={`print-field-${field}`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={hasError}
        aria-describedby={hasError ? `print-field-${field}-error` : undefined}
        className={`w-full px-3 py-2 rounded-lg border bg-white text-stone-800 text-sm focus:outline-none focus:ring-2 transition-colors ${
          hasError
            ? "border-red-400 focus:ring-red-400"
            : "border-stone-300 focus:ring-amber-500"
        }`}
      />
      {hasError && (
        <p
          id={`print-field-${field}-error`}
          className="mt-1 text-[11px] text-red-700"
        >
          {error}
        </p>
      )}
    </div>
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

