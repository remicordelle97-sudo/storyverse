import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUniverse, getStories, createCharacter } from "../api/client";
import CharacterCard from "../components/CharacterCard";
import StoryCard from "../components/StoryCard";
import { useAuth } from "../auth/AuthContext";
import Chip from "../components/Chip";

const PERSONALITIES = [
  "Brave",
  "Curious",
  "Funny",
  "Kind",
  "Shy but brave",
  "Clever",
  "Mischievous",
  "Loyal",
  "Cautious",
  "Energetic",
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const universeId = localStorage.getItem("universeId");

  const { data: universe, isLoading: loadingUniverse } = useQuery({
    queryKey: ["universe", universeId],
    queryFn: () => getUniverse(universeId!),
    enabled: !!universeId,
  });

  const { data: stories } = useQuery({
    queryKey: ["stories", universeId],
    queryFn: () => getStories(universeId!),
    enabled: !!universeId,
  });

  // Add character form
  const [showAddChar, setShowAddChar] = useState(false);
  const [charName, setCharName] = useState("");
  const [charSpecies, setCharSpecies] = useState("");
  const [charTraits, setCharTraits] = useState<string[]>([]);
  const [charAppearance, setCharAppearance] = useState("");
  const [charDetail, setCharDetail] = useState("");
  const [charRelationship, setCharRelationship] = useState("");
  const [savingChar, setSavingChar] = useState(false);

  const toggleTrait = (t: string) =>
    setCharTraits((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const resetCharForm = () => {
    setShowAddChar(false);
    setCharName("");
    setCharSpecies("");
    setCharTraits([]);
    setCharAppearance("");
    setCharDetail("");
    setCharRelationship("");
  };

  const handleAddCharacter = async () => {
    if (!universeId || !charName.trim() || !charSpecies.trim()) return;
    setSavingChar(true);
    try {
      await createCharacter({
        universeId,
        name: charName,
        speciesOrType: charSpecies,
        personalityTraits: JSON.stringify(charTraits),
        appearance: charAppearance || `A friendly ${charSpecies.toLowerCase()}`,
        specialDetail: charDetail,
        role: "supporting",
        relationshipToHero: charRelationship,
      });
      queryClient.invalidateQueries({ queryKey: ["universe", universeId] });
      resetCharForm();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingChar(false);
    }
  };

  if (!universeId) {
    navigate("/universes");
    return null;
  }

  if (loadingUniverse) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-400">Loading your universe...</p>
      </div>
    );
  }

  const hero = universe?.characters?.find((c: any) => c.role === "main");
  const secondaryCharacters = (universe?.characters || []).filter(
    (c: any) => c.role !== "main"
  );
  const recentStories = (stories || []).slice(0, 3);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* User bar */}
      <div className="flex items-center justify-end gap-3 mb-6">
        <button
          onClick={() => navigate("/universes")}
          className="text-sm text-stone-500 hover:text-stone-700 mr-auto"
        >
          &larr; Worlds
        </button>
        {user?.picture && (
          <img
            src={user.picture}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="text-sm text-stone-600">{user?.name}</span>
        <button
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
          className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-stone-800">
            {universe?.name}
          </h1>
          <p className="text-stone-500 mt-1">
            {universe?.child?.name ? `${universe.child.name}'s world · ` : ""}
            {universe?.mood}
          </p>
        </div>
        <button
          onClick={() => navigate("/story-builder")}
          className="px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          New story
        </button>
      </div>

      {/* Hero */}
      {hero && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-stone-700 mb-4">Hero</h2>
          <CharacterCard character={hero} />
        </section>
      )}

      {/* Secondary Characters */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-stone-700 mb-4">
          Supporting Characters
        </h2>
        {secondaryCharacters.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {secondaryCharacters.map((c: any) => (
              <CharacterCard key={c.id} character={c} />
            ))}
          </div>
        )}

        {showAddChar ? (
          <div className="bg-white rounded-xl p-5 border border-stone-200">
            <h3 className="font-semibold text-stone-700 mb-4">
              Add a supporting character
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={charName}
                  onChange={(e) => setCharName(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. Zuri the Zebra"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Species / Type
                </label>
                <input
                  type="text"
                  value={charSpecies}
                  onChange={(e) => setCharSpecies(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. Zebra"
                />
              </div>
            </div>
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Personality
            </label>
            <div className="flex flex-wrap gap-2 mb-4">
              {PERSONALITIES.map((p) => (
                <Chip
                  key={p}
                  label={p}
                  selected={charTraits.includes(p)}
                  onClick={() => toggleTrait(p)}
                />
              ))}
            </div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Appearance (optional)
            </label>
            <input
              type="text"
              value={charAppearance}
              onChange={(e) => setCharAppearance(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. A small zebra with bright eyes"
            />
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Special detail (optional)
            </label>
            <input
              type="text"
              value={charDetail}
              onChange={(e) => setCharDetail(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. Has one stripe that zigzags differently"
            />
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Relationship with {hero?.name || "the hero"}
            </label>
            <input
              type="text"
              value={charRelationship}
              onChange={(e) => setCharRelationship(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={`e.g. Best friends since they were young`}
            />
            <div className="flex gap-3">
              <button
                onClick={handleAddCharacter}
                disabled={
                  savingChar || !charName.trim() || !charSpecies.trim()
                }
                className="px-5 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingChar ? "Adding..." : "Add character"}
              </button>
              <button
                onClick={resetCharForm}
                className="px-5 py-2.5 text-stone-600 hover:text-stone-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddChar(true)}
            className="w-full py-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 hover:border-primary hover:text-primary transition-colors font-medium"
          >
            + Add a supporting character
          </button>
        )}
      </section>

      {/* Recent Stories */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-stone-700">
            Recent stories
          </h2>
          <button
            onClick={() => navigate("/library")}
            className="text-sm text-primary hover:underline"
          >
            View library
          </button>
        </div>
        {recentStories.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {recentStories.map((s: any) => (
              <StoryCard key={s.id} story={s} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl p-8 text-center border border-stone-200">
            <p className="text-stone-400 mb-4">No stories yet</p>
            <button
              onClick={() => navigate("/story-builder")}
              className="text-primary font-medium hover:underline"
            >
              Write your first story
            </button>
          </div>
        )}
      </section>

      {/* Timeline */}
      {universe?.timelineEvents?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-stone-700 mb-4">
            Timeline
          </h2>
          <div className="bg-white rounded-xl p-5 border border-stone-200">
            {universe.timelineEvents.slice(0, 8).map((e: any) => (
              <div key={e.id} className="flex items-start gap-3 py-2">
                <div
                  className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    e.significance === "major" ? "bg-primary" : "bg-stone-300"
                  }`}
                />
                <div>
                  <span className="text-sm font-medium text-stone-700">
                    {e.character?.name}
                  </span>
                  <p className="text-sm text-stone-500">{e.eventSummary}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
