import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createCustomUniverse } from "../api/client";
import StoryLoadingScreen from "../components/StoryLoadingScreen";
import UniverseBuilderForm, { UniverseBuilderPayload } from "../components/UniverseBuilderForm";

const PHRASES = [
  "Building your universe",
  "Bringing characters to life",
  "Sketching the world",
  "Painting first impressions",
];

export default function NewUniverse() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(payload: UniverseBuilderPayload) {
    setSubmitting(true);
    try {
      const { universeId } = await createCustomUniverse(payload);
      queryClient.invalidateQueries({ queryKey: ["universes-my"] });
      queryClient.invalidateQueries({ queryKey: ["universe-quota"] });
      localStorage.setItem("universeId", universeId);
      navigate("/my-universes");
    } catch (e) {
      setSubmitting(false);
      throw e;
    }
  }

  if (submitting) {
    return <StoryLoadingScreen phrases={PHRASES} />;
  }

  return (
    <div className="min-h-screen app-bg flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-3xl">
        <button
          onClick={() => navigate("/my-universes")}
          className="text-sm text-stone-500 hover:text-stone-700 mb-6 block"
        >
          &larr; Back to my universes
        </button>

        <h1 className="text-2xl font-bold text-stone-800 mb-6">Create a new universe</h1>

        <UniverseBuilderForm
          onSubmit={handleSubmit}
          onCancel={() => navigate("/my-universes")}
          cancelLabel="Cancel"
          submitLabel="Create universe"
          title="Build your world"
          subtitle="Choose a name, themes, and a hero. We'll handle the rest."
        />
      </div>
    </div>
  );
}
