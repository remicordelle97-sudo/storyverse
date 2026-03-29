import { useNavigate } from "react-router-dom";

interface StoryCardProps {
  story: {
    id: string;
    title: string;
    mood: string;
    createdAt: string;
    characters: { character: { name: string } }[];
    universe?: { name: string };
  };
}

export default function StoryCard({ story }: StoryCardProps) {
  const navigate = useNavigate();
  const date = new Date(story.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <button
      onClick={() => navigate(`/reading/${story.id}`)}
      className="bg-white rounded-xl p-5 shadow-sm border border-stone-200 text-left hover:shadow-md hover:border-primary/30 transition-all w-full"
    >
      <h3 className="font-semibold text-stone-800 mb-1">{story.title}</h3>
      {story.universe && (
        <p className="text-xs text-primary/60 mb-1">{story.universe.name}</p>
      )}
      <p className="text-xs text-stone-400 mb-3">{date}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {story.characters.map(({ character }) => (
          <span
            key={character.name}
            className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
          >
            {character.name}
          </span>
        ))}
      </div>
      <span className="text-xs px-2.5 py-1 rounded-full bg-stone-100 text-stone-500">
        {story.mood}
      </span>
    </button>
  );
}
