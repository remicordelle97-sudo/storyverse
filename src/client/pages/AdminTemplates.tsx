import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminUniverses, toggleUniverseTemplate } from "../api/client";

export default function AdminTemplates() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: universes = [], isLoading } = useQuery({
    queryKey: ["admin-universes"],
    queryFn: getAdminUniverses,
  });

  async function handleToggle(id: string) {
    try {
      await toggleUniverseTemplate(id);
      queryClient.invalidateQueries({ queryKey: ["admin-universes"] });
    } catch (e: any) {
      alert(e.message || "Failed to toggle");
    }
  }

  const templates = universes.filter((u: any) => u.isTemplate);
  const others = universes.filter((u: any) => !u.isTemplate);

  return (
    <div className="min-h-screen bg-amber-950/5">
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <h1
            className="text-3xl font-bold text-amber-900"
            style={{ fontFamily: "Lexend, sans-serif" }}
          >
            Default Universes
          </h1>
          <button
            onClick={() => navigate("/admin")}
            className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
          >
            Back to Admin
          </button>
        </div>
        <p className="text-sm text-stone-500 mt-2">
          Universes marked as templates are offered to new users during onboarding.
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-8">
        <Section
          title={`Templates (${templates.length})`}
          emptyText="No templates yet. Mark a universe below to make it available during onboarding."
          universes={templates}
          onToggle={handleToggle}
          isLoading={isLoading}
        />
        <Section
          title={`All other universes (${others.length})`}
          emptyText="No other universes."
          universes={others}
          onToggle={handleToggle}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  emptyText,
  universes,
  onToggle,
  isLoading,
}: {
  title: string;
  emptyText: string;
  universes: any[];
  onToggle: (id: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h2 className="font-semibold text-stone-700 text-sm mb-3">{title}</h2>
      {isLoading ? (
        <p className="text-sm text-stone-400">Loading...</p>
      ) : universes.length === 0 ? (
        <p className="text-sm text-stone-400">{emptyText}</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {universes.map((u: any) => (
            <div
              key={u.id}
              className="border border-stone-200 rounded-lg overflow-hidden flex flex-col"
            >
              {u.styleReferenceUrl ? (
                <div className="aspect-[4/3] bg-stone-100">
                  <img
                    src={u.styleReferenceUrl}
                    alt={u.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-[4/3] bg-stone-100 flex items-center justify-center">
                  <span className="text-xs text-stone-400">No style reference</span>
                </div>
              )}
              <div className="p-3 flex-1 flex flex-col">
                <h3 className="font-medium text-stone-800 text-sm truncate">{u.name}</h3>
                <p className="text-[11px] text-stone-400 mb-1">
                  by {u.user?.email || "unknown"} · {u._count?.characters ?? 0} chars
                </p>
                <p className="text-xs text-stone-500 line-clamp-2 mb-3 flex-1">
                  {u.settingDescription}
                </p>
                <button
                  onClick={() => onToggle(u.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    u.isTemplate
                      ? "bg-primary text-white hover:bg-primary/90"
                      : "border border-stone-200 text-stone-600 hover:border-primary hover:text-primary"
                  }`}
                >
                  {u.isTemplate ? "Remove from templates" : "Make template"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
