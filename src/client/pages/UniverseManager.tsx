import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUniverses, getUniverse, getLoraStatus, regenerateCharacterSheet } from "../api/client";

export default function UniverseManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: universes = [], isLoading } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  const [selectedUniverseId, setSelectedUniverseId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [sheetPreview, setSheetPreview] = useState<string | null>(null);

  const { data: selectedUniverse } = useQuery({
    queryKey: ["universe", selectedUniverseId],
    queryFn: () => getUniverse(selectedUniverseId!),
    enabled: !!selectedUniverseId,
  });

  const { data: loraStatus } = useQuery({
    queryKey: ["lora-status", selectedUniverseId],
    queryFn: () => getLoraStatus(selectedUniverseId!),
    enabled: !!selectedUniverseId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "training" ? 15000 : false;
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (characterId: string) => regenerateCharacterSheet(characterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["universe", selectedUniverseId] });
    },
  });

  const handleRegenerate = async (characterId: string, characterName: string) => {
    setRegeneratingId(characterId);
    try {
      await regenerateMutation.mutateAsync(characterId);
    } finally {
      setRegeneratingId(null);
    }
  };

  const hero = selectedUniverse?.characters?.find((c: any) => c.role === "main");
  const supporting = (selectedUniverse?.characters || []).filter((c: any) => c.role !== "main");

  let themes: string[] = [];
  try {
    themes = selectedUniverse ? JSON.parse(selectedUniverse.themes) : [];
  } catch {
    themes = selectedUniverse?.themes ? [selectedUniverse.themes] : [];
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate("/library")}
        className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
      >
        &larr; Back to library
      </button>

      <h1 className="text-2xl font-bold text-stone-800 mb-6">Universe Manager</h1>

      <div className="flex gap-6">
        {/* Universe list */}
        <div className="w-64 flex-shrink-0">
          <h2 className="text-sm font-medium text-stone-500 mb-3 uppercase tracking-wider">Universes</h2>
          {isLoading ? (
            <p className="text-stone-400 text-sm">Loading...</p>
          ) : (
            <div className="space-y-2">
              {universes.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUniverseId(u.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    selectedUniverseId === u.id
                      ? "border-primary bg-primary/5 text-stone-800"
                      : "border-stone-200 bg-white text-stone-600 hover:border-primary/30"
                  }`}
                >
                  <p className="font-medium text-sm">{u.name}</p>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {u.characters?.length || 0} characters
                  </p>
                </button>
              ))}
              {universes.length === 0 && (
                <p className="text-stone-400 text-sm">No universes yet</p>
              )}
            </div>
          )}
        </div>

        {/* Universe details */}
        <div className="flex-1">
          {!selectedUniverseId ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
              <p className="text-stone-400">Select a universe to manage</p>
            </div>
          ) : !selectedUniverse ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
              <p className="text-stone-400">Loading...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Universe info */}
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-xl font-bold text-stone-800 mb-1">{selectedUniverse.name}</h2>
                <p className="text-sm text-stone-500 mb-4">{selectedUniverse.settingDescription}</p>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-stone-400">Mood:</span>{" "}
                    <span className="text-stone-700">{selectedUniverse.mood}</span>
                  </div>
                  <div>
                    <span className="text-stone-400">Themes:</span>{" "}
                    <span className="text-stone-700">{themes.join(", ")}</span>
                  </div>
                  <div>
                    <span className="text-stone-400">Avoid:</span>{" "}
                    <span className="text-stone-700">{selectedUniverse.avoidThemes || "None"}</span>
                  </div>
                  <div>
                    <span className="text-stone-400">Style:</span>{" "}
                    <span className="text-stone-700">{selectedUniverse.illustrationStyle}</span>
                  </div>
                  <div>
                    <span className="text-stone-400">ID:</span>{" "}
                    <span className="text-stone-400 font-mono text-xs">{selectedUniverse.id}</span>
                  </div>
                </div>
              </div>

              {/* LoRA status */}
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h3 className="font-semibold text-stone-700 mb-3">LoRA Training</h3>
                {loraStatus?.status === "ready" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-sm text-emerald-700 font-medium">Model ready</span>
                    <span className="text-xs text-stone-400 font-mono ml-2">{loraStatus.model}</span>
                  </div>
                ) : loraStatus?.status === "training" ? (
                  <div className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-amber-600" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm text-amber-700">Training in progress...</span>
                    <span className="text-xs text-stone-400">({loraStatus.replicateStatus})</span>
                  </div>
                ) : loraStatus?.status === "failed" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm text-red-700">Training failed</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-stone-300" />
                    <span className="text-sm text-stone-500">No LoRA trained</span>
                  </div>
                )}
              </div>

              {/* Characters */}
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h3 className="font-semibold text-stone-700 mb-4">Characters</h3>

                {/* Hero */}
                {hero && (
                  <div className="mb-6">
                    <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">Hero</p>
                    <CharacterDetail
                      character={hero}
                      isRegenerating={regeneratingId === hero.id}
                      onRegenerate={() => handleRegenerate(hero.id, hero.name)}
                      onPreviewSheet={() => setSheetPreview(hero.referenceImageUrl)}
                    />
                  </div>
                )}

                {/* Supporting */}
                {supporting.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">Supporting</p>
                    <div className="space-y-3">
                      {supporting.map((c: any) => (
                        <CharacterDetail
                          key={c.id}
                          character={c}
                          isRegenerating={regeneratingId === c.id}
                          onRegenerate={() => handleRegenerate(c.id, c.name)}
                          onPreviewSheet={() => setSheetPreview(c.referenceImageUrl)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Timeline */}
              {selectedUniverse.timelineEvents?.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h3 className="font-semibold text-stone-700 mb-3">
                    Timeline ({selectedUniverse.timelineEvents.length} events)
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {selectedUniverse.timelineEvents.map((e: any) => (
                      <div key={e.id} className="flex items-start gap-2 text-sm">
                        <div
                          className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                            e.significance === "major" ? "bg-primary" : "bg-stone-300"
                          }`}
                        />
                        <div>
                          <span className="font-medium text-stone-600">{e.character?.name}: </span>
                          <span className="text-stone-500">{e.eventSummary}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sheet preview modal */}
      {sheetPreview && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setSheetPreview(null)}
        >
          <div className="max-w-4xl max-h-[90vh] relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSheetPreview(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm"
            >
              Close
            </button>
            <img
              src={sheetPreview}
              alt="Character reference sheet"
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterDetail({
  character,
  isRegenerating,
  onRegenerate,
  onPreviewSheet,
}: {
  character: any;
  isRegenerating: boolean;
  onRegenerate: () => void;
  onPreviewSheet: () => void;
}) {
  let traits: string[] = [];
  try {
    traits = JSON.parse(character.personalityTraits);
  } catch {
    traits = [character.personalityTraits];
  }

  return (
    <div className="border border-stone-100 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-stone-800">{character.name}</h4>
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">
              {character.speciesOrType}
            </span>
          </div>
          <p className="text-sm text-stone-500 mb-2">{character.appearance}</p>
          {character.specialDetail && (
            <p className="text-xs text-primary mb-2">Detail: {character.specialDetail}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {traits.map((t: string) => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-stone-50 text-stone-500">
                {t}
              </span>
            ))}
          </div>

          {/* Relationships */}
          {(character.relationshipsA?.length > 0 || character.relationshipsB?.length > 0) && (
            <div className="mt-2">
              {character.relationshipsA?.map((r: any) => (
                <p key={r.id} className="text-xs text-stone-400">
                  &rarr; {r.characterB?.name}: {r.description}
                </p>
              ))}
              {character.relationshipsB?.map((r: any) => (
                <p key={r.id} className="text-xs text-stone-400">
                  &larr; {r.characterA?.name}: {r.description}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Reference sheet thumbnail + actions */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          {character.referenceImageUrl ? (
            <button onClick={onPreviewSheet} className="group relative">
              <img
                src={character.referenceImageUrl}
                alt={`${character.name} reference sheet`}
                className="w-24 h-16 object-cover rounded-lg border border-stone-200 group-hover:border-primary transition-colors"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors flex items-center justify-center">
                <span className="text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                  View
                </span>
              </div>
            </button>
          ) : (
            <div className="w-24 h-16 rounded-lg border border-dashed border-stone-300 flex items-center justify-center">
              <span className="text-[10px] text-stone-300">No sheet</span>
            </div>
          )}
          <button
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="text-[11px] text-stone-400 hover:text-primary transition-colors disabled:opacity-50"
          >
            {isRegenerating ? (
              <span className="flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Regenerating...
              </span>
            ) : (
              "Regenerate sheet"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
