import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUniverses,
  getUniverse,
  getLocations,
  regenerateCharacterSheet,
  generateAllCharacterSheets,
  generateCharacters,
  generateLocations,
  generateLocationReferenceSheet,
  generateStyleReference,
  toggleUniversePublic,
  deleteUniverse,
} from "../api/client";

function ActionButton({
  onClick,
  loading,
  loadingText,
  children,
  variant = "default",
}: {
  onClick: () => void;
  loading: boolean;
  loadingText: string;
  children: React.ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  const colors = {
    default: "border-stone-200 text-stone-600 hover:border-primary hover:text-primary",
    primary: "border-primary bg-primary text-white hover:bg-primary/90",
    danger: "border-red-200 text-red-600 hover:border-red-400",
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${colors[variant]}`}
    >
      {loading ? (
        <span className="flex items-center gap-1">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {loadingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export default function UniverseManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: universes = [], isLoading } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetPreview, setSheetPreview] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [poseCount, setPoseCount] = useState(8);

  const { data: universe, isError: universeError } = useQuery({
    queryKey: ["universe", selectedId],
    queryFn: () => getUniverse(selectedId!),
    enabled: !!selectedId,
    retry: 1,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", selectedId],
    queryFn: () => getLocations(selectedId!),
    enabled: !!selectedId,
    retry: 1,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["universe", selectedId] });
    queryClient.invalidateQueries({ queryKey: ["locations", selectedId] });
  };

  const doAction = async (id: string, fn: () => Promise<any>) => {
    setActionLoading(id);
    try {
      await fn();
      invalidate();
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const hero = universe?.characters?.find((c: any) => c.role === "main");
  const supporting = (universe?.characters || []).filter((c: any) => c.role !== "main");

  let themes: string[] = [];
  try { themes = universe ? JSON.parse(universe.themes) : []; } catch { themes = []; }

  // Collect all existing sheet URLs for style reference
  const allSheetUrls = [
    ...(universe?.characters || []).filter((c: any) => c.referenceImageUrl).map((c: any) => c.referenceImageUrl),
    ...locations.filter((l: any) => l.referenceImageUrl).map((l: any) => l.referenceImageUrl),
  ];


  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <button onClick={() => navigate("/library")} className="text-sm text-stone-500 hover:text-stone-700 mb-6 block">
        &larr; Back to library
      </button>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Universe Manager</h1>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 space-y-2">
          <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">Universes</p>
          {isLoading ? (
            <p className="text-stone-400 text-sm">Loading...</p>
          ) : (
            universes.map((u: any) => (
              <button
                key={u.id}
                onClick={() => setSelectedId(u.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  selectedId === u.id
                    ? "border-primary bg-primary/5 text-stone-800"
                    : "border-stone-200 bg-white text-stone-600 hover:border-primary/30"
                }`}
              >
                <p className="font-medium">{u.name}</p>
                <p className="text-[11px] text-stone-400">{u.characters?.length || 0} chars</p>
              </button>
            ))
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-5">
          {!selectedId ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
              <p className="text-stone-400">Select a universe</p>
            </div>
          ) : universeError ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
              <p className="text-red-500 text-sm">Failed to load universe. Check the terminal for errors.</p>
            </div>
          ) : !universe ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
              <p className="text-stone-400">Loading...</p>
            </div>
          ) : (
            <>
              {/* Universe info */}
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-lg font-bold text-stone-800">{universe.name}</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await toggleUniversePublic(universe.id);
                        invalidate();
                      }}
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                        universe.isPublic
                          ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                          : "bg-stone-100 text-stone-400 hover:bg-stone-200"
                      }`}
                    >
                      {universe.isPublic ? "Featured (public)" : "Publish to all users"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete "${universe.name}" and all its stories, characters, and locations? This cannot be undone.`)) return;
                        await deleteUniverse(universe.id);
                        queryClient.invalidateQueries({ queryKey: ["universes"] });
                        setSelectedId(null);
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full font-medium bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-sm text-stone-500 mb-3">{universe.settingDescription}</p>
                <div className="space-y-2 text-xs">
                  <div><span className="text-stone-400">Themes:</span> <span className="text-stone-600">{themes.join(", ")}</span></div>
                  {universe.sensoryDetails && <div><span className="text-stone-400">Sensory:</span> <span className="text-stone-600">{universe.sensoryDetails}</span></div>}
                  {universe.worldRules && <div><span className="text-stone-400">World rules:</span> <span className="text-stone-600">{universe.worldRules}</span></div>}
                  {universe.scaleAndGeography && <div><span className="text-stone-400">Scale:</span> <span className="text-stone-600">{universe.scaleAndGeography}</span></div>}
                  <div><span className="text-stone-400">Avoid:</span> <span className="text-stone-600">{universe.avoidThemes || "None"}</span></div>
                </div>
              </div>

              {/* Style Reference */}
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-stone-700 text-sm">Art Style Reference</h3>
                  <ActionButton
                    onClick={() => doAction("gen-style-ref", async () => {
                      await generateStyleReference(selectedId!);
                      invalidate();
                    })}
                    loading={actionLoading === "gen-style-ref"}
                    loadingText="Generating..."
                  >
                    {universe.styleReferenceUrl ? "Regenerate" : "Generate"}
                  </ActionButton>
                </div>
                {universe.styleReferenceUrl ? (
                  <img
                    src={universe.styleReferenceUrl}
                    alt="Art style reference"
                    className="w-full rounded-lg"
                  />
                ) : (
                  <p className="text-xs text-stone-400">No style reference yet. Generate one to anchor the visual style for all illustrations.</p>
                )}
              </div>

              {/* Characters */}
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-stone-700 text-sm">
                    Characters ({(universe.characters || []).length})
                  </h3>
                  <div className="flex gap-2">
                    {supporting.length === 0 && hero && (
                      <ActionButton
                        onClick={() => doAction("gen-chars", () => generateCharacters(selectedId!))}
                        loading={actionLoading === "gen-chars"}
                        loadingText="Generating..."
                      >
                        Generate supporting characters
                      </ActionButton>
                    )}
                    {(universe.characters || []).length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={poseCount}
                          onChange={(e) => setPoseCount(parseInt(e.target.value))}
                          className="text-xs border border-stone-200 rounded px-1.5 py-1 text-stone-500 bg-white"
                          title="Number of poses per character"
                        >
                          {[4, 6, 8, 10, 12].map((n) => (
                            <option key={n} value={n}>{n} poses</option>
                          ))}
                        </select>
                        <ActionButton
                          onClick={() => doAction("gen-all-sheets", () => generateAllCharacterSheets(selectedId!, poseCount))}
                          loading={actionLoading === "gen-all-sheets"}
                          loadingText="Generating all..."
                          variant="primary"
                        >
                          Generate all sheets
                        </ActionButton>
                      </div>
                    )}
                  </div>
                </div>
                {!hero && (universe.characters || []).length === 0 && (
                  <p className="text-xs text-red-500 mb-2">No hero found. Try creating the universe again.</p>
                )}
                <div className="space-y-3">
                  {(universe.characters || []).map((char: any) => (
                    <SheetRow
                      key={char.id}
                      name={char.name}
                      subtitle={`${char.speciesOrType} · ${char.role}`}
                      description={char.appearance}
                      detail={[
                        char.personalityTraits ? `Personality: ${char.personalityTraits}` : "",
                        char.outfit ? `Outfit: ${char.outfit}` : "",
                        char.relationshipArchetype ? `Archetype: ${char.relationshipArchetype}` : "",
                      ].filter(Boolean).join("\n")}
                      imageUrl={char.referenceImageUrl}
                      onPreview={() => setSheetPreview(char.referenceImageUrl)}
                      onGenerate={() =>
                        doAction(`char-sheet-${char.id}`, () => regenerateCharacterSheet(char.id, poseCount))
                      }
                      isGenerating={actionLoading === `char-sheet-${char.id}`}
                      poseCount={poseCount}
                      onPoseCountChange={setPoseCount}
                    />
                  ))}
                </div>
              </div>

              {/* Locations */}
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-stone-700 text-sm">
                    Locations ({locations.length})
                  </h3>
                  {locations.length === 0 && (
                    <ActionButton
                      onClick={() => doAction("gen-locs", () => generateLocations(selectedId!))}
                      loading={actionLoading === "gen-locs"}
                      loadingText="Generating..."
                    >
                      Generate locations
                    </ActionButton>
                  )}
                </div>
                {locations.length === 0 ? (
                  <p className="text-xs text-stone-400">No locations yet. Generate them to define your world's geography.</p>
                ) : (
                  <div className="space-y-3">
                    {locations.map((loc: any) => (
                      <SheetRow
                        key={loc.id}
                        name={loc.name}
                        subtitle={loc.role}
                        description={loc.description}
                        detail={[
                          loc.mood ? `Mood: ${loc.mood}` : "",
                          loc.lighting ? `Lighting: ${loc.lighting}` : "",
                          loc.landmarks ? `Landmarks: ${loc.landmarks}` : "",
                        ].filter(Boolean).join("\n")}
                        imageUrl={loc.referenceImageUrl}
                        onPreview={() => setSheetPreview(loc.referenceImageUrl)}
                        onGenerate={() =>
                          doAction(`loc-sheet-${loc.id}`, () => generateLocationReferenceSheet(loc.id))
                        }
                        isGenerating={actionLoading === `loc-sheet-${loc.id}`}
                      />
                    ))}
                  </div>
                )}
              </div>

            </>
          )}
        </div>
      </div>

      {/* Sheet preview modal */}
      {sheetPreview && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSheetPreview(null)}>
          <div className="max-w-5xl max-h-[90vh] relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSheetPreview(null)} className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm">
              Close
            </button>
            <img src={sheetPreview} alt="Reference sheet" className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}

function SheetRow({
  name,
  subtitle,
  description,
  detail,
  imageUrl,
  onPreview,
  onGenerate,
  isGenerating,
  poseCount,
  onPoseCountChange,
}: {
  name: string;
  subtitle: string;
  description: string;
  detail?: string;
  imageUrl: string;
  onPreview: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  poseCount?: number;
  onPoseCountChange?: (count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-stone-100">
      {/* Thumbnail */}
      <div className="flex-shrink-0">
        {imageUrl ? (
          <button onClick={onPreview} className="group relative">
            <img
              src={imageUrl}
              alt={`${name} sheet`}
              className="w-20 h-14 object-cover rounded-md border border-stone-200 group-hover:border-primary transition-colors"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-md transition-colors" />
          </button>
        ) : (
          <div className="w-20 h-14 rounded-md border border-dashed border-stone-300 flex items-center justify-center">
            <span className="text-[9px] text-stone-300">No sheet</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-stone-800 truncate">{name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-400">{subtitle}</span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-left w-full mt-0.5"
        >
          <p className={`text-xs text-stone-500 ${expanded ? "" : "line-clamp-2"}`}>{description}</p>
          {detail && (
            <p className={`text-[10px] text-stone-400 mt-0.5 whitespace-pre-wrap ${expanded ? "" : "line-clamp-1"}`}>{detail}</p>
          )}
          <span className="text-[10px] text-primary/60 hover:text-primary mt-0.5 inline-block">
            {expanded ? "Show less" : "Show more"}
          </span>
        </button>
      </div>

      {/* Generate button (with optional pose selector) */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {poseCount !== undefined && onPoseCountChange && (
          <select
            value={poseCount}
            onChange={(e) => onPoseCountChange(parseInt(e.target.value))}
            className="text-[10px] border border-stone-200 rounded px-1 py-1 text-stone-500 bg-white"
            title="Number of poses"
          >
            {[4, 6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>{n} poses</option>
            ))}
          </select>
        )}
        <ActionButton
          onClick={onGenerate}
          loading={isGenerating}
          loadingText="Generating..."
        >
          {imageUrl ? "Regen" : "Generate"}
        </ActionButton>
      </div>
    </div>
  );
}
