import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory } from "../api/client";

export default function ReadingMode() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const [sceneIndex, setSceneIndex] = useState(0);

  const { data: story, isLoading } = useQuery({
    queryKey: ["story", storyId],
    queryFn: () => getStory(storyId!),
    enabled: !!storyId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-400">Loading story...</p>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-400">Story not found</p>
      </div>
    );
  }

  const scenes = story.scenes || [];
  const scene = scenes[sceneIndex];
  const isLast = sceneIndex === scenes.length - 1;
  const isFirst = sceneIndex === 0;

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate("/library")}
            className="text-sm text-stone-500 hover:text-stone-700"
          >
            &larr; Back to library
          </button>
          <span className="text-sm text-stone-400">
            Scene {sceneIndex + 1} of {scenes.length}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-stone-800 mb-8 text-center">
          {story.title}
        </h1>

        {/* Illustration */}
        {scene?.imageUrl ? (
          <img
            src={scene.imageUrl}
            alt={`Illustration for scene ${sceneIndex + 1}`}
            className="w-full rounded-xl mb-8 shadow-sm"
          />
        ) : (
          <div className="bg-stone-200 rounded-xl h-48 mb-8 flex items-center justify-center">
            <p className="text-stone-400 text-sm">Illustration</p>
          </div>
        )}

        {/* Scene content */}
        {scene && (
          <div className="font-serif text-lg leading-relaxed text-stone-700 mb-12">
            {scene.content}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSceneIndex((i) => i - 1)}
            disabled={isFirst}
            className="px-5 py-2.5 text-stone-600 hover:text-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            &larr; Previous
          </button>

          {isLast ? (
            <div className="flex items-center gap-4">
              <span className="text-primary font-semibold">The End</span>
              <button
                onClick={() => setSceneIndex(0)}
                className="px-5 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Read again
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSceneIndex((i) => i + 1)}
              className="px-5 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Next &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
