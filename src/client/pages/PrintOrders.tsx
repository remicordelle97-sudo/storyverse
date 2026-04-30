import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listPrintOrders } from "../api/client";

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "pending_payment":
      return { label: "Awaiting payment", className: "bg-amber-100 text-amber-900" };
    case "paid":
    case "submitted":
      return { label: "Sent to printer", className: "bg-blue-100 text-blue-900" };
    case "in_production":
      return { label: "Printing", className: "bg-blue-100 text-blue-900" };
    case "shipped":
      return { label: "Shipped", className: "bg-emerald-100 text-emerald-900" };
    case "delivered":
      return { label: "Delivered", className: "bg-emerald-100 text-emerald-900" };
    case "failed":
      return { label: "Failed", className: "bg-red-100 text-red-900" };
    case "cancelled":
      return { label: "Cancelled", className: "bg-stone-200 text-stone-700" };
    case "refunded":
      return { label: "Refunded", className: "bg-stone-200 text-stone-700" };
    default:
      return { label: status, className: "bg-stone-200 text-stone-700" };
  }
}

const NON_TERMINAL_STATUSES = new Set([
  "pending_payment",
  "paid",
  "submitted",
  "in_production",
]);

export default function PrintOrders() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["print-orders"],
    queryFn: () => listPrintOrders(),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((o) => NON_TERMINAL_STATUSES.has(o.status)) ? 5000 : false;
    },
  });

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
          <h1 className="text-2xl font-bold text-stone-900">My printed books</h1>
        </div>

        {isLoading ? (
          <p className="text-stone-500 text-center py-12">Loading…</p>
        ) : !data || data.items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-10 text-center">
            <p className="text-stone-700 mb-2">No orders yet.</p>
            <p className="text-sm text-stone-500">
              Open a story and tap "Print book" to order a real, printed copy.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.items.map((order) => {
              const badge = statusBadge(order.status);
              return (
                <li
                  key={order.id}
                  className="bg-white rounded-xl shadow-sm border border-stone-200 p-4 cursor-pointer hover:border-stone-300 transition-colors"
                  onClick={() => navigate(`/print/orders/${order.id}`)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-stone-900">{order.storyTitle}</p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Ordered {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <span className="text-sm font-semibold text-stone-700">
                        {formatCents(order.customerPriceCents)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
