import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createCustomUniverse } from "../api/client";
import UniverseBuilderForm, { UniverseBuilderPayload } from "../components/UniverseBuilderForm";

export default function NewUniverse() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSubmit(payload: UniverseBuilderPayload) {
    const { universeId } = await createCustomUniverse(payload);
    // The /custom endpoint returns 202 in milliseconds; the worker
    // does the Claude + Gemini work in the background. Send the
    // user back to /my-universes where the placeholder card and the
    // global ProgressBanner show progress until ready — no
    // intermediate full-screen loading view.
    queryClient.invalidateQueries({ queryKey: ["universes-my"] });
    queryClient.invalidateQueries({ queryKey: ["progress-banner-universes"] });
    queryClient.invalidateQueries({ queryKey: ["universe-quota"] });
    localStorage.setItem("universeId", universeId);
    navigate("/my-universes");
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
