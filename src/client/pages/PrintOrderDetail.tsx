import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPrintOrder } from "../api/client";

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

interface StatusVisual {
  label: string;
  description: string;
  tone: "pending" | "good" | "bad" | "neutral";
}

function statusVisual(status: string): StatusVisual {
  switch (status) {
    case "pending_payment":
      return {
        label: "Awaiting payment",
        description: "We're waiting for Stripe to confirm the payment.",
        tone: "pending",
      };
    case "paid":
      return {
        label: "Payment received",
        description: "Submitting your books to the printer…",
        tone: "pending",
      };
    case "submitted":
      return {
        label: "Sent to printer",
        description: "Lulu has accepted the print job.",
        tone: "good",
      };
    case "in_production":
      return {
        label: "Printing",
        description: "Your books are being printed.",
        tone: "good",
      };
    case "shipped":
      return {
        label: "Shipped",
        description: "On its way! Tracking is below.",
        tone: "good",
      };
    case "delivered":
      return {
        label: "Delivered",
        description: "Enjoy your books.",
        tone: "good",
      };
    case "failed":
      return {
        label: "Couldn't print",
        description: "Something went wrong with the printer.",
        tone: "bad",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        description: "This order was cancelled.",
        tone: "neutral",
      };
    case "refunded":
      return {
        label: "Refunded",
        description: "This order was refunded.",
        tone: "neutral",
      };
    default:
      return { label: status, description: "", tone: "neutral" };
  }
}

const NON_TERMINAL = new Set([
  "pending_payment",
  "paid",
  "submitted",
  "in_production",
]);

export default function PrintOrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const justPaid = searchParams.get("session_id") !== null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["print-order", orderId],
    queryFn: () => getPrintOrder(orderId!),
    enabled: !!orderId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 3000;
      return NON_TERMINAL.has(status) ? 3000 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500" style={{ fontFamily: "Lexend, sans-serif" }}>
          Loading your order…
        </p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-stone-700" style={{ fontFamily: "Lexend, sans-serif" }}>
          We couldn't load this order.
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

  const visual = statusVisual(data.status);
  const toneClass = {
    pending: "bg-amber-100 text-amber-900 border-amber-200",
    good: "bg-emerald-100 text-emerald-900 border-emerald-200",
    bad: "bg-red-100 text-red-900 border-red-200",
    neutral: "bg-stone-100 text-stone-800 border-stone-200",
  }[visual.tone];

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ fontFamily: "Lexend, sans-serif" }}
    >
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <button
            onClick={() => navigate("/orders")}
            className="text-stone-500 hover:text-stone-800 text-sm transition-colors"
          >
            &larr; All orders
          </button>
        </div>

        {justPaid && data.status === "pending_payment" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
            Stripe just confirmed your payment. We're submitting your order to
            the printer now — this page will update automatically.
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-stone-500">Order</p>
            <h1 className="text-xl font-bold text-stone-900">
              {data.items.length === 1
                ? data.items[0].storyTitle
                : `${data.items.length} books`}
            </h1>
          </div>

          <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
            <p className="font-semibold text-sm">{visual.label}</p>
            {visual.description && (
              <p className="text-sm opacity-90 mt-0.5">{visual.description}</p>
            )}
            {data.rejectionReason && (
              <p className="text-xs mt-2 opacity-80">{data.rejectionReason}</p>
            )}
          </div>

          {data.luluTrackingUrl && (
            <a
              href={data.luluTrackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium transition-colors"
            >
              Track shipment &rarr;
            </a>
          )}

          {data.items.length > 1 && (
            <div className="border-t border-stone-200 pt-4">
              <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Books in this order
              </p>
              <ul className="space-y-1.5">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-stone-700">{item.storyTitle}</span>
                    <span className="text-stone-500">
                      {formatCents(Math.round((item.customerPriceCents || 0)))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-stone-200 pt-4 space-y-1">
            {data.items.length > 1 && (
              <Row
                label="Print"
                value={formatCents(data.customerSubtotalCents)}
                muted
              />
            )}
            <Row
              label="Shipping"
              value={formatCents(data.shippingCents)}
              muted
            />
            <div className="pt-1.5">
              <Row
                label="Total"
                value={formatCents(data.customerTotalCents)}
                bold
              />
            </div>
          </div>

          {data.shippingAddress && (
            <div className="border-t border-stone-200 pt-4">
              <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Shipping to
              </p>
              <div className="text-sm text-stone-700 leading-relaxed">
                <div>{data.shippingAddress.name}</div>
                <div>{data.shippingAddress.street1}</div>
                {data.shippingAddress.street2 && (
                  <div>{data.shippingAddress.street2}</div>
                )}
                <div>
                  {data.shippingAddress.city}, {data.shippingAddress.state_code}{" "}
                  {data.shippingAddress.postcode}
                </div>
                <div>{data.shippingAddress.country_code}</div>
              </div>
            </div>
          )}

          <div className="border-t border-stone-200 pt-4 text-xs text-stone-400">
            Order placed {new Date(data.createdAt).toLocaleString()}
          </div>
        </div>
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
