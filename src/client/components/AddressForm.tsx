import { useState, useEffect } from "react";
import type { PrintShippingAddress } from "../api/client";

interface AddressFormProps {
  // Optional starter values (e.g. an address pulled from /api/account).
  initialValue?: PrintShippingAddress | null;
  onChange?: (address: PrintShippingAddress, valid: boolean) => void;
  // Submit lives outside the form (modal footer / page footer); we
  // expose `validate` via the imperative ref instead of a
  // <form onSubmit>. Parent components call validate() before saving.
  busy?: boolean;
  className?: string;
}

const EMPTY: PrintShippingAddress = {
  name: "",
  street1: "",
  street2: "",
  city: "",
  state_code: "",
  country_code: "US",
  postcode: "",
  phone_number: "",
};

const REQUIRED = new Set<keyof PrintShippingAddress>([
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

// Per-field validation. Mirror server-side validateShippingAddress
// (lib/shippingAddress.ts) — when one tightens, the other should too.
function validateField(
  field: keyof PrintShippingAddress,
  value: string
): string | null {
  const v = value.trim();
  if (REQUIRED.has(field) && !v) {
    return `${FIELD_LABEL[field]} is required`;
  }
  if (!v) return null;
  switch (field) {
    case "country_code":
      if (!/^[A-Z]{2}$/.test(v)) return "Use a 2-letter country code (e.g. US)";
      break;
    case "state_code":
      if (v.length > 6) return "State / region looks too long";
      break;
    case "postcode":
      if (!/^[A-Za-z0-9 \-]{2,12}$/.test(v)) return "Postal code looks invalid";
      break;
    case "phone_number":
      if ((v.match(/\d/g)?.length ?? 0) < 7) return "Phone number looks too short";
      break;
    case "name":
      if (v.length < 2) return "Name looks too short";
      break;
  }
  return null;
}

function isAddressValid(address: PrintShippingAddress): boolean {
  for (const key of Object.keys(FIELD_LABEL) as (keyof PrintShippingAddress)[]) {
    if (validateField(key, (address[key] || "") as string)) return false;
  }
  return true;
}

export interface AddressFormHandle {
  /** Run a full validation pass; mark every field touched so errors render. */
  validate: () => boolean;
  /** Current address value (canonicalised — uppercased country, etc). */
  current: () => PrintShippingAddress;
}

/**
 * Reusable shipping-address form. Renders inline per-field errors on
 * blur, with format hints for country, postcode, phone, and state.
 * Used in onboarding, /account, and the cart checkout flow.
 *
 * Parent components drive submission — call `onChange` to react to
 * edits and `validate()` (returned via ref) before saving.
 */
export default function AddressForm({
  initialValue,
  onChange,
  busy,
  className,
  formRef,
}: AddressFormProps & { formRef?: { current: AddressFormHandle | null } }) {
  const [address, setAddress] = useState<PrintShippingAddress>(initialValue || EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof PrintShippingAddress, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof PrintShippingAddress, string>>>({});

  // Bubble the latest value + validity to the parent on every change.
  useEffect(() => {
    onChange?.(address, isAddressValid(address));
    // omit onChange to avoid retriggering when the parent re-renders
    // with a new lambda — its identity isn't part of our truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // If a new initialValue arrives (e.g. /account loads asynchronously)
  // adopt it as long as the user hasn't started typing.
  useEffect(() => {
    if (initialValue && Object.keys(touched).length === 0) {
      setAddress(initialValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  // Expose validate() and current() to parents via the ref. Sync each
  // render — ref is just a write target, not a reactive value.
  if (formRef) {
    formRef.current = {
      validate: () => {
        const next: Partial<Record<keyof PrintShippingAddress, string>> = {};
        for (const key of Object.keys(FIELD_LABEL) as (keyof PrintShippingAddress)[]) {
          const error = validateField(key, (address[key] || "") as string);
          if (error) next[key] = error;
        }
        setErrors(next);
        const allTouched = Object.fromEntries(
          Object.keys(FIELD_LABEL).map((k) => [k, true])
        ) as Record<keyof PrintShippingAddress, boolean>;
        setTouched(allTouched);
        return Object.keys(next).length === 0;
      },
      current: () => address,
    };
  }

  function update<K extends keyof PrintShippingAddress>(
    key: K,
    value: PrintShippingAddress[K]
  ) {
    setAddress((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      const error = validateField(key, value as string);
      setErrors((prev) => ({ ...prev, [key]: error || undefined }));
    }
  }

  function handleBlur<K extends keyof PrintShippingAddress>(key: K) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const error = validateField(key, (address[key] || "") as string);
    setErrors((prev) => ({ ...prev, [key]: error || undefined }));
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${className || ""}`}>
      <Field
        className="col-span-2"
        field="name"
        value={address.name}
        onChange={(v) => update("name", v)}
        onBlur={() => handleBlur("name")}
        error={touched.name ? errors.name : undefined}
        placeholder="Jane Doe"
        required
        autoComplete="name"
        disabled={busy}
      />
      <Field
        className="col-span-2"
        field="street1"
        value={address.street1}
        onChange={(v) => update("street1", v)}
        onBlur={() => handleBlur("street1")}
        error={touched.street1 ? errors.street1 : undefined}
        placeholder="123 Main St"
        required
        autoComplete="address-line1"
        disabled={busy}
      />
      <Field
        className="col-span-2"
        field="street2"
        value={address.street2 || ""}
        onChange={(v) => update("street2", v)}
        onBlur={() => handleBlur("street2")}
        placeholder="Apt 4B (optional)"
        autoComplete="address-line2"
        disabled={busy}
      />
      <Field
        field="city"
        value={address.city}
        onChange={(v) => update("city", v)}
        onBlur={() => handleBlur("city")}
        error={touched.city ? errors.city : undefined}
        required
        autoComplete="address-level2"
        disabled={busy}
      />
      <Field
        field="state_code"
        value={address.state_code}
        onChange={(v) => update("state_code", v.toUpperCase().slice(0, 6))}
        onBlur={() => handleBlur("state_code")}
        error={touched.state_code ? errors.state_code : undefined}
        placeholder="CA"
        required
        autoComplete="address-level1"
        disabled={busy}
      />
      <Field
        field="postcode"
        value={address.postcode}
        onChange={(v) => update("postcode", v)}
        onBlur={() => handleBlur("postcode")}
        error={touched.postcode ? errors.postcode : undefined}
        required
        autoComplete="postal-code"
        disabled={busy}
      />
      <Field
        field="country_code"
        value={address.country_code}
        onChange={(v) => update("country_code", v.toUpperCase().slice(0, 2))}
        onBlur={() => handleBlur("country_code")}
        error={touched.country_code ? errors.country_code : undefined}
        placeholder="US"
        required
        autoComplete="country"
        disabled={busy}
      />
      <Field
        className="col-span-2"
        field="phone_number"
        value={address.phone_number}
        onChange={(v) => update("phone_number", v)}
        onBlur={() => handleBlur("phone_number")}
        error={touched.phone_number ? errors.phone_number : undefined}
        placeholder="555-555-1234"
        required
        autoComplete="tel"
        disabled={busy}
      />
    </div>
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
  disabled?: boolean;
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
  disabled,
  className,
}: FieldProps) {
  const hasError = Boolean(error);
  return (
    <div className={className}>
      <label
        className="block text-xs font-medium text-stone-600 mb-0.5"
        htmlFor={`address-field-${field}`}
      >
        {FIELD_LABEL[field]}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      <input
        id={`address-field-${field}`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={hasError}
        aria-describedby={hasError ? `address-field-${field}-error` : undefined}
        className={`w-full px-3 py-2 rounded-lg border bg-white text-stone-800 text-sm focus:outline-none focus:ring-2 transition-colors disabled:opacity-50 ${
          hasError
            ? "border-red-400 focus:ring-red-400"
            : "border-stone-300 focus:ring-amber-500"
        }`}
      />
      {hasError && (
        <p
          id={`address-field-${field}-error`}
          className="mt-1 text-[11px] text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
