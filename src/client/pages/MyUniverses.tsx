import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMyUniverses, getUniverseQuota } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { parseStringList } from "../lib/parseStringList";

export default function MyUniverses() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const { data: universesPage, isLoading } = useQuery({
    queryKey: ["universes-my"],
    queryFn: () => getMyUniverses(),
    // Poll while any universe is mid-build/illustrating; stop once
    // every universe is either ready or terminally failed.
    refetchInterval: (query) => {
      const items = ((query.state.data as any)?.items as any[]) || [];
      const pending = items.some(
        (u: any) => u.status !== "ready" && u.status !== "failed",
      );
      return pending ? 5000 : false;
    },
  });
  const universes = universesPage?.items ?? [];

  const { data: quota } = useQuery({
    queryKey: ["universe-quota"],
    queryFn: getUniverseQuota,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first universe once they load
  useEffect(() => {
    if (!selectedId && universes.length > 0) {
      setSelectedId(universes[0].id);
    }
  }, [universes, selectedId]);

  const selected = universes.find((u: any) => u.id === selectedId);
  const canCreate = quota ? quota.allowed : false;
  const atLimit = quota && !quota.allowed;

  const themes = selected ? parseStringList(selected.themes) : [];

  const characters = selected?.characters || [];
  const hero = characters.find((c: any) => c.role === "main");
  const supporting = characters.filter((c: any) => c.role !== "main");

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate("/library")}
        className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
      >
        &larr; Back to library
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">My universes</h1>
        <button
          onClick={() => navigate("/new-universe")}
          disabled={!canCreate}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={atLimit ? "You've reached your universe limit. Upgrade to add more." : ""}
        >
          {atLimit ? "Limit reached" : "+ New universe"}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-stone-400">Loading...</p>
      ) : universes.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-500 text-sm mb-4">You don't have any universes yet.</p>
          {canCreate && (
            <button
              onClick={() => navigate("/new-universe")}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Create your first universe
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar: universe list */}
          <div className="md:w-56 flex-shrink-0 space-y-2">
            <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">
              Universes ({universes.length})
            </p>
            {universes.map((u: any) => (
              <button
                key={u.id}
                onClick={() => setSelectedId(u.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  selectedId === u.id
                    ? "border-primary bg-primary/5 text-stone-800"
                    : "border-stone-200 bg-white text-stone-600 hover:border-primary/30"
                }`}
              >
                <p className="font-medium truncate">{u.name}</p>
                <p className="text-[11px] text-stone-400">
                  {u.characters?.length || 0} character{(u.characters?.length || 0) === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="flex-1 space-y-5">
            {!selected ? (
              <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
                <p className="text-stone-400">Select a universe</p>
              </div>
            ) : (
              <>
                {/* Universe info */}
                <div className="bg-white rounded-xl border border-stone-200 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-lg font-bold text-stone-800">{selected.name}</h2>
                    <UniverseStatusBadge universe={selected} />
                  </div>
                  {themes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {themes.map((t) => (
                        <span
                          key={t}
                          className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-500"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">
                    {selected.settingDescription}
                  </p>
                  {selected.styleReferenceUrl && (
                    <img
                      src={selected.styleReferenceUrl}
                      alt={`${selected.name} style reference`}
                      className="mt-4 w-full max-h-72 object-cover rounded-lg border border-stone-100"
                    />
                  )}
                </div>

                {/* Hero */}
                {hero && (
                  <div className="bg-white rounded-xl border border-stone-200 p-5">
                    <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
                      Hero
                    </p>
                    <CharacterCard character={hero} showAppearance={isAdmin} />
                  </div>
                )}

                {/* Supporting characters */}
                {supporting.length > 0 && (
                  <div className="bg-white rounded-xl border border-stone-200 p-5">
                    <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
                      Friends ({supporting.length})
                    </p>
                    <div className="space-y-3">
                      {supporting.map((c: any) => (
                        <CharacterCard key={c.id} character={c} showAppearance={isAdmin} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Badge showing where a universe is in the async creation pipeline.
 * Renders nothing once status === "ready" — the card itself is the
 * affirmative signal at that point. */
function UniverseStatusBadge({ universe }: { universe: any }) {
  const status: string = universe.status || "ready";
  if (status === "ready") return null;
  if (status === "failed") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
        Failed
      </span>
    );
  }
  const label =
    status === "queued"
      ? "Queued..."
      : status === "building"
        ? "Building..."
        : status === "illustrating_assets"
          ? "Generating images..."
          : "Working...";
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
      {label}
    </span>
  );
}

function CharacterCard({
  character,
  showAppearance,
}: {
  character: any;
  showAppearance: boolean;
}) {
  const traits = parseStringList(character.personalityTraits);

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-4 items-start">
      <div className="w-24 h-24 flex-shrink-0 rounded-lg border border-stone-100 overflow-hidden bg-stone-50 flex items-center justify-center">
        {character.referenceImageUrl ? (
          <img
            src={character.referenceImageUrl}
            alt={character.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[10px] text-stone-400 px-2 text-center">
            Generating...
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <h3 className="font-semibold text-stone-800 truncate">{character.name}</h3>
          {character.speciesOrType && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
              {character.speciesOrType}
            </span>
          )}
        </div>
        {traits.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {traits.map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {character.relationshipArchetype && (
          <p className="text-xs text-stone-500 mb-2">{character.relationshipArchetype}</p>
        )}
        {showAppearance && character.appearance && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-left w-full"
          >
            <p
              className={`text-xs text-stone-500 leading-relaxed ${
                expanded ? "" : "line-clamp-2"
              }`}
            >
              {character.appearance}
            </p>
            <span className="text-[10px] text-primary/70 hover:text-primary mt-0.5 inline-block">
              {expanded ? "Show less" : "Show more"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
